import { describe, expect, it, vi } from 'vitest';
import { runAnalyzeLocal } from './run-analyze-local.js';
import type { AnalyzeRepositoryResult } from '../application/analyze-repository.js';

const ANALYSIS_OUTPUT_SUMMARY = {
  markdownPath: '.devguard/devguard-report.md',
  jsonPath: '.devguard/devguard-report.json',
};

const LEXICAL_CONFIG_PATH = ' ./selected config/.devguard.yml ';
const WORKING_DIRECTORY = '/caller/working-directory';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value) => resolvePromise(value),
  };
}

function createResult(healthScore: number): AnalyzeRepositoryResult {
  return {
    loadedConfig: {} as AnalyzeRepositoryResult['loadedConfig'],
    report: { healthScore } as AnalyzeRepositoryResult['report'],
  };
}

describe('runAnalyzeLocal', () => {
  it('awaits publication of the exact result before returning only its report health score', async () => {
    const expectedScore = 80.5;
    const publication = createDeferred<typeof ANALYSIS_OUTPUT_SUMMARY>();
    const calls: string[] = [];
    let healthScoreReads = 0;
    const report = Object.freeze(
      Object.defineProperty({}, 'healthScore', {
        enumerable: true,
        get: () => {
          healthScoreReads += 1;
          calls.push('healthScore');
          return expectedScore;
        },
      }),
    ) as AnalyzeRepositoryResult['report'];
    const result = Object.freeze({
      loadedConfig: {} as AnalyzeRepositoryResult['loadedConfig'],
      report,
    }) as AnalyzeRepositoryResult;
    const analyzeRepository = vi.fn(async () => {
      calls.push('analyze');
      return result;
    });
    const publishAnalysisResult = vi.fn(async (input: { result: AnalyzeRepositoryResult }) => {
      calls.push('publish');
      expect(input.result).toBe(result);
      return publication.promise;
    });
    const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
    const input = { configPath: LEXICAL_CONFIG_PATH };
    const beforeInput = structuredClone(input);
    const dependencies = Object.freeze({
      analyzeRepository,
      publishAnalysisResult,
      getWorkingDirectory,
    });
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const workingDirectory = vi.spyOn(process, 'cwd');

    try {
      const completionPromise = runAnalyzeLocal(input, dependencies);
      let settled = false;
      void completionPromise.then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(calls).toEqual(['analyze', 'publish']);
      expect(settled).toBe(false);
      expect(healthScoreReads).toBe(0);
      expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(analyzeRepository).toHaveBeenCalledWith({
        configPath: LEXICAL_CONFIG_PATH,
        workingDirectory: WORKING_DIRECTORY,
      });
      expect(publishAnalysisResult).toHaveBeenCalledTimes(1);
      expect(publishAnalysisResult.mock.calls[0]?.[0]?.result).toBe(result);

      publication.resolve(ANALYSIS_OUTPUT_SUMMARY);
      const completion = await completionPromise;

      expect(completion).toEqual({ healthScore: expectedScore });
      expect(Object.keys(completion)).toEqual(['healthScore']);
      expect(completion).not.toBe(ANALYSIS_OUTPUT_SUMMARY);
      expect(completion).not.toHaveProperty('markdownPath');
      expect(completion).not.toHaveProperty('jsonPath');
      expect(completion).not.toBe(result);
      expect(calls).toEqual(['analyze', 'publish', 'healthScore']);
      expect(healthScoreReads).toBe(1);
      expect(input).toEqual(beforeInput);
      expect(Object.keys(dependencies)).toEqual([
        'analyzeRepository',
        'publishAnalysisResult',
        'getWorkingDirectory',
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(workingDirectory).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
      workingDirectory.mockRestore();
    }
  });

  it.each([
    ['', ''],
    [' ./réquirements "quoted"/../spec.md ', ' ./输出 "quoted"/../reports/./out '],
  ])(
    'preserves lexical requirements and output overrides with one working-directory capture',
    async (requirementsPath, outputDirectoryPath) => {
      const result = createResult(100);
      const analyzeRepository = vi.fn().mockResolvedValue(result);
      const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
      const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
      const input = { configPath: LEXICAL_CONFIG_PATH, requirementsPath, outputDirectoryPath };
      const beforeInput = structuredClone(input);

      const completion = await runAnalyzeLocal(input, {
        analyzeRepository,
        publishAnalysisResult,
        getWorkingDirectory,
      });

      expect(completion).toEqual({ healthScore: 100 });
      expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(analyzeRepository).toHaveBeenCalledWith({
        configPath: LEXICAL_CONFIG_PATH,
        workingDirectory: WORKING_DIRECTORY,
        requirementsOverride: {
          path: requirementsPath,
          baseDirectory: WORKING_DIRECTORY,
          required: true,
        },
      });
      expect(publishAnalysisResult).toHaveBeenCalledWith({
        result,
        outputDirectoryOverride: outputDirectoryPath,
      });
      expect(input).toEqual(beforeInput);
    },
  );

  it('does not inspect loadedConfig while returning the published result health score', async () => {
    const expectedScore = 73;
    const loadedConfigReadFailure = new Error('loadedConfig must remain private to publication');
    const report = Object.freeze({ healthScore: expectedScore });
    const result = Object.freeze(
      Object.defineProperty({ report } as AnalyzeRepositoryResult, 'loadedConfig', {
        enumerable: true,
        get: () => {
          throw loadedConfigReadFailure;
        },
      }),
    );
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const publishAnalysisResult = vi.fn((input: { result: AnalyzeRepositoryResult }) => {
      expect(input.result).toBe(result);
      return Promise.resolve(ANALYSIS_OUTPUT_SUMMARY);
    });
    const input = { configPath: 'config.yml' };
    const beforeInput = structuredClone(input);
    const dependencies = Object.freeze({
      analyzeRepository,
      publishAnalysisResult,
      getWorkingDirectory: () => WORKING_DIRECTORY,
    });

    const completion = await runAnalyzeLocal(input, dependencies);

    expect(completion).toEqual({ healthScore: expectedScore });
    expect(Object.keys(completion)).toEqual(['healthScore']);
    expect(completion).not.toHaveProperty('loadedConfig');
    expect(completion).not.toHaveProperty('report');
    expect(publishAnalysisResult).toHaveBeenCalledTimes(1);
    expect(input).toEqual(beforeInput);
    expect(Object.keys(dependencies)).toEqual([
      'analyzeRepository',
      'publishAnalysisResult',
      'getWorkingDirectory',
    ]);
  });

  it('omits undefined overrides without changing the approved analysis input', async () => {
    const result = createResult(0);
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);

    const completion = await runAnalyzeLocal(
      { configPath: LEXICAL_CONFIG_PATH },
      {
        analyzeRepository,
        publishAnalysisResult,
        getWorkingDirectory: () => WORKING_DIRECTORY,
      },
    );

    expect(completion).toEqual({ healthScore: 0 });
    expect(analyzeRepository).toHaveBeenCalledWith({
      configPath: LEXICAL_CONFIG_PATH,
      workingDirectory: WORKING_DIRECTORY,
    });
    expect(publishAnalysisResult).toHaveBeenCalledWith({ result });
  });

  it('propagates analysis failure by identity without publishing, completion, output, or process behavior', async () => {
    const failure = new Error('private analysis failure');
    const analyzeRepository = vi.fn().mockRejectedValue(failure);
    const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
    const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
    const input = Object.freeze({ configPath: 'config.yml' });
    const beforeInput = structuredClone(input);
    const dependencies = Object.freeze({
      analyzeRepository,
      publishAnalysisResult,
      getWorkingDirectory,
    });
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const workingDirectory = vi.spyOn(process, 'cwd');

    try {
      await expect(runAnalyzeLocal(input, dependencies)).rejects.toBe(failure);

      expect(analyzeRepository).toHaveBeenCalledTimes(1);
      expect(publishAnalysisResult).not.toHaveBeenCalled();
      expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(input).toEqual(beforeInput);
      expect(Object.keys(dependencies)).toEqual([
        'analyzeRepository',
        'publishAnalysisResult',
        'getWorkingDirectory',
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(workingDirectory).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
      workingDirectory.mockRestore();
    }
  });

  it('propagates publication failure by identity without repeating analysis or returning completion', async () => {
    const result = createResult(60);
    const failure = new Error('private publication failure');
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const publishAnalysisResult = vi.fn().mockRejectedValue(failure);

    await expect(
      runAnalyzeLocal(
        { configPath: 'config.yml' },
        {
          analyzeRepository,
          publishAnalysisResult,
          getWorkingDirectory: () => WORKING_DIRECTORY,
        },
      ),
    ).rejects.toBe(failure);

    expect(analyzeRepository).toHaveBeenCalledTimes(1);
    expect(publishAnalysisResult).toHaveBeenCalledTimes(1);
  });
});
