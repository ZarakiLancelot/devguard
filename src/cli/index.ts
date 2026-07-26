#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommanderError } from 'commander';
import { CliHandledFailure } from './cli-error-presenter.js';
import {
  CLI_EXIT_OPERATIONAL_FAILURE,
  CLI_EXIT_QUALITY_THRESHOLD_NOT_MET,
  CLI_EXIT_SUCCESS,
  CLI_EXIT_USAGE_ERROR,
} from './exit-codes.js';
import { createProgram, type CliDependencies } from './program.js';
import { QualityThresholdFailure } from './quality-threshold-failure.js';

/** Runs the CLI without mutating process exit state or exposing caught errors. */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  const program = createProgram(overrides);
  const filteredArgv = argv.filter((arg, index) => !(arg === '--' && index === 2));

  try {
    await program.parseAsync(filteredArgv);
    return CLI_EXIT_SUCCESS;
  } catch (error: unknown) {
    if (error instanceof QualityThresholdFailure) {
      return CLI_EXIT_QUALITY_THRESHOLD_NOT_MET;
    }

    if (error instanceof CliHandledFailure) {
      return CLI_EXIT_OPERATIONAL_FAILURE;
    }

    if (error instanceof CommanderError) {
      return error.exitCode === CLI_EXIT_SUCCESS ? CLI_EXIT_SUCCESS : CLI_EXIT_USAGE_ERROR;
    }

    return CLI_EXIT_OPERATIONAL_FAILURE;
  }
}

export async function main(
  argv: readonly string[] = process.argv,
  overrides: Partial<CliDependencies> = {},
): Promise<void> {
  const exitCode = await runCli(argv, overrides);
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
