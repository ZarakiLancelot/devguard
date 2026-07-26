import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROCESS_TIMEOUT_MS = 30_000;
const MAX_CAPTURED_OUTPUT_BYTES = 1_048_576;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const demoScript = path.resolve(scriptDirectory, 'demo.mjs');

async function main() {
  const build = await runProcess(pnpmCommand(), ['run', 'build:prod']);
  if (build.exitCode !== 0 || build.signal !== null) {
    process.stderr.write('DevGuard Book demo failed.\n');
    process.exitCode = 1;
    return;
  }

  const verification = await runProcess(process.execPath, [demoScript, '--verify']);
  if (verification.exitCode !== 0 || verification.signal !== null) {
    process.stderr.write('DevGuard Book demo failed.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(verification.stdout);
  process.stdout.write(
    [
      'Reports available at:',
      '- demo/.work/book-library/reports/book-library-report.md',
      '- demo/.work/book-library/reports/book-library-report.json',
    ].join('\n') + '\n',
  );
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: projectRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new Error('Unable to start demo command.'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Demo command failed.'));
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail();
    }, PROCESS_TIMEOUT_MS);
    const append = (stream, chunk) => {
      if (settled) return;
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_CAPTURED_OUTPUT_BYTES) return fail();
        stdout += chunk.toString('utf8');
      } else {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_CAPTURED_OUTPUT_BYTES) return fail();
        stderr += chunk.toString('utf8');
      }
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', fail);
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

void main().catch(() => {
  process.stderr.write('DevGuard Book demo failed.\n');
  process.exitCode = 1;
});
