import type { DevGuardConfig } from '../config/config-schema.js';
import type { LoadedConfig } from '../config/config-loader.js';
import type { RepositoryContext } from '../types/repository.js';
import type * as LocalContextBuilderModule from './local-context-builder.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildLocalRepositoryContext: vi.fn(),
}));

vi.mock('./local-context-builder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalContextBuilderModule>();
  return { ...actual, buildLocalRepositoryContext: mocks.buildLocalRepositoryContext };
});

import { GitRepositoryValidationError } from './git-repository-validator.js';
import { GitDiffError } from './local-git-diff-provider.js';
import {
  LocalRepositoryContextError,
  buildLocalRepositoryContext,
} from './local-context-builder.js';
import { LocalRepositorySource } from './local-repository-source.js';
import { GitFileLoadError } from './repository-file-loader.js';

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

function createLoadedConfig(): LoadedConfig {
  return {
    config: createConfig(),
    configPath: '/workspace/.devguard.yml',
    workspaceBase: '/workspace',
  };
}

function createContext(): RepositoryContext {
  return {
    sourceType: 'local',
    sourceLabel: 'Local Git Repositories',
    repositories: [],
    files: [],
    warnings: [],
  };
}

describe('LocalRepositorySource', () => {
  beforeEach(() => {
    mocks.buildLocalRepositoryContext.mockReset();
    mocks.buildLocalRepositoryContext.mockResolvedValue(createContext());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains one LoadedConfig identity and delegates its exact config and workspace base', async () => {
    const loadedConfig = createLoadedConfig();
    const returnedContext = createContext();
    mocks.buildLocalRepositoryContext.mockResolvedValue(returnedContext);
    const source = new LocalRepositorySource({ loadedConfig });

    const override = {
      path: 'requirements.md',
      baseDirectory: '/caller',
      required: true,
    } as const;
    const result = await source.loadContext({ requirementsOverride: override });

    expect(Reflect.get(source, 'loadedConfig')).toBe(loadedConfig);
    expect(buildLocalRepositoryContext).toHaveBeenCalledTimes(1);
    expect(buildLocalRepositoryContext).toHaveBeenCalledWith({
      workspaceBase: loadedConfig.workspaceBase,
      config: loadedConfig.config,
      requirementsOverride: override,
    });
    expect(mocks.buildLocalRepositoryContext.mock.calls[0]?.[0]?.requirementsOverride).toBe(
      override,
    );
    expect(mocks.buildLocalRepositoryContext.mock.calls[0]?.[0]?.config).toBe(loadedConfig.config);
    expect(result).toBe(returnedContext);
  });

  it('omits an undefined requirements override rather than resolving or reconstructing it', async () => {
    const loadedConfig = createLoadedConfig();
    const source = new LocalRepositorySource({ loadedConfig });

    await source.loadContext({});

    expect(buildLocalRepositoryContext).toHaveBeenCalledWith({
      workspaceBase: loadedConfig.workspaceBase,
      config: loadedConfig.config,
    });
    expect(mocks.buildLocalRepositoryContext.mock.calls[0]?.[0]).not.toHaveProperty(
      'requirementsOverride',
    );
  });

  it('does not mutate caller inputs or the LoadedConfig snapshot, and does not log', async () => {
    const loadedConfig = createLoadedConfig();
    const input = {
      requirementsOverride: {
        path: './raw/requirements.md',
        baseDirectory: '/caller',
        required: true as const,
      },
    };
    const beforeLoadedConfig = structuredClone(loadedConfig);
    const beforeInput = structuredClone(input);
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    const consoleError = vi.spyOn(console, 'error');

    try {
      const source = new LocalRepositorySource({ loadedConfig });
      await source.loadContext(input);

      expect(loadedConfig).toEqual(beforeLoadedConfig);
      expect(input).toEqual(beforeInput);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });

  it.each([
    new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY'),
    new GitDiffError('GIT_DIFF_FAILED'),
    new GitFileLoadError('FILE_OBJECT_NOT_FOUND'),
    new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION'),
  ])('passes a lower-level operational error through by identity', async (error) => {
    mocks.buildLocalRepositoryContext.mockRejectedValue(error);
    const source = new LocalRepositorySource({ loadedConfig: createLoadedConfig() });

    await expect(
      source.loadContext({
        requirementsOverride: { path: 'requirements.md', baseDirectory: '/caller', required: true },
      }),
    ).rejects.toBe(error);
  });
});
