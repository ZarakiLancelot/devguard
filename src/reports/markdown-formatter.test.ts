import { describe, expect, it } from 'vitest';
import { formatMarkdown } from './markdown-formatter.js';
import type { AnalysisFinding } from '../types/findings.js';
import type { PRHealthReport, ScoreDeduction } from '../types/reports.js';
import type { GeneratedTest } from '../types/tests.js';

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
    relatedFindingIds: ['finding-related'],
    metadata: { privateMetadata: 'do-not-render' },
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

function createReport(overrides: Partial<PRHealthReport> = {}): PRHealthReport {
  const warningDeduction = createDeduction({
    findingId: 'finding-warning',
    severity: 'warning',
    points: 3,
    reason: 'Warning needs review.',
  });
  delete warningDeduction.rootCauseId;

  const testingFinding = createFinding({
    id: 'finding-testing',
    severity: 'warning',
    category: 'testing',
    ruleId: 'risk.missing-related-tests',
    title: 'Related test missing',
  });
  delete testingFinding.evidence;
  delete testingFinding.recommendation;

  const informationalFinding = createFinding({
    id: 'finding-info',
    severity: 'info',
    category: 'contract',
    title: 'Informational finding',
  });
  delete informationalFinding.location;

  return {
    version: '1.0',
    analysisId: 'analysis-0123456789abcdef',
    generatedAt: '2026-07-22T16:30:00.000Z',
    source: { type: 'local', label: 'Local Git Repositories' },
    repositories: [
      { repositoryId: 'backend', role: 'backend', baseRef: 'main', headRef: 'abc123' },
      { repositoryId: 'frontend', role: 'frontend', baseRef: 'develop', headRef: 'def456' },
    ],
    healthScore: 67,
    healthLabel: 'HIGH_RISK',
    scoreBreakdown: {
      initialScore: 100,
      finalScore: 67,
      deductions: [
        createDeduction({
          severity: 'critical',
          points: 20,
          reason: 'Critical contract mismatch.',
        }),
        warningDeduction,
      ],
    },
    summary: {
      totalCount: 4,
      criticalCount: 1,
      highCount: 1,
      warningCount: 1,
      infoCount: 1,
      riskCount: 1,
      contractCount: 2,
      testingCount: 1,
    },
    findings: [
      createFinding({
        id: 'finding-critical',
        severity: 'critical',
        category: 'contract',
        title: 'Critical contract mismatch',
      }),
      createFinding({
        id: 'finding-risk',
        severity: 'high',
        category: 'risk',
        ruleId: 'risk.sensitive-file-change',
        title: 'Sensitive file changed',
        location: { repositoryId: 'backend', file: 'config/auth.ts' },
      }),
      testingFinding,
      informationalFinding,
    ],
    generatedTests: [
      createGeneratedTest({
        id: 'test-vitest',
        framework: 'vitest',
        title: 'Verify request payload',
        filePath: 'src/book.test.ts',
        code: 'describe("book", () => {\n  it("sends title", () => {});\n});',
      }),
      createGeneratedTest({
        id: 'test-scenario',
        framework: 'scenario-only',
        title: 'Review deployment behavior',
        relatedFindingIds: [],
      }),
    ],
    warnings: ['Unsupported property was skipped.', 'Review generated test coverage.'],
    ...overrides,
  };
}

function sectionIndex(markdown: string, heading: string): number {
  return markdown.indexOf(heading);
}

