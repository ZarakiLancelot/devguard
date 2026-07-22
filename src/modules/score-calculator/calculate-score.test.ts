import { describe, expect, it } from 'vitest';
import { calculateScore } from './calculate-score.js';
import type { AnalysisFinding } from '../../types/findings.js';
import type { ScoreBreakdown } from '../../types/reports.js';
import { SEVERITY_DEDUCTIONS, scoreToHealthLabel } from '../../types/scoring-helpers.js';

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

function deductionsFor(findings: readonly AnalysisFinding[]): ScoreBreakdown['deductions'] {
  return calculateScore({ findings }).deductions;
}

describe('calculateScore', () => {
  it('returns the existing empty ScoreBreakdown with score 100', () => {
    const result: ScoreBreakdown = calculateScore({ findings: [] });

    expect(result).toEqual({ initialScore: 100, finalScore: 100, deductions: [] });
  });

  it('creates separate deductions for distinct non-empty rootCauseIds', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-root-a', severity: 'high', rootCauseId: 'root-a' }),
        createFinding({ id: 'finding-root-b', severity: 'warning', rootCauseId: 'root-b' }),
      ],
    });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(87);
    expect(result.deductions.map((deduction) => deduction.rootCauseId)).toEqual([
      'root-a',
      'root-b',
    ]);
  });

  it('creates one deduction for findings sharing a rootCauseId', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-one', severity: 'high', rootCauseId: 'root-shared' }),
        createFinding({ id: 'finding-two', severity: 'warning', rootCauseId: 'root-shared' }),
      ],
    });

    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]).toMatchObject({
      rootCauseId: 'root-shared',
      severity: 'high',
      points: 10,
    });
    expect(result.finalScore).toBe(90);
  });

  it.each([
    ['critical', 'high', 'warning', 'critical', 20],
    ['high', 'warning', 'info', 'high', 10],
    ['warning', 'info', 'info', 'warning', 3],
  ] as const)(
    'selects %s over lower severities in one group',
    (first, second, third, expectedSeverity, expectedPoints) => {
      const result = calculateScore({
        findings: [
          createFinding({ id: 'finding-first', severity: first, rootCauseId: 'root-severity' }),
          createFinding({ id: 'finding-second', severity: second, rootCauseId: 'root-severity' }),
          createFinding({ id: 'finding-third', severity: third, rootCauseId: 'root-severity' }),
        ],
      });

      expect(result.deductions).toHaveLength(1);
      expect(result.deductions[0]).toMatchObject({
        severity: expectedSeverity,
        points: expectedPoints,
      });
      expect(result.finalScore).toBe(100 - expectedPoints);
    },
  );

  it('creates one deduction for multiple same-severity findings in a group', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-one', severity: 'high', rootCauseId: 'root-same-severity' }),
        createFinding({ id: 'finding-two', severity: 'high', rootCauseId: 'root-same-severity' }),
      ],
    });

    expect(result.deductions).toHaveLength(1);
    expect(result.finalScore).toBe(90);
  });

  it('uses rule ID as the first highest-severity representative tie-breaker', () => {
    const [deduction] = deductionsFor([
      createFinding({ id: 'finding-z', ruleId: 'z.rule', severity: 'high', rootCauseId: 'root' }),
      createFinding({ id: 'finding-a', ruleId: 'a.rule', severity: 'high', rootCauseId: 'root' }),
    ]);

    expect(deduction?.findingId).toBe('finding-a');
    expect(deduction?.reason).toContain('a.rule');
  });

  it('uses repository ID as the second highest-severity representative tie-breaker', () => {
    const [deduction] = deductionsFor([
      createFinding({
        id: 'finding-z',
        ruleId: 'same.rule',
        severity: 'high',
        rootCauseId: 'root',
        location: { repositoryId: 'repo-z', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'finding-a',
        ruleId: 'same.rule',
        severity: 'high',
        rootCauseId: 'root',
        location: { repositoryId: 'repo-a', file: 'src/file.ts' },
      }),
    ]);

    expect(deduction?.findingId).toBe('finding-a');
  });

  it('uses file as the third and finding ID as the fourth representative tie-breaker', () => {
    const [deduction] = deductionsFor([
      createFinding({
        id: 'finding-z',
        ruleId: 'same.rule',
        severity: 'high',
        rootCauseId: 'root',
        location: { repositoryId: 'repo', file: 'src/z.ts' },
      }),
      createFinding({
        id: 'finding-b',
        ruleId: 'same.rule',
        severity: 'high',
        rootCauseId: 'root',
        location: { repositoryId: 'repo', file: 'src/a.ts' },
      }),
      createFinding({
        id: 'finding-a',
        ruleId: 'same.rule',
        severity: 'high',
        rootCauseId: 'root',
        location: { repositoryId: 'repo', file: 'src/a.ts' },
      }),
    ]);

    expect(deduction?.findingId).toBe('finding-a');
  });

  it('uses rootCauseId as the final deterministic deduction ordering tie-breaker', () => {
    const common = {
      ruleId: 'same.rule',
      severity: 'high' as const,
      location: { repositoryId: 'repo', file: 'src/file.ts' },
      id: 'same-id',
    };
    const result = calculateScore({
      findings: [
        createFinding({ ...common, rootCauseId: 'root-z' }),
        createFinding({ ...common, rootCauseId: 'root-a' }),
      ],
    });

    expect(result.deductions.map((deduction) => deduction.rootCauseId)).toEqual([
      'root-a',
      'root-z',
    ]);
  });

  it('selects representatives independently of input order', () => {
    const findings = [
      createFinding({
        id: 'finding-z',
        ruleId: 'z.rule',
        severity: 'critical',
        rootCauseId: 'root',
      }),
      createFinding({
        id: 'finding-a',
        ruleId: 'a.rule',
        severity: 'critical',
        rootCauseId: 'root',
      }),
    ];

    expect(calculateScore({ findings }).deductions[0]?.findingId).toBe('finding-a');
    expect(calculateScore({ findings: [...findings].reverse() }).deductions[0]?.findingId).toBe(
      'finding-a',
    );
  });

  it('uses finding.id when rootCauseId is missing and omits rootCauseId from the deduction', () => {
    const [deduction] = deductionsFor([
      createFinding({ id: 'finding-fallback', severity: 'high' }),
    ]);

    expect(deduction).toMatchObject({
      findingId: 'finding-fallback',
      severity: 'high',
      points: 10,
    });
    expect(deduction).not.toHaveProperty('rootCauseId');
  });

  it('treats empty rootCauseId as absent and keeps different finding IDs separate', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-a', severity: 'high', rootCauseId: '' }),
        createFinding({ id: 'finding-b', severity: 'warning', rootCauseId: '' }),
      ],
    });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(87);
    expect(result.deductions.every((deduction) => !('rootCauseId' in deduction))).toBe(true);
  });

  it('collapses duplicate finding IDs without rootCauseId into one fallback group', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-duplicate', severity: 'high' }),
        createFinding({ id: 'finding-duplicate', severity: 'warning' }),
      ],
    });

    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]).toMatchObject({ findingId: 'finding-duplicate', points: 10 });
  });

  it('collapses duplicate findings with one non-empty rootCauseId into one group', () => {
    const finding = createFinding({
      id: 'finding-duplicate',
      severity: 'high',
      rootCauseId: 'root',
    });

    const result = calculateScore({ findings: [finding, finding] });

    expect(result.deductions).toHaveLength(1);
    expect(result.finalScore).toBe(90);
  });

  it('keeps one finding ID with two distinct non-empty rootCauseIds in separate groups', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'finding-same', severity: 'high', rootCauseId: 'root-a' }),
        createFinding({ id: 'finding-same', severity: 'warning', rootCauseId: 'root-b' }),
      ],
    });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(87);
  });

  it('keeps a root-cause group separate from a fallback finding ID with identical text', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'root-collision', severity: 'high', rootCauseId: 'root-collision' }),
        createFinding({ id: 'root-collision', severity: 'warning' }),
      ],
    });

    expect(result.deductions).toHaveLength(2);
    expect(result.finalScore).toBe(87);
  });

  it('retains one zero-point deduction for an info-only group', () => {
    const result = calculateScore({
      findings: [
        createFinding({ id: 'info-one', severity: 'info', rootCauseId: 'root-info' }),
        createFinding({ id: 'info-two', severity: 'info', rootCauseId: 'root-info' }),
      ],
    });

    expect(result.deductions).toEqual([
      expect.objectContaining({ severity: 'info', points: 0, rootCauseId: 'root-info' }),
    ]);
    expect(result.finalScore).toBe(100);
  });

  it('uses grouped deductions only when calculating and clamping the final score', () => {
    const findings = [
      ...Array.from({ length: 6 }, (_, index) =>
        createFinding({
          id: `critical-${index}`,
          severity: 'critical',
          rootCauseId: `root-${index}`,
        }),
      ),
      createFinding({ id: 'warning-same-root', severity: 'warning', rootCauseId: 'root-0' }),
    ];

    const result = calculateScore({ findings });

    expect(result.deductions).toHaveLength(6);
    expect(result.finalScore).toBe(0);
  });

  it('orders grouped deductions by severity and representative context', () => {
    const result = calculateScore({
      findings: [
        createFinding({
          id: 'info',
          ruleId: 'z.rule',
          severity: 'info',
          rootCauseId: 'root-info',
          location: { repositoryId: 'repo-z', file: 'z.ts' },
        }),
        createFinding({
          id: 'warning',
          ruleId: 'a.rule',
          severity: 'warning',
          rootCauseId: 'root-warning',
          location: { repositoryId: 'repo-z', file: 'z.ts' },
        }),
        createFinding({
          id: 'high-b',
          ruleId: 'same.rule',
          severity: 'high',
          rootCauseId: 'root-b',
          location: { repositoryId: 'repo-b', file: 'b.ts' },
        }),
        createFinding({
          id: 'high-a',
          ruleId: 'same.rule',
          severity: 'high',
          rootCauseId: 'root-a',
          location: { repositoryId: 'repo-a', file: 'a.ts' },
        }),
        createFinding({
          id: 'critical',
          ruleId: 'z.rule',
          severity: 'critical',
          rootCauseId: 'root-critical',
          location: { repositoryId: 'repo-z', file: 'z.ts' },
        }),
      ],
    });

    expect(result.deductions.map((deduction) => deduction.findingId)).toEqual([
      'critical',
      'high-a',
      'high-b',
      'warning',
      'info',
    ]);
  });

  it('is deterministic across repeated and reversed inputs without relying on group insertion order', () => {
    const findings = [
      createFinding({ id: 'finding-warning', severity: 'warning', rootCauseId: 'root-warning' }),
      createFinding({ id: 'finding-critical', severity: 'critical', rootCauseId: 'root-critical' }),
      createFinding({ id: 'finding-high', severity: 'high', rootCauseId: 'root-high' }),
    ];
    const first = calculateScore({ findings });

    expect(calculateScore({ findings })).toEqual(first);
    expect(calculateScore({ findings: [...findings].reverse() })).toEqual(first);
  });

  it('scores safe unknown rule IDs by severity and renders unsafe rule IDs safely', () => {
    const result = calculateScore({
      findings: [
        createFinding({
          id: 'finding-safe-rule',
          ruleId: 'custom.unknown-rule',
          severity: 'high',
          rootCauseId: 'root-safe-rule',
        }),
        createFinding({
          id: 'finding-unsafe-rule',
          ruleId: '/private/path',
          severity: 'warning',
          rootCauseId: 'root-unsafe-rule',
        }),
      ],
    });

    expect(result.deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ findingId: 'finding-safe-rule', points: 10 }),
        expect.objectContaining({
          findingId: 'finding-unsafe-rule',
          points: 3,
          reason: 'Warning finding from rule "unrecognized-rule" deducts 3 points.',
        }),
      ]),
    );
  });

  it('does not leak input content, paths, timestamps, or environment details into reasons', () => {
    const [deduction] = deductionsFor([
      createFinding({
        id: 'finding-safe-reason',
        rootCauseId: 'root-safe-reason',
        location: { repositoryId: 'frontend', file: ABSOLUTE_PATH },
      }),
    ]);
    const reason = deduction?.reason ?? '';

    expect(reason).not.toContain(SOURCE_CONTENT);
    expect(reason).not.toContain(ABSOLUTE_PATH);
    expect(reason).not.toContain('2026-07-22');
    expect(reason).not.toContain('developer-machine');
  });

  it('does not mutate original findings or nested input values', () => {
    const finding = createFinding({ id: 'finding-immutable', rootCauseId: 'root-immutable' });
    const findings = [finding];
    const before = structuredClone({ finding, findings });

    calculateScore({ findings });

    expect({ finding, findings }).toEqual(before);
  });

  it('does not add ignored or contributing finding fields and preserves the ScoreBreakdown shape', () => {
    const result: ScoreBreakdown = calculateScore({
      findings: [
        createFinding({ id: 'finding-shape', severity: 'high', rootCauseId: 'root-shape' }),
      ],
    });
    const [deduction] = result.deductions;

    expect(Object.keys(result).sort()).toEqual(['deductions', 'finalScore', 'initialScore']);
    expect(Object.keys(deduction ?? {}).sort()).toEqual([
      'findingId',
      'points',
      'reason',
      'rootCauseId',
      'severity',
    ]);
    expect(deduction?.points).toBe(SEVERITY_DEDUCTIONS.high);
  });

  it.each([
    ['no findings', [], 100, 'HEALTHY'],
    [
      'a grouped deduction in the healthy range',
      [
        createFinding({ id: 'healthy-high', severity: 'high', rootCauseId: 'root-healthy' }),
        createFinding({ id: 'healthy-warning', severity: 'warning', rootCauseId: 'root-healthy' }),
      ],
      90,
      'HEALTHY',
    ],
    [
      'separate grouped deductions in the review range',
      [
        createFinding({ id: 'review-high-one', severity: 'high', rootCauseId: 'root-review-one' }),
        createFinding({ id: 'review-high-two', severity: 'high', rootCauseId: 'root-review-two' }),
      ],
      80,
      'REVIEW',
    ],
    [
      'separate grouped deductions in the high-risk range',
      [
        createFinding({
          id: 'high-risk-critical-one',
          severity: 'critical',
          rootCauseId: 'root-high-risk-one',
        }),
        createFinding({
          id: 'high-risk-critical-two',
          severity: 'critical',
          rootCauseId: 'root-high-risk-two',
        }),
      ],
      60,
      'HIGH_RISK',
    ],
    [
      'separate grouped deductions in the critical-risk range',
      [
        createFinding({
          id: 'critical-risk-one',
          severity: 'critical',
          rootCauseId: 'root-critical-risk-one',
        }),
        createFinding({
          id: 'critical-risk-two',
          severity: 'critical',
          rootCauseId: 'root-critical-risk-two',
        }),
        createFinding({
          id: 'critical-risk-three',
          severity: 'critical',
          rootCauseId: 'root-critical-risk-three',
        }),
      ],
      40,
      'CRITICAL_RISK',
    ],
    [
      'a calculator score clamped at zero',
      Array.from({ length: 6 }, (_, index) =>
        createFinding({
          id: `clamped-critical-${index}`,
          severity: 'critical',
          rootCauseId: `root-clamped-${index}`,
        }),
      ),
      0,
      'CRITICAL_RISK',
    ],
  ] as const)(
    'maps calculator output for %s',
    (_scenario, findings, expectedScore, expectedLabel) => {
      const breakdown = calculateScore({ findings });
      const label = scoreToHealthLabel(breakdown.finalScore);

      expect(breakdown.finalScore).toBe(expectedScore);
      expect(label).toBe(expectedLabel);
    },
  );

  it('applies root-cause grouping before mapping the final score to a label', () => {
    const groupedFindings = [
      createFinding({ id: 'grouped-critical', severity: 'critical', rootCauseId: 'root-shared' }),
      createFinding({ id: 'grouped-high', severity: 'high', rootCauseId: 'root-shared' }),
    ];
    const separateFindings = [
      createFinding({
        id: 'separate-critical',
        severity: 'critical',
        rootCauseId: 'root-critical',
      }),
      createFinding({ id: 'separate-high', severity: 'high', rootCauseId: 'root-high' }),
    ];
    const groupedBreakdown = calculateScore({ findings: groupedFindings });
    const separateBreakdown = calculateScore({ findings: separateFindings });

    expect(groupedBreakdown.finalScore).toBe(80);
    expect(scoreToHealthLabel(groupedBreakdown.finalScore)).toBe('REVIEW');
    expect(separateBreakdown.finalScore).toBe(70);
    expect(scoreToHealthLabel(separateBreakdown.finalScore)).toBe('HIGH_RISK');
  });

  it('maps repeated and reversed calculator inputs to the same score and label', () => {
    const findings = [
      createFinding({
        id: 'repeat-warning',
        severity: 'warning',
        rootCauseId: 'root-repeat-warning',
      }),
      createFinding({
        id: 'repeat-critical',
        severity: 'critical',
        rootCauseId: 'root-repeat-critical',
      }),
      createFinding({ id: 'repeat-high', severity: 'high', rootCauseId: 'root-repeat-high' }),
    ];
    const firstBreakdown = calculateScore({ findings });
    const first = {
      finalScore: firstBreakdown.finalScore,
      label: scoreToHealthLabel(firstBreakdown.finalScore),
    };
    const repeatedBreakdown = calculateScore({ findings });
    const reversedBreakdown = calculateScore({ findings: [...findings].reverse() });

    expect({
      finalScore: repeatedBreakdown.finalScore,
      label: scoreToHealthLabel(repeatedBreakdown.finalScore),
    }).toEqual(first);
    expect({
      finalScore: reversedBreakdown.finalScore,
      label: scoreToHealthLabel(reversedBreakdown.finalScore),
    }).toEqual(first);
  });

  it('does not mutate findings while producing a score and health label', () => {
    const finding = createFinding({
      id: 'label-immutable',
      severity: 'high',
      rootCauseId: 'root-label-immutable',
    });
    const findings = [finding];
    const before = structuredClone({ finding, findings });

    const breakdown = calculateScore({ findings });
    const label = scoreToHealthLabel(breakdown.finalScore);

    expect(breakdown.finalScore).toBe(90);
    expect(label).toBe('HEALTHY');
    expect({ finding, findings }).toEqual(before);
  });
});
