import type {
  analyzeRepository,
  AnalyzeRepositoryResult,
} from '../application/analyze-repository.js';
import type { publishAnalysisResult } from '../application/publish-analysis-result.js';

export interface RunAnalyzeLocalInput {
  configPath: string;
  requirementsPath?: string;
  outputDirectoryPath?: string;
}

export interface RunAnalyzeLocalDependencies {
  analyzeRepository: typeof analyzeRepository;
  publishAnalysisResult: typeof publishAnalysisResult;
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

  const result = await dependencies.analyzeRepository({
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

  await dependencies.publishAnalysisResult({
    result,
    ...(input.outputDirectoryPath === undefined
      ? {}
      : { outputDirectoryOverride: input.outputDirectoryPath }),
  });

  return result;
}
