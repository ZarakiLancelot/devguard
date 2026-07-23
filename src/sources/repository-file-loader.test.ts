import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type * as GitCommandRunnerModule from './git-command-runner.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedRunGitCommand } = vi.hoisted(() => ({ mockedRunGitCommand: vi.fn() }));

vi.mock('./git-command-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GitCommandRunnerModule>();
  return { ...actual, runGitCommand: mockedRunGitCommand };
});

import { GitCommandError, runGitCommand, type GitCommandResult } from './git-command-runner.js';
import {
  GitFileLoadError,
  loadRepositoryFiles,
  MAX_REPOSITORY_FILE_BYTES,
  MAX_REPOSITORY_FILES_TOTAL_BYTES,
  type LoadRepositoryFilesInput,
} from './repository-file-loader.js';

const actualGitCommandRunner =
  await vi.importActual<typeof GitCommandRunnerModule>('./git-command-runner.js');
const execFileAsync = promisify(execFile);
const HEAD_COMMIT = 'b'.repeat(40);

beforeEach(() => {
  vi.mocked(runGitCommand).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function success(stdout: string): GitCommandResult {
  return { stdout, stderr: '' };
}

function createInput(overrides: Partial<LoadRepositoryFilesInput> = {}): LoadRepositoryFilesInput {
  return {
    repositoryId: 'frontend',
    repository: {
      repositoryPath: '/private/repository',
      baseRef: 'configured-branch',
      baseCommit: 'a'.repeat(40),
      headRef: HEAD_COMMIT,
    },
    paths: ['src/model.ts'],
    ...overrides,
  };
}

async function captureError(action: () => Promise<unknown>): Promise<GitFileLoadError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(GitFileLoadError);
    return error as GitFileLoadError;
  }

  throw new Error('Expected repository file loader to fail');
}

