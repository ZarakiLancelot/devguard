import { describe, expect, it } from 'vitest';
import { createTestScenarios } from './create-test-scenarios.js';
import type { AnalysisFinding, Severity } from '../../types/findings.js';

const SOURCE_CONTENT = 'const secret = "do-not-emit";';
const ABSOLUTE_PATH = '/private/workspace/book.ts';

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-default',
    ruleId: 'contract.missing-property',
    source: 'contract-checker',
    category: 'contract',
    severity: 'high',
    title: 'Input-only title',
    description: `Input-only description ${SOURCE_CONTENT}`,
    location: {
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
    },
    evidence: {
      details: {
        property: 'authorId',
        sourceContent: SOURCE_CONTENT,
      },
    },
    metadata: {
      property: 'authorId',
      patch: SOURCE_CONTENT,
      timestamp: '2026-07-22T00:00:00.000Z',
      environment: 'developer-machine',
    },
    ...overrides,
  };
}

function createSupportedContractFinding(
  ruleId: 'contract.missing-property' | 'contract.incompatible-type' | 'contract.required-mismatch',
  severity: Severity,
  id: string,
): AnalysisFinding {
  return createFinding({ ruleId, severity, id });
}

describe('createTestScenarios', () => {
  it('creates one scenario for a high missing-property finding with safe property context', () => {
    const [scenario] = createTestScenarios({
      findings: [
        createSupportedContractFinding('contract.missing-property', 'high', 'finding-missing'),
      ],
    });

    expect(scenario).toMatchObject({
      framework: 'scenario-only',
      title: 'Verify required property handling: authorId',
      relatedFindingIds: ['finding-missing'],
    });
    expect(scenario?.rationale).toContain('backend-required property "authorId"');
  });

  it('creates one scenario for a critical incompatible-type finding', () => {
    const scenarios = createTestScenarios({
      findings: [
        createSupportedContractFinding(
          'contract.incompatible-type',
          'critical',
          'finding-incompatible',
        ),
      ],
    });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.rationale).toContain('compatible representations');
    expect(scenarios[0]?.rationale).toContain('representative valid values');
  });

  it('creates one scenario for a high required-mismatch finding', () => {
    const scenarios = createTestScenarios({
      findings: [
        createSupportedContractFinding('contract.required-mismatch', 'high', 'finding-required'),
      ],
    });

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.rationale).toContain('absence or presence as appropriate');
  });

  it('creates one scenario for every supported critical or high contract finding', () => {
    const scenarios = createTestScenarios({
      findings: [
        createSupportedContractFinding('contract.missing-property', 'high', 'finding-missing'),
        createSupportedContractFinding(
          'contract.incompatible-type',
          'critical',
          'finding-incompatible',
        ),
        createSupportedContractFinding('contract.required-mismatch', 'high', 'finding-required'),
      ],
    });

    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.relatedFindingIds[0])).toEqual([
      'finding-incompatible',
      'finding-missing',
      'finding-required',
    ]);
  });

  it('creates one bounded review scenario for missing related changed tests', () => {
    const [scenario] = createTestScenarios({
      findings: [
        createFinding({
          id: 'finding-related-test',
          ruleId: 'risk.missing-related-tests',
          source: 'pr-risk-analyzer',
          category: 'risk',
          severity: 'warning',
          location: { repositoryId: 'frontend', file: 'src/books/book-form.ts' },
        }),
      ],
    });

    expect(scenario?.rationale).toContain('No related changed test was found');
    expect(scenario?.rationale).toContain('deterministic filename heuristic');
    expect(scenario?.rationale).not.toMatch(/no test exists|untested|coverage is absent/iu);
  });

  it('creates one bounded review scenario for a sensitive file change', () => {
    const [scenario] = createTestScenarios({
      findings: [
        createFinding({
          id: 'finding-sensitive',
          ruleId: 'risk.sensitive-file-change',
          source: 'pr-risk-analyzer',
          category: 'risk',
          severity: 'high',
          location: { repositoryId: 'backend', file: 'deploy/authorization.yml' },
        }),
      ],
    });

    expect(scenario?.rationale).toContain('matches a configured sensitive-file pattern');
    expect(scenario?.rationale).toContain('focused review');
    expect(scenario?.rationale).not.toMatch(/credential|secret|vulnerab|defect/iu);
  });

  it.each([
    'contract.schema-not-found',
    'contract.typescript-type-not-found',
    'contract.unsupported-type',
    'unknown.rule',
  ])('skips %s without throwing', (ruleId) => {
    expect(() => {
      expect(
        createTestScenarios({ findings: [createFinding({ id: `finding-${ruleId}`, ruleId })] }),
      ).toEqual([]);
    }).not.toThrow();
  });

  it('uses scenario-only by default and preserves an explicitly supplied framework', () => {
    const finding = createFinding({ id: 'finding-framework' });

    expect(createTestScenarios({ findings: [finding] })[0]?.framework).toBe('scenario-only');
    expect(createTestScenarios({ findings: [finding], framework: 'jest' })[0]?.framework).toBe(
      'jest',
    );
  });

  it('links exactly one source finding ID and leaves no scaffold fields', () => {
    const [scenario] = createTestScenarios({
      findings: [createFinding({ id: 'finding-reference' })],
    });

    expect(scenario?.relatedFindingIds).toEqual(['finding-reference']);
    expect(scenario).not.toHaveProperty('filePath');
    expect(scenario).not.toHaveProperty('code');
  });

  it('deduplicates identical findings by template ID and finding ID', () => {
    const finding = createFinding({ id: 'finding-duplicate' });

    expect(createTestScenarios({ findings: [finding, { ...finding }] })).toHaveLength(1);
  });

  it('keeps findings with different IDs separate and template identities distinct', () => {
    const scenarios = createTestScenarios({
      findings: [
        createFinding({ id: 'finding-one' }),
        createFinding({ id: 'finding-two' }),
        createFinding({
          id: 'finding-rule',
          ruleId: 'contract.incompatible-type',
          severity: 'critical',
        }),
      ],
    });

    expect(scenarios).toHaveLength(3);
    expect(new Set(scenarios.map((scenario) => scenario.id))).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.relatedFindingIds)).toEqual([
      ['finding-rule'],
      ['finding-one'],
      ['finding-two'],
    ]);
  });

  it('generates stable IDs that distinguish selected frameworks', () => {
    const finding = createFinding({ id: 'finding-stable-id' });
    const first = createTestScenarios({ findings: [finding] })[0];
    const second = createTestScenarios({ findings: [finding] })[0];
    const jestScenario = createTestScenarios({ findings: [finding], framework: 'jest' })[0];

    expect(first?.id).toMatch(/^test-[a-f0-9]{16}$/);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).not.toBe(jestScenario?.id);
  });

  it('is deeply deterministic across repeated execution and reversed input order', () => {
    const findings = [
      createFinding({ id: 'finding-high', severity: 'high' }),
      createFinding({
        id: 'finding-critical',
        ruleId: 'contract.incompatible-type',
        severity: 'critical',
      }),
      createFinding({
        id: 'finding-warning',
        ruleId: 'risk.missing-related-tests',
        source: 'pr-risk-analyzer',
        category: 'risk',
        severity: 'warning',
      }),
    ];

    const first = createTestScenarios({ findings });
    expect(createTestScenarios({ findings })).toEqual(first);
    expect(createTestScenarios({ findings: [...findings].reverse() })).toEqual(first);
  });

  it('orders scenarios by severity, then rule ID, repository, file, finding ID, and template', () => {
    const scenarios = createTestScenarios({
      findings: [
        createFinding({
          id: 'finding-info',
          ruleId: 'risk.sensitive-file-change',
          source: 'pr-risk-analyzer',
          category: 'risk',
          severity: 'info',
          location: { repositoryId: 'repo-z', file: 'z/file.yml' },
        }),
        createFinding({
          id: 'finding-warning',
          ruleId: 'risk.missing-related-tests',
          source: 'pr-risk-analyzer',
          category: 'risk',
          severity: 'warning',
          location: { repositoryId: 'repo-z', file: 'z/file.ts' },
        }),
        createFinding({
          id: 'finding-high-b',
          location: { repositoryId: 'repo-b', file: 'src/b.ts' },
        }),
        createFinding({
          id: 'finding-high-a',
          location: { repositoryId: 'repo-a', file: 'src/a.ts' },
        }),
        createFinding({
          id: 'finding-critical',
          ruleId: 'contract.incompatible-type',
          severity: 'critical',
        }),
      ],
    });

    expect(scenarios.map((scenario) => scenario.relatedFindingIds[0])).toEqual([
      'finding-critical',
      'finding-high-a',
      'finding-high-b',
      'finding-warning',
      'finding-info',
    ]);
  });

  it('includes safe repository, relative file, and property context when available', () => {
    const [scenario] = createTestScenarios({
      findings: [createFinding({ id: 'finding-context' })],
    });

    expect(scenario?.rationale).toContain('repository "frontend"');
    expect(scenario?.rationale).toContain('repository-relative file "src/types/book.ts"');
    expect(scenario?.rationale).toContain('property "authorId"');
  });

  it('omits missing or unsafe optional context without throwing or emitting absolute paths', () => {
    const [scenario] = createTestScenarios({
      findings: [
        createFinding({
          id: 'finding-safe-context',
          location: { repositoryId: 'frontend', file: ABSOLUTE_PATH },
          metadata: {},
          evidence: {},
        }),
      ],
    });

    expect(scenario?.title).toBe('Verify required property handling');
    expect(JSON.stringify(scenario)).not.toContain(ABSOLUTE_PATH);
    const findingWithoutLocation = createFinding({ id: 'finding-no-location', metadata: {} });
    delete findingWithoutLocation.location;

    expect(() => createTestScenarios({ findings: [findingWithoutLocation] })).not.toThrow();
  });

  it('does not copy source, patch, timestamps, environment details, or requirements-like extras', () => {
    const finding = createFinding({ id: 'finding-safety' });
    const baseline = createTestScenarios({ findings: [finding] });
    const extraInput = {
      findings: [finding],
      requirementsPath: ABSOLUTE_PATH,
      requirementsContent: SOURCE_CONTENT,
    } as unknown as Parameters<typeof createTestScenarios>[0];
    const serialized = JSON.stringify(createTestScenarios(extraInput));

    expect(createTestScenarios(extraInput)).toEqual(baseline);
    expect(serialized).not.toContain(SOURCE_CONTENT);
    expect(serialized).not.toContain('2026-07-22');
    expect(serialized).not.toContain('developer-machine');
    expect(serialized).not.toContain(ABSOLUTE_PATH);
  });

  it('skips findings without a stable ID and returns empty input as an empty array', () => {
    expect(createTestScenarios({ findings: [] })).toEqual([]);
    expect(createTestScenarios({ findings: [createFinding({ id: '' })] })).toEqual([]);
  });

  it('does not mutate finding arrays, nested metadata, or related finding arrays', () => {
    const relatedFindingIds = ['related-b', 'related-a'];
    const finding = createFinding({
      id: 'finding-immutable',
      relatedFindingIds,
      metadata: { property: 'authorId', nested: { stable: true } },
    });
    const findings = [finding];
    const before = structuredClone({ findings, relatedFindingIds });

    createTestScenarios({ findings });

    expect({ findings, relatedFindingIds }).toEqual(before);
  });
});
