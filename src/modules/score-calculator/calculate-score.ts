import { compareSeverity, maxSeverity, SEVERITY_DEDUCTIONS } from '../../types/scoring-helpers.js';
import type { AnalysisFinding, Severity } from '../../types/findings.js';
import type { ScoreBreakdown, ScoreDeduction } from '../../types/reports.js';

const INITIAL_SCORE: ScoreBreakdown['initialScore'] = 100;
const SAFE_RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

interface GroupingIdentity {
  key: string;
  rootCauseId?: string;
}

interface FindingGroup {
  identity: GroupingIdentity;
  findings: AnalysisFinding[];
}

interface AppliedDeduction {
  deduction: ScoreDeduction;
  representative: AnalysisFinding;
}

/** Input for pure deterministic grouped score calculation. */
export interface CalculateScoreInput {
  findings: readonly AnalysisFinding[];
}

/**
 * Applies one severity deduction per normalized root-cause group. A non-empty
 * rootCauseId defines a group; missing or empty rootCauseId falls back to the
 * finding ID. The input findings remain unchanged for later reporting.
 */
export function calculateScore(input: CalculateScoreInput): ScoreBreakdown {
  const appliedDeductions = [...groupFindings(input.findings).values()]
    .map(createAppliedDeduction)
    .sort(compareAppliedDeductions);
  const deductions = appliedDeductions.map((appliedDeduction) => appliedDeduction.deduction);
  const totalDeduction = deductions.reduce((total, deduction) => total + deduction.points, 0);

  return {
    initialScore: INITIAL_SCORE,
    finalScore: Math.max(0, INITIAL_SCORE - totalDeduction),
    deductions,
  };
}

/**
 * Uses distinct internal key namespaces so a fallback finding ID cannot collide
 * with a non-empty rootCauseId that happens to have the same text.
 */
function groupFindings(findings: readonly AnalysisFinding[]): Map<string, FindingGroup> {
  const groups = new Map<string, FindingGroup>();

  for (const finding of findings) {
    const identity = createGroupingIdentity(finding);
    const group = groups.get(identity.key);

    if (group === undefined) {
      groups.set(identity.key, {
        identity,
        findings: [finding],
      });
      continue;
    }

    group.findings.push(finding);
  }

  return groups;
}

function createGroupingIdentity(finding: AnalysisFinding): GroupingIdentity {
  if (finding.rootCauseId !== undefined && finding.rootCauseId !== '') {
    return {
      key: `root-cause\x00${finding.rootCauseId}`,
      rootCauseId: finding.rootCauseId,
    };
  }

  return {
    key: `finding\x00${finding.id}`,
  };
}

function createAppliedDeduction(group: FindingGroup): AppliedDeduction {
  const highestSeverity = getHighestSeverity(group.findings);
  const representative = getRepresentativeFinding(group.findings, highestSeverity);
  const points = SEVERITY_DEDUCTIONS[highestSeverity];

  return {
    representative,
    deduction: {
      findingId: representative.id,
      ...(group.identity.rootCauseId === undefined
        ? {}
        : { rootCauseId: group.identity.rootCauseId }),
      severity: highestSeverity,
      points,
      reason: createReason(representative, highestSeverity, points),
    },
  };
}

function getHighestSeverity(findings: readonly AnalysisFinding[]): Severity {
  let highestSeverity: Severity = 'info';

  for (const finding of findings) {
    highestSeverity = maxSeverity(highestSeverity, finding.severity);
  }

  return highestSeverity;
}

function getRepresentativeFinding(
  findings: readonly AnalysisFinding[],
  highestSeverity: Severity,
): AnalysisFinding {
  const candidates = findings
    .filter((finding) => finding.severity === highestSeverity)
    .sort(compareFindings);
  const representative = candidates[0];

  if (representative === undefined) {
    throw new Error('A non-empty finding group must have a representative');
  }

  return representative;
}

/**
 * Sorts findings by the specified representative tie-breakers without using
 * input order, category, or source preference.
 */
function compareFindings(left: AnalysisFinding, right: AnalysisFinding): number {
  return (
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.location?.repositoryId ?? '', right.location?.repositoryId ?? '') ||
    compareText(left.location?.file ?? '', right.location?.file ?? '') ||
    compareText(left.id, right.id) ||
    compareText(left.rootCauseId ?? '', right.rootCauseId ?? '')
  );
}

/** Sorts applied deductions by their selected representative and severity. */
function compareAppliedDeductions(left: AppliedDeduction, right: AppliedDeduction): number {
  const severityOrder = compareSeverity(right.deduction.severity, left.deduction.severity);
  if (severityOrder !== 0) {
    return severityOrder;
  }

  return (
    compareFindings(left.representative, right.representative) ||
    compareText(left.deduction.rootCauseId ?? '', right.deduction.rootCauseId ?? '')
  );
}

function createReason(representative: AnalysisFinding, severity: Severity, points: number): string {
  const severityLabel = `${severity[0]?.toUpperCase()}${severity.slice(1)}`;
  const ruleId = SAFE_RULE_ID.test(representative.ruleId)
    ? representative.ruleId
    : 'unrecognized-rule';

  return `${severityLabel} finding from rule "${ruleId}" deducts ${points} points.`;
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
