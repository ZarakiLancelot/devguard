import type { ChangedFile } from '../types/repository.js';
import { GitCommandError, runGitCommand } from './git-command-runner.js';
import { validateGitRepositoryPath } from './git-repository-path.js';
import type { ValidatedGitRepository } from './git-repository-validator.js';

/** Maximum retained patch size per changed-file record: 256 KiB. */
export const MAX_PATCH_BYTES = 256 * 1024;

const MAX_CONCURRENT_PATCH_COMMANDS = 4;

const WARNING_MESSAGES: Readonly<Record<GitPatchWarningCode, string>> = {
  PATCH_UNAVAILABLE: 'Patch metadata could not be loaded.',
  PATCH_TOO_LARGE: 'Patch was omitted because it exceeds the maximum allowed size.',
  PATCH_BINARY: 'Patch was omitted because it is not supported text content.',
  PATCH_LOAD_TIMED_OUT: 'Patch metadata loading timed out.',
};

export interface LoadChangedFilePatchesInput {
  repositoryId: string;
  repository: ValidatedGitRepository;
  changedFiles: readonly ChangedFile[];
}

export type GitPatchWarningCode =
  | 'PATCH_UNAVAILABLE'
  | 'PATCH_TOO_LARGE'
  | 'PATCH_BINARY'
  | 'PATCH_LOAD_TIMED_OUT';

export interface GitPatchWarning {
  code: GitPatchWarningCode;
  repositoryId: string;
  path: string;
  message: string;
}

export interface LoadChangedFilePatchesResult {
  changedFiles: ChangedFile[];
  warnings: GitPatchWarning[];
}

interface PatchLoadOutcome {
  changedFile: ChangedFile;
  warning?: GitPatchWarning;
}

/**
 * Loads immutable per-record unified patches without mutating Task 10.3 metadata.
 * The current runner buffers stdout before this loader can enforce its patch cap.
 */
export async function loadChangedFilePatches(
  input: LoadChangedFilePatchesInput,
): Promise<LoadChangedFilePatchesResult> {
  const outcomes = await mapWithConcurrency(
    input.changedFiles,
    MAX_CONCURRENT_PATCH_COMMANDS,
    (file) => loadOnePatch(input, file),
  );

  return {
    changedFiles: outcomes.map((outcome) => outcome.changedFile),
    warnings: outcomes
      .flatMap((outcome) => (outcome.warning === undefined ? [] : [outcome.warning]))
      .sort(compareWarnings),
  };
}

async function loadOnePatch(
  input: LoadChangedFilePatchesInput,
  changedFile: ChangedFile,
): Promise<PatchLoadOutcome> {
  let paths: string[];

  try {
    paths = getValidatedPatchPaths(changedFile);
  } catch {
    return createWarningOutcome(input.repositoryId, changedFile, 'PATCH_UNAVAILABLE');
  }

  try {
    const result = await runGitCommand({
      repositoryPath: input.repository.repositoryPath,
      args: [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--unified=0',
        '--find-renames=50%',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        `${input.repository.baseCommit}...${input.repository.headRef}`,
        '--',
        ...paths,
      ],
    });

    if (result.stdout.includes('\u0000')) {
      return createWarningOutcome(input.repositoryId, changedFile, 'PATCH_BINARY');
    }

    if (Buffer.byteLength(result.stdout, 'utf8') > MAX_PATCH_BYTES) {
      return createWarningOutcome(input.repositoryId, changedFile, 'PATCH_TOO_LARGE');
    }

    return { changedFile: { ...changedFile, patch: result.stdout } };
  } catch (error) {
    return createWarningOutcome(
      input.repositoryId,
      changedFile,
      error instanceof GitCommandError && error.code === 'GIT_COMMAND_TIMED_OUT'
        ? 'PATCH_LOAD_TIMED_OUT'
        : 'PATCH_UNAVAILABLE',
    );
  }
}

function getValidatedPatchPaths(changedFile: ChangedFile): string[] {
  if (changedFile.status !== 'renamed') {
    return [validateGitRepositoryPath(changedFile.path)];
  }

  if (changedFile.previousPath === undefined) {
    throw new Error('Renamed changed file requires a previous path.');
  }

  return [
    validateGitRepositoryPath(changedFile.previousPath),
    validateGitRepositoryPath(changedFile.path),
  ];
}

function createWarningOutcome(
  repositoryId: string,
  changedFile: ChangedFile,
  code: GitPatchWarningCode,
): PatchLoadOutcome {
  return {
    changedFile: copyWithoutPatch(changedFile),
    warning: {
      code,
      repositoryId,
      path: changedFile.path,
      message: WARNING_MESSAGES[code],
    },
  };
}

function copyWithoutPatch(changedFile: ChangedFile): ChangedFile {
  const { patch: _patch, ...copiedChangedFile } = changedFile;
  return copiedChangedFile;
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  maximumConcurrency: number,
  operation: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = new Array(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      const value = values[index];
      if (value === undefined) {
        return;
      }

      results[index] = await operation(value);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrency, values.length) }, () => worker()),
  );

  return results;
}

function compareWarnings(left: GitPatchWarning, right: GitPatchWarning): number {
  return (
    compareCodePoints(left.repositoryId, right.repositoryId) ||
    compareCodePoints(left.path, right.path) ||
    compareCodePoints(left.code, right.code)
  );
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }

  return leftPoints.length - rightPoints.length;
}
