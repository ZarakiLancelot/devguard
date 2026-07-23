import type { LoadedConfig } from '../config/config-loader.js';
import type { RepositoryContext } from '../types/repository.js';
import { buildLocalRepositoryContext } from './local-context-builder.js';

/** Immutable configuration snapshot owned by one local analysis session. */
export interface LocalRepositorySourceOptions {
  loadedConfig: LoadedConfig;
}

/** Per-context inputs that remain after application-owned configuration loading. */
export interface LocalRepositorySourceLoadInput {
  requirementsPath?: string;
}

/**
 * Loads local repository context from one already completed configuration snapshot.
 * Instances are created per local analysis session and are not long-lived services.
 */
export class LocalRepositorySource {
  private readonly loadedConfig: LoadedConfig;

  constructor(options: LocalRepositorySourceOptions) {
    if (options === null || typeof options !== 'object' || options.loadedConfig === undefined) {
      throw new TypeError('LocalRepositorySource requires a loaded configuration.');
    }

    this.loadedConfig = options.loadedConfig;
  }

  async loadContext(input: LocalRepositorySourceLoadInput): Promise<RepositoryContext> {
    return buildLocalRepositoryContext({
      workspaceBase: this.loadedConfig.workspaceBase,
      config: this.loadedConfig.config,
      ...(input.requirementsPath === undefined ? {} : { requirementsPath: input.requirementsPath }),
    });
  }
}
