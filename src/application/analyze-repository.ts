import {
  analyzeContractMapping,
  type ContractAnalysisWarning,
} from '../modules/contract-checker/analyze-contract-mapping.js';
import { detectMissingRelatedTests } from '../modules/pr-risk-analyzer/rules/missing-related-tests.js';
import { detectSensitiveFileChanges } from '../modules/pr-risk-analyzer/rules/sensitive-file-change.js';
import { calculateScore } from '../modules/score-calculator/calculate-score.js';
import { createTestScenarios } from '../modules/test-generator/create-test-scenarios.js';
import { buildReport } from '../reports/report-builder.js';
import { generateAnalysisId } from '../shared/ids.js';
import { createLocalAnalysisSession } from './create-local-analysis-session.js';
import { AnalyzeRepositoryError, createRepositoryFileIndex } from './repository-file-index.js';
import { formatContractWarning } from './contract-warning-formatter.js';
import type { LoadedConfig } from '../config/config-loader.js';
import type { ChangedFile, RepositoryContext } from '../types/repository.js';
import type { PRHealthReport } from '../types/reports.js';
import type { AnalysisFinding } from '../types/findings.js';
import type { GeneratedTest } from '../types/tests.js';

export type { AnalyzeRepositoryErrorCode } from './repository-file-index.js';
export { AnalyzeRepositoryError } from './repository-file-index.js';

export interface AnalyzeRepositoryInput {
  configPath: string;
  workingDirectory: string;
  requirementsPath?: string;
}

export interface AnalyzeRepositoryResult {
  /** Internal application composition state; never part of public report output. */
  loadedConfig: LoadedConfig;
  report: PRHealthReport;
}

export interface AnalyzeRepositoryDependencies {
  createLocalAnalysisSession: typeof createLocalAnalysisSession;
  analyzeContractMapping: typeof analyzeContractMapping;
  detectSensitiveFileChanges: typeof detectSensitiveFileChanges;
  detectMissingRelatedTests: typeof detectMissingRelatedTests;
  createTestScenarios: typeof createTestScenarios;
  calculateScore: typeof calculateScore;
  generateAnalysisId: typeof generateAnalysisId;
  buildReport: typeof buildReport;
  now: () => Date;
}

interface ContractWarningEntry {
  mappingName: string;
  warning: ContractAnalysisWarning;
}

const ANALYZER_EXECUTION_FAILED_MESSAGE = 'Analysis execution failed.';
const REPORT_BUILD_FAILED_MESSAGE = 'Analysis report could not be built.';
const INVALID_CLOCK_MESSAGE = 'Analysis clock returned an invalid date.';

const DEFAULT_DEPENDENCIES: Readonly<AnalyzeRepositoryDependencies> = Object.freeze({
  createLocalAnalysisSession,
  analyzeContractMapping,
  detectSensitiveFileChanges,
  detectMissingRelatedTests,
  createTestScenarios,
  calculateScore,
  generateAnalysisId,
  buildReport,
  now: () => new Date(),
});

const defaultAnalyzeRepository = createAnalyzeRepository();

/**
 * Analyzes one local repository configuration through the complete deterministic
 * application pipeline. It does not format, write, print, or choose an exit code.
 */
export async function analyzeRepository(
  input: AnalyzeRepositoryInput,
): Promise<AnalyzeRepositoryResult> {
  return defaultAnalyzeRepository(input);
}

/**
 * Creates an isolated application boundary with partial dependency overrides for
 * deterministic tests. Factory construction does not mutate defaults or overrides.
 */
export function createAnalyzeRepository(
  overrides: Partial<AnalyzeRepositoryDependencies> = {},
): (input: AnalyzeRepositoryInput) => Promise<AnalyzeRepositoryResult> {
  const dependencies: AnalyzeRepositoryDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };

  return async (input: AnalyzeRepositoryInput): Promise<AnalyzeRepositoryResult> => {
    const session = await dependencies.createLocalAnalysisSession({
      configPath: input.configPath,
      workingDirectory: input.workingDirectory,
    });
    const context = await session.source.loadContext(
      input.requirementsPath === undefined ? {} : { requirementsPath: input.requirementsPath },
    );
    const config = session.loadedConfig.config;
    const fileIndex = createRepositoryFileIndex(context.files);

    const contracts = [...config.contracts].sort((left, right) =>
      compareCodePoints(left.name, right.name),
    );
    const contractFindings: AnalysisFinding[] = [];
    const contractWarnings: ContractWarningEntry[] = [];

    for (const contract of contracts) {
      const result = executeAnalyzer(() =>
        dependencies.analyzeContractMapping({
          mappingName: contract.name,
          openapi: {
            repositoryId: config.openapi.repository,
            file: config.openapi.path,
            content: fileIndex.getRequired(config.openapi.repository, config.openapi.path).content,
            schemaName: contract.openapiSchema,
          },
          typescript: {
            repositoryId: contract.typescript.repository,
            file: contract.typescript.file,
            content: fileIndex.getRequired(contract.typescript.repository, contract.typescript.file)
              .content,
            declarationName: contract.typescript.type,
          },
        }),
      );

      contractFindings.push(...result.findings);
      contractWarnings.push(
        ...result.warnings.map((warning) => ({ mappingName: contract.name, warning })),
      );
    }

    const formattedContractWarnings = contractWarnings
      .sort(compareContractWarningEntries)
      .map((entry) => formatContractWarning(entry.mappingName, entry.warning));
    const changedFiles = collectChangedFiles(context);
    const sensitiveFindings = executeAnalyzer(() =>
      dependencies.detectSensitiveFileChanges({
        changedFiles,
        sensitivePatterns: config.risk?.sensitivePatterns ?? [],
      }),
    );
    const missingRelatedTestFindings = executeAnalyzer(() =>
      dependencies.detectMissingRelatedTests({ changedFiles }),
    );
    const findings = [...contractFindings, ...sensitiveFindings, ...missingRelatedTestFindings];
    const generatedTests = executeAnalyzer(() =>
      dependencies.createTestScenarios({
        findings,
        ...(config.testing?.framework === undefined ? {} : { framework: config.testing.framework }),
      }),
    );
    const scoreBreakdown = executeAnalyzer(() => dependencies.calculateScore({ findings }));
    const analysisId = executeAnalyzer(() =>
      dependencies.generateAnalysisId({
        configPath: session.loadedConfig.configPath,
        repositories: context.repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          baseRef: repository.baseRef,
          headRef: repository.headRef,
        })),
      }),
    );
    const generatedAt = createGeneratedAt(dependencies.now);
    const report = buildApplicationReport({
      dependencies,
      analysisId,
      generatedAt,
      context,
      findings,
      generatedTests,
      scoreBreakdown,
      warnings: formattedContractWarnings,
    });

    return { loadedConfig: session.loadedConfig, report };
  };
}

