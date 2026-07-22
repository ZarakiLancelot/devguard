import type { AnalysisFinding } from '../types/findings.js';
import type { PRHealthReport, ScoreDeduction } from '../types/reports.js';
import type { GeneratedTest, SupportedTestFramework } from '../types/tests.js';

const NONE = '_None._';
const MINIMUM_FENCE_LENGTH = 3;
const MARKDOWN_CONTROL_CHARACTERS = /[`*_{}[\]()#+.!|>-]/gu;

/**
 * Formats one validated PR health report as deterministic Markdown without
 * reading external state or mutating the report.
 */
export function formatMarkdown(report: PRHealthReport): string {
  const sections = [
    '# DevGuard PR Health Report',
    renderSource(report),
    renderRepositoryComparisons(report),
    renderHealthScore(report),
    renderSummary(report),
    renderFindings(report),
    renderSuggestedTests(report),
    renderWarnings(report),
  ];

  return `${sections.join('\n\n').replace(/\n+$/u, '')}\n`;
}

function renderSource(report: PRHealthReport): string {
  return [
    '## Source',
    [
      `- Type: ${escapeInline(report.source.type)}`,
      `- Label: ${escapeInline(report.source.label)}`,
      `- Analysis ID: ${escapeInline(report.analysisId)}`,
      `- Generated At: ${escapeInline(report.generatedAt)}`,
      `- Report Version: ${escapeInline(report.version)}`,
    ].join('\n'),
  ].join('\n\n');
}

function renderRepositoryComparisons(report: PRHealthReport): string {
  const repositories =
    report.repositories.length === 0
      ? NONE
      : report.repositories
          .map(
            (repository) =>
              `- ${escapeInline(repository.repositoryId)} (${escapeInline(repository.role)}): ${escapeInline(repository.baseRef)} → ${escapeInline(repository.headRef)}`,
          )
          .join('\n');

  return ['## Repository Comparisons', repositories].join('\n\n');
}

function renderHealthScore(report: PRHealthReport): string {
  const deductedPoints = report.scoreBreakdown.deductions.reduce(
    (total, deduction) => total + deduction.points,
    0,
  );
  const deductions =
    report.scoreBreakdown.deductions.length === 0
      ? NONE
      : report.scoreBreakdown.deductions.map(renderDeduction).join('\n');

  return [
    '## Health Score',
    [
      `- Score: ${report.healthScore} / 100`,
      `- Status: ${healthLabelDisplay(report.healthLabel)}`,
      `- Initial Score: ${report.scoreBreakdown.initialScore}`,
      `- Deducted Points: ${deductedPoints}`,
    ].join('\n'),
    '### Deductions',
    deductions,
  ].join('\n\n');
}

function renderDeduction(deduction: ScoreDeduction): string {
  const rootCause =
    deduction.rootCauseId === undefined
      ? ''
      : `; Root Cause: ${escapeInline(deduction.rootCauseId)}`;

  return `- ${deduction.severity.toUpperCase()}: ${deduction.points} points — ${escapeInline(deduction.reason)} (Finding ID: ${escapeInline(deduction.findingId)}${rootCause})`;
}

function healthLabelDisplay(label: PRHealthReport['healthLabel']): string {
  switch (label) {
    case 'HEALTHY':
      return 'HEALTHY';
    case 'REVIEW':
      return 'REVIEW';
    case 'HIGH_RISK':
      return 'HIGH RISK';
    case 'CRITICAL_RISK':
      return 'CRITICAL RISK';
  }
}

function renderSummary(report: PRHealthReport): string {
  const summary = report.summary;

  return [
    '## Summary',
    [
      `- Total: ${summary.totalCount}`,
      `- Critical: ${summary.criticalCount}`,
      `- High: ${summary.highCount}`,
      `- Warning: ${summary.warningCount}`,
      `- Info: ${summary.infoCount}`,
      `- Contract: ${summary.contractCount}`,
      `- Risk: ${summary.riskCount}`,
      `- Testing: ${summary.testingCount}`,
    ].join('\n'),
  ].join('\n\n');
}

function renderFindings(report: PRHealthReport): string {
  const findings =
    report.findings.length === 0 ? NONE : report.findings.map(renderFinding).join('\n\n');

  return ['## Findings', findings].join('\n\n');
}

function renderFinding(finding: AnalysisFinding): string {
  const bullets = [
    `- Rule: ${escapeInline(finding.ruleId)}`,
    `- Category: ${escapeInline(finding.category)}`,
    `- Finding ID: ${escapeInline(finding.id)}`,
  ];

  if (finding.rootCauseId !== undefined) {
    bullets.push(`- Root Cause: ${escapeInline(finding.rootCauseId)}`);
  }

  if (finding.relatedFindingIds !== undefined && finding.relatedFindingIds.length > 0) {
    bullets.push(`- Related Findings: ${finding.relatedFindingIds.map(escapeInline).join(', ')}`);
  }

  const location = formatLocation(finding);
  if (location !== undefined) {
    bullets.push(`- Location: ${escapeInline(location)}`);
  }

  const parts = [
    `### ${finding.severity.toUpperCase()} — ${escapeInline(finding.title)}`,
    bullets.join('\n'),
    '**Description**',
    escapeParagraph(finding.description),
  ];

  if (finding.recommendation !== undefined) {
    parts.push('**Recommendation**', escapeParagraph(finding.recommendation));
  }

  if (finding.evidence?.expected !== undefined || finding.evidence?.actual !== undefined) {
    parts.push(
      '**Evidence**',
      renderEvidence(finding.evidence?.expected, finding.evidence?.actual),
    );
  }

  return parts.join('\n\n');
}

