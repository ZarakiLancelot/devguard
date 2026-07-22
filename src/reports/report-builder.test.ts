import { describe, expect, it, vi } from 'vitest';
import { buildReport, type BuildReportInput } from './report-builder.js';
import { prHealthReportSchema } from './report-schema.js';
import type { AnalysisFinding } from '../types/findings.js';
import type { RepositoryContext, RepositoryChangeSet } from '../types/repository.js';
import type { ScoreBreakdown } from '../types/reports.js';
import type { GeneratedTest } from '../types/tests.js';

const FIXED_ANALYSIS_ID = 'analysis-0123456789abcdef';
const FIXED_TIMESTAMP = '2026-07-22T16:30:00.000Z';

function createRepository(overrides: Partial<RepositoryChangeSet> = {}): RepositoryChangeSet {
  return {
    repositoryId: 'frontend',
    repositoryPath: '/private/workspace/frontend',
    role: 'frontend',
    baseRef: 'main',
    headRef: 'feature/reporting',
    changedFiles: [
      {
        repositoryId: 'frontend',
        path: 'src/book.ts',
        status: 'modified',
        patch: 'private patch content',
      },
    ],
    ...overrides,
  };
}

function createContext(overrides: Partial<RepositoryContext> = {}): RepositoryContext {
  return {
    sourceType: 'local',
    sourceLabel: 'Local Git Repositories',
    repositories: [createRepository()],
    files: [
      {
        repositoryId: 'frontend',
        path: 'src/book.ts',
        absolutePath: '/private/workspace/frontend/src/book.ts',
        content: 'const privateSource = true;',
        sizeBytes: 27,
      },
    ],
    requirements: 'private requirements text',
    warnings: [],
    metadata: { absolutePath: '/private/workspace/frontend' },
    ...overrides,
  };
}

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-default',
    ruleId: 'contract.incompatible-type',
    rootCauseId: 'root-default',
    source: 'contract-checker',
    category: 'contract',
    severity: 'high',
    title: 'Contract mismatch',
    description: 'The contract values differ.',
    location: { repositoryId: 'frontend', file: 'src/book.ts', startLine: 4 },
    evidence: { expected: 'string', actual: 'number' },
    recommendation: 'Align the contract values.',
    relatedFindingIds: [],
    metadata: { property: 'title' },
    ...overrides,
  };
}

function createGeneratedTest(overrides: Partial<GeneratedTest> = {}): GeneratedTest {
  return {
    id: 'test-default',
    framework: 'scenario-only',
    title: 'Verify contract behavior',
    rationale: 'The finding requires a regression scenario.',
    relatedFindingIds: ['finding-default'],
    ...overrides,
  };
}

function createScoreBreakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    initialScore: 100,
    finalScore: 90,
    deductions: [
      {
        findingId: 'finding-default',
        rootCauseId: 'root-default',
        severity: 'high',
        points: 10,
        reason: 'High finding deducts 10 points.',
      },
    ],
    ...overrides,
  };
}

function buildInput(
  overrides: {
    context?: RepositoryContext;
    findings?: readonly AnalysisFinding[];
    generatedTests?: readonly GeneratedTest[];
    scoreBreakdown?: ScoreBreakdown;
    warnings?: readonly string[];
    analysisId?: string;
    generatedAt?: string;
  } = {},
): BuildReportInput {
  return {
    analysisId: overrides.analysisId ?? FIXED_ANALYSIS_ID,
    generatedAt: overrides.generatedAt ?? FIXED_TIMESTAMP,
    context: overrides.context ?? createContext(),
    findings: overrides.findings ?? [createFinding()],
    generatedTests: overrides.generatedTests ?? [createGeneratedTest()],
    scoreBreakdown: overrides.scoreBreakdown ?? createScoreBreakdown(),
    ...(overrides.warnings === undefined ? {} : { warnings: overrides.warnings }),
  };
}

