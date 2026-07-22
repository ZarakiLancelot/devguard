import { scoreToHealthLabel } from '../types/scoring-helpers.js';
import type { AnalysisFinding, Category, Severity } from '../types/findings.js';
import type { RepositoryContext } from '../types/repository.js';
import type { ScoreBreakdown, FindingSummary, PRHealthReport } from '../types/reports.js';
import type { GeneratedTest } from '../types/tests.js';
import { prHealthReportSchema } from './report-schema.js';

const REPORT_VERSION: PRHealthReport['version'] = '1.0';
const STABLE_SEPARATOR = '\x00';

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
};

/** Task 9.1 report category rank: contract, risk, then testing. */
const CATEGORY_RANK: Record<Category, number> = {
  contract: 0,
  risk: 1,
  testing: 2,
};

/** Explicit in-memory values required to build one validated PR health report. */
export interface BuildReportInput {
  analysisId: string;
  generatedAt: string;
  context: RepositoryContext;
  findings: readonly AnalysisFinding[];
  generatedTests: readonly GeneratedTest[];
  scoreBreakdown: ScoreBreakdown;
  warnings?: readonly string[];
}

/**
 * Builds and validates a deterministic PRHealthReport without reading files,
 * Git state, environment variables, clocks, or random values.
 */
export function buildReport(input: BuildReportInput): PRHealthReport {
  const findings = [...input.findings].sort(compareFindings);
  const generatedTests = [...input.generatedTests].sort(compareGeneratedTests);
  const scoreBreakdown = copyScoreBreakdown(input.scoreBreakdown);

  const report: PRHealthReport = {
    version: REPORT_VERSION,
    analysisId: input.analysisId,
    generatedAt: input.generatedAt,
    source: {
      type: input.context.sourceType,
      label: input.context.sourceLabel,
    },
    repositories: createRepositoryReferences(input.context),
    healthScore: scoreBreakdown.finalScore,
    healthLabel: scoreToHealthLabel(scoreBreakdown.finalScore),
    scoreBreakdown,
    summary: createFindingSummary(findings),
    findings,
    generatedTests,
    warnings: normalizeWarnings(input.context.warnings, input.warnings),
  };

  return prHealthReportSchema.parse(report) as PRHealthReport;
}

function createRepositoryReferences(context: RepositoryContext): PRHealthReport['repositories'] {
  const references = context.repositories.map((repository) => ({
    repositoryId: repository.repositoryId,
    role: repository.role,
    baseRef: repository.baseRef,
    headRef: repository.headRef,
  }));

  return references
    .filter(
      (reference, index) =>
        !references.slice(0, index).some((candidate) => isSameRepository(candidate, reference)),
    )
    .sort(compareRepositories);
}

function isSameRepository(
  left: PRHealthReport['repositories'][number],
  right: PRHealthReport['repositories'][number],
): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.role === right.role &&
    left.baseRef === right.baseRef &&
    left.headRef === right.headRef
  );
}

function compareRepositories(
  left: PRHealthReport['repositories'][number],
  right: PRHealthReport['repositories'][number],
): number {
  return (
    compareText(left.repositoryId, right.repositoryId) ||
    compareText(left.role, right.role) ||
    compareText(left.baseRef, right.baseRef) ||
    compareText(left.headRef, right.headRef)
  );
}

function copyScoreBreakdown(scoreBreakdown: ScoreBreakdown): ScoreBreakdown {
  return {
    initialScore: scoreBreakdown.initialScore,
    finalScore: scoreBreakdown.finalScore,
    deductions: scoreBreakdown.deductions.map((deduction) => ({ ...deduction })),
  };
}

function compareFindings(left: AnalysisFinding, right: AnalysisFinding): number {
  const severityOrder = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityOrder !== 0) {
    return severityOrder;
  }

  const categoryOrder = CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category];
  if (categoryOrder !== 0) {
    return categoryOrder;
  }

  return (
    compareText(left.location?.repositoryId ?? '', right.location?.repositoryId ?? '') ||
    compareText(left.location?.file ?? '', right.location?.file ?? '') ||
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.id, right.id) ||
    compareText(left.rootCauseId ?? '', right.rootCauseId ?? '')
  );
}

function createFindingSummary(findings: readonly AnalysisFinding[]): FindingSummary {
  const summary: FindingSummary = {
    totalCount: findings.length,
    criticalCount: 0,
    highCount: 0,
    warningCount: 0,
    infoCount: 0,
    riskCount: 0,
    contractCount: 0,
    testingCount: 0,
  };

  for (const finding of findings) {
    switch (finding.severity) {
      case 'critical':
        summary.criticalCount += 1;
        break;
      case 'high':
        summary.highCount += 1;
        break;
      case 'warning':
        summary.warningCount += 1;
        break;
      case 'info':
        summary.infoCount += 1;
        break;
    }

    switch (finding.category) {
      case 'risk':
        summary.riskCount += 1;
        break;
      case 'contract':
        summary.contractCount += 1;
        break;
      case 'testing':
        summary.testingCount += 1;
        break;
    }
  }

  return summary;
}

function compareGeneratedTests(left: GeneratedTest, right: GeneratedTest): number {
  return (
    compareText(left.framework, right.framework) ||
    compareText(left.title, right.title) ||
    compareText(left.id, right.id) ||
    compareText(
      relatedFindingIdsKey(left.relatedFindingIds),
      relatedFindingIdsKey(right.relatedFindingIds),
    )
  );
}

function relatedFindingIdsKey(relatedFindingIds: readonly string[]): string {
  return [...new Set(relatedFindingIds)].sort(compareText).join(STABLE_SEPARATOR);
}

function normalizeWarnings(
  contextWarnings: readonly string[],
  inputWarnings: readonly string[] | undefined,
): string[] {
  return [...new Set([...contextWarnings, ...(inputWarnings ?? [])].filter(isPresentWarning))].sort(
    compareText,
  );
}

function isPresentWarning(warning: string): boolean {
  return warning.trim().length > 0;
}

/** Compares Unicode code points without locale-dependent collation. */
function compareText(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftCodePoint = leftCodePoints[index]?.codePointAt(0);
    const rightCodePoint = rightCodePoints[index]?.codePointAt(0);

    if (leftCodePoint !== rightCodePoint) {
      return (leftCodePoint ?? 0) - (rightCodePoint ?? 0);
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
