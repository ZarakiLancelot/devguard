import { describe, expect, it, vi } from 'vitest';
import { runAnalyzeLocal } from './run-analyze-local.js';
import type { AnalyzeRepositoryResult } from '../application/analyze-repository.js';

const LEXICAL_CONFIG_PATH = ' ./selected config/.devguard.yml ';
const WORKING_DIRECTORY = '/caller/working-directory';

describe('runAnalyzeLocal', () => {
  it('forwards the exact lexical config path and one injected working directory once', async () => {
    const result = {} as AnalyzeRepositoryResult;
    const analyzeRepository = vi.fn().mockResolvedValue(result);
    const getWorkingDirectory = vi.fn(() => WORKING_DIRECTORY);
    const input = { configPath: LEXICAL_CONFIG_PATH };
    const beforeInput = structuredClone(input);
    const dependencies = Object.freeze({ analyzeRepository, getWorkingDirectory });

    const actual = await runAnalyzeLocal(input, dependencies);

    expect(getWorkingDirectory).toHaveBeenCalledTimes(1);
    expect(analyzeRepository).toHaveBeenCalledTimes(1);
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
    expect(Object.keys(dependencies)).toEqual(['analyzeRepository', 'getWorkingDirectory']);
  });

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

    const actual = await runAnalyzeLocal(
      { configPath: 'config.yml' },
      { analyzeRepository, getWorkingDirectory: () => WORKING_DIRECTORY },
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
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
      await expect(
        runAnalyzeLocal(
          { configPath: 'config.yml' },
          { analyzeRepository, getWorkingDirectory: () => WORKING_DIRECTORY },
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
});
