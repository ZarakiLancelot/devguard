import { describe, expect, it, vi } from 'vitest';
import {
  CliHandledFailure,
  presentCliError,
  type CliErrorPresentation,
} from './cli-error-presenter.js';
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

function expected(code: string, message: string): CliErrorPresentation {
  return { code, message };
}

describe('presentCliError', () => {
  it.each([
    ['CONFIG_INVALID_INPUT', 'DevGuard configuration input is invalid.'],
    ['CONFIG_FILE_NOT_FOUND', 'DevGuard configuration file was not found.'],
    ['CONFIG_FILE_UNREADABLE', 'DevGuard configuration file could not be read.'],
    ['CONFIG_FILE_NOT_REGULAR', 'DevGuard configuration path does not reference a regular file.'],
    ['CONFIG_FILE_TOO_LARGE', 'DevGuard configuration file exceeds the supported size limit.'],
    ['CONFIG_FILE_INVALID_UTF8', 'DevGuard configuration file is not valid UTF-8 text.'],
    ['CONFIG_YAML_INVALID', 'DevGuard configuration YAML is invalid.'],
    ['CONFIG_YAML_UNSUPPORTED', 'DevGuard configuration uses unsupported YAML features.'],
    ['CONFIG_SCHEMA_INVALID', 'DevGuard configuration structure is invalid.'],
    ['CONFIG_RELATION_INVALID', 'DevGuard configuration relationships are invalid.'],
  ] as const)('presents ConfigLoadError %s from the closed table', (code, message) => {
    const error = new ConfigLoadError(code as ConfigLoadErrorCode, [
      { path: '/private/config/sentinel' },
    ]);

    expect(presentCliError(error)).toEqual(expected(code, message));
  });

  it.each([
    ['GIT_COMMAND_INVALID_INPUT', 'Unable to execute Git command safely.'],
    ['GIT_COMMAND_FAILED', 'Git command failed.'],
    ['GIT_COMMAND_TIMED_OUT', 'Git command timed out.'],
  ] as const)('presents GitCommandError %s from the closed table', (code, message) => {
    expect(presentCliError(new GitCommandError(code as GitCommandErrorCode))).toEqual(
      expected(code, message),
    );
  });

  it.each([
    ['REPOSITORY_NOT_FOUND', 'Configured repository path is unavailable.'],
    ['NOT_A_GIT_REPOSITORY', 'Configured directory is not a Git working repository.'],
    ['BASE_REF_NOT_FOUND', 'Configured base reference could not be resolved.'],
    ['GIT_COMMAND_FAILED', 'Git repository validation failed.'],
    ['GIT_COMMAND_TIMED_OUT', 'Git repository validation timed out.'],
  ] as const)('presents GitRepositoryValidationError %s from the closed table', (code, message) => {
    expect(
      presentCliError(new GitRepositoryValidationError(code as GitRepositoryValidationErrorCode)),
    ).toEqual(expected(code, message));
  });

  it.each([
    ['GIT_DIFF_FAILED', 'Git changed-file discovery failed.'],
    ['GIT_DIFF_TIMED_OUT', 'Git changed-file discovery timed out.'],
    ['MERGE_BASE_NOT_FOUND', 'No common ancestor exists for the validated repository commits.'],
    ['MULTIPLE_MERGE_BASES', 'Repository commits have multiple best common ancestors.'],
    ['GIT_DIFF_OUTPUT_INVALID', 'Git changed-file metadata was invalid.'],
    ['CHANGED_FILE_LIMIT_EXCEEDED', 'Repository change count exceeds the supported limit.'],
  ] as const)('presents GitDiffError %s from the closed table', (code, message) => {
    expect(presentCliError(new GitDiffError(code as GitDiffErrorCode))).toEqual(
      expected(code, message),
    );
  });

  it.each([
    ['FILE_OBJECT_NOT_FOUND', 'Required repository file is unavailable at the captured revision.'],
    [
      'FILE_OBJECT_INVALID',
      'Required repository path does not resolve to a supported file object.',
    ],
    ['FILE_TOO_LARGE', 'Required repository file exceeds the supported size limit.'],
    ['FILE_BINARY', 'Required repository file is not supported text content.'],
    ['TOTAL_TEXT_LIMIT_EXCEEDED', 'Loaded repository text exceeds the supported total size limit.'],
    ['GIT_FILE_LOAD_FAILED', 'Required repository file could not be loaded.'],
    ['GIT_FILE_LOAD_TIMED_OUT', 'Repository file loading timed out.'],
  ] as const)('presents GitFileLoadError %s from the closed table', (code, message) => {
    expect(presentCliError(new GitFileLoadError(code as GitFileLoadErrorCode))).toEqual(
      expected(code, message),
    );
  });

  it.each([
    ['LOCAL_SOURCE_CONFIG_INVALID', 'Local repository source configuration is invalid.'],
    ['LOCAL_SOURCE_INVARIANT_VIOLATION', 'Local repository context could not be assembled safely.'],
    [
      'LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED',
      'Local repository source text exceeds the supported total size limit.',
    ],
  ] as const)('presents LocalRepositoryContextError %s from the closed table', (code, message) => {
    expect(
      presentCliError(new LocalRepositoryContextError(code as LocalRepositoryContextErrorCode)),
    ).toEqual(expected(code, message));
  });

  it.each([
    [
      'ANALYSIS_INVARIANT_VIOLATION',
      'Analysis could not be completed because an internal invariant failed.',
    ],
    ['ANALYZER_EXECUTION_FAILED', 'Analysis could not be completed.'],
    ['REPORT_BUILD_FAILED', 'The analysis report could not be created.'],
  ] as const)(
    'presents AnalyzeRepositoryError %s without reading private message or cause',
    (code, message) => {
      const privateCause = new Error('private cause /workspace/source-content');
      const error = new AnalyzeRepositoryError(
        code as AnalyzeRepositoryErrorCode,
        'private arbitrary application message',
        { cause: privateCause },
      );

      const presentation = presentCliError(error);

      expect(presentation).toEqual(expected(code, message));
      expect(JSON.stringify(presentation)).not.toContain('private');
      expect(JSON.stringify(presentation)).not.toContain('/workspace');
    },
  );

  it.each([
    new Error('private message /workspace/source-content'),
    Object.freeze({ code: 'CONFIG_FILE_NOT_FOUND', message: 'private imitation' }),
    'private string throw',
    42,
    null,
    undefined,
  ])('uses the exact internal fallback for unknown thrown values', (value) => {
    expect(presentCliError(value)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Analysis could not be completed.',
    });
  });

  it('does not inspect hostile unknown object getters, mutate inputs, or log', () => {
    const hostile = Object.create(null) as { code?: string; message?: string; stack?: string };
    Object.defineProperties(hostile, {
      code: {
        enumerable: true,
        get() {
          throw new Error('code getter must not run');
        },
      },
      message: {
        enumerable: true,
        get() {
          throw new Error('message getter must not run');
        },
      },
      stack: {
        enumerable: true,
        get() {
          throw new Error('stack getter must not run');
        },
      },
    });
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
      expect(presentCliError(hostile)).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Analysis could not be completed.',
      });
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('CliHandledFailure', () => {
  it('uses a stable generic message without a cause', () => {
    const failure = new CliHandledFailure();

    expect(failure.message).toBe('DevGuard command execution failed.');
    expect(failure.cause).toBeUndefined();
  });
});
