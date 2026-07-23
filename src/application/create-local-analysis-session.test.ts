import type { DevGuardConfig } from '../config/config-schema.js';
import type { LoadedConfig } from '../config/config-loader.js';
import type * as ConfigLoaderModule from '../config/config-loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  sourceConstructor: vi.fn(),
  sourceLoadContext: vi.fn(),
  sourceInstances: [] as unknown[],
}));

vi.mock('../config/config-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigLoaderModule>();
  return { ...actual, loadConfig: mocks.loadConfig };
});

vi.mock('../sources/local-repository-source.js', () => {
  class MockLocalRepositorySource {
    readonly loadContext = mocks.sourceLoadContext;

    constructor(options: unknown) {
      mocks.sourceConstructor(options);
      mocks.sourceInstances.push(this);
    }
  }

  return { LocalRepositorySource: MockLocalRepositorySource };
});

import { createLocalAnalysisSession } from './create-local-analysis-session.js';
import { ConfigLoadError, loadConfig } from '../config/config-loader.js';

function createConfig(): DevGuardConfig {
  return {
    version: 1,
    repositories: {
      app: { path: '.', baseRef: 'main', role: 'fullstack' },
    },
    openapi: { repository: 'app', path: 'docs/openapi.yaml' },
    contracts: [],
  };
}

function createLoadedConfig(config = createConfig()): LoadedConfig {
  return {
    config,
    configPath: '/workspace/.devguard.yml',
    workspaceBase: '/workspace',
  };
}

describe('createLocalAnalysisSession', () => {
  beforeEach(() => {
    mocks.loadConfig.mockReset();
    mocks.sourceConstructor.mockReset();
    mocks.sourceLoadContext.mockReset();
    mocks.sourceInstances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads configuration exactly once, forwards exact input strings, and shares one snapshot', async () => {
    const loadedConfig = createLoadedConfig();
    const input = {
      configPath: './config/.devguard.yml',
      workingDirectory: '/caller/working-directory',
    };
    const beforeInput = structuredClone(input);
    mocks.loadConfig.mockResolvedValue(loadedConfig);

    const session = await createLocalAnalysisSession(input);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledWith({
      configPath: './config/.devguard.yml',
      workingDirectory: '/caller/working-directory',
    });
    expect(mocks.sourceConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.sourceConstructor).toHaveBeenCalledWith({ loadedConfig });
    expect(session.loadedConfig).toBe(loadedConfig);
    expect(session.source).toBe(mocks.sourceInstances[0]);
    expect(input).toEqual(beforeInput);
  });

  it('creates no context during session creation and does not log', async () => {
    mocks.loadConfig.mockResolvedValue(createLoadedConfig());
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');

    try {
      await createLocalAnalysisSession({
        configPath: '.devguard.yml',
        workingDirectory: '/workspace',
      });

      expect(mocks.sourceLoadContext).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });

  it('keeps the first loaded snapshot after an external result change without reloading', async () => {
    const firstLoadedConfig = createLoadedConfig();
    const laterLoadedConfig = createLoadedConfig({
      ...createConfig(),
      output: { directory: 'later-output' },
    });
    mocks.loadConfig
      .mockResolvedValueOnce(firstLoadedConfig)
      .mockResolvedValueOnce(laterLoadedConfig);

    const session = await createLocalAnalysisSession({
      configPath: '.devguard.yml',
      workingDirectory: '/workspace',
    });

    expect(session.loadedConfig).toBe(firstLoadedConfig);
    expect(mocks.sourceConstructor).toHaveBeenCalledWith({ loadedConfig: firstLoadedConfig });
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(session.loadedConfig).not.toBe(laterLoadedConfig);
  });

  it('passes ConfigLoadError through by identity without creating a source or retrying', async () => {
    const error = new ConfigLoadError('CONFIG_SCHEMA_INVALID');
    mocks.loadConfig.mockRejectedValue(error);

    await expect(
      createLocalAnalysisSession({
        configPath: '.devguard.yml',
        workingDirectory: '/workspace',
      }),
    ).rejects.toBe(error);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.sourceConstructor).not.toHaveBeenCalled();
    expect(mocks.sourceLoadContext).not.toHaveBeenCalled();
  });
});
