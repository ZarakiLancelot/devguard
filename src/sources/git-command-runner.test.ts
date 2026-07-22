import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { GitCommandError, runGitCommand, type RunGitCommandInput } from './git-command-runner.js';

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((_signal: NodeJS.Signals): boolean => true);

  asChildProcess(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }

  close(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', exitCode, signal);
  }
}

const spawnMock = vi.mocked(spawn);

function arrangeChild(): FakeChildProcess {
  const child = new FakeChildProcess();
  spawnMock.mockReturnValue(child.asChildProcess());
  return child;
}

function createInput(overrides: Partial<RunGitCommandInput> = {}): RunGitCommandInput {
  return {
    repositoryPath: '/private/repository path',
    args: ['status', '--short'],
    ...overrides,
  };
}

function finishSuccessfulProcess(child: FakeChildProcess): void {
  child.stdout.end();
  child.stderr.end();
  child.close(0);
}

async function captureFailure(action: () => Promise<unknown>): Promise<GitCommandError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(GitCommandError);
    return error as GitCommandError;
  }

  throw new Error('Expected Git command to fail');
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runGitCommand', () => {
  it('spawns only fixed git with literal, separate arguments and safe options', async () => {
    const child = arrangeChild();
    const args = ['diff', '--name-status', 'two words', '日本語', 'line\nbreak', '-leading-dash'];
    const input = createInput({ repositoryPath: '/repo path', args });
    const before = structuredClone(input);
    const result = runGitCommand(input);

    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      [
        '-C',
        '/repo path',
        'diff',
        '--name-status',
        'two words',
        '日本語',
        'line\nbreak',
        '-leading-dash',
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(spawnMock.mock.calls[0]?.[0]).toBe('git');
    expect(spawnMock.mock.calls[0]?.[1]).not.toBe(args);
    expect(input).toEqual(before);

    finishSuccessfulProcess(child);
    await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
  });

  it('allows an empty args array and does not trim or normalize a whitespace repository path', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput({ repositoryPath: '  ', args: [] }));

    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      ['-C', '  '],
      expect.objectContaining({ shell: false }),
    );

    finishSuccessfulProcess(child);
    await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
  });

  it.each([
    ['empty repository path', createInput({ repositoryPath: '' })],
    ['NUL repository path', createInput({ repositoryPath: 'repo\u0000path' })],
    ['NUL argument', createInput({ args: ['show', 'bad\u0000argument'] })],
  ])(
    'rejects %s before spawning with a safe deterministic invalid-input error',
    async (_label, input) => {
      const secretValues = [input.repositoryPath, ...input.args];
      const failure = await captureFailure(() => runGitCommand(input));

      expect(failure.code).toBe('GIT_COMMAND_INVALID_INPUT');
      expect(failure.message).toBe('Unable to execute Git command safely.');
      expect(failure.exitCode).toBeUndefined();
      expect(failure.signal).toBeUndefined();
      expect(spawnMock).not.toHaveBeenCalled();
      for (const value of secretValues.filter((value) => value.length > 0)) {
        expect(failure.message).not.toContain(value);
      }
    },
  );

  it('returns untrimmed UTF-8 stdout and stderr, including successful stderr output', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    child.stdout.write(Buffer.from('first\r\nlast\n', 'utf8'));
    child.stderr.write(Buffer.from('warning\r\n', 'utf8'));
    finishSuccessfulProcess(child);

    await expect(result).resolves.toEqual({
      stdout: 'first\r\nlast\n',
      stderr: 'warning\r\n',
    });
  });

  it('decodes split multibyte UTF-8 stdout and stderr independently', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput());
    const stdoutBytes = Buffer.from('stdout 😀', 'utf8');
    const stderrBytes = Buffer.from('stderr 漢', 'utf8');

    child.stdout.write(stdoutBytes.subarray(0, 8));
    child.stderr.write(stderrBytes.subarray(0, 8));
    child.stdout.write(stdoutBytes.subarray(8));
    child.stderr.write(stderrBytes.subarray(8));
    finishSuccessfulProcess(child);

    await expect(result).resolves.toEqual({ stdout: 'stdout 😀', stderr: 'stderr 漢' });
  });

  it('produces deterministic equivalent results for repeated equivalent process events', async () => {
    const firstChild = arrangeChild();
    const first = runGitCommand(createInput({ args: ['version'] }));
    firstChild.stdout.write('git version test\n');
    finishSuccessfulProcess(firstChild);
    const firstResult = await first;

    const secondChild = arrangeChild();
    const second = runGitCommand(createInput({ args: ['version'] }));
    secondChild.stdout.write('git version test\n');
    finishSuccessfulProcess(secondChild);

    await expect(second).resolves.toEqual(firstResult);
  });

  it('captures streams when stderr ends before stdout and flushes each decoder once', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    child.stderr.write(Buffer.from('stderr first', 'utf8'));
    child.stderr.end();
    child.stdout.write(Buffer.from('stdout later', 'utf8'));
    child.stdout.end();
    child.close(0);

    await expect(result).resolves.toEqual({ stdout: 'stdout later', stderr: 'stderr first' });
  });

  it('rejects non-zero exits with only safe structured exit information', async () => {
    const child = arrangeChild();
    const result = runGitCommand(
      createInput({ repositoryPath: '/secret/repository', args: ['secret'] }),
    );
    child.stdout.write('private stdout');
    child.stderr.write('private stderr');
    child.stdout.end();
    child.stderr.end();
    child.close(23);

    const failure = await captureFailure(() => result);

    expect(failure.code).toBe('GIT_COMMAND_FAILED');
    expect(failure.exitCode).toBe(23);
    expect(failure.signal).toBeUndefined();
    expect(failure.message).toBe('Git command failed.');
    expect(failure.message).not.toContain('/secret/repository');
    expect(failure.message).not.toContain('secret');
    expect(failure.message).not.toContain('private stdout');
    expect(failure.message).not.toContain('private stderr');
    expect(Object.keys(failure)).not.toContain('stdout');
    expect(Object.keys(failure)).not.toContain('stderr');
  });

  it('rejects signal termination with safe structured signal information', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    child.close(null, 'SIGTERM');

    const failure = await captureFailure(() => result);
    expect(failure.code).toBe('GIT_COMMAND_FAILED');
    expect(failure.exitCode).toBeUndefined();
    expect(failure.signal).toBe('SIGTERM');
    expect(failure.message).toBe('Git command failed.');
  });

  it('wraps a raw spawn error safely and settles once when close follows error', async () => {
    const child = arrangeChild();
    const consoleLog = vi.spyOn(console, 'log');
    const consoleError = vi.spyOn(console, 'error');
    const result = runGitCommand(createInput({ repositoryPath: '/secret/repository' }));
    const rawError = new Error('ENOENT git lookup at /secret/repository');
    const catches = vi.fn();
    void result.catch(catches);

    child.emit('error', rawError);
    child.close(1);

    const failure = await captureFailure(() => result);
    await Promise.resolve();
    expect(catches).toHaveBeenCalledTimes(1);
    expect(failure.code).toBe('GIT_COMMAND_FAILED');
    expect(failure.message).toBe('Git command failed.');
    expect(failure.message).not.toContain(rawError.message);
    expect(failure.message).not.toContain('/secret/repository');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores a late process error after successful close without changing the settled result', async () => {
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    finishSuccessfulProcess(child);
    await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
    expect(() => child.emit('error', new Error('late private error'))).not.toThrow();
  });

  it('starts a 10-second timeout, sends SIGTERM first, and preserves timeout after a late non-zero close', async () => {
    vi.useFakeTimers();
    const child = arrangeChild();
    const result = runGitCommand(createInput({ repositoryPath: '/secret/path', args: ['secret'] }));

    vi.advanceTimersByTime(9_999);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');

    child.close(1);
    const failure = await captureFailure(() => result);

    expect(failure.code).toBe('GIT_COMMAND_TIMED_OUT');
    expect(failure.message).toBe('Git command timed out.');
    expect(failure.message).not.toContain('/secret/path');
    expect(failure.message).not.toContain('secret');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(250);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('escalates to SIGKILL only after the fixed grace period and bounds a never-closing process', async () => {
    vi.useFakeTimers();
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    vi.advanceTimersByTime(10_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');
    vi.advanceTimersByTime(249);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);

    await expect(result).rejects.toMatchObject({
      code: 'GIT_COMMAND_TIMED_OUT',
      message: 'Git command timed out.',
    });
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves timeout classification when a late signal close follows SIGTERM', async () => {
    vi.useFakeTimers();
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    vi.advanceTimersByTime(10_000);
    child.close(null, 'SIGTERM');

    await expect(result).rejects.toMatchObject({
      code: 'GIT_COMMAND_TIMED_OUT',
      message: 'Git command timed out.',
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timeout timers after successful close and never kills a closed child', async () => {
    vi.useFakeTimers();
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    finishSuccessfulProcess(child);
    await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('clears timeout timers after process error without later termination attempts', async () => {
    vi.useFakeTimers();
    const child = arrangeChild();
    const result = runGitCommand(createInput());

    child.emit('error', new Error('private raw spawn error'));
    await expect(result).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not mutate cwd or environment, and does not log process output', async () => {
    const child = arrangeChild();
    const originalCwd = process.cwd();
    const environmentBefore = { ...process.env };
    const chdir = vi.spyOn(process, 'chdir');
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');
    const result = runGitCommand(createInput());

    child.stdout.write('stdout content');
    child.stderr.write('stderr content');
    finishSuccessfulProcess(child);

    await expect(result).resolves.toEqual({ stdout: 'stdout content', stderr: 'stderr content' });
    expect(process.cwd()).toBe(originalCwd);
    expect(process.env).toEqual(environmentBefore);
    expect(chdir).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
