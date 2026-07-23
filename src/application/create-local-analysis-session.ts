import { loadConfig, type LoadedConfig } from '../config/config-loader.js';
import { LocalRepositorySource } from '../sources/local-repository-source.js';

/** Explicit caller-owned input for creating one local analysis session. */
export interface CreateLocalAnalysisSessionInput {
  configPath: string;
  workingDirectory: string;
}

/**
 * Immutable-by-convention configuration ownership for one local analysis run.
 * Context loading and future analyzers consume the same LoadedConfig snapshot.
 */
export interface LocalAnalysisSession {
  loadedConfig: LoadedConfig;
  source: LocalRepositorySource;
}

/**
 * Loads DevGuard configuration exactly once and binds it to one local source.
 * Context loading and analysis orchestration intentionally remain separate.
 */
export async function createLocalAnalysisSession(
  input: CreateLocalAnalysisSessionInput,
): Promise<LocalAnalysisSession> {
  const loadedConfig = await loadConfig({
    configPath: input.configPath,
    workingDirectory: input.workingDirectory,
  });
  const source = new LocalRepositorySource({ loadedConfig });

  return { loadedConfig, source };
}
