import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type * as GitCommandRunnerModule from './git-command-runner.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedRunGitCommand } = vi.hoisted(() => ({ mockedRunGitCommand: vi.fn() }));

vi.mock('./git-command-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GitCommandRunnerModule>();

  return {
    ...actual,
    runGitCommand: mockedRunGitCommand,
  };
});

import {
  GitDiffError,
  loadChangedFiles,
  type LoadChangedFilesInput,
} from './local-git-diff-provider.js';
import { GitCommandError, runGitCommand, type GitCommandResult } from './git-command-runner.js';

const actualGitCommandRunner =
  await vi.importActual<typeof GitCommandRunnerModule>('./git-command-runner.js');
const execFileAsync = promisify(execFile);
const BASE_COMMIT = 'a'.repeat(40);
const HEAD_COMMIT = 'b'.repeat(40);
const MERGE_BASE = 'c'.repeat(40);

beforeEach(() => {
  vi.mocked(runGitCommand).mockReset();
  vi.mocked(runGitCommand).mockImplementation(actualGitCommandRunner.runGitCommand);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function success(stdout: string): GitCommandResult {
  return { stdout, stderr: '' };
}

function createInput(overrides: Partial<LoadChangedFilesInput> = {}): LoadChangedFilesInput {
  return {
    repositoryId: 'frontend',
    repository: {
      repositoryPath: '/private/repository',
      baseRef: 'configured-branch',
      baseCommit: BASE_COMMIT,
      headRef: HEAD_COMMIT,
    },
    ...overrides,
  };
}

function arrangeSuccessfulCommands(mergeBaseOutput: string, diffOutput: string): void {
  vi.mocked(runGitCommand)
    .mockResolvedValueOnce(success(mergeBaseOutput))
    .mockResolvedValueOnce(success(diffOutput));
}

async function captureDiffError(input: LoadChangedFilesInput): Promise<GitDiffError> {
  try {
    await loadChangedFiles(input);
  } catch (error) {
    expect(error).toBeInstanceOf(GitDiffError);
    return error as GitDiffError;
  }

  throw new Error('Expected changed-file discovery to fail');
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devguard-git-diff-'));

  try {
    await callback(directory);
  } finally {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
}

async function runGit(args: readonly string[], repositoryPath?: string): Promise<string> {
  const commandArgs = repositoryPath === undefined ? [...args] : ['-C', repositoryPath, ...args];
  const { stdout } = await execFileAsync('git', commandArgs, { encoding: 'utf8' });
  return stdout;
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

function repositoryDescriptor(
  repositoryPath: string,
  baseCommit: string,
  headRef: string,
): LoadChangedFilesInput['repository'] {
  return {
    repositoryPath,
    baseRef: 'main',
    baseCommit,
    headRef,
  };
}

describe('loadChangedFiles mocked provider behavior', () => {
  it('runs merge-base before the exact immutable SHA diff command', async () => {
    const input = createInput();
    const before = structuredClone(input);
    arrangeSuccessfulCommands(
      `${MERGE_BASE.toUpperCase()}\r\n`,
      'R100\u0000old.ts\u0000new.ts\u0000',
    );

    const result = await loadChangedFiles(input);

    expect(result).toEqual([
      {
        repositoryId: 'frontend',
        previousPath: 'old.ts',
        path: 'new.ts',
        status: 'renamed',
      },
    ]);
    expect(input).toEqual(before);
    expect(runGitCommand).toHaveBeenCalledTimes(2);
    expect(runGitCommand).toHaveBeenNthCalledWith(1, {
      repositoryPath: '/private/repository',
      args: ['merge-base', '--all', BASE_COMMIT, HEAD_COMMIT],
    });
    expect(runGitCommand).toHaveBeenNthCalledWith(2, {
      repositoryPath: '/private/repository',
      args: [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '--find-renames=50%',
        '-z',
        `${BASE_COMMIT}...${HEAD_COMMIT}`,
        '--',
      ],
    });
  });

  it('does not use configured baseRef, literal HEAD, copy detection, patches, or a rename-limit option', async () => {
    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, '');

    await loadChangedFiles(createInput());

    const diffArgs = vi.mocked(runGitCommand).mock.calls[1]?.[0].args;
    expect(diffArgs).toBeDefined();
    expect(diffArgs).not.toContain('configured-branch');
    expect(diffArgs).not.toContain('HEAD');
    expect(diffArgs?.some((arg) => arg.includes('find-copies') || arg === '-C')).toBe(false);
    expect(diffArgs?.some((arg) => arg.includes('patch') || arg.includes('numstat'))).toBe(false);
    expect(diffArgs?.some((arg) => arg === '-l500' || /^-l\d+/u.test(arg))).toBe(false);
  });

  it.each([
    ['no merge base', '', 'MERGE_BASE_NOT_FOUND'],
    ['multiple merge bases', `${MERGE_BASE}\n${BASE_COMMIT}\n`, 'MULTIPLE_MERGE_BASES'],
    ['blank merge-base line', `${MERGE_BASE}\n\n`, 'GIT_DIFF_OUTPUT_INVALID'],
    ['malformed merge-base ID', 'not-a-sha\n', 'GIT_DIFF_OUTPUT_INVALID'],
  ] as const)('maps %s before attempting a diff', async (_label, output, code) => {
    vi.mocked(runGitCommand).mockResolvedValueOnce(success(output));

    const failure = await captureDiffError(createInput());

    expect(failure.code).toBe(code);
    expect(runGitCommand).toHaveBeenCalledTimes(1);
  });

  it('maps merge-base and diff timeouts without exposing inputs', async () => {
    vi.mocked(runGitCommand).mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_TIMED_OUT'));
    const mergeFailure = await captureDiffError(createInput());
    expect(mergeFailure).toMatchObject({ code: 'GIT_DIFF_TIMED_OUT' });

    vi.mocked(runGitCommand).mockReset();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success(`${MERGE_BASE}\n`))
      .mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_TIMED_OUT'));
    const diffFailure = await captureDiffError(createInput());
    expect(diffFailure).toMatchObject({ code: 'GIT_DIFF_TIMED_OUT' });
    expect(diffFailure.message).not.toContain(BASE_COMMIT);
    expect(diffFailure.message).not.toContain(HEAD_COMMIT);
  });

  it('maps merge-base failures, ordinary diff failures, and malformed diff output safely', async () => {
    vi.mocked(runGitCommand).mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_FAILED'));
    await expect(captureDiffError(createInput())).resolves.toMatchObject({
      code: 'MERGE_BASE_NOT_FOUND',
    });

    vi.mocked(runGitCommand).mockReset();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success(`${MERGE_BASE}\n`))
      .mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_FAILED'));
    await expect(captureDiffError(createInput())).resolves.toMatchObject({
      code: 'GIT_DIFF_FAILED',
    });

    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, 'A\u0000private-name.ts');
    const malformed = await captureDiffError(createInput());
    expect(malformed.code).toBe('GIT_DIFF_OUTPUT_INVALID');
    expect(malformed.message).not.toContain('private-name.ts');
  });

  it('returns an empty diff successfully', async () => {
    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, '');

    await expect(loadChangedFiles(createInput())).resolves.toEqual([]);
  });

  it('accepts 500 changed records and rejects 501 records without truncation', async () => {
    const records = (count: number): string =>
      Array.from(
        { length: count },
        (_, index) => `A\u0000file-${String(index).padStart(3, '0')}.ts\u0000`,
      ).join('');

    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, records(500));
    await expect(loadChangedFiles(createInput())).resolves.toHaveLength(500);

    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, records(501));
    await expect(captureDiffError(createInput())).resolves.toMatchObject({
      code: 'CHANGED_FILE_LIMIT_EXCEEDED',
    });
  });

  it('counts renames, unknown statuses, and exact duplicates as records', async () => {
    const output = [
      'R100\u0000old.ts\u0000new.ts\u0000',
      'C100\u0000source.ts\u0000copy.ts\u0000',
      'T\u0000mode-change.ts\u0000',
      'A\u0000duplicate.ts\u0000',
      'A\u0000duplicate.ts\u0000',
    ].join('');
    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, output);

    await expect(loadChangedFiles(createInput())).resolves.toHaveLength(5);
  });

  it('does not log, mutate cwd/environment, or expose private values in public errors', async () => {
    const input = createInput({
      repositoryId: 'private-id',
      repository: {
        repositoryPath: '/private/repository',
        baseRef: 'private-base-ref',
        baseCommit: BASE_COMMIT,
        headRef: HEAD_COMMIT,
      },
    });
    const cwd = process.cwd();
    const environment = { ...process.env };
    const chdir = vi.spyOn(process, 'chdir');
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');
    arrangeSuccessfulCommands(`${MERGE_BASE}\n`, 'A\u0000private-file.ts');

    const failure = await captureDiffError(input);
    const serialized = JSON.stringify(failure);

    expect(process.cwd()).toBe(cwd);
    expect(process.env).toEqual(environment);
    expect(chdir).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    for (const privateValue of [
      'private-id',
      '/private/repository',
      'private-base-ref',
      BASE_COMMIT,
      HEAD_COMMIT,
    ]) {
      expect(failure.message).not.toContain(privateValue);
      expect(serialized).not.toContain(privateValue);
    }
  });
});

