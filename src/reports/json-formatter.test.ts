import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { formatJson } from './json-formatter.js';
import type { AnalysisFinding } from '../types/findings.js';
import type { PRHealthReport, ScoreDeduction } from '../types/reports.js';
import type { GeneratedTest } from '../types/tests.js';

function createDeduction(overrides: Partial<ScoreDeduction> = {}): ScoreDeduction {
  return {
    findingId: 'finding-default',
    rootCauseId: 'root-default',
    severity: 'high',
    points: 10,
    reason: 'High finding deducts 10 points.',
    ...overrides,
  };
}

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-default',
    ruleId: 'contract.required-mismatch',
    rootCauseId: 'root-default',
    source: 'contract-checker',
    category: 'contract',
    severity: 'high',
    title: 'Required field differs',
    description: 'The API requires title but the payload makes it optional.',
    location: { repositoryId: 'frontend', file: 'src/books.ts', startLine: 18 },
    evidence: {
      expected: 'required: title',
      actual: 'title?: string',
      codeSnippet: 'type Payload = { title?: string };',
      details: { property: 'title', expectedRequired: true, actualRequired: false },
    },
    recommendation: 'Make title required in the payload.',
    relatedFindingIds: ['finding-related-b', 'finding-related-a'],
    metadata: { zebra: 'preserve-first', alpha: 'preserve-second', nested: { state: 'safe' } },
    ...overrides,
  };
}

function createGeneratedTest(overrides: Partial<GeneratedTest> = {}): GeneratedTest {
  return {
    id: 'test-default',
    framework: 'vitest',
    title: 'Reject missing title',
    rationale: 'The required contract field needs a regression test.',
    filePath: 'src/books.test.ts',
    code: 'it("rejects missing title", () => {\n  expect(validate({})).toBe(false);\n});',
    relatedFindingIds: ['finding-related-b', 'finding-related-a'],
    ...overrides,
  };
}

