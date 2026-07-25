import path from 'node:path';
import { isPathContainedInRoot, resolveOutputFile } from '../config/path-security.js';
import { writeFileAtomically } from './atomic-writer.js';
import type { AnalysisOutputPlan } from './analysis-output-plan.js';
import { AnalysisOutputError } from './analysis-output-error.js';
import { prepareAnalysisOutputDirectory } from './analysis-output-directory.js';

export { AnalysisOutputError } from './analysis-output-error.js';
export type { AnalysisOutputErrorCode as AnalysisOutputCoordinatorErrorCode } from './analysis-output-error.js';
import { formatJson } from './json-formatter.js';
import { formatMarkdown } from './markdown-formatter.js';
import type { PreparedAnalysisOutputDirectory } from './analysis-output-directory.js';
import type { PRHealthReport } from '../types/reports.js';

const FORMAT_ERROR_MESSAGE = 'Analysis reports could not be formatted.';
const WRITE_ERROR_MESSAGE = 'Analysis report output could not be written safely.';

export interface CoordinateAnalysisOutputInput {
  /** Private internal state used only to prepare the canonical output directory. */
  workspaceBase: string;
  plan: AnalysisOutputPlan;
  report: PRHealthReport;
}

export interface AnalysisOutputSummary {
  markdownPath: string;
  jsonPath: string;
}

export interface AnalysisOutputCoordinatorDependencies {
  formatMarkdown: typeof formatMarkdown;
  formatJson: typeof formatJson;
  prepareAnalysisOutputDirectory: typeof prepareAnalysisOutputDirectory;
  writeFileAtomically: typeof writeFileAtomically;
}

const productionDependencies: Readonly<AnalysisOutputCoordinatorDependencies> = Object.freeze({
  formatMarkdown,
  formatJson,
  prepareAnalysisOutputDirectory,
  writeFileAtomically,
});

/**
 * Creates an output coordinator with immutable, factory-scoped dependencies.
 */
export function createCoordinateAnalysisOutput(
  overrides: Partial<AnalysisOutputCoordinatorDependencies> = {},
): (input: CoordinateAnalysisOutputInput) => Promise<AnalysisOutputSummary> {
  const dependencies: Readonly<AnalysisOutputCoordinatorDependencies> = Object.freeze({
    ...productionDependencies,
    ...overrides,
  });

  return async function coordinate(
    input: CoordinateAnalysisOutputInput,
  ): Promise<AnalysisOutputSummary> {
    let markdownContent: string;
    let jsonContent: string;

    try {
      markdownContent = dependencies.formatMarkdown(input.report);
      jsonContent = dependencies.formatJson(input.report);
    } catch (error) {
      throw new AnalysisOutputError('OUTPUT_FORMAT_FAILED', FORMAT_ERROR_MESSAGE, { cause: error });
    }

    let preparedDirectory: PreparedAnalysisOutputDirectory;
    try {
      preparedDirectory = await dependencies.prepareAnalysisOutputDirectory({
        workspaceBase: input.workspaceBase,
        plan: input.plan,
      });
    } catch (error) {
      if (error instanceof AnalysisOutputError) {
        throw error;
      }

      throw new AnalysisOutputError('OUTPUT_WRITE_FAILED', WRITE_ERROR_MESSAGE, { cause: error });
    }

    try {
      const markdownTarget = resolvePreparedTarget(
        preparedDirectory.outputDirectory,
        preparedDirectory.markdownParentDirectory,
        input.plan.markdownFile,
      );
      const jsonTarget = resolvePreparedTarget(
        preparedDirectory.outputDirectory,
        preparedDirectory.jsonParentDirectory,
        input.plan.jsonFile,
      );

      await dependencies.writeFileAtomically({
        allowedRoot: preparedDirectory.outputDirectory,
        filePath: markdownTarget,
        content: markdownContent,
      });
      await dependencies.writeFileAtomically({
        allowedRoot: preparedDirectory.outputDirectory,
        filePath: jsonTarget,
        content: jsonContent,
      });
    } catch (error) {
      throw new AnalysisOutputError('OUTPUT_WRITE_FAILED', WRITE_ERROR_MESSAGE, { cause: error });
    }

    return {
      markdownPath: input.plan.markdownDisplayPath,
      jsonPath: input.plan.jsonDisplayPath,
    };
  };
}

/** Coordinates formatting, safe directory preparation, and ordered report publication. */
export async function coordinateAnalysisOutput(
  input: CoordinateAnalysisOutputInput,
): Promise<AnalysisOutputSummary> {
  return productionCoordinator(input);
}

const productionCoordinator = createCoordinateAnalysisOutput();

function resolvePreparedTarget(
  preparedOutputDirectory: string,
  preparedParentDirectory: string,
  reportFile: string,
): string {
  const lexicalResolution = resolveOutputFile(preparedOutputDirectory, reportFile);
  if (!lexicalResolution.valid) {
    throw new Error('OUTPUT_TARGET_INVALID');
  }

  const targetPath = path.resolve(
    preparedParentDirectory,
    path.basename(lexicalResolution.resolvedPath),
  );

  if (
    !isPathContainedInRoot(targetPath, preparedOutputDirectory) ||
    !isPathContainedInRoot(targetPath, preparedParentDirectory)
  ) {
    throw new Error('OUTPUT_TARGET_OUTSIDE_PREPARED_DIRECTORY');
  }

  return targetPath;
}
