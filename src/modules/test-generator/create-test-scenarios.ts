import { generateTestId } from '../../shared/ids.js';
import type { AnalysisFinding, Severity } from '../../types/findings.js';
import type { GeneratedTest, SupportedTestFramework } from '../../types/tests.js';

const DEFAULT_FRAMEWORK: SupportedTestFramework = 'scenario-only';

const TEMPLATE_IDS = {
  'contract.missing-property': 'contract-missing-property-v1',
  'contract.incompatible-type': 'contract-incompatible-type-v1',
  'contract.required-mismatch': 'contract-required-mismatch-v1',
  'risk.missing-related-tests': 'risk-missing-related-tests-v1',
  'risk.sensitive-file-change': 'risk-sensitive-file-change-v1',
} as const;

type SupportedTemplateRuleId = keyof typeof TEMPLATE_IDS;

interface ScenarioContext {
  repositoryId?: string;
  file?: string;
  property?: string;
}

interface ScenarioCandidate {
  generatedTest: GeneratedTest;
  severity: Severity;
  ruleId: string;
  repositoryId: string;
  file: string;
  findingId: string;
  templateId: string;
  identity: string;
}

/**
 * Input for pure, in-memory deterministic test scenario creation.
 */
export interface CreateTestScenariosInput {
  findings: readonly AnalysisFinding[];
  framework?: SupportedTestFramework;
}

/**
 * Creates one structured, non-executable test scenario for each supported
 * finding. It does not read configuration, requirements, repositories, Git,
 * files, environment variables, or source content.
 */
export function createTestScenarios(input: CreateTestScenariosInput): GeneratedTest[] {
  const framework = input.framework ?? DEFAULT_FRAMEWORK;
  const candidates = input.findings.flatMap((finding) =>
    createScenarioCandidate(finding, framework),
  );
  const uniqueCandidates = new Map<string, ScenarioCandidate>();

  for (const candidate of candidates) {
    const existing = uniqueCandidates.get(candidate.identity);
    if (existing === undefined || compareDuplicateCandidates(candidate, existing) < 0) {
      uniqueCandidates.set(candidate.identity, candidate);
    }
  }

  return [...uniqueCandidates.values()]
    .sort(compareScenarioCandidates)
    .map((candidate) => candidate.generatedTest);
}

/**
 * Creates a scenario candidate only for an approved Task 7.1 template and a
 * non-empty stable finding ID.
 */
function createScenarioCandidate(
  finding: AnalysisFinding,
  framework: SupportedTestFramework,
): ScenarioCandidate[] {
  if (!isSupportedTemplateRuleId(finding.ruleId) || !isStableFindingId(finding.id)) {
    return [];
  }

  const templateId = TEMPLATE_IDS[finding.ruleId];
  const relatedFindingIds = uniqueSorted([finding.id]);
  const context = createScenarioContext(finding);
  const generatedTest: GeneratedTest = {
    id: generateTestId({
      templateId,
      framework,
      relatedFindingIds,
    }),
    framework,
    title: createTitle(finding.ruleId, context),
    rationale: createRationale(finding.ruleId, context),
    relatedFindingIds,
  };

  return [
    {
      generatedTest,
      severity: finding.severity,
      ruleId: finding.ruleId,
      repositoryId: context.repositoryId ?? '',
      file: context.file ?? '',
      findingId: finding.id,
      templateId,
      identity: [templateId, ...relatedFindingIds].join('\x00'),
    },
  ];
}

function isSupportedTemplateRuleId(ruleId: string): ruleId is SupportedTemplateRuleId {
  return Object.hasOwn(TEMPLATE_IDS, ruleId);
}

/**
 * Extracts only small, safe context fields used by Task 7.1 wording.
 */
function createScenarioContext(finding: AnalysisFinding): ScenarioContext {
  const repositoryId = safeText(finding.location?.repositoryId);
  const file = safeRepositoryRelativePath(finding.location?.file);
  const property =
    safeText(finding.metadata?.property) ?? safeText(finding.evidence?.details?.property);

  return {
    ...(repositoryId === undefined ? {} : { repositoryId }),
    ...(file === undefined ? {} : { file }),
    ...(property === undefined ? {} : { property }),
  };
}

/**
 * Creates stable scenario titles without copying finding descriptions or source.
 */