describe('loadChangedFiles real Git behavior', () => {
  it('returns deterministic added, modified, deleted, renamed, space, Unicode, and leading-dash metadata', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'modified.ts'), 'before\n', 'utf8');
      await writeFile(path.join(repositoryPath, 'deleted.ts'), 'delete\n', 'utf8');
      await writeFile(path.join(repositoryPath, 'rename-source.ts'), 'rename\n', 'utf8');
      const baseCommit = await commitAll(repositoryPath, 'base');

      await writeFile(path.join(repositoryPath, 'modified.ts'), 'after\n', 'utf8');
      await unlink(path.join(repositoryPath, 'deleted.ts'));
      await runGit(['mv', 'rename-source.ts', 'renamed.ts'], repositoryPath);
      await writeFile(path.join(repositoryPath, 'space file.ts'), 'space\n', 'utf8');
      await writeFile(path.join(repositoryPath, '日本語.ts'), 'unicode\n', 'utf8');
      await writeFile(path.join(repositoryPath, '-leading.ts'), 'leading\n', 'utf8');
      const headRef = await commitAll(repositoryPath, 'changes');
      const input: LoadChangedFilesInput = {
        repositoryId: 'backend',
        repository: repositoryDescriptor(repositoryPath, baseCommit, headRef),
      };

      const first = await loadChangedFiles(input);
      const second = await loadChangedFiles(input);

      expect(second).toEqual(first);
      expect(first).toContainEqual({
        repositoryId: 'backend',
        path: 'modified.ts',
        status: 'modified',
      });
      expect(first).toContainEqual({
        repositoryId: 'backend',
        path: 'deleted.ts',
        status: 'deleted',
      });
      expect(first).toContainEqual({
        repositoryId: 'backend',
        previousPath: 'rename-source.ts',
        path: 'renamed.ts',
        status: 'renamed',
      });
      expect(first).toContainEqual({
        repositoryId: 'backend',
        path: 'space file.ts',
        status: 'added',
      });
      expect(first).toContainEqual({ repositoryId: 'backend', path: '日本語.ts', status: 'added' });
      expect(first).toContainEqual({
        repositoryId: 'backend',
        path: '-leading.ts',
        status: 'added',
      });
    });
  });

  it('uses immutable detached commit IDs rather than current repository HEAD', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'base.ts'), 'base\n', 'utf8');
      const baseCommit = await commitAll(repositoryPath, 'base');
      await writeFile(path.join(repositoryPath, 'target.ts'), 'target\n', 'utf8');
      const capturedHead = await commitAll(repositoryPath, 'target');
      await writeFile(path.join(repositoryPath, 'later.ts'), 'later\n', 'utf8');
      await commitAll(repositoryPath, 'later');

      const result = await loadChangedFiles({
        repositoryId: 'frontend',
        repository: repositoryDescriptor(repositoryPath, baseCommit, capturedHead),
      });

      expect(result).toEqual([{ repositoryId: 'frontend', path: 'target.ts', status: 'added' }]);
    });
  });

  it('returns an empty array for equivalent captured commits', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'base.ts'), 'base\n', 'utf8');
      const commit = await commitAll(repositoryPath, 'base');

      await expect(
        loadChangedFiles({
          repositoryId: 'frontend',
          repository: repositoryDescriptor(repositoryPath, commit, commit),
        }),
      ).resolves.toEqual([]);
    });
  });

  it('fails unrelated histories without fetching', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'main.ts'), 'main\n', 'utf8');
      const baseCommit = await commitAll(repositoryPath, 'main');
      await runGit(['checkout', '--orphan', 'unrelated'], repositoryPath);
      await runGit(['rm', '-r', '--cached', '--ignore-unmatch', '.'], repositoryPath);
      await writeFile(path.join(repositoryPath, 'unrelated.ts'), 'unrelated\n', 'utf8');
      const unrelatedCommit = await commitAll(repositoryPath, 'unrelated');

      await expect(
        captureDiffError({
          repositoryId: 'frontend',
          repository: repositoryDescriptor(repositoryPath, baseCommit, unrelatedCommit),
        }),
      ).resolves.toMatchObject({ code: 'MERGE_BASE_NOT_FOUND' });
    });
  });
});