async function runGit(args: readonly string[], repositoryPath?: string): Promise<string> {
  const commandArgs = repositoryPath === undefined ? [...args] : ['-C', repositoryPath, ...args];
  return (await execFileAsync('git', commandArgs, { encoding: 'utf8' })).stdout;
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devguard-file-loader-'));
  try {
    await callback(directory);
  } finally {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
}

async function createRepository(parentDirectory: string): Promise<string> {
  const repositoryPath = path.join(parentDirectory, 'repository');
  await runGit(['init', '--initial-branch=main', repositoryPath]);
  await runGit(['config', 'user.name', 'DevGuard Tests'], repositoryPath);
  await runGit(['config', 'user.email', 'devguard-tests@example.invalid'], repositoryPath);
  return repositoryPath;
}

async function commitAll(repositoryPath: string, message: string): Promise<string> {
  await runGit(['add', '--all'], repositoryPath);
  await runGit(['commit', '-m', message], repositoryPath);
  return (await runGit(['rev-parse', 'HEAD'], repositoryPath)).trim();
}

describe('loadRepositoryFiles mocked behavior', () => {
  it('loads one immutable blob through exact type, size, and content commands', async () => {
    const input = createInput({ paths: ['src/path:with-colon.ts'] });
    const before = structuredClone(input);
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\r\n'))
      .mockResolvedValueOnce(success('5\n'))
      .mockResolvedValueOnce(success('hello'));

    const result = await loadRepositoryFiles(input);
    const expression = `${HEAD_COMMIT}:src/path:with-colon.ts`;

    expect(runGitCommand).toHaveBeenNthCalledWith(1, {
      repositoryPath: '/private/repository',
      args: ['cat-file', '-t', expression],
    });
    expect(runGitCommand).toHaveBeenNthCalledWith(2, {
      repositoryPath: '/private/repository',
      args: ['cat-file', '-s', expression],
    });
    expect(runGitCommand).toHaveBeenNthCalledWith(3, {
      repositoryPath: '/private/repository',
      args: ['cat-file', 'blob', expression],
    });
    expect(result).toEqual({
      files: [
        {
          repositoryId: 'frontend',
          path: 'src/path:with-colon.ts',
          content: 'hello',
          sizeBytes: 5,
        },
      ],
    });
    expect(result.files[0]).not.toHaveProperty('absolutePath');
    expect(input).toEqual(before);
  });

  it('validates every path before any command and deduplicates exact paths', async () => {
    const invalid = await captureError(() =>
      loadRepositoryFiles(createInput({ paths: ['valid.ts', 'src/../invalid.ts'] })),
    );
    expect(invalid.code).toBe('FILE_OBJECT_INVALID');
    expect(runGitCommand).not.toHaveBeenCalled();

    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success('1\n'))
      .mockResolvedValueOnce(success('x'));
    await expect(
      loadRepositoryFiles(createInput({ paths: ['-leading.ts', '-leading.ts'] })),
    ).resolves.toEqual({
      files: [{ repositoryId: 'frontend', path: '-leading.ts', content: 'x', sizeBytes: 1 }],
    });
    expect(runGitCommand).toHaveBeenCalledTimes(3);
  });

  it('sorts returned deduplicated files independently of request order', async () => {
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success('1\n'))
      .mockResolvedValueOnce(success('z'))
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success('1\n'))
      .mockResolvedValueOnce(success('a'));

    await expect(loadRepositoryFiles(createInput({ paths: ['z.ts', 'a.ts'] }))).resolves.toEqual({
      files: [
        { repositoryId: 'frontend', path: 'a.ts', content: 'a', sizeBytes: 1 },
        { repositoryId: 'frontend', path: 'z.ts', content: 'z', sizeBytes: 1 },
      ],
    });
  });

  it.each([
    ['missing object', new GitCommandError('GIT_COMMAND_FAILED'), 'FILE_OBJECT_NOT_FOUND'],
    ['type timeout', new GitCommandError('GIT_COMMAND_TIMED_OUT'), 'GIT_FILE_LOAD_TIMED_OUT'],
  ] as const)('maps type-stage %s safely', async (_label, error, code) => {
    vi.mocked(runGitCommand).mockRejectedValue(error);
    const failure = await captureError(() => loadRepositoryFiles(createInput()));
    expect(failure.code).toBe(code);
    expect(failure.message).not.toContain('/private/repository');
    expect(failure.message).not.toContain(HEAD_COMMIT);
  });

  it.each([
    ['non-blob type', [success('tree\n')], 'FILE_OBJECT_INVALID'],
    ['malformed type', [success('blob\nextra\n')], 'FILE_OBJECT_INVALID'],
    ['malformed size', [success('blob\n'), success('1.5\n')], 'FILE_OBJECT_INVALID'],
    ['negative size', [success('blob\n'), success('-1\n')], 'FILE_OBJECT_INVALID'],
    ['unsafe size', [success('blob\n'), success('9007199254740992\n')], 'FILE_OBJECT_INVALID'],
  ] as const)('rejects %s atomically', async (_label, results, code) => {
    const queuedResults = [...results];
    vi.mocked(runGitCommand).mockImplementation(async () => queuedResults.shift() ?? success(''));
    const failure = await captureError(() => loadRepositoryFiles(createInput()));
    expect(failure.code).toBe(code);
  });

  it('rejects a blob over 1 MiB before retrieving content', async () => {
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success(`${MAX_REPOSITORY_FILE_BYTES + 1}\n`));

    const failure = await captureError(() => loadRepositoryFiles(createInput()));

    expect(failure.code).toBe('FILE_TOO_LARGE');
    expect(runGitCommand).toHaveBeenCalledTimes(2);
  });

  it('accepts an exact 1 MiB blob and preserves its reported size', async () => {
    const content = 'x'.repeat(MAX_REPOSITORY_FILE_BYTES);
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success(`${MAX_REPOSITORY_FILE_BYTES}\n`))
      .mockResolvedValueOnce(success(content));

    await expect(loadRepositoryFiles(createInput())).resolves.toEqual({
      files: [
        {
          repositoryId: 'frontend',
          path: 'src/model.ts',
          content,
          sizeBytes: MAX_REPOSITORY_FILE_BYTES,
        },
      ],
    });
  });

  it('stops before the offending content retrieval when the per-invocation total would overflow', async () => {
    const content = 'x'.repeat(MAX_REPOSITORY_FILE_BYTES);
    const paths = Array.from({ length: 21 }, (_, index) => `file-${index}.ts`);
    vi.mocked(runGitCommand).mockImplementation(async ({ args }) => {
      if (args[1] === '-t') return success('blob\n');
      if (args[1] === '-s') return success(`${MAX_REPOSITORY_FILE_BYTES}\n`);
      return success(content);
    });

    const failure = await captureError(() => loadRepositoryFiles(createInput({ paths })));

    expect(failure.code).toBe('TOTAL_TEXT_LIMIT_EXCEEDED');
    expect(runGitCommand).toHaveBeenCalledTimes(62);
    expect(MAX_REPOSITORY_FILES_TOTAL_BYTES).toBe(20 * MAX_REPOSITORY_FILE_BYTES);
  });

  it.each([
    [
      'size timeout',
      [success('blob\n'), new GitCommandError('GIT_COMMAND_TIMED_OUT')],
      'GIT_FILE_LOAD_TIMED_OUT',
    ],
    [
      'content failure',
      [success('blob\n'), success('1\n'), new GitCommandError('GIT_COMMAND_FAILED')],
      'GIT_FILE_LOAD_FAILED',
    ],
  ] as const)('maps established-object %s safely', async (_label, results, code) => {
    const queuedResults = [...results];
    vi.mocked(runGitCommand).mockImplementation(async () => {
      const result = queuedResults.shift();
      if (result instanceof Error) throw result;
      return result ?? success('');
    });

    const failure = await captureError(() => loadRepositoryFiles(createInput()));
    expect(failure.code).toBe(code);
  });

  it.each([
    ['NUL content', 'a\u0000b', 3, 'FILE_BINARY'],
    ['content byte mismatch', '😀', 1, 'FILE_OBJECT_INVALID'],
  ] as const)('rejects %s without partial result', async (_label, content, size, code) => {
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('blob\n'))
      .mockResolvedValueOnce(success(`${size}\n`))
      .mockResolvedValueOnce(success(content));

    const failure = await captureError(() => loadRepositoryFiles(createInput()));
    expect(failure.code).toBe(code);
  });

  it('does not log or expose private operational data', async () => {
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');
    vi.mocked(runGitCommand).mockRejectedValue(new Error('private cat-file diagnostic'));

    const failure = await captureError(() => loadRepositoryFiles(createInput()));

    expect(JSON.stringify(failure)).not.toContain('private cat-file diagnostic');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('loadRepositoryFiles real Git behavior', () => {
  it('loads unchanged captured content, ignoring dirty working-tree and later commits', async () => {
    vi.mocked(runGitCommand).mockImplementation(actualGitCommandRunner.runGitCommand);

    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'schema:book.yaml'), 'captured\n', 'utf8');
      const capturedHead = await commitAll(repositoryPath, 'captured');
      await writeFile(path.join(repositoryPath, 'schema:book.yaml'), 'later\n', 'utf8');
      await commitAll(repositoryPath, 'later');
      await writeFile(path.join(repositoryPath, 'schema:book.yaml'), 'dirty\n', 'utf8');

      const result = await loadRepositoryFiles({
        repositoryId: 'backend',
        repository: {
          repositoryPath,
          baseRef: 'ignored',
          baseCommit: 'a'.repeat(40),
          headRef: capturedHead,
        },
        paths: ['schema:book.yaml'],
      });

      expect(result).toEqual({
        files: [
          {
            repositoryId: 'backend',
            path: 'schema:book.yaml',
            content: 'captured\n',
            sizeBytes: Buffer.byteLength('captured\n', 'utf8'),
          },
        ],
      });
    });
  });

  it('rejects a NUL-containing committed blob as required binary content', async () => {
    vi.mocked(runGitCommand).mockImplementation(actualGitCommandRunner.runGitCommand);

    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'binary.ts'), Buffer.from([0x61, 0, 0x62]));
      const headRef = await commitAll(repositoryPath, 'binary');

      const failure = await captureError(() =>
        loadRepositoryFiles({
          repositoryId: 'frontend',
          repository: {
            repositoryPath,
            baseRef: 'ignored',
            baseCommit: 'a'.repeat(40),
            headRef,
          },
          paths: ['binary.ts'],
        }),
      );

      expect(failure.code).toBe('FILE_BINARY');
    });
  });
});