function collectChangedFiles(context: RepositoryContext): ChangedFile[] {
  return context.repositories
    .flatMap((repository) => repository.changedFiles.map((changedFile) => ({ ...changedFile })))
    .sort(compareChangedFiles);
}

function compareChangedFiles(left: ChangedFile, right: ChangedFile): number {
  return (
    compareCodePoints(left.repositoryId, right.repositoryId) ||
    compareCodePoints(left.path, right.path) ||
    compareCodePoints(left.previousPath ?? '', right.previousPath ?? '') ||
    compareCodePoints(left.status, right.status)
  );
}

function compareContractWarningEntries(
  left: ContractWarningEntry,
  right: ContractWarningEntry,
): number {
  return (
    compareCodePoints(left.mappingName, right.mappingName) ||
    compareCodePoints(left.warning.source, right.warning.source) ||
    compareCodePoints(left.warning.file ?? '', right.warning.file ?? '') ||
    compareWarningLines(left.warning.line, right.warning.line) ||
    compareCodePoints(left.warning.code, right.warning.code) ||
    compareCodePoints(left.warning.message, right.warning.message)
  );
}

function compareWarningLines(left: number | undefined, right: number | undefined): number {
  const leftLine = isPositiveSafeInteger(left) ? left : Number.POSITIVE_INFINITY;
  const rightLine = isPositiveSafeInteger(right) ? right : Number.POSITIVE_INFINITY;

  if (leftLine < rightLine) {
    return -1;
  }

  if (leftLine > rightLine) {
    return 1;
  }

  return 0;
}

function buildApplicationReport(input: {
  dependencies: AnalyzeRepositoryDependencies;
  analysisId: string;
  generatedAt: string;
  context: RepositoryContext;
  findings: readonly AnalysisFinding[];
  generatedTests: readonly GeneratedTest[];
  scoreBreakdown: ReturnType<typeof calculateScore>;
  warnings: readonly string[];
}): PRHealthReport {
  try {
    return input.dependencies.buildReport({
      analysisId: input.analysisId,
      generatedAt: input.generatedAt,
      context: input.context,
      findings: input.findings,
      generatedTests: input.generatedTests,
      scoreBreakdown: input.scoreBreakdown,
      warnings: input.warnings,
    });
  } catch (error: unknown) {
    if (error instanceof AnalyzeRepositoryError) {
      throw error;
    }

    throw new AnalyzeRepositoryError('REPORT_BUILD_FAILED', REPORT_BUILD_FAILED_MESSAGE, {
      cause: error,
    });
  }
}

function createGeneratedAt(now: () => Date): string {
  let currentTime: Date;

  try {
    currentTime = now();
  } catch (error: unknown) {
    throw new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', INVALID_CLOCK_MESSAGE, {
      cause: error,
    });
  }

  if (!(currentTime instanceof Date) || Number.isNaN(currentTime.getTime())) {
    throw new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', INVALID_CLOCK_MESSAGE, {
      cause: currentTime,
    });
  }

  try {
    return currentTime.toISOString();
  } catch (error: unknown) {
    throw new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', INVALID_CLOCK_MESSAGE, {
      cause: error,
    });
  }
}

function executeAnalyzer<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    if (error instanceof AnalyzeRepositoryError) {
      throw error;
    }

    throw new AnalyzeRepositoryError(
      'ANALYZER_EXECUTION_FAILED',
      ANALYZER_EXECUTION_FAILED_MESSAGE,
      {
        cause: error,
      },
    );
  }
}

function isPositiveSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }

  return leftPoints.length - rightPoints.length;
}
