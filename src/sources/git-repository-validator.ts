import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { GitCommandError, runGitCommand } from './git-command-runner.js';

const ERROR_MESSAGES: Readonly<Record<GitRepositoryValidationErrorCode, string>> = {
  REPOSITORY_NOT_FOUND: 'Configured repository path is unavailable.',
  NOT_A_GIT_REPOSITORY: 'Configured directory is not a Git working repository.',
  BASE_REF_NOT_FOUND: 'Configured base reference could not be resolved.',
  GIT_COMMAND_FAILED: 'Git repository validation failed.',
  GIT_COMMAND_TIMED_OUT: 'Git repository validation timed out.',
};

const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;

/** Runtime input for validating one already-resolved local Git repository. */
export interface ValidateGitRepositoryInput {
  repositoryPath: string;
  baseRef: string;
}

/** Immutable Git identity values captured for one validated working repository. */
export interface ValidatedGitRepository {
  /** Canonical absolute real path of the Git worktree top-level directory. */
  repositoryPath: string;
  /** Original configured base-ref text, preserved without normalization. */
  baseRef: string;
  /** Full resolved commit object ID for baseRef. */
  baseCommit: string;
  /** Full resolved commit object ID captured from HEAD. */
  headRef: string;
}

export type GitRepositoryValidationErrorCode =
  | 'REPOSITORY_NOT_FOUND'
  | 'NOT_A_GIT_REPOSITORY'
  | 'BASE_REF_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'GIT_COMMAND_TIMED_OUT';

/** A safe operational error raised while validating one local Git repository. */
export class GitRepositoryValidationError extends Error {
  readonly code: GitRepositoryValidationErrorCode;

  constructor(code: GitRepositoryValidationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'GitRepositoryValidationError';
    this.code = code;
  }
}

/**
 * Validates one local non-bare Git worktree and captures immutable commit IDs.
 * It accepts an already-resolved runtime path; configuration-relative resolution
 * and later repository-context assembly are intentionally outside this module.
 */
