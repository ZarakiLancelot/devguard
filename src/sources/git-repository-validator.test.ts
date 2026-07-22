import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, chmod } from 'node:fs/promises';
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
  GitRepositoryValidationError,
  validateGitRepository,
  type ValidateGitRepositoryInput,
} from './git-repository-validator.js';
import { GitCommandError, runGitCommand, type GitCommandResult } from './git-command-runner.js';

const actualGitCommandRunner =
  await vi.importActual<typeof GitCommandRunnerModule>('./git-command-runner.js');
const execFileAsync = promisify(execFile);
const SHA_A = 'A'.repeat(40);
const SHA_B = 'b'.repeat(40);

beforeEach(() => {
  vi.mocked(runGitCommand).mockReset();
  vi.mocked(runGitCommand).mockImplementation(actualGitCommandRunner.runGitCommand);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devguard-git-validator-'));

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

async function createCommittedRepository(
  parentDirectory: string,
  name = 'repository',
): Promise<string> {
  const repositoryPath = path.join(parentDirectory, name);
  await runGit(['init', '--initial-branch=main', repositoryPath]);
  await runGit(['config', 'user.name', 'DevGuard Tests'], repositoryPath);
  await runGit(['config', 'user.email', 'devguard-tests@example.invalid'], repositoryPath);
  await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
  await runGit(['add', 'README.md'], repositoryPath);
  await runGit(['commit', '-m', 'initial'], repositoryPath);
  return repositoryPath;
}

async function addCommit(repositoryPath: string, filename = 'next.txt'): Promise<void> {
  await writeFile(path.join(repositoryPath, filename), `${filename}\n`, 'utf8');
  await runGit(['add', filename], repositoryPath);
  await runGit(['commit', '-m', `add ${filename}`], repositoryPath);
}

async function captureValidationError(
  input: ValidateGitRepositoryInput,
): Promise<GitRepositoryValidationError> {
  try {
    await validateGitRepository(input);
  } catch (error) {
    expect(error).toBeInstanceOf(GitRepositoryValidationError);
    return error as GitRepositoryValidationError;
  }

  throw new Error('Expected Git repository validation to fail');
}

function success(stdout: string): GitCommandResult {
  return { stdout, stderr: '' };
}

function arrangeMockedSuccess(
  candidatePath: string,
  topLevelPath: string,
  overrides: Partial<{
    bare: string;
    worktree: string;
    topLevel: string;
    head: string;
    base: string;
  }> = {},
): void {
  const outputs = {
    bare: 'false\n',
    worktree: 'true\n',
    topLevel: `${topLevelPath}\n`,
    head: `${SHA_A}\n`,
    base: `${SHA_B}\n`,
    ...overrides,
  };

  vi.mocked(runGitCommand)
    .mockResolvedValueOnce(success(outputs.bare))
    .mockResolvedValueOnce(success(outputs.worktree))
    .mockResolvedValueOnce(success(outputs.topLevel))
    .mockResolvedValueOnce(success(outputs.head))
    .mockResolvedValueOnce(success(outputs.base));

  expect(candidatePath).toBeTruthy();
}

describe('validateGitRepository mocked command behavior', () => {
  it('runs the five commands sequentially with canonical candidate and top-level argument boundaries', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = path.join(directory, 'repository');
      const subdirectoryPath = path.join(repositoryPath, 'nested');
      await mkdir(subdirectoryPath, { recursive: true });
      const canonicalCandidatePath = await realpath(subdirectoryPath);
      const canonicalTopLevelPath = await realpath(repositoryPath);
      arrangeMockedSuccess(canonicalCandidatePath, canonicalTopLevelPath);

      const input = { repositoryPath: subdirectoryPath, baseRef: 'main~1' };
      const before = structuredClone(input);
      const result = await validateGitRepository(input);

      expect(result).toEqual({
        repositoryPath: canonicalTopLevelPath,
        baseRef: 'main~1',
        baseCommit: SHA_B.toLowerCase(),
        headRef: SHA_A.toLowerCase(),
      });
      expect(input).toEqual(before);
      expect(runGitCommand).toHaveBeenCalledTimes(5);
      expect(runGitCommand).toHaveBeenNthCalledWith(1, {
        repositoryPath: canonicalCandidatePath,
        args: ['rev-parse', '--is-bare-repository'],
      });
      expect(runGitCommand).toHaveBeenNthCalledWith(2, {
        repositoryPath: canonicalCandidatePath,
        args: ['rev-parse', '--is-inside-work-tree'],
      });
      expect(runGitCommand).toHaveBeenNthCalledWith(3, {
        repositoryPath: canonicalCandidatePath,
        args: ['rev-parse', '--show-toplevel'],
      });
      expect(runGitCommand).toHaveBeenNthCalledWith(4, {
        repositoryPath: canonicalTopLevelPath,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      });
      expect(runGitCommand).toHaveBeenNthCalledWith(5, {
        repositoryPath: canonicalTopLevelPath,
        args: ['rev-parse', '--verify', 'main~1^{commit}'],
      });
    });
  });

  it('allows one terminal CRLF and lowercases otherwise valid full object IDs', async () => {
    await withTemporaryDirectory(async (directory) => {
      arrangeMockedSuccess(directory, directory, {
        bare: 'false\r\n',
        worktree: 'true\r\n',
        topLevel: `${directory}\r\n`,
        head: `${SHA_A}\r\n`,
        base: `${SHA_B.toUpperCase()}\r\n`,
      });

      await expect(
        validateGitRepository({ repositoryPath: directory, baseRef: 'base' }),
      ).resolves.toEqual({
        repositoryPath: await realpath(directory),
        baseRef: 'base',
        baseCommit: SHA_B,
        headRef: SHA_A.toLowerCase(),
      });
    });
  });

  it('stops before later commands when bare validation fails', async () => {
    await withTemporaryDirectory(async (directory) => {
      vi.mocked(runGitCommand).mockResolvedValueOnce(success('true\n'));

      const failure = await captureValidationError({ repositoryPath: directory, baseRef: 'main' });

      expect(failure.code).toBe('NOT_A_GIT_REPOSITORY');
      expect(runGitCommand).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['malformed bare output', { bare: 'false \n' }, 'NOT_A_GIT_REPOSITORY'],
    ['malformed worktree output', { worktree: 'true\nfalse\n' }, 'NOT_A_GIT_REPOSITORY'],
    ['false worktree output', { worktree: 'false\n' }, 'NOT_A_GIT_REPOSITORY'],
    ['multiple top-level lines', { topLevel: '/one\n/two\n' }, 'NOT_A_GIT_REPOSITORY'],
    ['malformed HEAD object ID', { head: `${'c'.repeat(39)}\n` }, 'NOT_A_GIT_REPOSITORY'],
    ['malformed base object ID', { base: 'not-a-commit\n' }, 'BASE_REF_NOT_FOUND'],
  ] as const)('rejects %s without exposing Git output', async (_label, overrides, expectedCode) => {
    await withTemporaryDirectory(async (directory) => {
      arrangeMockedSuccess(directory, directory, overrides);
      const failure = await captureValidationError({ repositoryPath: directory, baseRef: 'main' });

      expect(failure.code).toBe(expectedCode);
      expect(failure.message).not.toContain('not-a-commit');
      expect(failure.message).not.toContain(directory);
    });
  });

  it.each(['', '   ', 'bad\u0000ref', 'bad\tref', 'bad\nref', 'bad\rref', 'bad\u007Fref', '-main'])(
    'rejects unsafe baseRef %j before base-ref Git resolution',
    async (baseRef) => {
      await withTemporaryDirectory(async (directory) => {
        arrangeMockedSuccess(directory, directory);

        const failure = await captureValidationError({ repositoryPath: directory, baseRef });

        expect(failure.code).toBe('BASE_REF_NOT_FOUND');
        expect(runGitCommand).toHaveBeenCalledTimes(4);
        if (baseRef.length > 0) {
          expect(failure.message).not.toContain(baseRef);
        }
      });
    },
  );

  it('maps Git timeout errors without leaking command diagnostics', async () => {
    await withTemporaryDirectory(async (directory) => {
      vi.mocked(runGitCommand).mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_TIMED_OUT'));
      const failure = await captureValidationError({
        repositoryPath: directory,
        baseRef: 'private-ref',
      });

      expect(failure.code).toBe('GIT_COMMAND_TIMED_OUT');
      expect(failure.message).toBe('Git repository validation timed out.');
      expect(JSON.stringify(failure)).not.toContain(directory);
      expect(JSON.stringify(failure)).not.toContain('private-ref');
    });
  });

  it('maps identity failures, base failures, and unexpected failures to their safe codes', async () => {
    await withTemporaryDirectory(async (directory) => {
      vi.mocked(runGitCommand).mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_FAILED'));
      await expect(
        captureValidationError({ repositoryPath: directory, baseRef: 'main' }),
      ).resolves.toMatchObject({
        code: 'NOT_A_GIT_REPOSITORY',
      });

      vi.mocked(runGitCommand).mockReset();
      vi.mocked(runGitCommand)
        .mockResolvedValueOnce(success('false\n'))
        .mockResolvedValueOnce(success('true\n'))
        .mockResolvedValueOnce(success(`${directory}\n`))
        .mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_INVALID_INPUT'));
      await expect(
        captureValidationError({ repositoryPath: directory, baseRef: 'main' }),
      ).resolves.toMatchObject({
        code: 'GIT_COMMAND_FAILED',
      });

      vi.mocked(runGitCommand).mockReset();
      vi.mocked(runGitCommand)
        .mockResolvedValueOnce(success('false\n'))
        .mockResolvedValueOnce(success('true\n'))
        .mockResolvedValueOnce(success(`${directory}\n`))
        .mockResolvedValueOnce(success(`${SHA_A}\n`))
        .mockRejectedValueOnce(new GitCommandError('GIT_COMMAND_FAILED'));
      await expect(
        captureValidationError({ repositoryPath: directory, baseRef: 'main' }),
      ).resolves.toMatchObject({
        code: 'BASE_REF_NOT_FOUND',
      });
    });
  });

  it('keeps validation errors deterministic and limited to safe public fields', async () => {
    await withTemporaryDirectory(async (directory) => {
      const secretPath = path.join(directory, 'private repository');
      const secretRef = 'private-base-ref';
      const first = await captureValidationError({
        repositoryPath: secretPath,
        baseRef: secretRef,
      });
      const second = await captureValidationError({
        repositoryPath: secretPath,
        baseRef: secretRef,
      });

      expect(first.code).toBe('REPOSITORY_NOT_FOUND');
      expect(second).toMatchObject({ code: first.code, message: first.message, name: first.name });
      expect(Object.keys(first).sort()).toEqual(['code', 'name']);
      const publicError = JSON.stringify(first);
      expect(publicError).not.toContain(secretPath);
      expect(publicError).not.toContain(secretRef);
      expect(publicError).not.toContain('stdout');
      expect(publicError).not.toContain('stderr');
    });
  });
});

describe('validateGitRepository filesystem and real Git behavior', () => {
  it('validates a normal worktree and returns canonical top-level and immutable commit IDs', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      await runGit(['branch', 'base'], repositoryPath);
      await addCommit(repositoryPath);
      const expectedHead = (await runGit(['rev-parse', 'HEAD'], repositoryPath)).trim();
      const expectedBase = (await runGit(['rev-parse', 'base'], repositoryPath)).trim();

      const result = await validateGitRepository({ repositoryPath, baseRef: 'base' });

      expect(result).toEqual({
        repositoryPath: await realpath(repositoryPath),
        baseRef: 'base',
        baseCommit: expectedBase,
        headRef: expectedHead,
      });
      expect(result.headRef).toMatch(/^[0-9a-f]{40}$/u);
      expect(result.headRef).not.toBe('HEAD');
    });
  });

  it('accepts a relative runtime repository path without applying workspace containment', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const relativePath = path.relative(process.cwd(), repositoryPath);

      const result = await validateGitRepository({ repositoryPath: relativePath, baseRef: 'HEAD' });

      expect(result.repositoryPath).toBe(await realpath(repositoryPath));
      expect(result.baseRef).toBe('HEAD');
      expect(result.baseCommit).toBe(result.headRef);
    });
  });

  it('normalizes a worktree subdirectory and a symlink to the same canonical top-level', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const subdirectoryPath = path.join(repositoryPath, 'nested', 'source');
      const symlinkPath = path.join(directory, 'repository-link');
      await mkdir(subdirectoryPath, { recursive: true });
      await symlink(repositoryPath, symlinkPath);
      const canonicalTopLevelPath = await realpath(repositoryPath);

      await expect(
        validateGitRepository({ repositoryPath: subdirectoryPath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({ repositoryPath: canonicalTopLevelPath });
      await expect(
        validateGitRepository({ repositoryPath: symlinkPath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({ repositoryPath: canonicalTopLevelPath });
    });
  });

  it('preserves spaces and Unicode in repository paths without converting native separators', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory, 'repository café space');
      const result = await validateGitRepository({ repositoryPath, baseRef: 'HEAD' });

      expect(result.repositoryPath).toBe(await realpath(repositoryPath));
      expect(result.repositoryPath).toContain('repository café space');
      expect(result.repositoryPath).not.toContain('\\');
    });
  });

  it('accepts a linked Git worktree', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const worktreePath = path.join(directory, 'linked-worktree');
      await runGit(['worktree', 'add', worktreePath, '-b', 'linked-branch'], repositoryPath);

      await expect(
        validateGitRepository({ repositoryPath: worktreePath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({
        repositoryPath: await realpath(worktreePath),
      });
    });
  });

  it('accepts detached HEAD and returns its commit SHA rather than a branch name', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const detachedCommit = (await runGit(['rev-parse', 'HEAD'], repositoryPath)).trim();
      await runGit(['checkout', '--detach', detachedCommit], repositoryPath);

      const result = await validateGitRepository({ repositoryPath, baseRef: 'HEAD' });

      expect(result.headRef).toBe(detachedCommit);
      expect(result.headRef).not.toBe('main');
    });
  });

  it('captures a stable headRef until a new commit changes it', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const first = await validateGitRepository({ repositoryPath, baseRef: 'HEAD' });
      const repeated = await validateGitRepository({ repositoryPath, baseRef: 'HEAD' });
      await addCommit(repositoryPath);
      const second = await validateGitRepository({ repositoryPath, baseRef: 'HEAD' });

      expect(repeated.headRef).toBe(first.headRef);
      expect(second.headRef).not.toBe(first.headRef);
      expect(second.baseCommit).toBe(second.headRef);
    });
  });

  it('supports configured commit-ish base references while preserving their original text', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const initialCommit = (await runGit(['rev-parse', 'HEAD'], repositoryPath)).trim();
      await runGit(['branch', 'base'], repositoryPath);
      await runGit(['tag', 'lightweight-base'], repositoryPath);
      await runGit(['tag', '-a', 'annotated-base', '-m', 'annotated'], repositoryPath);
      await runGit(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repositoryPath);
      await addCommit(repositoryPath);

      for (const baseRef of [
        'base',
        'origin/main',
        'lightweight-base',
        'annotated-base',
        initialCommit,
        initialCommit.slice(0, 12),
        'HEAD',
        'HEAD~1',
      ]) {
        const result = await validateGitRepository({ repositoryPath, baseRef });
        const expectedBase = (
          await runGit(['rev-parse', '--verify', `${baseRef}^{commit}`], repositoryPath)
        ).trim();

        expect(result.baseRef).toBe(baseRef);
        expect(result.baseCommit).toBe(expectedBase);
        expect(result.baseCommit).toMatch(/^[0-9a-f]{40}$/u);
      }
    });
  });

  it('rejects missing and non-commit base references safely', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const blobPath = path.join(repositoryPath, 'blob.txt');
      await writeFile(blobPath, 'blob\n', 'utf8');
      const blobObjectId = (await runGit(['hash-object', '-w', 'blob.txt'], repositoryPath)).trim();

      for (const baseRef of ['missing-reference', blobObjectId]) {
        const failure = await captureValidationError({ repositoryPath, baseRef });
        expect(failure.code).toBe('BASE_REF_NOT_FOUND');
        expect(failure.message).not.toContain(baseRef);
      }
    });
  });

  it('maps an inaccessible candidate path to REPOSITORY_NOT_FOUND when permissions are enforceable', async () => {
    if (process.getuid?.() === 0) {
      return;
    }

    await withTemporaryDirectory(async (directory) => {
      const protectedDirectory = path.join(directory, 'protected');
      const inaccessibleRepositoryPath = path.join(protectedDirectory, 'repository');
      await mkdir(inaccessibleRepositoryPath, { recursive: true });
      await chmod(protectedDirectory, 0o000);

      try {
        await expect(
          captureValidationError({ repositoryPath: inaccessibleRepositoryPath, baseRef: 'HEAD' }),
        ).resolves.toMatchObject({ code: 'REPOSITORY_NOT_FOUND' });
      } finally {
        await chmod(protectedDirectory, 0o700);
      }
    });
  });

  it('rejects missing paths, file paths, non-Git directories, bare repositories, and unborn HEADs', async () => {
    await withTemporaryDirectory(async (directory) => {
      const filePath = path.join(directory, 'not-a-directory');
      const nonGitPath = path.join(directory, 'not-a-repository');
      const barePath = path.join(directory, 'bare.git');
      const unbornPath = path.join(directory, 'unborn');
      await writeFile(filePath, 'file\n', 'utf8');
      await mkdir(nonGitPath);
      await runGit(['init', '--bare', barePath]);
      await runGit(['init', '--initial-branch=main', unbornPath]);

      await expect(
        captureValidationError({
          repositoryPath: path.join(directory, 'missing'),
          baseRef: 'HEAD',
        }),
      ).resolves.toMatchObject({ code: 'REPOSITORY_NOT_FOUND' });
      await expect(
        captureValidationError({ repositoryPath: filePath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({
        code: 'REPOSITORY_NOT_FOUND',
      });
      await expect(
        captureValidationError({ repositoryPath: nonGitPath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({
        code: 'NOT_A_GIT_REPOSITORY',
      });
      await expect(
        captureValidationError({ repositoryPath: barePath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({
        code: 'NOT_A_GIT_REPOSITORY',
      });
      await expect(
        captureValidationError({ repositoryPath: unbornPath, baseRef: 'HEAD' }),
      ).resolves.toMatchObject({
        code: 'NOT_A_GIT_REPOSITORY',
      });
    });
  });

  it('does not change cwd, environment, console output, or caller-owned input', async () => {
    await withTemporaryDirectory(async (directory) => {
      const repositoryPath = await createCommittedRepository(directory);
      const input = { repositoryPath, baseRef: 'HEAD' };
      const inputBefore = structuredClone(input);
      const cwd = process.cwd();
      const environment = { ...process.env };
      const chdir = vi.spyOn(process, 'chdir');
      const consoleLog = vi.spyOn(console, 'log');
      const consoleWarn = vi.spyOn(console, 'warn');
      const consoleError = vi.spyOn(console, 'error');

      await validateGitRepository(input);

      expect(input).toEqual(inputBefore);
      expect(process.cwd()).toBe(cwd);
      expect(process.env).toEqual(environment);
      expect(chdir).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
