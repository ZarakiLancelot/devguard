import type { Severity, AnalysisFinding } from './findings.js';
import type { RepositoryRole } from './repository.js';
import type { GeneratedTest } from './tests.js';

export type HealthLabel = 'HEALTHY' | 'REVIEW' | 'HIGH_RISK' | 'CRITICAL_RISK';

export interface ScoreDeduction {
  findingId: string;
  rootCauseId?: string;
  severity: Severity;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  initialScore: 100;
  finalScore: number;
  deductions: ScoreDeduction[];
}

export interface FindingSummary {
  totalCount: number;
  criticalCount: number;
  highCount: number;
  warningCount: number;
  infoCount: number;
  riskCount: number;
  contractCount: number;
  testingCount: number;
}

export interface PRHealthReport {
  version: '1.0';
  analysisId: string;
  generatedAt: string;
  source: {
    type: 'local' | 'github';
    label: string;
  };
  repositories: Array<{
    repositoryId: string;
    role: RepositoryRole;
    baseRef: string;
    headRef: string;
  }>;
  healthScore: number;
  healthLabel: HealthLabel;
  scoreBreakdown: ScoreBreakdown;
  summary: FindingSummary;
  findings: AnalysisFinding[];
  generatedTests: GeneratedTest[];
  warnings: string[];
}
