import type { ChangeStatus, ChangedFile } from '../types/repository.js';

const RENAME_OR_COPY_STATUS_PATTERN = /^([RC])(\d{1,3})$/u;

export interface ParseGitNameStatusInput {
  repositoryId: string;
  output: string;
}

/** Internal parse error that never carries raw Git metadata or paths. */
export class GitNameStatusParseError extends Error {
  constructor() {
    super('Git name-status metadata was invalid.');
    this.name = 'GitNameStatusParseError';
  }
}

/**
 * Parses Git's NUL-delimited --name-status output into deterministic domain records.
 * The operation is all-or-nothing: malformed metadata throws without returning
 * partially parsed ChangedFile entries.
 */
export function parseGitNameStatus(input: ParseGitNameStatusInput): ChangedFile[] {
  if (input.output.length === 0) {
    return [];
  }

  if (!input.output.endsWith('\u0000')) {
    throw new GitNameStatusParseError();
  }

  const tokens = input.output.slice(0, -1).split('\u0000');
  const changedFiles: ChangedFile[] = [];

  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index];
    if (statusToken === undefined) {
      throw new GitNameStatusParseError();
    }
    index += 1;

    const parsedStatus = parseStatusToken(statusToken);

    if (parsedStatus.kind === 'rename' || parsedStatus.kind === 'copy') {
      const sourcePath = validateGitPath(tokens[index]);
      const destinationPath = validateGitPath(tokens[index + 1]);
      index += 2;

      if (parsedStatus.kind === 'rename' && sourcePath === destinationPath) {
        throw new GitNameStatusParseError();
      }

      changedFiles.push(
        parsedStatus.kind === 'rename'
          ? {
              repositoryId: input.repositoryId,
              previousPath: sourcePath,
              path: destinationPath,
              status: 'renamed',
            }
          : {
              repositoryId: input.repositoryId,
              path: destinationPath,
              status: 'unknown',
            },
      );
      continue;
    }

    const filePath = validateGitPath(tokens[index]);
    index += 1;
    changedFiles.push({
      repositoryId: input.repositoryId,
      path: filePath,
      status: parsedStatus.status,
    });
  }

  return changedFiles.sort(compareChangedFiles);
}

type ParsedStatus =
  | { kind: 'ordinary'; status: ChangeStatus }
  | { kind: 'rename' }
  | { kind: 'copy' };

function parseStatusToken(statusToken: string): ParsedStatus {
  switch (statusToken) {
    case 'A':
      return { kind: 'ordinary', status: 'added' };
    case 'M':
      return { kind: 'ordinary', status: 'modified' };
    case 'D':
      return { kind: 'ordinary', status: 'deleted' };
    case 'T':
    case 'U':
    case 'X':
    case 'B':
      return { kind: 'ordinary', status: 'unknown' };
  }

  const renameOrCopyMatch = RENAME_OR_COPY_STATUS_PATTERN.exec(statusToken);
  if (renameOrCopyMatch === null) {
    throw new GitNameStatusParseError();
  }

  const kind = renameOrCopyMatch[1];
  const scoreText = renameOrCopyMatch[2];
  if (kind === undefined || scoreText === undefined || Number(scoreText) > 100) {
    throw new GitNameStatusParseError();
  }

  if (kind === 'R') {
    return { kind: 'rename' };
  }

  return { kind: 'copy' };
}

function validateGitPath(path: string | undefined): string {
  if (
    path === undefined ||
    path.length === 0 ||
    path.includes('\u0000') ||
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    (process.platform === 'win32' && path.includes('\\'))
  ) {
    throw new GitNameStatusParseError();
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new GitNameStatusParseError();
  }

  return path;
}

function compareChangedFiles(left: ChangedFile, right: ChangedFile): number {
  return (
    compareText(left.repositoryId, right.repositoryId) ||
    compareText(left.path, right.path) ||
    compareText(left.status, right.status) ||
    compareText(left.previousPath ?? '', right.previousPath ?? '')
  );
}

function compareText(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftCodePoint = leftCodePoints[index]?.codePointAt(0);
    const rightCodePoint = rightCodePoints[index]?.codePointAt(0);

    if (leftCodePoint !== rightCodePoint) {
      return (leftCodePoint ?? 0) - (rightCodePoint ?? 0);
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
