import { describe, expect, it } from 'vitest';
import { prHealthReportSchema } from './report-schema.js';
import type { PRHealthReport } from '../types/reports.js';

function createValidReport(): PRHealthReport {
  return {
    version: '1.0',
    analysisId: 'analysis-0123456789abcdef',
    generatedAt: '2026-07-22T16:30:00.000Z',
    source: { type: 'local', label: 'Local Git Repositories' },
    repositories: [
      {
        repositoryId: 'frontend',
        role: 'frontend',
        baseRef: 'main',
        headRef: 'feature/reporting',
      },
    ],
    healthScore: 90,
    healthLabel: 'HEALTHY',
    scoreBreakdown: {
      initialScore: 100,
      finalScore: 90,
      deductions: [
        {
          findingId: 'finding-one',
          rootCauseId: 'root-one',
          severity: 'high',
          points: 10,
          reason: 'High finding deducts 10 points.',
        },
      ],
    },
    summary: {
      totalCount: 1,
      criticalCount: 0,
      highCount: 1,
      warningCount: 0,
      infoCount: 0,
      riskCount: 0,
      contractCount: 1,
      testingCount: 0,
    },
    findings: [
      {
        id: 'finding-one',
        ruleId: 'contract.incompatible-type',
        rootCauseId: 'root-one',
        source: 'contract-checker',
        category: 'contract',
        severity: 'high',
        title: 'Contract mismatch',
        description: 'The contract values differ.',
        location: { repositoryId: 'frontend', file: 'src/book.ts', startLine: 4 },
        evidence: { expected: 'string', actual: 'number', details: { property: 'title' } },
        recommendation: 'Align the contract values.',
        relatedFindingIds: [],
        metadata: { mapping: 'Book' },
      },
    ],
    generatedTests: [
      {
        id: 'test-one',
        framework: 'scenario-only',
        title: 'Verify contract behavior',
        rationale: 'The finding requires a regression scenario.',
        relatedFindingIds: ['finding-one'],
      },
    ],
    warnings: ['Review the unsupported property.'],
  };
}

describe('prHealthReportSchema', () => {
  it('parses a valid current PRHealthReport', () => {
    const report = createValidReport();

    expect(prHealthReportSchema.parse(report)).toEqual(report);
  });

  it.each([
    ['wrong version', (report: PRHealthReport) => ({ ...report, version: '2.0' })],
    ['empty analysis ID', (report: PRHealthReport) => ({ ...report, analysisId: '' })],
    ['invalid timestamp', (report: PRHealthReport) => ({ ...report, generatedAt: 'not-a-date' })],
    [
      'invalid source type',
      (report: PRHealthReport) => ({ ...report, source: { ...report.source, type: 'remote' } }),
    ],
    ['invalid health label', (report: PRHealthReport) => ({ ...report, healthLabel: 'LOW_RISK' })],
    [
      'invalid deduction severity',
      (report: PRHealthReport) => ({
        ...report,
        scoreBreakdown: {
          ...report.scoreBreakdown,
          deductions: [{ ...report.scoreBreakdown.deductions[0], severity: 'urgent' }],
        },
      }),
    ],
    [
      'malformed score breakdown',
      (report: PRHealthReport) => ({
        ...report,
        scoreBreakdown: { ...report.scoreBreakdown, initialScore: 99 },
      }),
    ],
    [
      'malformed summary',
      (report: PRHealthReport) => ({ ...report, summary: { ...report.summary, highCount: -1 } }),
    ],
    [
      'malformed repository reference',
      (report: PRHealthReport) => ({
        ...report,
        repositories: [{ ...report.repositories[0], role: 'worker' }],
      }),
    ],
    [
      'malformed finding',
      (report: PRHealthReport) => ({
        ...report,
        findings: [{ ...report.findings[0], category: 'quality' }],
      }),
    ],
    [
      'malformed generated test',
      (report: PRHealthReport) => ({
        ...report,
        generatedTests: [{ ...report.generatedTests[0], framework: 'playwright' }],
      }),
    ],
    ['non-string warning', (report: PRHealthReport) => ({ ...report, warnings: [123] })],
  ])('rejects %s', (_description, createInvalidReport) => {
    expect(prHealthReportSchema.safeParse(createInvalidReport(createValidReport())).success).toBe(
      false,
    );
  });

  it('rejects missing required top-level fields', () => {
    const { warnings: _warnings, ...reportWithoutWarnings } = createValidReport();

    expect(prHealthReportSchema.safeParse(reportWithoutWarnings).success).toBe(false);
  });

  it('rejects unknown top-level fields because the report schema is strict', () => {
    const report = { ...createValidReport(), unexpected: true };

    expect(prHealthReportSchema.safeParse(report).success).toBe(false);
  });
});
