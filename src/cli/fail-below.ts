const FAIL_BELOW_INVALID_MESSAGE = 'Fail-below score must be a decimal value from 0 through 100.';
const DECIMAL_THRESHOLD = /^\d+(?:\.\d+)?$/u;
const MINIMUM_THRESHOLD = 0;
const MAXIMUM_THRESHOLD = 100;

export interface ParsedFailBelow {
  threshold: number;
}

export type FailBelowOutcome = { kind: 'passed' } | { kind: 'quality-threshold-not-met' };

export class FailBelowParseError extends Error {
  readonly code = 'FAIL_BELOW_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'FailBelowParseError';
  }
}

/** Parses one lexical --fail-below value using the approved decimal grammar. */
export function parseFailBelow(value: string): ParsedFailBelow {
  const trimmedValue = value.trim();

  if (!DECIMAL_THRESHOLD.test(trimmedValue)) {
    throw new FailBelowParseError(FAIL_BELOW_INVALID_MESSAGE);
  }

  const threshold = Number(trimmedValue);
  if (
    !Number.isFinite(threshold) ||
    threshold < MINIMUM_THRESHOLD ||
    threshold > MAXIMUM_THRESHOLD
  ) {
    throw new FailBelowParseError(FAIL_BELOW_INVALID_MESSAGE);
  }

  return { threshold };
}

/** Evaluates a pre-parsed threshold against an already calculated health score. */
export function evaluateFailBelow(healthScore: number, parsed: ParsedFailBelow): FailBelowOutcome {
  return healthScore < parsed.threshold
    ? { kind: 'quality-threshold-not-met' }
    : { kind: 'passed' };
}
