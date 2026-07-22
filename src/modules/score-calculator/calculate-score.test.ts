import { describe, expect, it } from 'vitest';
import { calculateScore } from './calculate-score.js';
import type { AnalysisFinding, Severity } from '../../types/findings.js';
import type { ScoreBreakdown } from '../../types/reports.js';
import { SEVERITY_DEDUCTIONS } from '../../types/scoring-helpers.js';

const SOURCE_CONTENT = 'const privateSource = "do-not-copy";';
const ABSOLUTE_PATH = '/private/workspace/Book.ts';

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-default',
    ruleId: 'contract.incompatible-type',
    source: 'contract-checker',
    category: 'contract',
    severity: 'critical',
    title: 'Input-only title',
    description: `Input-only description ${SOURCE_CONTENT}`,
    location: {
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
    },
    evidence: {
      codeSnippet: SOURCE_CONTENT,
      details: {
        patch: SOURCE_CONTENT,
        timestamp: '2026-07-22T00:00:00.000Z',
        environment: 'developer-machine',
      },
    },
    recommendation: `Input-only recommendation ${SOURCE_CONTENT}`,
    metadata: {
      patch: SOURCE_CONTENT,
      timestamp: '2026-07-22T00:00:00.000Z',
      environment: 'developer-machine',
    },
    ...overrides,
  };
}

function deductionForSeverity(severity: Severity): ScoreBreakdown {
  return calculateScore({
    findings: [createFinding({ id: `finding-${severity}`, severity })],
  });
}

