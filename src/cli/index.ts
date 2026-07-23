#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommanderError } from 'commander';
import { CliHandledFailure } from './cli-error-presenter.js';
import { createProgram, type CliDependencies } from './program.js';

/** Runs the CLI without mutating process exit state or exposing caught errors. */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  const program = createProgram(overrides);
  const filteredArgv = argv.filter((arg, index) => !(arg === '--' && index === 2));

  try {
    await program.parseAsync(filteredArgv);
    return 0;
  } catch (error: unknown) {
    if (error instanceof CliHandledFailure) {
      return 1;
    }

    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url;
}

if (isDirectExecution()) {
  void main();
}
