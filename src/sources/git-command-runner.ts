import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

const GIT_EXECUTABLE = 'git';
const COMMAND_TIMEOUT_MS = 10_000;
const TERMINATION_GRACE_MS = 250;

const ERROR_MESSAGES: Readonly<Record<GitCommandErrorCode, string>> = {
  GIT_COMMAND_INVALID_INPUT: 'Unable to execute Git command safely.',
  GIT_COMMAND_FAILED: 'Git command failed.',
  GIT_COMMAND_TIMED_OUT: 'Git command timed out.',
};

export interface RunGitCommandInput {
  repositoryPath: string;
  args: readonly string[];
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export type GitCommandErrorCode =
  | 'GIT_COMMAND_INVALID_INPUT'
  | 'GIT_COMMAND_FAILED'
  | 'GIT_COMMAND_TIMED_OUT';

/** A safe operational error for unsuccessful fixed-executable Git execution. */
export class GitCommandError extends Error {
  readonly code: GitCommandErrorCode;
  readonly exitCode?: number;
  readonly signal?: NodeJS.Signals;

  constructor(code: GitCommandErrorCode, exitCode?: number, signal?: NodeJS.Signals) {
    super(ERROR_MESSAGES[code]);
    this.name = 'GitCommandError';
    this.code = code;

    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }

    if (signal !== undefined) {
      this.signal = signal;
    }
  }
}

/**
 * Runs the fixed `git` executable using literal argument-array execution.
 * It intentionally performs no repository, ref, option, or command validation.
 */
export async function runGitCommand(input: RunGitCommandInput): Promise<GitCommandResult> {
  if (!isValidInput(input)) {
    throw new GitCommandError('GIT_COMMAND_INVALID_INPUT');
  }

  return runGitCommandProcess(input);
}

function isValidInput(input: RunGitCommandInput): boolean {
  return (
    input.repositoryPath.length > 0 &&
    !input.repositoryPath.includes('\u0000') &&
    !input.args.some((argument) => argument.includes('\u0000'))
  );
}

function runGitCommandProcess(input: RunGitCommandInput): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;

    try {
      child = spawn(GIT_EXECUTABLE, ['-C', input.repositoryPath, ...input.args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new GitCommandError('GIT_COMMAND_FAILED'));
      return;
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    let stdoutFlushed = false;
    let stderrFlushed = false;
    let settled = false;
    let closed = false;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;

    const flushStdout = (): void => {
      if (stdoutFlushed) {
        return;
      }

      stdoutFlushed = true;
      stdout += stdoutDecoder.end();
    };

    const flushStderr = (): void => {
      if (stderrFlushed) {
        return;
      }

      stderrFlushed = true;
      stderr += stderrDecoder.end();
    };

    const clearTimers = (): void => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }

      if (escalationTimer !== undefined) {
        clearTimeout(escalationTimer);
        escalationTimer = undefined;
      }
    };

    const settle = (result: GitCommandResult | GitCommandError): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();

      if (result instanceof GitCommandError) {
        reject(result);
        return;
      }

      resolve(result);
    };

    const terminate = (signal: NodeJS.Signals): void => {
      if (closed || settled) {
        return;
      }

      try {
        child.kill(signal);
      } catch {
        // The timeout classification remains stable if process termination races.
      }
    };

    const handleTimeout = (): void => {
      if (closed || settled) {
        return;
      }

      timedOut = true;
      terminate('SIGTERM');
      escalationTimer = setTimeout(() => {
        if (closed || settled) {
          return;
        }

        terminate('SIGKILL');
        settle(new GitCommandError('GIT_COMMAND_TIMED_OUT'));
      }, TERMINATION_GRACE_MS);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += stdoutDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += stderrDecoder.write(chunk);
    });
    child.stdout.once('end', flushStdout);
    child.stderr.once('end', flushStderr);

    child.on('error', () => {
      if (timedOut || settled) {
        return;
      }

      settle(new GitCommandError('GIT_COMMAND_FAILED'));
    });

    child.once('close', (exitCode, signal) => {
      closed = true;
      flushStdout();
      flushStderr();

      if (settled) {
        return;
      }

      if (timedOut) {
        settle(new GitCommandError('GIT_COMMAND_TIMED_OUT'));
        return;
      }

      if (exitCode === 0 && signal === null) {
        settle({ stdout, stderr });
        return;
      }

      settle(
        new GitCommandError(
          'GIT_COMMAND_FAILED',
          typeof exitCode === 'number' ? exitCode : undefined,
          signal ?? undefined,
        ),
      );
    });

    timeoutTimer = setTimeout(handleTimeout, COMMAND_TIMEOUT_MS);
  });
}
