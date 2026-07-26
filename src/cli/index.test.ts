import { describe, expect, it, vi } from 'vitest';
import { CliHandledFailure } from './cli-error-presenter.js';
import { evaluateFailBelow as evaluateFailBelowPure } from './fail-below.js';
import { runCli } from './index.js';
import { createProgram, type CliDependencies } from './program.js';
import { QualityThresholdFailure } from './quality-threshold-failure.js';
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
  publishAnalysisResult: ReturnType<typeof vi.fn>;
  evaluateFailBelow: ReturnType<typeof vi.fn>;
  getWorkingDirectory: ReturnType<typeof vi.fn>;
  stdout: string[];
  stderr: string[];
  dependencies: CliDependencies;
}

function createHarness(): CliHarness {
  const analyzeRepository = vi.fn().mockResolvedValue({
    report: { healthScore: 100 },
  } as AnalyzeRepositoryResult);
  const publishAnalysisResult = vi.fn().mockResolvedValue({});
  const evaluateFailBelow = vi.fn(evaluateFailBelowPure);
  const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies = {
    analyzeRepository,
    publishAnalysisResult,
    evaluateFailBelow,
    getWorkingDirectory,
    writeStdout: (text: string): void => {
      stdout.push(text);
    },
    writeStderr: (text: string): void => {
      stderr.push(text);
    },
  } as unknown as CliDependencies;

  return {
    analyzeRepository,
    publishAnalysisResult,
    evaluateFailBelow,
    getWorkingDirectory,
    stdout,
    stderr,
    dependencies,
  };
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
    expect(local?.options.map((option) => option.long)).toEqual([
      '--config',
      '--requirements',
      '--output',
      '--fail-below',
    ]);
    for (const option of ['--verbose', '--format']) {
      expect(local?.options.some((candidate) => candidate.long === option)).toBe(false);
    }
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
    expect(harness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(harness.stderr.join('')).not.toContain('DevGuard error [');
    expect(harness.stderr.join('')).toContain('error:');
  });
});