describe('formatMarkdown', () => {
  it('returns a string in the exact required section order', () => {
    const markdown = formatMarkdown(createReport());
    const headings = [
      '# DevGuard PR Health Report',
      '## Source',
      '## Repository Comparisons',
      '## Health Score',
      '## Summary',
      '## Findings',
      '## Suggested Tests',
      '## Warnings and Limitations',
    ];

    expect(typeof markdown).toBe('string');
    for (const [index, heading] of headings.entries()) {
      expect(sectionIndex(markdown, heading)).toBeGreaterThan(
        index === 0 ? -1 : sectionIndex(markdown, headings[index - 1] ?? ''),
      );
    }
  });

  it('renders source, repositories, score presentation, deductions, and every summary field', () => {
    const markdown = formatMarkdown(createReport());

    expect(markdown).toContain('- Type: local');
    expect(markdown).toContain('- Label: Local Git Repositories');
    expect(markdown).toContain(String.raw`- Analysis ID: analysis\-0123456789abcdef`);
    expect(markdown).toContain(String.raw`- Generated At: 2026\-07\-22T16:30:00\.000Z`);
    expect(markdown).toContain(String.raw`- Report Version: 1\.0`);
    expect(markdown).toContain('- backend (backend): main → abc123');
    expect(markdown).toContain('- frontend (frontend): develop → def456');
    expect(markdown).toContain('- Score: 67 / 100');
    expect(markdown).toContain('- Status: HIGH RISK');
    expect(markdown).toContain('- Initial Score: 100');
    expect(markdown).toContain('- Deducted Points: 23');
    expect(markdown).toContain('### Deductions');
    expect(markdown.indexOf('CRITICAL: 20 points')).toBeLessThan(
      markdown.indexOf('WARNING: 3 points'),
    );
    expect(markdown).toContain('- Total: 4');
    expect(markdown).toContain('- Critical: 1');
    expect(markdown).toContain('- High: 1');
    expect(markdown).toContain('- Warning: 1');
    expect(markdown).toContain('- Info: 1');
    expect(markdown).toContain('- Contract: 2');
    expect(markdown).toContain('- Risk: 1');
    expect(markdown).toContain('- Testing: 1');
  });

  it.each([
    ['HIGH_RISK', 'HIGH RISK'],
    ['CRITICAL_RISK', 'CRITICAL RISK'],
  ] as const)('renders %s only as presentation label %s', (healthLabel, displayLabel) => {
    const report = createReport({ healthLabel });
    const markdown = formatMarkdown(report);

    expect(markdown).toContain(`- Status: ${displayLabel}`);
    expect(report.healthLabel).toBe(healthLabel);
  });

  it('renders every finding in supplied report order with supported optional fields', () => {
    const first = createFinding({ id: 'finding-first', severity: 'info', title: 'First finding' });
    const second = createFinding({
      id: 'finding-second',
      severity: 'critical',
      title: 'Second finding',
    });
    const markdown = formatMarkdown(createReport({ findings: [first, second] }));

    expect(markdown.indexOf('### INFO — First finding')).toBeLessThan(
      markdown.indexOf('### CRITICAL — Second finding'),
    );
    expect(markdown).toContain(String.raw`- Rule: contract\.incompatible\-type`);
    expect(markdown).toContain('- Category: contract');
    expect(markdown).toContain(String.raw`- Finding ID: finding\-first`);
    expect(markdown).toContain(String.raw`- Root Cause: root\-default`);
    expect(markdown).toContain(String.raw`- Related Findings: finding\-related`);
    expect(markdown).toContain(String.raw`- Location: frontend:src/book\.ts:4`);
    expect(markdown).toContain(String.raw`**Description**

The contract values differ\.`);
    expect(markdown).toContain(String.raw`**Recommendation**

Align the contract values\.`);
  });

  it.each([
    [{ repositoryId: 'repo', file: 'src/file.ts', startLine: 8 }, 'repo:src/file\\.ts:8'],
    [{ repositoryId: 'repo', file: 'src/file.ts' }, 'repo:src/file\\.ts'],
    [{ repositoryId: '', file: 'src/file.ts', startLine: 8 }, 'src/file\\.ts:8'],
    [{ repositoryId: '', file: 'src/file.ts' }, 'src/file\\.ts'],
    [{ repositoryId: 'repo', file: '' }, 'repo'],
  ] as const)('renders useful location %o', (location, expected) => {
    const finding = createFinding({ location });

    expect(formatMarkdown(createReport({ findings: [finding] }))).toContain(
      `- Location: ${expected}`,
    );
  });

  it('omits unusable locations and absent optional finding content', () => {
    const finding = createFinding({ id: 'finding-minimal', relatedFindingIds: [] });
    delete finding.location;
    delete finding.rootCauseId;
    delete finding.recommendation;
    delete finding.evidence;

    const markdown = formatMarkdown(
      createReport({
        findings: [finding],
        generatedTests: [],
        scoreBreakdown: { initialScore: 100, finalScore: 100, deductions: [] },
      }),
    );

    expect(markdown).not.toContain('- Location:');
    expect(markdown).not.toContain('- Root Cause:');
    expect(markdown).not.toContain('- Related Findings:');
    expect(markdown).not.toContain('**Recommendation**');
    expect(markdown).not.toContain('**Evidence**');
  });

  it('renders two-sided and one-sided evidence in a dynamic fenced diff without exposing excluded evidence', () => {
    const expectedOnly = createFinding({
      id: 'expected-only',
      evidence: {
        expected: 'first\n```\n<raw>',
        codeSnippet: 'private snippet',
        details: { raw: 'private' },
      },
      metadata: { raw: 'private metadata' },
    });
    const actualOnly = createFinding({ id: 'actual-only', evidence: { actual: 'actual value' } });
    const withoutEvidence = createFinding({ id: 'without-evidence' });
    delete withoutEvidence.evidence;

    const markdown = formatMarkdown(
      createReport({ findings: [expectedOnly, actualOnly, withoutEvidence] }),
    );

    expect(markdown).toContain('**Evidence**');
    expect(markdown).toContain('- Expected: first');
    expect(markdown).toMatch(/^-\s+```$/mu);
    expect(markdown).toContain('&lt;raw&gt;');
    expect(markdown).toContain('+ Actual: actual value');
    expect(markdown).not.toContain('private snippet');
    expect(markdown).not.toContain('private metadata');
    expect(markdown.match(/\*\*Evidence\*\*/gu)).toHaveLength(2);
    expect(markdown).toContain('````diff');
  });

  it('renders generated tests in report order, including scenario-only entries without code or paths', () => {
    const generatedTests = [
      createGeneratedTest({
        id: 'scenario',
        framework: 'scenario-only',
        title: 'Scenario first',
        relatedFindingIds: [],
      }),
      createGeneratedTest({
        id: 'vitest',
        framework: 'vitest',
        title: 'Vitest second',
        filePath: 'src/test.ts',
      }),
    ];
    const markdown = formatMarkdown(createReport({ generatedTests }));

    expect(markdown.indexOf('### Scenario first')).toBeLessThan(
      markdown.indexOf('### Vitest second'),
    );
    expect(markdown).toContain(String.raw`- Framework: scenario\-only`);
    expect(markdown).toContain('- Test ID: scenario');
    expect(markdown).toContain('- Related Findings: None');
    expect(markdown).toContain(String.raw`- File: src/test\.ts`);
    expect(markdown).toContain('**Rationale**');
  });

  it.each([
    ['vitest', 'Vitest', 'typescript'],
    ['jest', 'Jest', 'typescript'],
    ['scenario-only', 'Scenario', 'text'],
  ] as const)(
    'renders %s generated code in the required static details block',
    (framework, display, language) => {
      const code = 'const fence = ````;\n</details>\n# still code';
      const markdown = formatMarkdown(
        createReport({
          generatedTests: [createGeneratedTest({ framework, code })],
        }),
      );

      expect(markdown).toContain(`<summary>Generated ${display} scaffold</summary>`);
      expect(markdown).toContain(`\`\`\`\`\`${language}`);
      expect(markdown).toContain(code);
      expect(markdown.match(/<details>/gu)).toHaveLength(1);
      expect(markdown.match(/<\/details>/gu)).toHaveLength(2);
    },
  );

  it('preserves generated code byte-for-byte inside a dynamic fenced details block', () => {
    const code = '\r\n\tif (ready) {  \r\n\t  const fence = ````;\r\n\t  </details>\r\n\t}\r\n\r\n';
    const markdown = formatMarkdown(
      createReport({
        generatedTests: [createGeneratedTest({ framework: 'vitest', code })],
      }),
    );
    const openingFence = '`````typescript\n';
    const openingFenceStart = markdown.indexOf(openingFence);
    const codeStart = openingFenceStart + openingFence.length;
    const closingFenceStart = codeStart + code.length;
    const embeddedDetailsClose = markdown.indexOf('</details>', codeStart);
    const formatterDetailsClose = markdown.indexOf('</details>', closingFenceStart + 5);

    expect(openingFenceStart).toBeGreaterThanOrEqual(0);
    expect(markdown.slice(codeStart, closingFenceStart)).toBe(code);
    expect(markdown.slice(closingFenceStart, closingFenceStart + 5)).toBe('`````');
    expect(embeddedDetailsClose).toBe(codeStart + code.indexOf('</details>'));
    expect(embeddedDetailsClose).toBeLessThan(closingFenceStart);
    expect(markdown.slice(closingFenceStart + 5, formatterDetailsClose)).toBe('\n\n');
  });
  it('omits details blocks for absent or empty generated code', () => {
    const markdown = formatMarkdown(
      createReport({
        generatedTests: [
          createGeneratedTest({ id: 'none' }),
          createGeneratedTest({ id: 'empty', code: '' }),
        ],
      }),
    );

    expect(markdown).not.toContain('<details>');
  });

  it('renders warnings as ordered escaped bullets and empty collections as exact placeholders', () => {
    const markdown = formatMarkdown(
      createReport({
        repositories: [],
        findings: [],
        generatedTests: [],
        warnings: ['# heading\n<danger>', 'warning *text*'],
        scoreBreakdown: { initialScore: 100, finalScore: 100, deductions: [] },
      }),
    );

    expect(markdown).toContain('## Repository Comparisons\n\n_None._');
    expect(markdown).toContain('### Deductions\n\n_None._');
    expect(markdown).toContain('## Findings\n\n_None._');
    expect(markdown).toContain('## Suggested Tests\n\n_None._');
    expect(markdown).toContain(String.raw`- \# heading
  &lt;danger&gt;`);
    expect(markdown).toContain(String.raw`- warning \*text\*`);
    expect(markdown.indexOf(String.raw`\# heading`)).toBeLessThan(
      markdown.indexOf(String.raw`warning \*text\*`),
    );
    expect(formatMarkdown(createReport({ warnings: [] }))).toContain(
      '## Warnings and Limitations\n\n_None._',
    );
  });

  it('escapes normal text safely, preserves Unicode and multiline structure, and escapes literal backslashes exactly once', () => {
    const hostile = `${String.fromCharCode(92)}path *star* _under_ [link](url) | pipe # heading + plus - dash . dot ! bang ${String.fromCharCode(92)}\r\n<em>HTML</em> 😀\r\n\`\`\` code`;
    const finding = createFinding({
      title: hostile,
      description: hostile,
      recommendation: hostile,
      evidence: { expected: hostile, actual: hostile },
    });
    const markdown = formatMarkdown(
      createReport({
        source: { type: 'local', label: hostile },
        findings: [finding],
        generatedTests: [createGeneratedTest({ title: hostile, rationale: hostile })],
        warnings: [hostile],
      }),
    );

    expect(markdown).toContain('\\\\path');
    expect(markdown).not.toContain('\\\\\\\\path');
    expect(markdown).toContain('\\*star\\*');
    expect(markdown).toContain('\\_under\\_');
    expect(markdown).toContain('\\[link\\]\\(url\\)');
    expect(markdown).toContain('&lt;em&gt;HTML&lt;/em&gt;');
    expect(markdown).toContain('😀');
    expect(markdown).not.toContain('\r');
    expect(markdown).toContain('\\`\\`\\` code');
  });

  it('uses LF only, no trailing spaces, exactly one final newline, and leaves input unchanged', () => {
    const report = createReport({
      findings: [createFinding({ description: 'first line\r\nsecond line  ' })],
      warnings: ['warning  '],
    });
    const before = structuredClone(report);
    const markdown = formatMarkdown(report);

    expect(markdown).not.toContain('\r');
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
    expect(markdown.split('\n').every((line) => !/[ \t]$/u.test(line))).toBe(true);
    expect(formatMarkdown(report)).toBe(markdown);
    expect(report).toEqual(before);
  });

  it('does not correct altered report array order', () => {
    const first = createFinding({ id: 'first', title: 'First' });
    const second = createFinding({ id: 'second', title: 'Second' });
    const report = createReport({ findings: [second, first] });
    const markdown = formatMarkdown(report);

    expect(markdown.indexOf('### HIGH — Second')).toBeLessThan(
      markdown.indexOf('### HIGH — First'),
    );
  });

  it('matches the canonical full-report snapshot', () => {
    expect(formatMarkdown(createReport())).toMatchSnapshot();
  });

  it('matches the empty-collections snapshot', () => {
    expect(
      formatMarkdown(
        createReport({
          repositories: [],
          findings: [],
          generatedTests: [],
          warnings: [],
          scoreBreakdown: { initialScore: 100, finalScore: 100, deductions: [] },
        }),
      ),
    ).toMatchSnapshot();
  });

  it('matches the special-character and fence-safety snapshot', () => {
    const text = '# heading *em* _under_ [link](url) | pipe `tick` <html> 😀\n```\n</details>';

    expect(
      formatMarkdown(
        createReport({
          source: { type: 'github', label: text },
          findings: [
            createFinding({
              title: text,
              description: text,
              recommendation: text,
              evidence: { expected: text, actual: text, codeSnippet: 'omit' },
            }),
          ],
          generatedTests: [
            createGeneratedTest({
              framework: 'jest',
              title: text,
              rationale: text,
              code: '````\n</details>\n# nested fence',
            }),
          ],
          warnings: [text],
        }),
      ),
    ).toMatchSnapshot();
  });
});
