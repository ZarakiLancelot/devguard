import type { RepositoryFile } from '../types/repository.js';
import { GitCommandError, runGitCommand } from './git-command-runner.js';
import { validateGitRepositoryPath } from './git-repository-path.js';
import type { ValidatedGitRepository } from './git-repository-validator.js';

/** Maximum supported individual immutable repository blob size: 1 MiB. */
export const MAX_REPOSITORY_FILE_BYTES = 1_048_576;
/** Maximum supported complete-file text retained by one loader invocation: 20 MiB. */
export const MAX_REPOSITORY_FILES_TOTAL_BYTES = 20 * 1_048_576;

const ERROR_MESSAGES: Readonly<Record<GitFileLoadErrorCode, string>> = {
  FILE_OBJECT_NOT_FOUND: 'Required repository file is unavailable at the captured revision.',
  FILE_OBJECT_INVALID: 'Required repository path does not resolve to a supported file object.',
  FILE_TOO_LARGE: 'Required repository file exceeds the supported size limit.',
  FILE_BINARY: 'Required repository file is not supported text content.',
  TOTAL_TEXT_LIMIT_EXCEEDED: 'Loaded repository text exceeds the supported total size limit.',
  GIT_FILE_LOAD_FAILED: 'Required repository file could not be loaded.',
  GIT_FILE_LOAD_TIMED_OUT: 'Repository file loading timed out.',
};

export interface LoadRepositoryFilesInput {
  repositoryId: string;
  repository: ValidatedGitRepository;
  paths: readonly string[];
}

export interface LoadRepositoryFilesResult {
  files: RepositoryFile[];
}

export type GitFileLoadErrorCode =
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_OBJECT_INVALID'
  | 'FILE_TOO_LARGE'
  | 'FILE_BINARY'
  | 'TOTAL_TEXT_LIMIT_EXCEEDED'
  | 'GIT_FILE_LOAD_FAILED'
  | 'GIT_FILE_LOAD_TIMED_OUT';

/** A safe fatal error raised while loading required immutable repository blobs. */
export class GitFileLoadError extends Error {
  readonly code: GitFileLoadErrorCode;

  constructor(code: GitFileLoadErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'GitFileLoadError';
    this.code = code;
  }
}

/**
 * Loads supplied repository-relative paths from the captured head commit only.
 * Required mapped-file loading is atomic: one failure returns no partial result.
 */
export async function loadRepositoryFiles(
  input: LoadRepositoryFilesInput,
): Promise<LoadRepositoryFilesResult> {
  const paths = validateAndDeduplicatePaths(input.paths);
  const files: RepositoryFile[] = [];
  let loadedBytes = 0;

  for (const path of paths) {
    const objectExpression = `${input.repository.headRef}:${path}`;
    await verifyBlobObject(input.repository.repositoryPath, objectExpression);
    const sizeBytes = await readBlobSize(input.repository.repositoryPath, objectExpression);

    if (sizeBytes > MAX_REPOSITORY_FILE_BYTES) {
      throw new GitFileLoadError('FILE_TOO_LARGE');
    }

    if (loadedBytes + sizeBytes > MAX_REPOSITORY_FILES_TOTAL_BYTES) {
      throw new GitFileLoadError('TOTAL_TEXT_LIMIT_EXCEEDED');
    }

    loadedBytes += sizeBytes;
    const content = await readBlobContent(input.repository.repositoryPath, objectExpression);
    if (content.includes('\u0000')) {
      throw new GitFileLoadError('FILE_BINARY');
    }

    if (Buffer.byteLength(content, 'utf8') !== sizeBytes) {
      throw new GitFileLoadError('FILE_OBJECT_INVALID');
    }

    files.push({
      repositoryId: input.repositoryId,
      path,
      content,
      sizeBytes,
    });
  }

  return { files: files.sort(compareRepositoryFiles) };
}

function validateAndDeduplicatePaths(paths: readonly string[]): string[] {
  const uniquePaths = new Set<string>();

  for (const path of paths) {
    try {
      uniquePaths.add(validateGitRepositoryPath(path));
    } catch {
      throw new GitFileLoadError('FILE_OBJECT_INVALID');
    }
  }

  return [...uniquePaths];
}

async function verifyBlobObject(repositoryPath: string, objectExpression: string): Promise<void> {
  let output: string;

  try {
    output = (
      await runGitCommand({
        repositoryPath,
        args: ['cat-file', '-t', objectExpression],
      })
    ).stdout;
  } catch (error) {
    throw mapObjectResolutionFailure(error);
  }

  if (parseSingleOutputLine(output) !== 'blob') {
    throw new GitFileLoadError('FILE_OBJECT_INVALID');
  }
}

async function readBlobSize(repositoryPath: string, objectExpression: string): Promise<number> {
  let output: string;

  try {
    output = (
      await runGitCommand({
        repositoryPath,
        args: ['cat-file', '-s', objectExpression],
      })
    ).stdout;
  } catch (error) {
    throw mapEstablishedObjectFailure(error);
  }

  const sizeText = parseSingleOutputLine(output);
  if (sizeText === undefined || !/^\d+$/u.test(sizeText)) {
    throw new GitFileLoadError('FILE_OBJECT_INVALID');
  }

  const sizeBytes = Number(sizeText);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new GitFileLoadError('FILE_OBJECT_INVALID');
  }

  return sizeBytes;
}

async function readBlobContent(repositoryPath: string, objectExpression: string): Promise<string> {
  try {
    return (
      await runGitCommand({
        repositoryPath,
        args: ['cat-file', 'blob', objectExpression],
      })
    ).stdout;
  } catch (error) {
    throw mapEstablishedObjectFailure(error);
  }
}

function mapObjectResolutionFailure(error: unknown): GitFileLoadError {
  if (error instanceof GitCommandError && error.code === 'GIT_COMMAND_TIMED_OUT') {
    return new GitFileLoadError('GIT_FILE_LOAD_TIMED_OUT');
  }

  return new GitFileLoadError('FILE_OBJECT_NOT_FOUND');
}

function mapEstablishedObjectFailure(error: unknown): GitFileLoadError {
  if (error instanceof GitCommandError && error.code === 'GIT_COMMAND_TIMED_OUT') {
    return new GitFileLoadError('GIT_FILE_LOAD_TIMED_OUT');
  }

  return new GitFileLoadError('GIT_FILE_LOAD_FAILED');
}

function parseSingleOutputLine(output: string): string | undefined {
  const value = removeSingleTerminalLineEnding(output);
  if (value.length === 0 || containsAsciiControlCharacter(value)) {
    return undefined;
  }

  return value;
}

function removeSingleTerminalLineEnding(output: string): string {
  if (output.endsWith('\r\n')) {
    return output.slice(0, -2);
  }

  if (output.endsWith('\n')) {
    return output.slice(0, -1);
  }

  return output;
}

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

function compareRepositoryFiles(left: RepositoryFile, right: RepositoryFile): number {
  return (
    compareCodePoints(left.repositoryId, right.repositoryId) ||
    compareCodePoints(left.path, right.path)
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