export async function validateGitRepository(
  input: ValidateGitRepositoryInput,
): Promise<ValidatedGitRepository> {
  const candidateRepositoryPath = await resolveCandidateRepositoryPath(input.repositoryPath);

  const bareResult = await runRepositoryIdentityCommand(candidateRepositoryPath, [
    'rev-parse',
    '--is-bare-repository',
  ]);
  if (parseBooleanOutput(bareResult.stdout) !== false) {
    throw new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY');
  }

  const worktreeResult = await runRepositoryIdentityCommand(candidateRepositoryPath, [
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  if (parseBooleanOutput(worktreeResult.stdout) !== true) {
    throw new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY');
  }

  const topLevelResult = await runRepositoryIdentityCommand(candidateRepositoryPath, [
    'rev-parse',
    '--show-toplevel',
  ]);
  const repositoryPath = await resolveCanonicalTopLevel(
    parseSingleLineOutput(topLevelResult.stdout),
    candidateRepositoryPath,
  );

  const headResult = await runRepositoryIdentityCommand(repositoryPath, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]);
  const headRef = parseCommitObjectId(headResult.stdout);
  if (headRef === undefined) {
    throw new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY');
  }

  if (!isValidBaseRef(input.baseRef)) {
    throw new GitRepositoryValidationError('BASE_REF_NOT_FOUND');
  }

  const baseResult = await runBaseRefCommand(repositoryPath, [
    'rev-parse',
    '--verify',
    `${input.baseRef}^{commit}`,
  ]);
  const baseCommit = parseCommitObjectId(baseResult.stdout);
  if (baseCommit === undefined) {
    throw new GitRepositoryValidationError('BASE_REF_NOT_FOUND');
  }

  return {
    repositoryPath,
    baseRef: input.baseRef,
    baseCommit,
    headRef,
  };
}

async function resolveCandidateRepositoryPath(repositoryPath: string): Promise<string> {
  if (repositoryPath.length === 0 || repositoryPath.includes('\u0000')) {
    throw new GitRepositoryValidationError('REPOSITORY_NOT_FOUND');
  }

  const absolutePath = path.resolve(repositoryPath);

  try {
    const candidateStats = await stat(absolutePath);
    if (!candidateStats.isDirectory()) {
      throw new Error('Repository candidate is not a directory');
    }

    const realCandidatePath = await realpath(absolutePath);
    const realCandidateStats = await stat(realCandidatePath);
    if (!realCandidateStats.isDirectory()) {
      throw new Error('Resolved repository candidate is not a directory');
    }

    return realCandidatePath;
  } catch {
    throw new GitRepositoryValidationError('REPOSITORY_NOT_FOUND');
  }
}

async function resolveCanonicalTopLevel(
  topLevelPath: string | undefined,
  candidateRepositoryPath: string,
): Promise<string> {
  if (topLevelPath === undefined || !path.isAbsolute(topLevelPath)) {
    throw new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY');
  }

  try {
    const canonicalTopLevelPath = await realpath(topLevelPath);
    const topLevelStats = await stat(canonicalTopLevelPath);
    if (
      !topLevelStats.isDirectory() ||
      !isPathWithinRoot(candidateRepositoryPath, canonicalTopLevelPath)
    ) {
      throw new Error('Git top-level path does not contain candidate');
    }

    return canonicalTopLevelPath;
  } catch {
    throw new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY');
  }
}

async function runRepositoryIdentityCommand(
  repositoryPath: string,
  args: readonly string[],
): ReturnType<typeof runGitCommand> {
  try {
    return await runGitCommand({ repositoryPath, args });
  } catch (error) {
    throw mapGitCommandFailure(error, 'NOT_A_GIT_REPOSITORY');
  }
}

async function runBaseRefCommand(
  repositoryPath: string,
  args: readonly string[],
): ReturnType<typeof runGitCommand> {
  try {
    return await runGitCommand({ repositoryPath, args });
  } catch (error) {
    throw mapGitCommandFailure(error, 'BASE_REF_NOT_FOUND');
  }
}

function mapGitCommandFailure(
  error: unknown,
  nonTimeoutCode: 'NOT_A_GIT_REPOSITORY' | 'BASE_REF_NOT_FOUND',
): GitRepositoryValidationError {
  if (error instanceof GitCommandError) {
    if (error.code === 'GIT_COMMAND_TIMED_OUT') {
      return new GitRepositoryValidationError('GIT_COMMAND_TIMED_OUT');
    }

    if (error.code === 'GIT_COMMAND_INVALID_INPUT') {
      return new GitRepositoryValidationError('GIT_COMMAND_FAILED');
    }

    return new GitRepositoryValidationError(nonTimeoutCode);
  }

  return new GitRepositoryValidationError('GIT_COMMAND_FAILED');
}

function parseBooleanOutput(output: string): boolean | undefined {
  const value = parseSingleLineOutput(output);

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function parseCommitObjectId(output: string): string | undefined {
  const value = parseSingleLineOutput(output);
  if (value === undefined || !FULL_OBJECT_ID_PATTERN.test(value)) {
    return undefined;
  }

  return value.toLowerCase();
}

function parseSingleLineOutput(output: string): string | undefined {
  const value = removeSingleTerminalLineEnding(output);
  if (value.length === 0 || containsAsciiControlCharacter(value)) {
    return undefined;
  }

  return value;
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

function removeSingleTerminalLineEnding(output: string): string {
  if (output.endsWith('\r\n')) {
    return output.slice(0, -2);
  }

  if (output.endsWith('\n')) {
    return output.slice(0, -1);
  }

  return output;
}

function isValidBaseRef(baseRef: string): boolean {
  return (
    baseRef.trim().length > 0 && !containsAsciiControlCharacter(baseRef) && !baseRef.startsWith('-')
  );
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}
