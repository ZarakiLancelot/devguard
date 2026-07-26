import { describe, expect, it, vi } from 'vitest';
import { runAnalyzeLocal } from './run-analyze-local.js';
import type { AnalyzeRepositoryResult } from '../application/analyze-repository.js';

const ANALYSIS_OUTPUT_SUMMARY = {
  markdownPath: '.devguard/devguard-report.md',
  jsonPath: '.devguard/devguard-report.json',
};

const LEXICAL_CONFIG_PATH = ' ./selected config/.devguard.yml ';
const WORKING_DIRECTORY = '/caller/working-directory';

describe('runAnalyzeLocal', () => {
  it('forwards the exact lexical config path and one injected working directory once', async () => {
    const result = {} as AnalyzeRepositoryResult;
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
    const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
    const input = { configPath: LEXICAL_CONFIG_PATH };
    const beforeInput = structuredClone(input);
    const dependencies = Object.freeze({
      analyzeRepository,
      publishAnalysisResult,
      getWorkingDirectory,
    });

    const actual = await runAnalyzeLocal(input, dependencies);

    expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
    expect(analyzeRepository).toHaveBeenCalledTimes(1);
    expect(publishAnalysisResult).toHaveBeenCalledTimes(1);
    expect(publishAnalysisResult).toHaveBeenCalledWith({ result });
    expect(publishAnalysisResult.mock.calls[0]?.[0]?.result).toBe(result);
    const analysisInput = analyzeRepository.mock.calls[0]?.[0];
    expect(analysisInput).toEqual({
      configPath: LEXICAL_CONFIG_PATH,
      workingDirectory: WORKING_DIRECTORY,
    });
    expect(analysisInput).not.toHaveProperty('requirementsPath');
    expect(analysisInput).not.toHaveProperty('outputDirectory');
    expect(analysisInput).not.toHaveProperty('verbose');
    expect(analysisInput).not.toHaveProperty('failBelow');
    expect(analysisInput).not.toHaveProperty('format');
    expect(actual).toBe(result);
    expect(input).toEqual(beforeInput);
    expect(Object.keys(dependencies)).toEqual([
      'analyzeRepository',
      'publishAnalysisResult',
      'getWorkingDirectory',
    ]);
  });

  it.each(['', ' ./réquirements "quoted"/../spec.md '])(
    'forwards an explicit requirements path unchanged with the same captured working directory',
    async (requirementsPath) => {
      const analyzeRepository = vi.fn().mockResolvedValue({} as AnalyzeRepositoryResult);
      const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
      const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
      const input = { configPath: LEXICAL_CONFIG_PATH, requirementsPath };
      const beforeInput = structuredClone(input);
      const dependencies = Object.freeze({
        analyzeRepository,
        publishAnalysisResult,
        getWorkingDirectory,
      });

      await runAnalyzeLocal(input, dependencies);

      expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(analyzeRepository).toHaveBeenCalledTimes(1);
      expect(analyzeRepository).toHaveBeenCalledWith({
        configPath: LEXICAL_CONFIG_PATH,
        workingDirectory: WORKING_DIRECTORY,
        requirementsOverride: {
          path: requirementsPath,
          baseDirectory: WORKING_DIRECTORY,
          required: true,
        },
      });
      expect(analyzeRepository.mock.calls[0]?.[0]?.requirementsOverride.path).toBe(
        requirementsPath,
      );
      expect(input).toEqual(beforeInput);
      expect(Object.keys(dependencies)).toEqual([
        'analyzeRepository',
        'publishAnalysisResult',
        'getWorkingDirectory',
      ]);
    },
  );

  it('returns an opaque result unchanged without inspecting LoadedConfig or report', async () => {
    const result = Object.defineProperties({} as AnalyzeRepositoryResult, {
      loadedConfig: {
        get() {
          throw new Error('LoadedConfig must remain opaque to the CLI adapter');
        },
      },
      report: {
        get() {
          throw new Error('Report must remain opaque to the CLI adapter');
        },
      },
    });
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);

    const actual = await runAnalyzeLocal(
      { configPath: 'config.yml' },
      { analyzeRepository, publishAnalysisResult, getWorkingDirectory: () => WORKING_DIRECTORY },
    );

    expect(actual).toBe(result);
    expect(analyzeRepository).toHaveBeenCalledWith({
      configPath: 'config.yml',
      workingDirectory: WORKING_DIRECTORY,
    });
  });

  it('passes an analysis failure through by identity without output or process behavior', async () => {
    const failure = new Error('private analysis failure');
    const analyzeRepository = vi.fn().mockRejectedValue(failure);
    const publishAnalysisResult = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
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
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it.each(['', ' ./输出 "quoted"/../reports/./out '])(
    'forwards explicit output overrides unchanged after analysis',
    async (outputDirectoryPath) => {
      const result = {} as AnalyzeRepositoryResult;
      const calls: string[] = [];
      const analyzeRepository = vi.fn(async () => {
        calls.push('analyze');
        return result;
      });
      const publishAnalysisResult = vi.fn(async () => {
        calls.push('publish');
        return ANALYSIS_OUTPUT_SUMMARY;
      });
      const input = { configPath: 'config.yml', outputDirectoryPath };
      const before = structuredClone(input);

      await runAnalyzeLocal(input, {
        analyzeRepository,
        publishAnalysisResult,
        getWorkingDirectory: () => WORKING_DIRECTORY,
      });

      expect(calls).toEqual(['analyze', 'publish']);
      expect(publishAnalysisResult).toHaveBeenCalledWith({
        result,
        outputDirectoryOverride: outputDirectoryPath,
      });
      expect(input).toEqual(before);
    },
  );

  it('does not publish after analysis failure and propagates publication failures unchanged', async () => {
    const analysisFailure = new Error('analysis');
    const failedAnalysis = vi.fn().mockRejectedValue(analysisFailure);
    const publisher = vi.fn().mockResolvedValue(ANALYSIS_OUTPUT_SUMMARY);
    await expect(
      runAnalyzeLocal(
        { configPath: 'x' },
        {
          analyzeRepository: failedAnalysis,
          publishAnalysisResult: publisher,
          getWorkingDirectory: () => WORKING_DIRECTORY,
        },
      ),
    ).rejects.toBe(analysisFailure);
    expect(publisher).not.toHaveBeenCalled();

    const result = {} as AnalyzeRepositoryResult;
    const publicationFailure = new Error('publication');
    const analysis = vi.fn().mockResolvedValue(result);
    const failedPublisher = vi.fn().mockRejectedValue(publicationFailure);
    await expect(
      runAnalyzeLocal(
        { configPath: 'x' },
        {
          analyzeRepository: analysis,
          publishAnalysisResult: failedPublisher,
          getWorkingDirectory: () => WORKING_DIRECTORY,
        },
      ),
    ).rejects.toBe(publicationFailure);
    expect(analysis).toHaveBeenCalledTimes(1);
    expect(failedPublisher).toHaveBeenCalledTimes(1);
  });
});
