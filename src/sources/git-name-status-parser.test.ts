import type { ChangedFile } from '../types/repository.js';
import { describe, expect, it } from 'vitest';
import {
  GitNameStatusParseError,
  parseGitNameStatus,
  type ParseGitNameStatusInput,
} from './git-name-status-parser.js';

const REPOSITORY_ID = 'frontend';

function parse(output: string, repositoryId = REPOSITORY_ID): ChangedFile[] {
  return parseGitNameStatus({ repositoryId, output });
}

function expectParseFailure(output: string): void {
  expect(() => parse(output)).toThrow(GitNameStatusParseError);
}

describe('parseGitNameStatus', () => {
  it('returns an empty result for empty output', () => {
    expect(parse('')).toEqual([]);
  });

  it.each([
    ['added', 'A\u0000src/new.ts\u0000', 'added'],
    ['modified', 'M\u0000src/model.ts\u0000', 'modified'],
    ['deleted', 'D\u0000src/old.ts\u0000', 'deleted'],
    ['type changed', 'T\u0000src/link.ts\u0000', 'unknown'],
    ['unmerged', 'U\u0000src/conflict.ts\u0000', 'unknown'],
    ['unknown Git status', 'X\u0000src/unknown.ts\u0000', 'unknown'],
    ['broken pairing', 'B\u0000src/broken.ts\u0000', 'unknown'],
  ] as const)('maps a %s record', (_label, output, status) => {
    expect(parse(output)).toEqual([
      {
        repositoryId: REPOSITORY_ID,
        path: output.split('\u0000')[1],
        status,
      },
    ]);
  });

  it.each(['R0', 'R050', 'R087', 'R100'])(
    'maps %s rename scores without retaining score data',
    (token) => {
      const result = parse(`${token}\u0000src/old.ts\u0000src/new.ts\u0000`);

      expect(result).toEqual([
        {
          repositoryId: REPOSITORY_ID,
          previousPath: 'src/old.ts',
          path: 'src/new.ts',
          status: 'renamed',
        },
      ]);
      expect(result[0]).not.toHaveProperty('patch');
      expect(result[0]).not.toHaveProperty('addedLines');
      expect(result[0]).not.toHaveProperty('deletedLines');
    },
  );

  it('maps a copied record to unknown using its destination path only', () => {
    expect(parse('C087\u0000src/source.ts\u0000src/copy.ts\u0000')).toEqual([
      {
        repositoryId: REPOSITORY_ID,
        path: 'src/copy.ts',
        status: 'unknown',
      },
    ]);
  });

  it.each(['R', 'R101', 'R1000', 'R-1', 'C101', 'Cbad', 'Z', 'MM', 'A1'])(
    'rejects malformed or unknown status token %s',
    (token) => {
      expect.hasAssertions();
      expectParseFailure(`${token}\u0000src/file.ts\u0000`);
    },
  );

  it.each([
    ['missing final NUL', 'A\u0000src/file.ts'],
    ['empty ordinary path', 'A\u0000\u0000'],
    ['incomplete rename', 'R100\u0000src/old.ts\u0000'],
    ['incomplete copy', 'C100\u0000src/source.ts\u0000'],
    ['extra token framing', 'A\u0000src/file.ts\u0000unexpected\u0000'],
    ['identical rename paths', 'R100\u0000src/file.ts\u0000src/file.ts\u0000'],
  ] as const)('rejects %s atomically', (_label, output) => {
    expect.hasAssertions();
    expectParseFailure(output);
  });

  it.each([
    ['absolute POSIX path', '/etc/passwd'],
    ['Windows drive path', 'C:\\repo\\file.ts'],
    ['Windows UNC path', '\\\\server\\share\\file.ts'],
    ['current-directory path', '.'],
    ['parent-directory path', '..'],
    ['dot path segment', 'src/./file.ts'],
    ['dot-dot path segment', 'src/../file.ts'],
    ['empty slash segment', 'src//file.ts'],
  ] as const)('rejects invalid Git path %s', (_label, filePath) => {
    expect.hasAssertions();
    expectParseFailure(`A\u0000${filePath}\u0000`);
  });

  it('preserves spaces, tabs, newlines, Unicode, quotes, and leading dashes', () => {
    const paths = [
      'dir with spaces/file.ts',
      'tab\tname.ts',
      'line\nbreak.ts',
      '日本語/😀.ts',
      '"quoted".ts',
      '-leading-dash.ts',
    ];
    const output = paths.map((filePath) => `A\u0000${filePath}\u0000`).join('');

    expect(parse(output).map((changedFile) => changedFile.path)).toEqual([...paths].sort());
  });

  it('preserves a literal POSIX backslash rather than normalizing it', () => {
    if (process.platform === 'win32') {
      expectParseFailure('A\u0000literal\\backslash.ts\u0000');
      return;
    }

    expect(parse('A\u0000literal\\backslash.ts\u0000')).toEqual([
      {
        repositoryId: REPOSITORY_ID,
        path: 'literal\\backslash.ts',
        status: 'added',
      },
    ]);
  });

  it('sorts by repository ID, destination path, status, and previous path', () => {
    const output = [
      'M\u0000z.ts\u0000',
      'R100\u0000old-b.ts\u0000a.ts\u0000',
      'A\u0000a.ts\u0000',
      'R100\u0000old-a.ts\u0000a.ts\u0000',
    ].join('');

    expect(parse(output, 'backend')).toEqual([
      { repositoryId: 'backend', path: 'a.ts', status: 'added' },
      {
        repositoryId: 'backend',
        previousPath: 'old-a.ts',
        path: 'a.ts',
        status: 'renamed',
      },
      {
        repositoryId: 'backend',
        previousPath: 'old-b.ts',
        path: 'a.ts',
        status: 'renamed',
      },
      { repositoryId: 'backend', path: 'z.ts', status: 'modified' },
    ]);
  });

  it('preserves exact duplicates and attaches the caller repository ID to every record', () => {
    const result = parse('A\u0000src/file.ts\u0000A\u0000src/file.ts\u0000', 'backend');

    expect(result).toEqual([
      { repositoryId: 'backend', path: 'src/file.ts', status: 'added' },
      { repositoryId: 'backend', path: 'src/file.ts', status: 'added' },
    ]);
  });

  it('does not mutate its caller-owned input object', () => {
    const input: ParseGitNameStatusInput = {
      repositoryId: REPOSITORY_ID,
      output: 'A\u0000src/file.ts\u0000',
    };
    const before = structuredClone(input);

    parseGitNameStatus(input);

    expect(input).toEqual(before);
  });
});
