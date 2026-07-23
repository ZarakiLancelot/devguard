import { describe, expect, it } from 'vitest';
import { validateGitRepositoryPath } from './git-repository-path.js';

describe('validateGitRepositoryPath', () => {
  it.each([
    'file.ts',
    'src/models/book.ts',
    'dir with spaces/file.ts',
    'tab\tname.ts',
    'line\nbreak.ts',
    '日本語/😀.ts',
    '"quoted".ts',
    'path:with:colon.ts',
    'glob[*]?!.ts',
    '-leading-dash.ts',
  ])('returns accepted path text exactly: %j', (repositoryPath) => {
    expect(validateGitRepositoryPath(repositoryPath)).toBe(repositoryPath);
  });

  it.each([
    '',
    '\u0000',
    'before\u0000after',
    '/absolute/file.ts',
    'C:\\repository\\file.ts',
    'C:/repository/file.ts',
    '\\\\server\\share\\file.ts',
    '.',
    '..',
    'src/./file.ts',
    'src/../file.ts',
    'src//file.ts',
    'src/',
  ])('rejects invalid Git repository path text: %j', (repositoryPath) => {
    expect(() => validateGitRepositoryPath(repositoryPath)).toThrow(
      'Git repository path is invalid.',
    );
  });

  it('does not trim accepted text', () => {
    const repositoryPath = '  source file.ts  ';

    expect(validateGitRepositoryPath(repositoryPath)).toBe(repositoryPath);
  });

  it('preserves literal backslashes on POSIX', () => {
    if (process.platform === 'win32') {
      return;
    }

    const repositoryPath = 'literal\\backslash.ts';
    expect(validateGitRepositoryPath(repositoryPath)).toBe(repositoryPath);
  });

  it('rejects literal backslashes on Windows', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });

    try {
      expect(() => validateGitRepositoryPath('literal\\backslash.ts')).toThrow(
        'Git repository path is invalid.',
      );
    } finally {
      if (descriptor === undefined) {
        delete (process as { platform?: NodeJS.Platform }).platform;
      } else {
        Object.defineProperty(process, 'platform', descriptor);
      }
    }
  });
});