describe('calculateScore', () => {
  it('returns the exact initial score and no deductions for empty findings', () => {
    expect(calculateScore({ findings: [] })).toEqual({
      initialScore: 100,
      finalScore: 100,
      deductions: [],
    });
  });

  it.each([
    ['critical', 20],
    ['high', 10],
    ['warning', 3],
    ['info', 0],
  ] as const)('deducts the configured %s severity magnitude', (severity, points) => {
    const result = deductionForSeverity(severity);

    expect(result.initialScore).toBe(100);
    expect(result.finalScore).toBe(100 - points);
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]).toMatchObject({
      findingId: `finding-${severity}`,
      severity,
      points: SEVERITY_DEDUCTIONS[severity],
    });
  });

  it('retains an explicit zero-point deduction entry for an info finding', () => {
    const [deduction] = deductionForSeverity('info').deductions;

    expect(deduction).toMatchObject({ severity: 'info', points: 0 });
    expect(deduction?.reason).toContain('deducts 0 points');
  });

  it('sums deductions for multiple findings without creating category scores', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'critical', severity: 'critical' }),
        createFinding({ id: 'high', severity: 'high' }),
        createFinding({ id: 'warning', severity: 'warning' }),
        createFinding({ id: 'info', severity: 'info' }),
      ],
    });

    expect(result.initialScore).toBe(100);
    expect(result.finalScore).toBe(67);
    expect(result.deductions.map((deduction) => deduction.points)).toEqual([20, 10, 3, 0]);
    expect(result).not.toHaveProperty('categoryScores');
  });

  it('clamps a score below zero to exactly zero and never returns a negative score', () => {
    const findings = Array.from({ length: 6 }, (_, index) =>
      createFinding({ id: `critical-${index}`, severity: 'critical' }),
    );

    const result = calculateScore({ findings });

    expect(result.finalScore).toBe(0);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('maps every deduction from the shared SEVERITY_DEDUCTIONS source of truth', () => {
    const findings: AnalysisFinding[] = ['critical', 'high', 'warning', 'info'].map((severity) =>
      createFinding({ id: `finding-${severity}`, severity: severity as Severity }),
    );

    const result = calculateScore({ findings });

    for (const deduction of result.deductions) {
      expect(deduction.points).toBe(SEVERITY_DEDUCTIONS[deduction.severity]);
    }
  });

  it('preserves finding ID, root cause, and severity in each deduction', () => {
    const withRootCause = createFinding({
      id: 'finding-with-root',
      severity: 'high',
      rootCauseId: '',
    });
    const withoutRootCause = createFinding({
      id: 'finding-without-root',
      severity: 'warning',
    });

    const result = calculateScore({ findings: [withoutRootCause, withRootCause] });
    const withRootDeduction = result.deductions.find(
      (deduction) => deduction.findingId === 'finding-with-root',
    );
    const withoutRootDeduction = result.deductions.find(
      (deduction) => deduction.findingId === 'finding-without-root',
    );

    expect(withRootDeduction).toMatchObject({
      findingId: 'finding-with-root',
      rootCauseId: '',
      severity: 'high',
    });
    expect(withoutRootDeduction).not.toHaveProperty('rootCauseId');
    expect(withoutRootDeduction).toMatchObject({ severity: 'warning' });
  });

  it('uses safe deterministic reasons with severity, rule ID, and deduction magnitude', () => {
    const [deduction] = calculateScore({
      findings: [createFinding({ id: 'finding-reason', severity: 'critical' })],
    }).deductions;

    expect(deduction?.reason).toBe(
      'Critical finding from rule "contract.incompatible-type" deducts 20 points.',
    );
  });

  it('does not copy descriptions, recommendations, evidence, metadata, paths, or environment details into reasons', () => {
    const [deduction] = calculateScore({
      findings: [
        createFinding({
          id: 'finding-safe-reason',
          location: { repositoryId: 'frontend', file: ABSOLUTE_PATH },
        }),
      ],
    }).deductions;
    const reason = deduction?.reason ?? '';

    expect(reason).not.toContain(SOURCE_CONTENT);
    expect(reason).not.toContain(ABSOLUTE_PATH);
    expect(reason).not.toContain('2026-07-22');
    expect(reason).not.toContain('developer-machine');
  });

  it('scores unknown rule IDs solely by their severity', () => {
    const [deduction] = calculateScore({
      findings: [
        createFinding({ id: 'finding-unknown', ruleId: 'custom.unknown-rule', severity: 'high' }),
      ],
    }).deductions;

    expect(deduction).toMatchObject({ severity: 'high', points: 10 });
    expect(deduction?.reason).toContain('custom.unknown-rule');
  });

  it.each([
    ['contract.unsupported-type', 'warning', 3],
    ['contract.schema-not-found', 'high', 10],
    ['risk.sensitive-file-change', 'high', 10],
  ] as const)('scores approved public finding rule %s by severity', (ruleId, severity, points) => {
    const [deduction] = calculateScore({
      findings: [createFinding({ id: `finding-${ruleId}`, ruleId, severity })],
    }).deductions;

    expect(deduction).toMatchObject({ severity, points });
  });

  it('does not deduplicate identical input occurrences during Task 8.1', () => {
    const finding = createFinding({ id: 'finding-duplicate', severity: 'high' });

    const result = calculateScore({ findings: [finding, finding] });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(80);
    expect(result.deductions.map((deduction) => deduction.findingId)).toEqual([
      'finding-duplicate',
      'finding-duplicate',
    ]);
  });

  it('does not group findings sharing one rootCauseId during Task 8.1', () => {
    const result = calculateScore({
      findings: [
        createFinding({
          id: 'finding-critical',
          severity: 'critical',
          rootCauseId: 'root-shared',
        }),
        createFinding({ id: 'finding-warning', severity: 'warning', rootCauseId: 'root-shared' }),
      ],
    });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(77);
    expect(result.deductions.map((deduction) => deduction.rootCauseId)).toEqual([
      'root-shared',
      'root-shared',
    ]);
  });

  it('orders deductions by severity, rule ID, repository, file, finding ID, and root cause', () => {
    const findings = [
      createFinding({
        id: 'info',
        ruleId: 'z.rule',
        severity: 'info',
        location: { repositoryId: 'repo-z', file: 'z.ts' },
      }),
      createFinding({
        id: 'warning',
        ruleId: 'a.rule',
        severity: 'warning',
        location: { repositoryId: 'repo-z', file: 'z.ts' },
      }),
      createFinding({
        id: 'high-b',
        ruleId: 'same.rule',
        severity: 'high',
        location: { repositoryId: 'repo-b', file: 'b.ts' },
      }),
      createFinding({
        id: 'high-a',
        ruleId: 'same.rule',
        severity: 'high',
        location: { repositoryId: 'repo-a', file: 'a.ts' },
      }),
      createFinding({
        id: 'critical',
        ruleId: 'z.rule',
        severity: 'critical',
        location: { repositoryId: 'repo-z', file: 'z.ts' },
      }),
    ];

    const result = calculateScore({ findings });

    expect(result.deductions.map((deduction) => deduction.findingId)).toEqual([
      'critical',
      'high-a',
      'high-b',
      'warning',
      'info',
    ]);
  });

  it('uses missing location values as empty strings without throwing', () => {
    const findingWithoutLocation = createFinding({ id: 'finding-no-location' });
    delete findingWithoutLocation.location;

    expect(() => calculateScore({ findings: [findingWithoutLocation] })).not.toThrow();
  });

  it('uses finding ID and then rootCauseId as final deterministic ordering tie-breaks', () => {
    const common = {
      ruleId: 'same.rule',
      severity: 'high' as const,
      location: { repositoryId: 'repo', file: 'src/file.ts' },
    };
    const result = calculateScore({
      findings: [
        createFinding({ ...common, id: 'same-id', rootCauseId: 'root-z' }),
        createFinding({ ...common, id: 'finding-b', rootCauseId: 'root-a' }),
        createFinding({ ...common, id: 'same-id', rootCauseId: 'root-a' }),
        createFinding({ ...common, id: 'finding-a', rootCauseId: 'root-z' }),
      ],
    });

    expect(
      result.deductions.map((deduction) => [deduction.findingId, deduction.rootCauseId]),
    ).toEqual([
      ['finding-a', 'root-z'],
      ['finding-b', 'root-a'],
      ['same-id', 'root-a'],
      ['same-id', 'root-z'],
    ]);
  });

  it('is deterministic across repeated execution and reversed input order', () => {
    const findings = [
      createFinding({ id: 'finding-warning', severity: 'warning' }),
      createFinding({ id: 'finding-critical', severity: 'critical' }),
      createFinding({ id: 'finding-high', severity: 'high' }),
    ];

    const first = calculateScore({ findings });

    expect(calculateScore({ findings })).toEqual(first);
    expect(calculateScore({ findings: [...findings].reverse() })).toEqual(first);
  });

  it('does not mutate findings, nested evidence, metadata, locations, or input arrays', () => {
    const finding = createFinding({ id: 'finding-immutable', rootCauseId: 'root-immutable' });
    const findings = [finding];
    const before = structuredClone({ finding, findings });

    calculateScore({ findings });

    expect({ finding, findings }).toEqual(before);
  });

  it('returns the existing ScoreBreakdown shape only', () => {
    const result: ScoreBreakdown = calculateScore({
      findings: [createFinding({ id: 'finding-shape', severity: 'high' })],
    });

    expect(Object.keys(result).sort()).toEqual(['deductions', 'finalScore', 'initialScore']);
    expect(result.deductions[0]).toMatchObject({
      findingId: 'finding-shape',
      severity: 'high',
      points: 10,
    });
  });
});
