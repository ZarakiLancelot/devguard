import { AnalyzeRepositoryError } from '../application/analyze-repository.js';
import { ConfigLoadError, type ConfigLoadErrorCode } from '../config/config-loader.js';
import { GitCommandError, type GitCommandErrorCode } from '../sources/git-command-runner.js';
import {
  GitRepositoryValidationError,
  type GitRepositoryValidationErrorCode,
} from '../sources/git-repository-validator.js';
import { GitDiffError, type GitDiffErrorCode } from '../sources/local-git-diff-provider.js';
import {
  LocalRepositoryContextError,
  type LocalRepositoryContextErrorCode,
} from '../sources/local-context-builder.js';
import { GitFileLoadError, type GitFileLoadErrorCode } from '../sources/repository-file-loader.js';
import type { AnalyzeRepositoryErrorCode } from '../application/analyze-repository.js';

export interface CliErrorPresentation {
  code: string;
  message: string;
}

const CONFIG_MESSAGES: Readonly<Record<ConfigLoadErrorCode, string>> = Object.freeze({
  CONFIG_INVALID_INPUT: 'DevGuard configuration input is invalid.',
  CONFIG_FILE_NOT_FOUND: 'DevGuard configuration file was not found.',
  CONFIG_FILE_UNREADABLE: 'DevGuard configuration file could not be read.',
  CONFIG_FILE_NOT_REGULAR: 'DevGuard configuration path does not reference a regular file.',
  CONFIG_FILE_TOO_LARGE: 'DevGuard configuration file exceeds the supported size limit.',
  CONFIG_FILE_INVALID_UTF8: 'DevGuard configuration file is not valid UTF-8 text.',
  CONFIG_YAML_INVALID: 'DevGuard configuration YAML is invalid.',
  CONFIG_YAML_UNSUPPORTED: 'DevGuard configuration uses unsupported YAML features.',
  CONFIG_SCHEMA_INVALID: 'DevGuard configuration structure is invalid.',
  CONFIG_RELATION_INVALID: 'DevGuard configuration relationships are invalid.',
});

const GIT_COMMAND_MESSAGES: Readonly<Record<GitCommandErrorCode, string>> = Object.freeze({
  GIT_COMMAND_INVALID_INPUT: 'Unable to execute Git command safely.',
  GIT_COMMAND_FAILED: 'Git command failed.',
  GIT_COMMAND_TIMED_OUT: 'Git command timed out.',
});

const GIT_REPOSITORY_MESSAGES: Readonly<Record<GitRepositoryValidationErrorCode, string>> =
  Object.freeze({
    REPOSITORY_NOT_FOUND: 'Configured repository path is unavailable.',
    NOT_A_GIT_REPOSITORY: 'Configured directory is not a Git working repository.',
    BASE_REF_NOT_FOUND: 'Configured base reference could not be resolved.',
    GIT_COMMAND_FAILED: 'Git repository validation failed.',
    GIT_COMMAND_TIMED_OUT: 'Git repository validation timed out.',
  });

const GIT_DIFF_MESSAGES: Readonly<Record<GitDiffErrorCode, string>> = Object.freeze({
  GIT_DIFF_FAILED: 'Git changed-file discovery failed.',
  GIT_DIFF_TIMED_OUT: 'Git changed-file discovery timed out.',
  MERGE_BASE_NOT_FOUND: 'No common ancestor exists for the validated repository commits.',
  MULTIPLE_MERGE_BASES: 'Repository commits have multiple best common ancestors.',
  GIT_DIFF_OUTPUT_INVALID: 'Git changed-file metadata was invalid.',
  CHANGED_FILE_LIMIT_EXCEEDED: 'Repository change count exceeds the supported limit.',
});

const GIT_FILE_MESSAGES: Readonly<Record<GitFileLoadErrorCode, string>> = Object.freeze({
  FILE_OBJECT_NOT_FOUND: 'Required repository file is unavailable at the captured revision.',
  FILE_OBJECT_INVALID: 'Required repository path does not resolve to a supported file object.',
  FILE_TOO_LARGE: 'Required repository file exceeds the supported size limit.',
  FILE_BINARY: 'Required repository file is not supported text content.',
  TOTAL_TEXT_LIMIT_EXCEEDED: 'Loaded repository text exceeds the supported total size limit.',
  GIT_FILE_LOAD_FAILED: 'Required repository file could not be loaded.',
  GIT_FILE_LOAD_TIMED_OUT: 'Repository file loading timed out.',
});

const LOCAL_CONTEXT_MESSAGES: Readonly<Record<LocalRepositoryContextErrorCode, string>> =
  Object.freeze({
    LOCAL_SOURCE_CONFIG_INVALID: 'Local repository source configuration is invalid.',
    LOCAL_SOURCE_INVARIANT_VIOLATION: 'Local repository context could not be assembled safely.',
    LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED:
      'Local repository source text exceeds the supported total size limit.',
  });

const ANALYSIS_MESSAGES: Readonly<Record<AnalyzeRepositoryErrorCode, string>> = Object.freeze({
  ANALYSIS_INVARIANT_VIOLATION:
    'Analysis could not be completed because an internal invariant failed.',
  ANALYZER_EXECUTION_FAILED: 'Analysis could not be completed.',
  REPORT_BUILD_FAILED: 'The analysis report could not be created.',
});

const UNKNOWN_PRESENTATION: Readonly<CliErrorPresentation> = Object.freeze({
  code: 'INTERNAL_ERROR',
  message: 'Analysis could not be completed.',
});

const HANDLED_FAILURE_MESSAGE = 'DevGuard command execution failed.';

/** Internal control-flow signal for an analysis failure already rendered safely. */
export class CliHandledFailure extends Error {
  constructor() {
    super(HANDLED_FAILURE_MESSAGE);
    this.name = 'CliHandledFailure';
  }
}

/**
 * Converts known local DevGuard fatal errors into stable public text without
 * inspecting arbitrary messages, causes, names, stacks, or foreign objects.
 */
export function presentCliError(error: unknown): CliErrorPresentation {
  if (error instanceof ConfigLoadError) {
    return createPresentation(error.code, CONFIG_MESSAGES);
  }

  if (error instanceof GitCommandError) {
    return createPresentation(error.code, GIT_COMMAND_MESSAGES);
  }

  if (error instanceof GitRepositoryValidationError) {
    return createPresentation(error.code, GIT_REPOSITORY_MESSAGES);
  }

  if (error instanceof GitDiffError) {
    return createPresentation(error.code, GIT_DIFF_MESSAGES);
  }

  if (error instanceof GitFileLoadError) {
    return createPresentation(error.code, GIT_FILE_MESSAGES);
  }

  if (error instanceof LocalRepositoryContextError) {
    return createPresentation(error.code, LOCAL_CONTEXT_MESSAGES);
  }

  if (error instanceof AnalyzeRepositoryError) {
    return createPresentation(error.code, ANALYSIS_MESSAGES);
  }

  return UNKNOWN_PRESENTATION;
}

function createPresentation<Code extends string>(
  code: Code,
  messages: Readonly<Record<Code, string>>,
): CliErrorPresentation {
  return { code, message: messages[code] };
}
