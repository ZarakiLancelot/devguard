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
  loadChangedFilePatches,
  MAX_PATCH_BYTES,
  type LoadChangedFilePatchesInput,
} from './repository-patch-loader.js';

const actualGitCommandRunner =
  await vi.importActual<typeof GitCommandRunnerModule>('./git-command-runner.js');
const execFileAsync = promisify(execFile);
const BASE_COMMIT = 'a'.repeat(40);
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

function createInput(
  overrides: Partial<LoadChangedFilePatchesInput> = {},
): LoadChangedFilePatchesInput {
  return {
    repositoryId: 'frontend',
    repository: {
      repositoryPath: '/private/repository',
      baseRef: 'configured-branch',
      baseCommit: BASE_COMMIT,
      headRef: HEAD_COMMIT,
    },
    changedFiles: [{ repositoryId: 'frontend', path: 'src/file.ts', status: 'modified' }],
    ...overrides,
  };
}

async function runGit(args: readonly string[], repositoryPath?: string): Promise<string> {
  const commandArgs = repositoryPath === undefined ? [...args] : ['-C', repositoryPath, ...args];
  return (await execFileAsync('git', commandArgs, { encoding: 'utf8' })).stdout;
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devguard-patch-loader-'));
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

describe('loadChangedFilePatches mocked behavior', () => {
  it('uses the exact immutable literal-pathspec command for an ordinary record', async () => {
    const input = createInput();
    const before = structuredClone(input);
    vi.mocked(runGitCommand).mockResolvedValue(success('diff --git a/src/file.ts b/src/file.ts\n'));

    const result = await loadChangedFilePatches(input);

    expect(runGitCommand).toHaveBeenCalledWith({
      repositoryPath: '/private/repository',
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
        `${BASE_COMMIT}...${HEAD_COMMIT}`,
        '--',
        'src/file.ts',
      ],
    });
    expect(result).toEqual({
      changedFiles: [
        {
          repositoryId: 'frontend',
          path: 'src/file.ts',
          status: 'modified',
          patch: 'diff --git a/src/file.ts b/src/file.ts\n',
        },
      ],
      warnings: [],
    });
    expect(input).toEqual(before);
  });

  it('uses both validated paths for a renamed record', async () => {
    vi.mocked(runGitCommand).mockResolvedValue(success(''));
    const input = createInput({
      changedFiles: [
        {
          repositoryId: 'frontend',
          previousPath: 'src/old:*.ts',
          path: '-new[1].ts',
          status: 'renamed',
        },
      ],
    });

    await expect(loadChangedFilePatches(input)).resolves.toMatchObject({ warnings: [] });
    expect(runGitCommand).toHaveBeenCalledWith({
      repositoryPath: '/private/repository',
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
        `${BASE_COMMIT}...${HEAD_COMMIT}`,
        '--',
        'src/old:*.ts',
        '-new[1].ts',
      ],
    });
  });

  it('preserves successful empty and nonempty patch output exactly without line counts', async () => {
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(success('first\r\nlast\n'))
      .mockResolvedValueOnce(success(''));
    const input = createInput({
      changedFiles: [
        { repositoryId: 'frontend', path: 'first.ts', status: 'added' },
        { repositoryId: 'frontend', path: 'second.ts', status: 'deleted' },
      ],
    });

    const result = await loadChangedFilePatches(input);

    expect(result.changedFiles).toEqual([
      { repositoryId: 'frontend', path: 'first.ts', status: 'added', patch: 'first\r\nlast\n' },
      { repositoryId: 'frontend', path: 'second.ts', status: 'deleted', patch: '' },
    ]);
    expect(result.changedFiles[0]).not.toHaveProperty('addedLines');
    expect(result.changedFiles[0]).not.toHaveProperty('deletedLines');
  });

  it.each([
    [
      'binary output',
      'patch\u0000content',
      'PATCH_BINARY',
      'Patch was omitted because it is not supported text content.',
    ],
    [
      'oversized output',
      'x'.repeat(MAX_PATCH_BYTES + 1),
      'PATCH_TOO_LARGE',
      'Patch was omitted because it exceeds the maximum allowed size.',
    ],
  ] as const)('omits %s and preserves changed metadata', async (_label, stdout, code, message) => {
    vi.mocked(runGitCommand).mockResolvedValue(success(stdout));
    const input = createInput({
      changedFiles: [
        {
          repositoryId: 'frontend',
          path: 'src/file.ts',
          status: 'modified',
          addedLines: 7,
          deletedLines: 3,
        },
      ],
    });

    const result = await loadChangedFilePatches(input);

    expect(result.changedFiles).toEqual([
      {
        repositoryId: 'frontend',
        path: 'src/file.ts',
        status: 'modified',
        addedLines: 7,
        deletedLines: 3,
      },
    ]);
    expect(result.warnings).toEqual([
      { code, repositoryId: 'frontend', path: 'src/file.ts', message },
    ]);
  });

  it('accepts a patch at the exact 256 KiB boundary', async () => {
    const patch = 'x'.repeat(MAX_PATCH_BYTES);
    vi.mocked(runGitCommand).mockResolvedValue(success(patch));

    await expect(loadChangedFilePatches(createInput())).resolves.toEqual({
      changedFiles: [{ repositoryId: 'frontend', path: 'src/file.ts', status: 'modified', patch }],
      warnings: [],
    });
  });

  it.each([
    [
      'timeout',
      new GitCommandError('GIT_COMMAND_TIMED_OUT'),
      'PATCH_LOAD_TIMED_OUT',
      'Patch metadata loading timed out.',
    ],
    [
      'failure',
      new GitCommandError('GIT_COMMAND_FAILED'),
      'PATCH_UNAVAILABLE',
      'Patch metadata could not be loaded.',
    ],
  ] as const)('maps Git %s to a safe warning', async (_label, error, code, message) => {
    vi.mocked(runGitCommand).mockRejectedValue(error);

    const result = await loadChangedFilePatches(createInput());

    expect(result.changedFiles).toEqual([
      { repositoryId: 'frontend', path: 'src/file.ts', status: 'modified' },
    ]);
    expect(result.warnings).toEqual([
      { code, repositoryId: 'frontend', path: 'src/file.ts', message },
    ]);
  });

  it('treats malformed renamed metadata as unavailable without invoking Git', async () => {
    const result = await loadChangedFilePatches(
      createInput({
        changedFiles: [{ repositoryId: 'frontend', path: 'new.ts', status: 'renamed' }],
      }),
    );

    expect(runGitCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      changedFiles: [{ repositoryId: 'frontend', path: 'new.ts', status: 'renamed' }],
      warnings: [
        {
          code: 'PATCH_UNAVAILABLE',
          repositoryId: 'frontend',
          path: 'new.ts',
          message: 'Patch metadata could not be loaded.',
        },
      ],
    });
  });

  it('keeps duplicates and input order while sorting warnings by repository, path, and code point', async () => {
    vi.mocked(runGitCommand).mockImplementation(async ({ args }) => {
      const filePath = args.at(-1);
      if (filePath === 'z.ts') {
        throw new GitCommandError('GIT_COMMAND_TIMED_OUT');
      }
      throw new GitCommandError('GIT_COMMAND_FAILED');
    });
    const input = createInput({
      changedFiles: [
        { repositoryId: 'frontend', path: 'z.ts', status: 'modified' },
        { repositoryId: 'frontend', path: 'a.ts', status: 'added' },
        { repositoryId: 'frontend', path: 'a.ts', status: 'added' },
      ],
    });

    const result = await loadChangedFilePatches(input);

    expect(result.changedFiles).toEqual(input.changedFiles);
    expect(result.warnings.map((warning) => [warning.path, warning.code])).toEqual([
      ['a.ts', 'PATCH_UNAVAILABLE'],
      ['a.ts', 'PATCH_UNAVAILABLE'],
      ['z.ts', 'PATCH_LOAD_TIMED_OUT'],
    ]);
  });

  it('limits active patch commands to four and starts another only after one completes', async () => {
    let active = 0;
    let maximumActive = 0;
    const finishers: Array<() => void> = [];
    vi.mocked(runGitCommand).mockImplementation(
      () =>
        new Promise<GitCommandResult>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          finishers.push(() => {
            active -= 1;
            resolve(success(''));
          });
        }),
    );
    const input = createInput({
      changedFiles: Array.from({ length: 5 }, (_, index) => ({
        repositoryId: 'frontend',
        path: `file-${index}.ts`,
        status: 'modified' as const,
      })),
    });

    const result = loadChangedFilePatches(input);
    await Promise.resolve();
    await Promise.resolve();

    expect(runGitCommand).toHaveBeenCalledTimes(4);
    expect(maximumActive).toBe(4);
    finishers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(runGitCommand).toHaveBeenCalledTimes(5);

    while (finishers.length > 0) {
      finishers.shift()?.();
    }

    await expect(result).resolves.toMatchObject({ warnings: [] });
    expect(maximumActive).toBe(4);
  });

  it('does not log or leak private runner diagnostics', async () => {
    const privatePath = 'private/path.ts';
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');
    vi.mocked(runGitCommand).mockRejectedValue(new Error(`private diagnostic ${privatePath}`));

    const result = await loadChangedFilePatches(
      createInput({
        changedFiles: [{ repositoryId: 'frontend', path: privatePath, status: 'modified' }],
      }),
    );

    expect(JSON.stringify(result.warnings)).not.toContain('private diagnostic');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('loadChangedFilePatches real Git behavior', () => {
  it('uses captured commits rather than dirty working-tree content', async () => {
    vi.mocked(runGitCommand).mockImplementation(actualGitCommandRunner.runGitCommand);

    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createRepository(directory);
      await writeFile(path.join(repositoryPath, 'tracked.ts'), 'base\n', 'utf8');
      const baseCommit = await commitAll(repositoryPath, 'base');
      await writeFile(path.join(repositoryPath, 'tracked.ts'), 'captured\n', 'utf8');
      const headRef = await commitAll(repositoryPath, 'captured');
      await writeFile(path.join(repositoryPath, 'tracked.ts'), 'dirty\n', 'utf8');

      const result = await loadChangedFilePatches({
        repositoryId: 'backend',
        repository: { repositoryPath, baseRef: 'ignored', baseCommit, headRef },
        changedFiles: [{ repositoryId: 'backend', path: 'tracked.ts', status: 'modified' }],
      });

      expect(result.warnings).toEqual([]);
      expect(result.changedFiles[0]?.patch).toContain('+captured');
      expect(result.changedFiles[0]?.patch).not.toContain('+dirty');
    });
  });
});
