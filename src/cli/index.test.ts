import { describe, expect, it, vi } from 'vitest';
import { CliHandledFailure } from './cli-error-presenter.js';
import { runCli } from './index.js';
import { createProgram, type CliDependencies } from './program.js';
import {
  AnalyzeRepositoryError,
  type AnalyzeRepositoryResult,
} from '../application/analyze-repository.js';
import { ConfigLoadError } from '../config/config-loader.js';
import { GitDiffError } from '../sources/local-git-diff-provider.js';
import { GitRepositoryValidationError } from '../sources/git-repository-validator.js';
import { GitFileLoadError } from '../sources/repository-file-loader.js';
import { LocalRepositoryContextError } from '../sources/local-context-builder.js';
import { ExplicitRequirementsOverrideError } from '../sources/explicit-requirements-override-loader.js';

const LEXICAL_CONFIG_PATH = ' ./selected config/.devguard.yml ';
const WORKING_DIRECTORY = '/caller/working-directory';

interface CliHarness {
  analyzeRepository: ReturnType<typeof vi.fn>;
  getWorkingDirectory: ReturnType<typeof vi.fn>;
  stdout: string[];
  stderr: string[];
  dependencies: CliDependencies;
}

function createHarness(): CliHarness {
  const analyzeRepository = vi.fn().mockResolvedValue({} as AnalyzeRepositoryResult);
  const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies = {
    analyzeRepository,
    getWorkingDirectory,
    writeStdout: (text: string): void => {
      stdout.push(text);
    },
    writeStderr: (text: string): void => {
      stderr.push(text);
    },
  } as unknown as CliDependencies;

  return { analyzeRepository, getWorkingDirectory, stdout, stderr, dependencies };
}

async function captureParseFailure(program: ReturnType<typeof createProgram>): Promise<unknown> {
  try {
    await program.parseAsync(['analyze', 'local', '--config', LEXICAL_CONFIG_PATH], {
      from: 'user',
    });
  } catch (error: unknown) {
    return error;
  }

  throw new Error('Expected Commander parsing to reject');
}