function createReport(overrides: Partial<PRHealthReport> = {}): PRHealthReport {
  return {
    version: '1.0',
    analysisId: 'analysis-0123456789abcdef',
    generatedAt: '2026-07-22T16:30:00.000Z',
    source: { type: 'local', label: 'Local Git Repositories' },
    repositories: [
      { repositoryId: 'backend', role: 'backend', baseRef: 'main', headRef: 'abc123' },
      { repositoryId: 'frontend', role: 'frontend', baseRef: 'develop', headRef: 'def456' },
    ],
    healthScore: 90,
    healthLabel: 'HEALTHY',
    scoreBreakdown: {
      initialScore: 100,
      finalScore: 90,
      deductions: [createDeduction()],
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
    findings: [createFinding()],
    generatedTests: [createGeneratedTest()],
    warnings: ['Review the required field.'],
    ...overrides,
  };
}

function parseFormattedReport(report: PRHealthReport): Record<string, unknown> {
  return JSON.parse(formatJson(report)) as Record<string, unknown>;
}

function expectObjectKeys(value: unknown, expected: string[]): void {
  expect(Object.keys(value as object)).toEqual(expected);
}

function reportWithMetadata(value: unknown, key = 'unsafe'): PRHealthReport {
  return createReport({ findings: [createFinding({ metadata: { [key]: value } })] });
}

describe('formatJson', () => {
  it('exports a synchronous formatter that returns parseable semantically equivalent JSON', () => {
    const report = createReport();
    const json = formatJson(report);

    expect(typeof formatJson).toBe('function');
    expect(typeof json).toBe('string');
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it('uses two-space indentation, one final LF, no BOM, and UTF-8-compatible JSON text', () => {
    const json = formatJson(createReport());

    expect(json).toContain('\n  "version": "1.0"');
    expect(json).toContain('\n    "type": "local"');
    expect(json.endsWith('\n')).toBe(true);
    expect(json.endsWith('\n\n')).toBe(false);
    expect(json.charCodeAt(0)).not.toBe(0xfeff);
    expect(Buffer.from(json, 'utf8').toString('utf8')).toBe(json);
  });

  it('is byte-identical for repeated calls and preserves supplied ID and timestamp without reading the clock', () => {
    const report = createReport({
      analysisId: 'analysis-supplied-id',
      generatedAt: '2026-07-23T01:02:03.000Z',
    });
    const dateNow = vi.spyOn(Date, 'now');

    try {
      const first = formatJson(report);
      const second = formatJson(report);

      expect(second).toBe(first);
      expect(JSON.parse(first)).toMatchObject({
        analysisId: 'analysis-supplied-id',
        generatedAt: '2026-07-23T01:02:03.000Z',
        version: '1.0',
      });
      expect(dateNow).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
    }
  });

  it('uses the fixed report and known nested-object field order', () => {
    const parsed = parseFormattedReport(createReport());
    const source = parsed.source as Record<string, unknown>;
    const repositories = parsed.repositories as Array<Record<string, unknown>>;
    const scoreBreakdown = parsed.scoreBreakdown as Record<string, unknown>;
    const deductions = scoreBreakdown.deductions as Array<Record<string, unknown>>;
    const summary = parsed.summary as Record<string, unknown>;
    const findings = parsed.findings as Array<Record<string, unknown>>;
    const generatedTests = parsed.generatedTests as Array<Record<string, unknown>>;

    expect(parsed.version).toBe('1.0');
    expectObjectKeys(parsed, [
      'version',
      'analysisId',
      'generatedAt',
      'source',
      'repositories',
      'healthScore',
      'healthLabel',
      'scoreBreakdown',
      'summary',
      'findings',
      'generatedTests',
      'warnings',
    ]);
    expectObjectKeys(source, ['type', 'label']);
    expectObjectKeys(repositories[0], ['repositoryId', 'role', 'baseRef', 'headRef']);
    expectObjectKeys(scoreBreakdown, ['initialScore', 'finalScore', 'deductions']);
    expectObjectKeys(deductions[0], ['findingId', 'rootCauseId', 'severity', 'points', 'reason']);
    expectObjectKeys(summary, [
      'totalCount',
      'criticalCount',
      'highCount',
      'warningCount',
      'infoCount',
      'riskCount',
      'contractCount',
      'testingCount',
    ]);
    expectObjectKeys(findings[0], [
      'id',
      'ruleId',
      'rootCauseId',
      'source',
      'category',
      'severity',
      'title',
      'description',
      'location',
      'evidence',
      'recommendation',
      'relatedFindingIds',
      'metadata',
    ]);
    expectObjectKeys(generatedTests[0], [
      'id',
      'framework',
      'title',
      'rationale',
      'filePath',
      'code',
      'relatedFindingIds',
    ]);
  });

  it('preserves every supplied report and nested-array order without sorting or deduplicating', () => {
    const report = createReport({
      repositories: [
        { repositoryId: 'z-repository', role: 'frontend', baseRef: 'z-base', headRef: 'z-head' },
        { repositoryId: 'a-repository', role: 'backend', baseRef: 'a-base', headRef: 'a-head' },
      ],
      scoreBreakdown: {
        initialScore: 100,
        finalScore: 87,
        deductions: [
          createDeduction({ findingId: 'deduction-z', reason: 'Z deduction.' }),
          createDeduction({ findingId: 'deduction-a', reason: 'A deduction.' }),
        ],
      },
      findings: [
        createFinding({ id: 'finding-z', relatedFindingIds: ['z', 'a', 'z'] }),
        createFinding({ id: 'finding-a', relatedFindingIds: ['b', 'a'] }),
      ],
      generatedTests: [
        createGeneratedTest({ id: 'test-z', relatedFindingIds: ['z', 'a'] }),
        createGeneratedTest({ id: 'test-a', relatedFindingIds: ['b', 'a'] }),
      ],
      warnings: ['z warning', 'a warning', 'z warning'],
    });
    const parsed = parseFormattedReport(report);

    expect(
      (parsed.repositories as Array<Record<string, unknown>>).map(
        ({ repositoryId }) => repositoryId,
      ),
    ).toEqual(['z-repository', 'a-repository']);
    expect(
      (
        (parsed.scoreBreakdown as Record<string, unknown>).deductions as Array<
          Record<string, unknown>
        >
      ).map(({ findingId }) => findingId),
    ).toEqual(['deduction-z', 'deduction-a']);
    expect((parsed.findings as Array<Record<string, unknown>>).map(({ id }) => id)).toEqual([
      'finding-z',
      'finding-a',
    ]);
    expect((parsed.generatedTests as Array<Record<string, unknown>>).map(({ id }) => id)).toEqual([
      'test-z',
      'test-a',
    ]);
    expect(parsed.warnings).toEqual(['z warning', 'a warning', 'z warning']);
    expect((parsed.findings as Array<Record<string, unknown>>)[0]?.relatedFindingIds).toEqual([
      'z',
      'a',
      'z',
    ]);
  });

  it('serializes empty collections and every health label', () => {
    const emptyReport = createReport({
      repositories: [],
      scoreBreakdown: { initialScore: 100, finalScore: 100, deductions: [] },
      findings: [],
      generatedTests: [],
      warnings: [],
    });
    const parsedEmpty = parseFormattedReport(emptyReport);

    expect(parsedEmpty.repositories).toEqual([]);
    expect((parsedEmpty.scoreBreakdown as Record<string, unknown>).deductions).toEqual([]);
    expect(parsedEmpty.findings).toEqual([]);
    expect(parsedEmpty.generatedTests).toEqual([]);
    expect(parsedEmpty.warnings).toEqual([]);

    for (const healthLabel of ['HEALTHY', 'REVIEW', 'HIGH_RISK', 'CRITICAL_RISK'] as const) {
      expect(parseFormattedReport(createReport({ healthLabel })).healthLabel).toBe(healthLabel);
    }
  });

  it('omits optional undefined object properties without converting them to null', () => {
    const finding = createFinding({ metadata: { kept: 'value', omitted: undefined } });
    delete finding.rootCauseId;
    delete finding.location;
    delete finding.evidence;
    delete finding.recommendation;
    delete finding.relatedFindingIds;
    const generatedTest = createGeneratedTest();
    delete generatedTest.filePath;
    delete generatedTest.code;
    const parsed = parseFormattedReport(
      createReport({ findings: [finding], generatedTests: [generatedTest] }),
    );
    const parsedFinding = (parsed.findings as Array<Record<string, unknown>>)[0] ?? {};
    const parsedMetadata = parsedFinding.metadata as Record<string, unknown>;
    const parsedTest = (parsed.generatedTests as Array<Record<string, unknown>>)[0] ?? {};

    expect(parsedFinding).not.toHaveProperty('rootCauseId');
    expect(parsedFinding).not.toHaveProperty('location');
    expect(parsedFinding).not.toHaveProperty('evidence');
    expect(parsedFinding).not.toHaveProperty('recommendation');
    expect(parsedFinding).not.toHaveProperty('relatedFindingIds');
    expect(parsedMetadata).toEqual({ kept: 'value' });
    expect(parsedMetadata).not.toHaveProperty('omitted');
    expect(parsedTest).not.toHaveProperty('filePath');
    expect(parsedTest).not.toHaveProperty('code');
  });

  it('uses normal JSON escaping while preserving Unicode, HTML-like strings, metadata, evidence details, and generated code semantically', () => {
    const text = 'Emoji 😀 "quote" \\ slash\nline\tcontrol\u0001 <details>&/';
    const generatedCode = 'const fence = ````;\n</details><script>&/';
    const report = createReport({
      source: { type: 'github', label: text },
      findings: [
        createFinding({
          title: text,
          description: text,
          evidence: {
            expected: text,
            actual: text,
            codeSnippet: generatedCode,
            details: { zebra: 'first', alpha: 'second', text },
          },
          metadata: { zebra: 'first', alpha: 'second', html: '<script>&/' },
        }),
      ],
      generatedTests: [createGeneratedTest({ code: generatedCode })],
    });
    const json = formatJson(report);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const parsedFinding = (parsed.findings as Array<Record<string, unknown>>)[0] ?? {};
    const parsedEvidence = parsedFinding.evidence as Record<string, unknown>;

    expect(json).toContain('😀');
    expect(json).toContain('\\"quote\\"');
    expect(json).toContain('\\\\ slash');
    expect(json).toContain('\\nline\\tcontrol\\u0001');
    expect(json).toContain('<details>&/');
    expect(json).not.toContain('&lt;details&gt;');
    expect((parsed.source as Record<string, unknown>).label).toBe(text);
    expect(parsedFinding.metadata).toEqual({ zebra: 'first', alpha: 'second', html: '<script>&/' });
    expect(parsedEvidence.details).toEqual({ zebra: 'first', alpha: 'second', text });
    expect((parsed.generatedTests as Array<Record<string, unknown>>)[0]?.code).toBe(generatedCode);
    expect(Object.keys(parsedFinding.metadata as object)).toEqual(['zebra', 'alpha', 'html']);
    expect(Object.keys(parsedEvidence.details as object)).toEqual(['zebra', 'alpha', 'text']);
  });

  it('does not mutate report arrays, known objects, or arbitrary records', () => {
    const report = createReport({
      findings: [createFinding({ metadata: { nested: { values: ['z', 'a'] } } })],
      warnings: ['z warning', 'a warning'],
    });
    const before = structuredClone(report);

    formatJson(report);

    expect(report).toEqual(before);
  });

  it.each([
    ['wrong version', (report: PRHealthReport) => ({ ...report, version: '2.0' })],
    ['invalid timestamp', (report: PRHealthReport) => ({ ...report, generatedAt: 'not-a-date' })],
    ['invalid health label', (report: PRHealthReport) => ({ ...report, healthLabel: 'LOW_RISK' })],
    [
      'non-finite fixed health score',
      (report: PRHealthReport) => ({ ...report, healthScore: NaN }),
    ],
  ])('propagates a Zod validation error for %s', (_description, makeInvalidReport) => {
    const invalidReport = makeInvalidReport(createReport()) as unknown as PRHealthReport;

    expect(() => formatJson(invalidReport)).toThrow(ZodError);
  });

  it.each([
    ['bigint', 1n, 'bigint'],
    ['function', () => 'not serialized', 'function'],
    ['symbol', Symbol('unsafe'), 'symbol'],
    ['NaN', Number.NaN, 'non-finite number'],
    ['Infinity', Number.POSITIVE_INFINITY, 'non-finite number'],
    ['Date', new Date('2026-07-22T16:30:00.000Z'), 'Date'],
    ['Map', new Map([['key', 'value']]), 'Map'],
    ['Set', new Set(['value']), 'Set'],
    ['RegExp', /secret/gu, 'RegExp'],
    ['Buffer', Buffer.from('value'), 'Buffer'],
    ['typed array', new Uint8Array([1, 2, 3]), 'typed array'],
  ])('rejects %s inside metadata before JSON.stringify', (_description, value, category) => {
    expect(() => formatJson(reportWithMetadata(value))).toThrow(
      `Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe: ${category}.`,
    );
  });

  it('rejects a class instance and non-finite evidence details with their safe paths', () => {
    class UnsafeMetadata {
      readonly value = 'unsafe';
    }

    expect(() => formatJson(reportWithMetadata(new UnsafeMetadata()))).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe: class instance.',
    );
    expect(() =>
      formatJson(
        createReport({
          findings: [
            createFinding({
              evidence: { expected: 'value', details: { count: Number.NEGATIVE_INFINITY } },
            }),
          ],
        }),
      ),
    ).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].evidence.details.count: non-finite number.',
    );
  });

  it('rejects undefined array elements and arrays with lossy holes or properties', () => {
    expect(() => formatJson(reportWithMetadata(['safe', undefined]))).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe[1]: undefined array element.',
    );

    const sparse = new Array<unknown>(2);
    sparse[0] = 'safe';
    expect(() => formatJson(reportWithMetadata(sparse))).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe[1]: array hole.',
    );

    const withProperty = ['safe'] as string[] & { note?: string };
    withProperty.note = 'would be lost';
    expect(() => formatJson(reportWithMetadata(withProperty))).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe.note: array property.',
    );
  });

  it('rejects circular references but permits shared non-circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => formatJson(reportWithMetadata(circular))).toThrow(
      'Report contains a non-JSON-safe value at $.findings[0].metadata.unsafe.self: circular reference.',
    );

    const shared = { label: 'shared value' };
    const parsed = parseFormattedReport(
      createReport({ findings: [createFinding({ metadata: { left: shared, right: shared } })] }),
    );
    const metadata = ((parsed.findings as Array<Record<string, unknown>>)[0] ?? {}).metadata;

    expect(metadata).toEqual({ left: { label: 'shared value' }, right: { label: 'shared value' } });
  });

  it('does not expose rejected values in preflight errors', () => {
    const secret = 'private-value-that-must-not-appear';
    let thrown: unknown;

    try {
      formatJson(reportWithMetadata(() => secret, 'callback'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('$.findings[0].metadata.callback');
    expect((thrown as Error).message).toContain('function');
    expect((thrown as Error).message).not.toContain(secret);
  });
});
