export interface LocalAnalysisSummaryInput {
  healthScore: number;
  verbose: boolean;
}

const DEFAULT_SUMMARY = 'DevGuard local analysis completed.\nReports published.\n';

/** Formats the deterministic CLI-owned summary for a successfully published local analysis. */
export function formatLocalAnalysisSummary(input: LocalAnalysisSummaryInput): string {
  return input.verbose
    ? `${DEFAULT_SUMMARY}Health score: ${input.healthScore}/100\n`
    : DEFAULT_SUMMARY;
}
