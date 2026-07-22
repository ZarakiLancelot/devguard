import { compareSeverity, SEVERITY_DEDUCTIONS } from '../../types/scoring-helpers.js';
import type { AnalysisFinding } from '../../types/findings.js';
import type { ScoreBreakdown, ScoreDeduction } from '../../types/reports.js';

const INITIAL_SCORE: ScoreBreakdown['initialScore'] = 100;
const SAFE_RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

interface ScoredFinding {
  finding: AnalysisFinding;
  deduction: ScoreDeduction;
}

/** Input for pure deterministic per-finding score calculation. */
export interface CalculateScoreInput {
  findings: readonly AnalysisFinding[];
}

/**
 * Applies the configured severity deduction once per input finding.
 * Root-cause grouping and representative selection are intentionally deferred
 * to Task 8.2.
 */
export function calculateScore(input: CalculateScoreInput): ScoreBreakdown {
  const scoredFindings = input.findings.map(createScoredFinding).sort(compareScoredFindings);
  const deductions = scoredFindings.map((scoredFinding) => scoredFinding.deduction);
  const totalDeduction = deductions.reduce((total, deduction) => total + deduction.points, 0);

  return {
    initialScore: INITIAL_SCORE,
    finalScore: Math.max(0, INITIAL_SCORE - totalDeduction),
    deductions,
  };
}

function createScoredFinding(finding: AnalysisFinding): ScoredFinding {
  const points = SEVERITY_DEDUCTIONS[finding.severity];

  return {
    finding,
    deduction: {
      findingId: finding.id,
      ...(finding.rootCauseId === undefined ? {} : { rootCauseId: finding.rootCauseId }),
      severity: finding.severity,
      points,
      reason: createReason(finding, points),
    },
  };
}

/**
 * Sorts deductions independently of input order without grouping or removing
 * duplicate findings.
 */
function compareScoredFindings(left: ScoredFinding, right: ScoredFinding): number {
  const severityOrder = compareSeverity(right.finding.severity, left.finding.severity);
  if (severityOrder !== 0) {
    return severityOrder;
  }

  return (
    compareText(left.finding.ruleId, right.finding.ruleId) ||
    compareText(
      left.finding.location?.repositoryId ?? '',
      right.finding.location?.repositoryId ?? '',
    ) ||
    compareText(left.finding.location?.file ?? '', right.finding.location?.file ?? '') ||
    compareText(left.finding.id, right.finding.id) ||
    compareText(left.finding.rootCauseId ?? '', right.finding.rootCauseId ?? '')
  );
}

function createReason(finding: AnalysisFinding, points: number): string {
  const severity = `${finding.severity[0]?.toUpperCase()}${finding.severity.slice(1)}`;
  const ruleId = SAFE_RULE_ID.test(finding.ruleId) ? finding.ruleId : 'unrecognized-rule';

  return `${severity} finding from rule "${ruleId}" deducts ${points} points.`;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