function createTitle(ruleId: SupportedTemplateRuleId, context: ScenarioContext): string {
  const propertySuffix = context.property === undefined ? '' : `: ${context.property}`;
  const fileSuffix = context.file === undefined ? '' : `: ${context.file}`;

  switch (ruleId) {
    case 'contract.missing-property':
      return `Verify required property handling${propertySuffix}`;
    case 'contract.incompatible-type':
      return `Verify compatible property representation${propertySuffix}`;
    case 'contract.required-mismatch':
      return `Verify required and optional behavior${propertySuffix}`;
    case 'risk.missing-related-tests':
      return `Review related changed test${fileSuffix}`;
    case 'risk.sensitive-file-change':
      return `Review sensitive file change${fileSuffix}`;
  }
}

/**
 * Produces factual bounded scenario wording from approved rule semantics only.
 */
function createRationale(ruleId: SupportedTemplateRuleId, context: ScenarioContext): string {
  const property = createPropertyReference(context.property);
  const location = createLocationReference(context);

  switch (ruleId) {
    case 'contract.missing-property':
      return `Verify that the frontend contract includes and correctly handles the backend-required ${property}${location}.`;
    case 'contract.incompatible-type':
      return `Verify that frontend and backend use compatible representations for ${property}, including representative valid values${location}.`;
    case 'contract.required-mismatch':
      return `Verify required and optional behavior for ${property}, including absence or presence as appropriate${location}.`;
    case 'risk.missing-related-tests':
      return `Review or add a related changed test for ${createProductionFileReference(context.file)}${location}. No related changed test was found using the deterministic filename heuristic.`;
    case 'risk.sensitive-file-change':
      return `Validate ${createChangedPathReference(context.file)} because it matches a configured sensitive-file pattern and merits focused review${location}. Review applicable configuration, authorization, migration, or deployment behavior before merging.`;
  }
}

function createPropertyReference(property: string | undefined): string {
  return property === undefined
    ? 'the property identified by the contract finding'
    : `property "${property}"`;
}

function createProductionFileReference(file: string | undefined): string {
  return file === undefined
    ? 'the production file identified by the finding'
    : `production file "${file}"`;
}

function createChangedPathReference(file: string | undefined): string {
  return file === undefined
    ? 'the changed path identified by the finding'
    : `changed path "${file}"`;
}

function createLocationReference(context: ScenarioContext): string {
  const repository =
    context.repositoryId === undefined ? '' : ` in repository "${context.repositoryId}"`;
  const file = context.file === undefined ? '' : ` for repository-relative file "${context.file}"`;

  return `${repository}${file}`;
}

/**
 * Sorts output by required severity, rule, repository, file, finding ID, and template ID.
 */
function compareScenarioCandidates(left: ScenarioCandidate, right: ScenarioCandidate): number {
  const severityOrder = severityRank(left.severity) - severityRank(right.severity);
  if (severityOrder !== 0) {
    return severityOrder;
  }

  return (
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.repositoryId, right.repositoryId) ||
    compareText(left.file, right.file) ||
    compareText(left.findingId, right.findingId) ||
    compareText(left.templateId, right.templateId)
  );
}

/**
 * Canonically resolves malformed duplicate finding data without using input order.
 */
function compareDuplicateCandidates(left: ScenarioCandidate, right: ScenarioCandidate): number {
  return (
    compareScenarioCandidates(left, right) ||
    compareText(left.generatedTest.title, right.generatedTest.title) ||
    compareText(left.generatedTest.rationale, right.generatedTest.rationale)
  );
}

function severityRank(severity: Severity): number {
  switch (severity) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'warning':
      return 2;
    case 'info':
      return 3;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function isStableFindingId(findingId: string): boolean {
  return (
    findingId.length > 0 &&
    findingId.length <= 160 &&
    findingId.trim() === findingId &&
    !hasControlCharacters(findingId)
  );
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 160 || hasControlCharacters(normalized)) {
    return undefined;
  }

  return normalized;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }

  return false;
}

/**
 * Keeps only normalized repository-relative paths and rejects absolute or traversal paths.
 */
function safeRepositoryRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || hasControlCharacters(value)) {
    return undefined;
  }

  const normalized = value.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    return undefined;
  }

  const segments = normalized.split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ? undefined
    : normalized;
}