describe('missing local configuration option', () => {
  it('remains a Commander syntax failure without analysis, publication, success output, or action error presentation', async () => {
    const harness = createHarness();
    const program = createProgram(harness.dependencies);
    const exit = vi.spyOn(process, 'exit');
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');

    try {
      await expect(
        program.parseAsync(['analyze', 'local'], { from: 'user' }),
      ).rejects.toMatchObject({
        code: 'commander.missingMandatoryOptionValue',
      });
      expect(harness.analyzeRepository).not.toHaveBeenCalled();
      expect(harness.publishAnalysisResult).not.toHaveBeenCalled();
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr.join('')).not.toContain('DevGuard error [');
      expect(exit).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
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

describe('provisional threshold outer behavior', () => {
  it('keeps the threshold signal on the generic outer fallback until exit-code integration', async () => {
    const harness = createHarness();
    harness.analyzeRepository.mockResolvedValue({
      report: { healthScore: 79 },
    } as AnalyzeRepositoryResult);

    const exitCode = await runCli(
      ['node', 'devguard', 'analyze', 'local', '--config', 'config.yml', '--fail-below', '80'],
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual(['DevGuard quality threshold not met.\n']);
  });
});

describe('fail-below Commander wiring', () => {
  it('does not evaluate a threshold when the option is absent and prints the existing completion line', async () => {
    const harness = createHarness();

    await createProgram(harness.dependencies).parseAsync(
      ['analyze', 'local', '--config', 'config.yml'],
      { from: 'user' },
    );

    expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
    expect(harness.publishAnalysisResult).toHaveBeenCalledTimes(1);
    expect(harness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
    expect(harness.stderr).toEqual([]);
  });

  it.each([
    ['80', 80, 80],
    ['80.5', 80.5, 81],
    [' 75.25 ', 75.25, 80],
  ])(
    'parses %j once and evaluates the exact parsed threshold after completion',
    async (value, threshold, healthScore) => {
      const harness = createHarness();
      harness.analyzeRepository.mockResolvedValue({
        report: { healthScore },
      } as AnalyzeRepositoryResult);

      const program = createProgram(harness.dependencies);
      await program.parseAsync(
        ['analyze', 'local', '--config', 'config.yml', '--fail-below', value],
        { from: 'user' },
      );
      const analyze = program.commands.find((command) => command.name() === 'analyze');
      const local = analyze?.commands.find((command) => command.name() === 'local');

      expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
      expect(harness.publishAnalysisResult).toHaveBeenCalledTimes(1);
      expect(harness.evaluateFailBelow).toHaveBeenCalledTimes(1);
      expect(harness.evaluateFailBelow).toHaveBeenCalledWith(healthScore, { threshold });
      expect(harness.evaluateFailBelow.mock.calls[0]?.[1]).toBe(local?.opts().failBelow);
      expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
      expect(harness.stderr).toEqual([]);
    },
  );

  it('evaluates only after deferred publication has completed', async () => {
    const harness = createHarness();
    let resolvePublication!: (value: object) => void;
    const publication = new Promise<object>((resolve) => {
      resolvePublication = resolve;
    });
    harness.analyzeRepository.mockResolvedValue({
      report: { healthScore: 80 },
    } as AnalyzeRepositoryResult);
    harness.publishAnalysisResult.mockReturnValue(publication);

    const parsing = createProgram(harness.dependencies).parseAsync(
      ['analyze', 'local', '--config', 'config.yml', '--fail-below', '80'],
      { from: 'user' },
    );

    await Promise.resolve();
    expect(harness.publishAnalysisResult).toHaveBeenCalledTimes(1);
    expect(harness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(harness.stdout).toEqual([]);

    resolvePublication({});
    await parsing;

    expect(harness.evaluateFailBelow).toHaveBeenCalledTimes(1);
    expect(harness.stdout).toEqual(['DevGuard local analysis completed.\n']);
  });

  it('renders only the fixed threshold diagnostic and rethrows the nominal quality signal on a miss', async () => {
    const harness = createHarness();
    const privateConfigPath = 'private-config-sentinel';
    harness.analyzeRepository.mockResolvedValue({
      report: { healthScore: 79 },
    } as AnalyzeRepositoryResult);

    let thrown: unknown;
    try {
      await createProgram(harness.dependencies).parseAsync(
        ['analyze', 'local', '--config', privateConfigPath, '--fail-below', '80'],
        { from: 'user' },
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(QualityThresholdFailure);
    expect(harness.analyzeRepository).toHaveBeenCalledTimes(1);
    expect(harness.publishAnalysisResult).toHaveBeenCalledTimes(1);
    expect(harness.evaluateFailBelow).toHaveBeenCalledTimes(1);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual(['DevGuard quality threshold not met.\n']);
    expect(harness.stderr.join('')).not.toContain('INTERNAL_ERROR');
    expect(harness.stderr.join('')).not.toContain(privateConfigPath);
    expect(harness.stderr.join('')).not.toContain('79');
    expect(harness.stderr.join('')).not.toContain('80');
  });

  it.each([
    '',
    '   ',
    '.5',
    '80.',
    '+80',
    '-1',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e2',
    '0x50',
    '0b1010',
    '0o100',
    '80,5',
    '1_000',
    '80.5.1',
    'alphabetic-sentinel',
    '100.001',
    '101',
  ])(
    'keeps invalid fail-below value %j in Commander usage flow without action work or leakage',
    async (value) => {
      const harness = createHarness();
      const exit = vi.spyOn(process, 'exit');
      const log = vi.spyOn(console, 'log');
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');

      try {
        await expect(
          createProgram(harness.dependencies).parseAsync(
            ['analyze', 'local', '--config', 'config.yml', '--fail-below', value],
            { from: 'user' },
          ),
        ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
        expect(harness.getWorkingDirectory).not.toHaveBeenCalled();
        expect(harness.analyzeRepository).not.toHaveBeenCalled();
        expect(harness.publishAnalysisResult).not.toHaveBeenCalled();
        expect(harness.evaluateFailBelow).not.toHaveBeenCalled();
        expect(harness.stdout).toEqual([]);
        expect(harness.stderr.join('')).toContain(
          'Fail-below score must be a decimal value from 0 through 100.',
        );
        expect(harness.stderr.join('')).not.toContain('DevGuard quality threshold not met.');
        expect(harness.stderr.join('')).not.toContain('DevGuard error [');
        if (value.length > 1) {
          expect(harness.stderr.join('')).not.toContain(value);
        }
        expect(exit).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      } finally {
        exit.mockRestore();
        log.mockRestore();
        warn.mockRestore();
        error.mockRestore();
      }
    },
  );

  it('keeps a missing fail-below value in Commander syntax flow without action work', async () => {
    const harness = createHarness();

    await expect(
      createProgram(harness.dependencies).parseAsync(
        ['analyze', 'local', '--config', 'config.yml', '--fail-below'],
        { from: 'user' },
      ),
    ).rejects.toMatchObject({ code: 'commander.optionMissingArgument' });
    expect(harness.getWorkingDirectory).not.toHaveBeenCalled();
    expect(harness.analyzeRepository).not.toHaveBeenCalled();
    expect(harness.publishAnalysisResult).not.toHaveBeenCalled();
    expect(harness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr.join('')).not.toContain('DevGuard error [');
  });

  it('prevents threshold evaluation and success output after analysis or publication failure', async () => {
    const analysisHarness = createHarness();
    const analysisFailure = new Error('private analysis failure');
    analysisHarness.analyzeRepository.mockRejectedValue(analysisFailure);

    await expect(
      createProgram(analysisHarness.dependencies).parseAsync(
        ['analyze', 'local', '--config', 'config.yml', '--fail-below', '80'],
        { from: 'user' },
      ),
    ).rejects.toBeInstanceOf(CliHandledFailure);
    expect(analysisHarness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(analysisHarness.stdout).toEqual([]);
    expect(analysisHarness.stderr).toEqual([
      'DevGuard error [INTERNAL_ERROR]: Analysis could not be completed.\n',
    ]);

    const publicationHarness = createHarness();
    const publicationFailure = new Error('private publication failure');
    publicationHarness.publishAnalysisResult.mockRejectedValue(publicationFailure);

    await expect(
      createProgram(publicationHarness.dependencies).parseAsync(
        ['analyze', 'local', '--config', 'config.yml', '--fail-below', '80'],
        { from: 'user' },
      ),
    ).rejects.toBeInstanceOf(CliHandledFailure);
    expect(publicationHarness.evaluateFailBelow).not.toHaveBeenCalled();
    expect(publicationHarness.stdout).toEqual([]);
    expect(publicationHarness.stderr).toEqual([
      'DevGuard error [INTERNAL_ERROR]: Analysis could not be completed.\n',
    ]);
  });
});
