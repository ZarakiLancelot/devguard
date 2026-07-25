import type {
  analyzeRepository,
  AnalyzeRepositoryResult,
} from '../application/analyze-repository.js';

export interface RunAnalyzeLocalInput {
  configPath: string;
  requirementsPath?: string;
}

export interface RunAnalyzeLocalDependencies {
  analyzeRepository: typeof analyzeRepository;
  getWorkingDirectory: () => string;
}

/**
 * Maps the active local CLI command to one application-owned analysis run.
 * It deliberately performs no configuration, output, or report work itself.
 */
export async function runAnalyzeLocal(
  input: RunAnalyzeLocalInput,
  dependencies: RunAnalyzeLocalDependencies,
): Promise<AnalyzeRepositoryResult> {
  const workingDirectory = dependencies.getWorkingDirectory();

  return dependencies.analyzeRepository({
    configPath: input.configPath,
    workingDirectory,
    ...(input.requirementsPath === undefined
      ? {}
      : {
          requirementsOverride: {
            path: input.requirementsPath,
            baseDirectory: workingDirectory,
            required: true,
          },
        }),
  });
}
