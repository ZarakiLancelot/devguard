import path from 'node:path';
import type { OutputConfig } from '../config/config-schema.js';
import { resolveOutputDirectory, resolveOutputFile } from '../config/path-security.js';
import { AnalysisOutputError } from './analysis-output-error.js';

export { AnalysisOutputError } from './analysis-output-error.js';
export type { AnalysisOutputErrorCode } from './analysis-output-error.js';

export const DEFAULT_OUTPUT_DIRECTORY = '.devguard';
export const DEFAULT_MARKDOWN_REPORT_FILE = 'devguard-report.md';
export const DEFAULT_JSON_REPORT_FILE = 'devguard-report.json';

const ANALYSIS_OUTPUT_ERROR_MESSAGE = 'Analysis output configuration is invalid.';

export interface PlanAnalysisOutputInput {
  workspaceBase: string;
  configuredOutput?: OutputConfig;
  outputDirectoryOverride?: string;
}

export interface AnalysisOutputPlan {
  outputDirectory: string;
  markdownFile: string;
  jsonFile: string;
  markdownDisplayPath: string;
  jsonDisplayPath: string;
}

/**
 * Creates a deterministic, lexical-only plan for the two analysis reports.
 * It validates configured paths but does not access the filesystem or write output.
 */
export function planAnalysisOutput(input: PlanAnalysisOutputInput): AnalysisOutputPlan {
  try {
    return createAnalysisOutputPlan(input);
  } catch (error) {
    if (error instanceof AnalysisOutputError) {
      throw error;
    }

    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }
}

function createAnalysisOutputPlan(input: PlanAnalysisOutputInput): AnalysisOutputPlan {
  const directory =
    input.outputDirectoryOverride ?? input.configuredOutput?.directory ?? DEFAULT_OUTPUT_DIRECTORY;
  const markdown = input.configuredOutput?.markdown ?? DEFAULT_MARKDOWN_REPORT_FILE;
  const json = input.configuredOutput?.json ?? DEFAULT_JSON_REPORT_FILE;

  const directoryResolution = resolveOutputDirectory(input.workspaceBase, directory);
  if (!directoryResolution.valid) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  const outputDirectory = directoryResolution.resolvedPath;
  const markdownFile = resolveReportFile(outputDirectory, markdown);
  const jsonFile = resolveReportFile(outputDirectory, json);

  if (markdownFile === jsonFile) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  return {
    outputDirectory,
    markdownFile,
    jsonFile,
    markdownDisplayPath: createDisplayPath(input.workspaceBase, outputDirectory, markdownFile),
    jsonDisplayPath: createDisplayPath(input.workspaceBase, outputDirectory, jsonFile),
  };
}

function resolveReportFile(outputDirectory: string, file: string): string {
  if (file.trim() === '' || file.includes('\u0000') || file.startsWith('\\\\')) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  const fileResolution = resolveOutputFile(outputDirectory, file);
  if (!fileResolution.valid) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  const normalizedRelativePath = path.relative(outputDirectory, fileResolution.resolvedPath);
  if (normalizedRelativePath === '' || path.isAbsolute(normalizedRelativePath)) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  return normalizedRelativePath;
}

function createDisplayPath(
  workspaceBase: string,
  outputDirectory: string,
  reportFile: string,
): string {
  const reportPath = path.resolve(outputDirectory, reportFile);
  const displayPath = path.relative(path.resolve(workspaceBase), reportPath);

  if (
    displayPath === '' ||
    path.isAbsolute(displayPath) ||
    displayPath.split(path.sep).includes('..')
  ) {
    throw new AnalysisOutputError('OUTPUT_PLAN_INVALID', ANALYSIS_OUTPUT_ERROR_MESSAGE);
  }

  return displayPath.split(path.sep).join('/');
}