describe('buildReport', () => {
  it('builds a complete validated report with fixed version and supplied identifiers', () => {
    const report = buildReport(buildInput());

    expect(report).toMatchObject({
      version: '1.0',
      analysisId: FIXED_ANALYSIS_ID,
      generatedAt: FIXED_TIMESTAMP,
      source: { type: 'local', label: 'Local Git Repositories' },
      healthScore: 90,
      healthLabel: 'HEALTHY',
    });
    expect(prHealthReportSchema.parse(report)).toEqual(report);
    expect(Object.keys(report).sort()).toEqual([
      'analysisId',
      'findings',
      'generatedAt',
      'generatedTests',
      'healthLabel',
      'healthScore',
      'repositories',
      'scoreBreakdown',
      'source',
      'summary',
      'version',
      'warnings',
    ]);
  });

  it('uses only supplied timestamps and never calls Date.now', () => {
    const dateNow = vi.spyOn(Date, 'now');

    try {
      const report = buildReport(buildInput());

      expect(report.generatedAt).toBe(FIXED_TIMESTAMP);
      expect(dateNow).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
    }
  });

  it('maps github source directly from RepositoryContext without copying private context data', () => {
    const report = buildReport(
      buildInput({
        context: createContext({ sourceType: 'github', sourceLabel: 'GitHub Pull Request' }),
      }),
    );

    expect(report.source).toEqual({ type: 'github', label: 'GitHub Pull Request' });
    expect(JSON.stringify(report)).not.toContain('privateSource');
    expect(JSON.stringify(report)).not.toContain('private requirements text');
    expect(JSON.stringify(report)).not.toContain('/private/workspace');
    expect(report).not.toHaveProperty('metadata');
    expect(report).not.toHaveProperty('files');
    expect(report).not.toHaveProperty('requirements');
  });

  it('maps, sorts, structurally deduplicates repository references, and excludes change data', () => {
    const duplicate = createRepository({
      repositoryId: 'backend',
      role: 'backend',
      baseRef: 'main',
    });
    const report = buildReport(
      buildInput({
        context: createContext({
          repositories: [
            createRepository({ repositoryId: 'backend', role: 'backend', baseRef: 'release' }),
            duplicate,
            createRepository({ repositoryId: 'frontend', role: 'frontend' }),
            duplicate,
          ],
        }),
      }),
    );

    expect(report.repositories).toEqual([
      { repositoryId: 'backend', role: 'backend', baseRef: 'main', headRef: 'feature/reporting' },
      {
        repositoryId: 'backend',
        role: 'backend',
        baseRef: 'release',
        headRef: 'feature/reporting',
      },
      {
        repositoryId: 'frontend',
        role: 'frontend',
        baseRef: 'main',
        headRef: 'feature/reporting',
      },
    ]);
    expect(JSON.stringify(report.repositories)).not.toContain('changedFiles');
    expect(JSON.stringify(report.repositories)).not.toContain('private patch content');
  });

  it.each([
    [100, 'HEALTHY'],
    [80, 'REVIEW'],
    [60, 'HIGH_RISK'],
    [40, 'CRITICAL_RISK'],
  ] as const)(
    'composes score %d with health label %s from the supplied breakdown',
    (score, label) => {
      const report = buildReport(
        buildInput({ scoreBreakdown: createScoreBreakdown({ finalScore: score }) }),
      );

      expect(report.healthScore).toBe(score);
      expect(report.healthLabel).toBe(label);
    },
  );

  it('preserves every finding occurrence and globally orders severity, category, location, rule, ID, and root cause', () => {
    const findings = [
      createFinding({
        id: 'same',
        rootCauseId: 'root-z',
        severity: 'high',
        category: 'contract',
        ruleId: 'same.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'testing',
        severity: 'high',
        category: 'testing',
        ruleId: 'a.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'critical',
        severity: 'critical',
        category: 'risk',
        ruleId: 'z.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'same',
        rootCauseId: 'root-a',
        severity: 'high',
        category: 'contract',
        ruleId: 'same.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'rule-z',
        severity: 'high',
        category: 'contract',
        ruleId: 'z.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      createFinding({
        id: 'file-z',
        severity: 'high',
        category: 'contract',
        ruleId: 'a.rule',
        location: { repositoryId: 'repo', file: 'src/z.ts' },
      }),
      createFinding({
        id: 'repo-z',
        severity: 'high',
        category: 'contract',
        ruleId: 'a.rule',
        location: { repositoryId: 'repo-z', file: 'src/a.ts' },
      }),
      createFinding({
        id: 'risk',
        severity: 'high',
        category: 'risk',
        ruleId: 'a.rule',
        location: { repositoryId: 'repo', file: 'src/file.ts' },
      }),
      (() => {
        const finding = createFinding({
          id: 'no-location',
          severity: 'high',
          category: 'contract',
          ruleId: 'a.rule',
        });
        delete finding.location;
        return finding;
      })(),
      createFinding({
        id: 'warning',
        severity: 'warning',
        category: 'contract',
        ruleId: 'a.rule',
      }),
      createFinding({
        id: 'info',
        severity: 'info',
        category: 'contract',
        ruleId: 'a.rule',
      }),
    ];

    const report = buildReport(buildInput({ findings }));

    expect(report.findings.map((finding) => `${finding.id}:${finding.rootCauseId ?? ''}`)).toEqual([
      'critical:root-default',
      'no-location:root-default',
      'same:root-a',
      'same:root-z',
      'rule-z:root-default',
      'file-z:root-default',
      'repo-z:root-default',
      'risk:root-default',
      'testing:root-default',
      'warning:root-default',
      'info:root-default',
    ]);
    expect(report.findings).toHaveLength(findings.length);
    expect(buildReport(buildInput({ findings: [...findings].reverse() })).findings).toEqual(
      report.findings,
    );
  });

  it('computes summary counts from all visible findings rather than score deductions', () => {
    const findings = [
      createFinding({ id: 'critical-contract', severity: 'critical', category: 'contract' }),
      createFinding({ id: 'high-risk', severity: 'high', category: 'risk' }),
      createFinding({ id: 'warning-testing', severity: 'warning', category: 'testing' }),
      createFinding({ id: 'info-contract', severity: 'info', category: 'contract' }),
      createFinding({
        id: 'same-root',
        severity: 'high',
        category: 'contract',
        rootCauseId: 'root-shared',
      }),
    ];
    const report = buildReport(
      buildInput({ findings, scoreBreakdown: createScoreBreakdown({ deductions: [] }) }),
    );

    expect(report.summary).toEqual({
      totalCount: 5,
      criticalCount: 1,
      highCount: 2,
      warningCount: 1,
      infoCount: 1,
      riskCount: 1,
      contractCount: 3,
      testingCount: 1,
    });
    expect(
      report.summary.criticalCount +
        report.summary.highCount +
        report.summary.warningCount +
        report.summary.infoCount,
    ).toBe(report.summary.totalCount);
    expect(
      report.summary.riskCount + report.summary.contractCount + report.summary.testingCount,
    ).toBe(report.summary.totalCount);
  });

  it('sorts generated tests by normalized comparison keys without changing their content or deduplicating them', () => {
    const repeated = createGeneratedTest({
      id: 'test-same',
      framework: 'vitest',
      title: 'Same title',
      relatedFindingIds: ['finding-z', 'finding-a', 'finding-a'],
    });
    const generatedTests = [
      repeated,
      createGeneratedTest({ id: 'test-b', framework: 'vitest', title: 'Beta' }),
      createGeneratedTest({ id: 'test-a', framework: 'jest', title: 'Alpha' }),
      repeated,
    ];

    const report = buildReport(buildInput({ generatedTests }));

    expect(report.generatedTests.map((test) => test.id)).toEqual([
      'test-a',
      'test-b',
      'test-same',
      'test-same',
    ]);
    expect(report.generatedTests[2]?.relatedFindingIds).toEqual([
      'finding-z',
      'finding-a',
      'finding-a',
    ]);
    expect(
      report.generatedTests.every((test) => test.filePath === undefined && test.code === undefined),
    ).toBe(true);
    expect(
      buildReport(buildInput({ generatedTests: [...generatedTests].reverse() })).generatedTests,
    ).toEqual(report.generatedTests);
  });

  it('combines, preserves, deduplicates, and code-point sorts non-empty warnings', () => {
    const report = buildReport(
      buildInput({
        context: createContext({ warnings: ['beta', '  ', 'Alpha', 'beta'] }),
        warnings: ['gamma', '', ' Alpha ', 'gamma'],
      }),
    );

    expect(report.warnings).toEqual([' Alpha ', 'Alpha', 'beta', 'gamma']);
    expect(buildReport(buildInput({ context: createContext(), warnings: [] })).warnings).toEqual(
      [],
    );
  });

  it('does not mutate inputs and creates defensive report-owned arrays and deductions', () => {
    const context = createContext();
    const findings = [createFinding()];
    const generatedTests = [createGeneratedTest()];
    const scoreBreakdown = createScoreBreakdown();
    const warnings = ['warning'];
    const input = buildInput({ context, findings, generatedTests, scoreBreakdown, warnings });
    const before = structuredClone(input);

    const report = buildReport(input);

    expect(input).toEqual(before);
    expect(report.repositories).not.toBe(context.repositories);
    expect(report.findings).not.toBe(findings);
    expect(report.generatedTests).not.toBe(generatedTests);
    expect(report.warnings).not.toBe(warnings);
    expect(report.scoreBreakdown).not.toBe(scoreBreakdown);
    expect(report.scoreBreakdown.deductions).not.toBe(scoreBreakdown.deductions);
    expect(report.scoreBreakdown.deductions[0]).not.toBe(scoreBreakdown.deductions[0]);
    expect(buildReport(input)).toEqual(report);
  });

  it('accepts empty collections and produces a zeroed FindingSummary', () => {
    const report = buildReport(
      buildInput({
        context: createContext({ repositories: [], files: [], warnings: [] }),
        findings: [],
        generatedTests: [],
        warnings: [],
        scoreBreakdown: createScoreBreakdown({ deductions: [] }),
      }),
    );

    expect(report.repositories).toEqual([]);
    expect(report.generatedTests).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.summary).toEqual({
      totalCount: 0,
      criticalCount: 0,
      highCount: 0,
      warningCount: 0,
      infoCount: 0,
      riskCount: 0,
      contractCount: 0,
      testingCount: 0,
    });
  });

  it.each([
    ['an invalid timestamp', buildInput({ generatedAt: 'not-a-timestamp' })],
    ['an empty analysis ID', buildInput({ analysisId: '' })],
  ])('fails validation deterministically for %s', (_description, input) => {
    expect(() => buildReport(input)).toThrow();
  });
});
