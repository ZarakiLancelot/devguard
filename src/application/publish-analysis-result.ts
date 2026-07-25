import type { AnalyzeRepositoryResult } from './analyze-repository.js';
import { planAnalysisOutput, type AnalysisOutputPlan } from '../reports/analysis-output-plan.js';
import {
  coordinateAnalysisOutput,
  type AnalysisOutputSummary,
} from '../reports/analysis-output-coordinator.js';

export interface PublishAnalysisResultInput {
  result: AnalyzeRepositoryResult;
  outputDirectoryOverride?: string;
}

export interface PublishAnalysisResultDependencies {
  planAnalysisOutput: typeof planAnalysisOutput;
  coordinateAnalysisOutput: typeof coordinateAnalysisOutput;
}

const productionDependencies: Readonly<PublishAnalysisResultDependencies> = Object.freeze({
  planAnalysisOutput,
  coordinateAnalysisOutput,
});

/**
 * Creates a pure application composition boundary for publishing an already
 * completed analysis result with immutable, factory-scoped dependencies.
 */
export function createPublishAnalysisResult(
  overrides: Partial<PublishAnalysisResultDependencies> = {},
): (input: PublishAnalysisResultInput) => Promise<AnalysisOutputSummary> {
  const dependencies: Readonly<PublishAnalysisResultDependencies> = Object.freeze({
    ...productionDependencies,
    ...overrides,
  });

  return async function publish(input: PublishAnalysisResultInput): Promise<AnalysisOutputSummary> {
    const { workspaceBase, config } = input.result.loadedConfig;
    const planningInput = {
      workspaceBase,
      configuredOutput: config.output,
      outputDirectoryOverride: input.outputDirectoryOverride,
    };
    const plan: AnalysisOutputPlan = dependencies.planAnalysisOutput(
      planningInput as unknown as Parameters<typeof planAnalysisOutput>[0],
    );

    return dependencies.coordinateAnalysisOutput({
      workspaceBase,
      plan,
      report: input.result.report,
    });
  };
}

const productionPublisher = createPublishAnalysisResult();

/** Publishes an already-completed analysis result without reloading or reanalyzing it. */
export async function publishAnalysisResult(
  input: PublishAnalysisResultInput,
): Promise<AnalysisOutputSummary> {
  return productionPublisher(input);
}
