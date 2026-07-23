import type { ChangedFile } from '../types/repository.js';
import { GitCommandError, runGitCommand } from './git-command-runner.js';
import type { ValidatedGitRepository } from './git-repository-validator.js';
import { GitNameStatusParseError, parseGitNameStatus } from './git-name-status-parser.js';

const MAX_CHANGED_FILES = 500;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;

const ERROR_MESSAGES: Readonly<Record<GitDiffErrorCode, string>> = {
  GIT_DIFF_FAILED: 'Git changed-file discovery failed.',
  GIT_DIFF_TIMED_OUT: 'Git changed-file discovery timed out.',
  MERGE_BASE_NOT_FOUND: 'No common ancestor exists for the validated repository commits.',
  MULTIPLE_MERGE_BASES: 'Repository commits have multiple best common ancestors.',
  GIT_DIFF_OUTPUT_INVALID: 'Git changed-file metadata was invalid.',
  CHANGED_FILE_LIMIT_EXCEEDED: 'Repository change count exceeds the supported limit.',
};

export interface LoadChangedFilesInput {
  repositoryId: string;
  repository: ValidatedGitRepository;
}

export type GitDiffErrorCode =
  | 'GIT_DIFF_FAILED'
  | 'GIT_DIFF_TIMED_OUT'
  | 'MERGE_BASE_NOT_FOUND'
  | 'MULTIPLE_MERGE_BASES'
  | 'GIT_DIFF_OUTPUT_INVALID'
  | 'CHANGED_FILE_LIMIT_EXCEEDED';

/** A safe operational error raised while discovering changed-file metadata. */
export class GitDiffError extends Error {
  readonly code: GitDiffErrorCode;

  constructor(code: GitDiffErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'GitDiffError';
    this.code = code;
  }
}

/**
 * Discovers one validated repository's committed changed-file metadata.
 * It compares only Task 10.2's captured commit IDs and never reads file content.
 */
export async function loadChangedFiles(input: LoadChangedFilesInput): Promise<ChangedFile[]> {
  const repositoryPath = input.repository.repositoryPath;
  const mergeBaseResult = await runMergeBaseCommand(
    repositoryPath,
    input.repository.baseCommit,
    input.repository.headRef,
  );
  const mergeBases = parseMergeBaseOutput(mergeBaseResult.stdout);

  if (mergeBases.length === 0) {
    throw new GitDiffError('MERGE_BASE_NOT_FOUND');
  }

  if (mergeBases.length > 1) {
    throw new GitDiffError('MULTIPLE_MERGE_BASES');
  }

  const diffResult = await runDiffCommand(
    repositoryPath,
    input.repository.baseCommit,
    input.repository.headRef,
  );

  let changedFiles: ChangedFile[];
  try {
    changedFiles = parseGitNameStatus({
      repositoryId: input.repositoryId,
      output: diffResult.stdout,
    });
  } catch (error) {
    if (error instanceof GitNameStatusParseError) {
      throw new GitDiffError('GIT_DIFF_OUTPUT_INVALID');
    }

    throw new GitDiffError('GIT_DIFF_FAILED');
  }

  if (changedFiles.length > MAX_CHANGED_FILES) {
    throw new GitDiffError('CHANGED_FILE_LIMIT_EXCEEDED');
  }

  return changedFiles;
}

async function runMergeBaseCommand(
  repositoryPath: string,
  baseCommit: string,
  headRef: string,
): ReturnType<typeof runGitCommand> {
  try {
    return await runGitCommand({
      repositoryPath,
      args: ['merge-base', '--all', baseCommit, headRef],
    });
  } catch (error) {
    throw mapMergeBaseCommandFailure(error);
  }
}

async function runDiffCommand(
  repositoryPath: string,
  baseCommit: string,
  headRef: string,
): ReturnType<typeof runGitCommand> {
  try {
    return await runGitCommand({
      repositoryPath,
      args: [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '--find-renames=50%',
        '-z',
        `${baseCommit}...${headRef}`,
        '--',
      ],
    });
  } catch (error) {
    throw mapDiffCommandFailure(error);
  }
}

function mapMergeBaseCommandFailure(error: unknown): GitDiffError {
  if (error instanceof GitCommandError && error.code === 'GIT_COMMAND_TIMED_OUT') {
    return new GitDiffError('GIT_DIFF_TIMED_OUT');
  }

  return new GitDiffError('MERGE_BASE_NOT_FOUND');
}

function mapDiffCommandFailure(error: unknown): GitDiffError {
  if (error instanceof GitCommandError && error.code === 'GIT_COMMAND_TIMED_OUT') {
    return new GitDiffError('GIT_DIFF_TIMED_OUT');
  }

  return new GitDiffError('GIT_DIFF_FAILED');
}

function parseMergeBaseOutput(output: string): string[] {
  if (output.length === 0) {
    return [];
  }

  const normalizedLineEndings = output.replaceAll('\r\n', '\n');
  const withoutTerminalLineFeed = normalizedLineEndings.endsWith('\n')
    ? normalizedLineEndings.slice(0, -1)
    : normalizedLineEndings;

  if (withoutTerminalLineFeed.length === 0) {
    throw new GitDiffError('GIT_DIFF_OUTPUT_INVALID');
  }

  const mergeBases = withoutTerminalLineFeed.split('\n');
  if (mergeBases.some((mergeBase) => !FULL_OBJECT_ID_PATTERN.test(mergeBase))) {
    throw new GitDiffError('GIT_DIFF_OUTPUT_INVALID');
  }

  return mergeBases.map((mergeBase) => mergeBase.toLowerCase());
}
