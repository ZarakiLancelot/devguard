import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(projectRoot, 'dist');

await rm(outputDirectory, { force: true, recursive: true });

const compiler = spawn(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  {
    cwd: projectRoot,
    shell: false,
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolve, reject) => {
  compiler.once('error', reject);
  compiler.once('close', (code, signal) => {
    if (signal !== null) {
      reject(new Error('Production TypeScript build was terminated.'));
      return;
    }
    resolve(code ?? 1);
  });
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
}
