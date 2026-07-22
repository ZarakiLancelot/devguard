import type { Severity } from './findings.js';
import type { HealthLabel } from './reports.js';

/**
 * Severity ranking from lowest (0) to highest (3).
 * Used to compare severity levels deterministically.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};

/**
 * Deduction points per severity level.
 */
export const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 20,
  high: 10,
  warning: 3,
  info: 0,
};

/**
 * All severity values ordered from highest to lowest.
 */
export const SEVERITIES_DESCENDING: readonly Severity[] = [
  'critical',
  'high',
  'warning',
  'info',
] as const;

/**
 * Returns the numeric rank of a severity level.
 * Higher rank means more severe.
 */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/**
 * Compares two severities. Returns a negative number if `a` is less severe
 * than `b`, zero if equal, or a positive number if `a` is more severe.
 */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

/**
 * Returns the more severe of two severity values.
 */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Returns the health label for a given numeric score (0–100).
 */
export function scoreToHealthLabel(score: number): HealthLabel {
  if (score >= 90) return 'HEALTHY';
  if (score >= 75) return 'REVIEW';
  if (score >= 50) return 'HIGH_RISK';
  return 'CRITICAL_RISK';
}