function formatLocation(finding: AnalysisFinding): string | undefined {
  const location = finding.location;
  if (location === undefined) {
    return undefined;
  }

  const repositoryId = location.repositoryId;
  const file = location.file;
  const line = location.startLine;

  if (repositoryId.length > 0 && file.length > 0 && line !== undefined) {
    return `${repositoryId}:${file}:${line}`;
  }

  if (repositoryId.length > 0 && file.length > 0) {
    return `${repositoryId}:${file}`;
  }

  if (file.length > 0 && line !== undefined) {
    return `${file}:${line}`;
  }

  if (file.length > 0) {
    return file;
  }

  return repositoryId.length > 0 ? repositoryId : undefined;
}

function renderEvidence(expected: string | undefined, actual: string | undefined): string {
  const lines = [
    ...(expected === undefined ? [] : renderDiffValue('-', 'Expected', expected)),
    ...(actual === undefined ? [] : renderDiffValue('+', 'Actual', actual)),
  ];

  return renderFencedBlock('diff', lines.join('\n'));
}

function renderDiffValue(prefix: '-' | '+', label: string, value: string): string[] {
  const lines = escapeFencedText(value).split('\n');

  return lines.map((line, index) =>
    index === 0
      ? `${prefix} ${label}: ${line}`
      : `${prefix} ${' '.repeat(label.length + 2)}${line}`,
  );
}

function renderSuggestedTests(report: PRHealthReport): string {
  const generatedTests =
    report.generatedTests.length === 0
      ? NONE
      : report.generatedTests.map(renderGeneratedTest).join('\n\n');

  return ['## Suggested Tests', generatedTests].join('\n\n');
}

function renderGeneratedTest(generatedTest: GeneratedTest): string {
  const relatedFindings =
    generatedTest.relatedFindingIds.length === 0
      ? 'None'
      : generatedTest.relatedFindingIds.map(escapeInline).join(', ');
  const bullets = [
    `- Framework: ${escapeInline(generatedTest.framework)}`,
    `- Test ID: ${escapeInline(generatedTest.id)}`,
    `- Related Findings: ${relatedFindings}`,
  ];

  if (generatedTest.filePath !== undefined) {
    bullets.push(`- File: ${escapeInline(generatedTest.filePath)}`);
  }

  const parts = [
    `### ${escapeInline(generatedTest.title)}`,
    bullets.join('\n'),
    '**Rationale**',
    escapeParagraph(generatedTest.rationale),
  ];
  const generatedCode = renderGeneratedCode(generatedTest);

  if (generatedCode !== undefined) {
    parts.push(generatedCode);
  }

  return parts.join('\n\n');
}

function renderGeneratedCodeBlock(language: string, code: string): string {
  const fence = createFence(code);
  const closingNewline = code.endsWith('\n') || code.endsWith('\r') ? '' : '\n';

  return `${fence}${language}\n${code}${closingNewline}${fence}`;
}

function renderGeneratedCode(generatedTest: GeneratedTest): string | undefined {
  if (generatedTest.code === undefined || generatedTest.code.length === 0) {
    return undefined;
  }

  return [
    '<details>',
    `<summary>Generated ${frameworkDisplay(generatedTest.framework)} scaffold</summary>`,
    '',
    renderGeneratedCodeBlock(fenceLanguage(generatedTest.framework), generatedTest.code),
    '',
    '</details>',
  ].join('\n');
}

function frameworkDisplay(framework: SupportedTestFramework): string {
  switch (framework) {
    case 'vitest':
      return 'Vitest';
    case 'jest':
      return 'Jest';
    case 'scenario-only':
      return 'Scenario';
  }
}

function fenceLanguage(framework: SupportedTestFramework): 'typescript' | 'text' {
  return framework === 'scenario-only' ? 'text' : 'typescript';
}

function renderWarnings(report: PRHealthReport): string {
  const warnings =
    report.warnings.length === 0 ? NONE : report.warnings.map(renderWarning).join('\n');

  return ['## Warnings and Limitations', warnings].join('\n\n');
}

function renderWarning(warning: string): string {
  return `- ${escapeParagraph(warning).replace(/\n/gu, '\n  ')}`;
}

function renderFencedBlock(language: string, content: string): string {
  const normalizedContent = normalizeFencedContent(content);
  const fence = createFence(normalizedContent);
  const closingNewline = normalizedContent.endsWith('\n') ? '' : '\n';

  return `${fence}${language}\n${normalizedContent}${closingNewline}${fence}`;
}

function normalizeFencedContent(content: string): string {
  return normalizeNewlines(content)
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/gu, ''))
    .join('\n');
}

function createFence(content: string): string {
  const matches = content.match(/`+/gu) ?? [];
  const longestSequence = matches.reduce(
    (longest, sequence) => Math.max(longest, sequence.length),
    0,
  );

  return '`'.repeat(Math.max(MINIMUM_FENCE_LENGTH, longestSequence + 1));
}

/**
 * Escapes normal Markdown text. Literal input backslashes are escaped before
 * other controls, and the later replacement deliberately excludes backslashes
 * so it cannot double-escape newly inserted escape characters.
 */
function escapeInline(value: string): string {
  return escapeParagraph(value).replace(/\n/gu, '\\n');
}

function escapeParagraph(value: string): string {
  return normalizeNewlines(value)
    .split('\n')
    .map((line) => escapeMarkdownLine(line.replace(/[\t ]+$/gu, '')))
    .join('\n');
}

function escapeMarkdownLine(value: string): string {
  const htmlEscaped = value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
  const backslashEscaped = htmlEscaped.replace(/\\/gu, '\\\\');

  return backslashEscaped.replace(MARKDOWN_CONTROL_CHARACTERS, '\\$&');
}

function escapeFencedText(value: string): string {
  return normalizeNewlines(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}