describe('DevGuard CLI', () => {
  it('creates the expected Task 11.2 command tree and active options only', () => {
    const program = createProgram();
    const analyze = program.commands.find((command) => command.name() === 'analyze');
    const local = analyze?.commands.find((command) => command.name() === 'local');
    const configOption = local?.options.find((option) => option.long === '--config');
    const requirementsOption = local?.options.find((option) => option.long === '--requirements');

    expect(program.name()).toBe('devguard');
    expect(analyze).toBeDefined();
    expect(local).toBeDefined();
    expect(configOption?.required).toBe(true);
    expect(requirementsOption).toBeDefined();
    for (const option of ['--output', '--verbose', '--fail-below']) {
      expect(local?.options.some((candidate) => candidate.long === option)).toBe(false);
    }
    expect(local?.options.some((candidate) => candidate.long === '--format')).toBe(false);
  });

  it('maps the exact lexical requirements option through one analysis using one working-directory capture', async () => {
    const requirementsPath = ' ./private requirements/../"quoted".md ';
    const harness = createHarness();

    await createProgram(harness.dependencies).parseAsync(
      ['analyze', 'local', '--config', LEXICAL_CONFIG_PATH, '--requirements', requirementsPath],
      { from: 'user' },
    );

    expect(harness.getWorkingDirectory).toHaveBeenCalledTimes(1);
    expect(harness.analyzeRepository).toHaveBeenCalledWith({
      configPath: LEXICAL_CONFIG_PATH,
      workingDirectory: WORKING_DIRECTORY,
      requirementsOverride: {
        path: requirementsPath,
        baseDirectory: WORKING_DIRECTORY,
        required: true,
      },
    });
    expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
  });

  it('renders an explicit override error safely without leaking CLI path or working directory', async () => {
    const requirementsPath = 'private requirements sentinel';
    const harness = createHarness();
    harness.analyzeRepository.mockRejectedValue(
      new ExplicitRequirementsOverrideError('REQUIREMENTS_OVERRIDE_NOT_FOUND', 'private'),
    );

    const thrown = await (async () => {
      try {
        await createProgram(harness.dependencies).parseAsync(
          ['analyze', 'local', '--config', 'config.yml', '--requirements', requirementsPath],
          { from: 'user' },
        );
      } catch (error) {
        return error;
      }
      throw new Error('Expected handled failure');
    })();

    expect(thrown).toBeInstanceOf(CliHandledFailure);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual([
      'DevGuard error [REQUIREMENTS_OVERRIDE_NOT_FOUND]: Requirements override file was not found.\n',
    ]);
    expect(harness.stderr.join('')).not.toContain(requirementsPath);
    expect(harness.stderr.join('')).not.toContain(WORKING_DIRECTORY);
  });

  it('does not read the working directory while constructing the program', () => {
    const harness = createHarness();

    createProgram(harness.dependencies);

    expect(harness.getWorkingDirectory).not.toHaveBeenCalled();
  });

  it('runs exactly one analysis with lexical config text and emits only the temporary completion line', async () => {
    const canonicalConfigPath = '/private/canonical/.devguard.yml';
    const workspaceBase = '/private/canonical';
    const repositoryPath = '/private/repository';
    const sourceContent = 'private source content';
    const report = { findings: [{ description: sourceContent }] };
    const result = {
      loadedConfig: { configPath: canonicalConfigPath, workspaceBase },
      report,
    } as unknown as AnalyzeRepositoryResult;
    const harness = createHarness();
    harness.analyzeRepository.mockResolvedValue(result);
    const program = createProgram(harness.dependencies);
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');

    try {
      await program.parseAsync(['analyze', 'local', '--config', LEXICAL_CONFIG_PATH], {
        from: 'user',
      });

      expect(harness.getWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
      const input = harness.analyzeRepository.mock.calls[0]?.[0];
      expect(input).toEqual({
        configPath: LEXICAL_CONFIG_PATH,
        workingDirectory: WORKING_DIRECTORY,
      });
      expect(input).not.toHaveProperty('requirementsPath');
      expect(input).not.toHaveProperty('outputDirectory');
      expect(input).not.toHaveProperty('verbose');
      expect(input).not.toHaveProperty('failBelow');
      expect(input).not.toHaveProperty('format');
      expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
      expect(harness.stderr).toEqual([]);
      const output = `${harness.stdout.join('')}${harness.stderr.join('')}`;
      for (const privateValue of [
        canonicalConfigPath,
        workspaceBase,
        repositoryPath,
        sourceContent,
      ]) {
        expect(output).not.toContain(privateValue);
      }
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it.each([
    [
      'ConfigLoadError',
      new ConfigLoadError('CONFIG_FILE_NOT_FOUND'),
      'CONFIG_FILE_NOT_FOUND',
      'DevGuard configuration file was not found.',
    ],
    [
      'GitRepositoryValidationError',
      new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY'),
      'NOT_A_GIT_REPOSITORY',
      'Configured directory is not a Git working repository.',
    ],
    [
      'GitDiffError',
      new GitDiffError('GIT_DIFF_FAILED'),
      'GIT_DIFF_FAILED',
      'Git changed-file discovery failed.',
    ],
    [
      'GitFileLoadError',
      new GitFileLoadError('GIT_FILE_LOAD_FAILED'),
      'GIT_FILE_LOAD_FAILED',
      'Required repository file could not be loaded.',
    ],
    [
      'LocalRepositoryContextError',
      new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION'),
      'LOCAL_SOURCE_INVARIANT_VIOLATION',
      'Local repository context could not be assembled safely.',
    ],
    [
      'AnalyzeRepositoryError invariant',
      new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', 'private application message'),
      'ANALYSIS_INVARIANT_VIOLATION',
      'Analysis could not be completed because an internal invariant failed.',
    ],
    [
      'AnalyzeRepositoryError execution',
      new AnalyzeRepositoryError('ANALYZER_EXECUTION_FAILED', 'private application message'),
      'ANALYZER_EXECUTION_FAILED',
      'Analysis could not be completed.',
    ],
    [
      'AnalyzeRepositoryError report',
      new AnalyzeRepositoryError('REPORT_BUILD_FAILED', 'private application message'),
      'REPORT_BUILD_FAILED',
      'The analysis report could not be created.',
    ],
  ] as const)(
    'renders %s safely and replaces it with CliHandledFailure',
    async (_label, failure, code, message) => {
      const harness = createHarness();
      harness.analyzeRepository.mockRejectedValue(failure);
      const program = createProgram(harness.dependencies);

      const thrown = await captureParseFailure(program);

      expect(thrown).toBeInstanceOf(CliHandledFailure);
      expect(thrown).not.toBe(failure);
      expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([`DevGuard error [${code}]: ${message}\n`]);
    },
  );

  it('uses the generic fallback without leaking hostile analysis details', async () => {
    const privateCause = new Error('private cause /private/repository source-content');
    const failure = Object.assign(new Error('private message /private/config'), {
      cause: privateCause,
      stack: 'private stack source-content',
    });
    const harness = createHarness();
    harness.analyzeRepository.mockRejectedValue(failure);

    const thrown = await captureParseFailure(createProgram(harness.dependencies));

    expect(thrown).toBeInstanceOf(CliHandledFailure);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual([
      'DevGuard error [INTERNAL_ERROR]: Analysis could not be completed.\n',
    ]);
    const output = harness.stderr.join('');
    for (const privateValue of [
      'private message',
      '/private/config',
      'private cause',
      '/private/repository',
      'source-content',
      'private stack',
    ]) {
      expect(output).not.toContain(privateValue);
    }
  });

  it('keeps Commander help, version, and syntax errors separate from analysis failures', async () => {
    const harness = createHarness();
    const program = createProgram(harness.dependencies);

    await expect(
      program.parseAsync(['analyze', 'local', '--help'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
      exitCode: 0,
    });
    await expect(
      createProgram(harness.dependencies).parseAsync(['--version'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'commander.version',
      exitCode: 0,
    });
    await expect(
      createProgram(harness.dependencies).parseAsync(['analyze', 'local'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    await expect(
      createProgram(harness.dependencies).parseAsync(
        ['analyze', 'local', '--config', 'config.yml', '--unknown-option'],
        { from: 'user' },
      ),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });

    expect(harness.analyzeRepository).not.toHaveBeenCalled();
    expect(harness.stderr.join('')).not.toContain('DevGuard error [');
    expect(harness.stderr.join('')).toContain('error:');
  });
});

describe('runCli', () => {
  it('returns zero after success and preserves package-manager bare separator filtering', async () => {
    const harness = createHarness();

    const exitCode = await runCli(
      ['node', 'devguard', '--', 'analyze', 'local', '--config', LEXICAL_CONFIG_PATH],
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
    expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
    expect(harness.stderr).toEqual([]);
  });

  it('returns provisional generic failure code one after a safely handled analysis failure', async () => {
    const harness = createHarness();
    harness.analyzeRepository.mockRejectedValue(new Error('private entrypoint failure'));

    const exitCode = await runCli(
      ['node', 'devguard', 'analyze', 'local', '--config', 'config.yml'],
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual([
      'DevGuard error [INTERNAL_ERROR]: Analysis could not be completed.\n',
    ]);
  });

  it('returns Commander exit codes for help and parser failures without analysis', async () => {
    const helpHarness = createHarness();
    const syntaxHarness = createHarness();

    const helpExitCode = await runCli(['node', 'devguard', '--help'], helpHarness.dependencies);
    const syntaxExitCode = await runCli(
      ['node', 'devguard', 'analyze', 'local'],
      syntaxHarness.dependencies,
    );

    expect(helpExitCode).toBe(0);
    expect(syntaxExitCode).toBe(1);
    expect(helpHarness.analyzeRepository).not.toHaveBeenCalled();
    expect(syntaxHarness.analyzeRepository).not.toHaveBeenCalled();
    expect(syntaxHarness.stderr.join('')).toContain('error:');
    expect(syntaxHarness.stderr.join('')).not.toContain('DevGuard error [');
  });
});
