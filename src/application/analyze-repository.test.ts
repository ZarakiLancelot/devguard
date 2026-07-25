import { describe, expect, it, vi } from 'vitest';
import {
  AnalyzeRepositoryError,
  createAnalyzeRepository,
  type AnalyzeRepositoryDependencies,
  type AnalyzeRepositoryInput,
} from './analyze-repository.js';
import { ConfigLoadError, type LoadedConfig } from '../config/config-loader.js';
import { GitDiffError } from '../sources/local-git-diff-provider.js';
import { GitRepositoryValidationError } from '../sources/git-repository-validator.js';
import { GitFileLoadError } from '../sources/repository-file-loader.js';
import { LocalRepositoryContextError } from '../sources/local-context-builder.js';
import { ExplicitRequirementsOverrideError } from '../sources/explicit-requirements-override-loader.js';
import type { DevGuardConfig } from '../config/config-schema.js';
import type {
  AnalyzeContractMappingInput,
  AnalyzeContractMappingResult,
} from '../modules/contract-checker/analyze-contract-mapping.js';
import type { SensitiveFileChangeInput } from '../modules/pr-risk-analyzer/rules/sensitive-file-change.js';
import type { MissingRelatedTestsInput } from '../modules/pr-risk-analyzer/rules/missing-related-tests.js';
import type { CalculateScoreInput } from '../modules/score-calculator/calculate-score.js';
import type { CreateTestScenariosInput } from '../modules/test-generator/create-test-scenarios.js';
import type { BuildReportInput } from '../reports/report-builder.js';
import type { AnalysisIdInput } from '../shared/ids.js';
import type { AnalysisFinding } from '../types/findings.js';
import type {
  RepositoryChangeSet,
  RepositoryContext,
  RepositoryFile,
} from '../types/repository.js';
import type { PRHealthReport, ScoreBreakdown } from '../types/reports.js';
import type { GeneratedTest } from '../types/tests.js';

const FIXED_TIME = new Date('2026-07-23T01:02:03.000Z');
const CANONICAL_CONFIG_PATH = '/private/canonical/workspace/.devguard.yml';
const REQUIREMENTS_OVERRIDE = {
  path: ' ./requirements override.md ',
  baseDirectory: '/caller/working-directory',
  required: true,
} as const;
const INPUT: AnalyzeRepositoryInput = {
  configPath: './selected/.devguard.yml',
  workingDirectory: '/caller/working-directory',
  requirementsOverride: REQUIREMENTS_OVERRIDE,
};

interface Harness {
  config: DevGuardConfig;
  loadedConfig: LoadedConfig;
  context: RepositoryContext;
  sessionFactory: ReturnType<typeof vi.fn>;
  loadContext: ReturnType<typeof vi.fn>;
  analyzeContractMapping: ReturnType<typeof vi.fn>;
  detectSensitiveFileChanges: ReturnType<typeof vi.fn>;
  detectMissingRelatedTests: ReturnType<typeof vi.fn>;
  createTestScenarios: ReturnType<typeof vi.fn>;
  calculateScore: ReturnType<typeof vi.fn>;
  generateAnalysisId: ReturnType<typeof vi.fn>;
  buildReport: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  dependencies: AnalyzeRepositoryDependencies;
}

function createConfig(overrides: Partial<DevGuardConfig> = {}): DevGuardConfig {
  return {
    version: 1,
    repositories: {
      backend: { path: '../backend', baseRef: 'main', role: 'backend' },
      frontend: { path: '../frontend', baseRef: 'develop', role: 'frontend' },
    },
    openapi: { repository: 'backend', path: 'shared/schema.txt' },
    contracts: [
      {
        name: 'ZetaMapping',
        openapiSchema: 'ZetaSchema',
        typescript: {
          repository: 'frontend',
          file: 'src/zeta.ts',
          type: 'ZetaPayload',
        },
      },
      {
        name: 'AlphaMapping',
        openapiSchema: 'AlphaSchema',
        typescript: {
          repository: 'frontend',
          file: 'shared/schema.txt',
          type: 'AlphaPayload',
        },
      },
    ],
    risk: {
      sensitivePatterns: ['**/secrets/**'],
      productionPatterns: ['unused-production-pattern'],
    },
    testing: {
      framework: 'vitest',
      testPatterns: ['unused-test-pattern'],
    },
    ...overrides,
  };
}

function createRepository(overrides: Partial<RepositoryChangeSet> = {}): RepositoryChangeSet {
  return {
    repositoryId: 'frontend',
    repositoryPath: '/private/frontend-repository',
    role: 'frontend',
    baseRef: 'develop',
    headRef: 'frontend-head',
    changedFiles: [
      { repositoryId: 'frontend', path: 'src/z.ts', status: 'modified' },
      { repositoryId: 'frontend', path: 'src/a.ts', status: 'added' },
    ],
    ...overrides,
  };
}

function createFile(overrides: Partial<RepositoryFile> = {}): RepositoryFile {
  return {
    repositoryId: 'frontend',
    path: 'shared/schema.txt',
    content: 'frontend Alpha source',
    sizeBytes: 21,
    ...overrides,
  };
}

function createContext(overrides: Partial<RepositoryContext> = {}): RepositoryContext {
  return {
    sourceType: 'local',
    sourceLabel: 'Local Git Repositories',
    repositories: [
      createRepository(),
      createRepository({
        repositoryId: 'backend',
        repositoryPath: '/private/backend-repository',
        role: 'backend',
        baseRef: 'main',
        headRef: 'backend-head',
        changedFiles: [
          {
            repositoryId: 'backend',
            path: 'src/backend.ts',
            status: 'renamed',
            previousPath: 'src/old.ts',
          },
        ],
      }),
    ],
    files: [
      createFile(),
      createFile({ repositoryId: 'backend', content: 'backend OpenAPI source' }),
      createFile({ path: 'src/zeta.ts', content: 'frontend Zeta source' }),
    ],
    requirements: 'private requirements content',
    warnings: ['context warning'],
    metadata: { sourceOwned: 'metadata' },
    ...overrides,
  };
}

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding-default',
    ruleId: 'contract.missing-property',
    source: 'contract-checker',
    category: 'contract',
    severity: 'high',
    title: 'Contract finding',
    description: 'Contract finding description.',
    location: { repositoryId: 'frontend', file: 'shared/schema.txt' },
    ...overrides,
  };
}

function createGeneratedTest(overrides: Partial<GeneratedTest> = {}): GeneratedTest {
  return {
    id: 'test-default',
    framework: 'vitest',
    title: 'Generated test',
    rationale: 'Generated test rationale.',
    relatedFindingIds: ['finding-default'],
    ...overrides,
  };
}

function createScoreBreakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return { initialScore: 100, finalScore: 90, deductions: [], ...overrides };
}

function createReport(input: BuildReportInput): PRHealthReport {
  return {
    version: '1.0',
    analysisId: input.analysisId,
    generatedAt: input.generatedAt,
    source: { type: input.context.sourceType, label: input.context.sourceLabel },
    repositories: input.context.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      role: repository.role,
      baseRef: repository.baseRef,
      headRef: repository.headRef,
    })),
    healthScore: input.scoreBreakdown.finalScore,
    healthLabel: 'HEALTHY',
    scoreBreakdown: input.scoreBreakdown,
    summary: {
      totalCount: input.findings.length,
      criticalCount: 0,
      highCount: input.findings.length,
      warningCount: 0,
      infoCount: 0,
      riskCount: 0,
      contractCount: input.findings.length,
      testingCount: 0,
    },
    findings: [...input.findings],
    generatedTests: [...input.generatedTests],
    warnings: [...input.context.warnings, ...(input.warnings ?? [])],
  };
}

function createHarness(overrides: Partial<AnalyzeRepositoryDependencies> = {}): Harness {
  const config = createConfig();
  const loadedConfig: LoadedConfig = {
    config,
    configPath: CANONICAL_CONFIG_PATH,
    workspaceBase: '/private/canonical/workspace',
  };
  const context = createContext();
  const loadContext = vi.fn().mockResolvedValue(context);
  const sessionFactory = vi.fn().mockResolvedValue({
    loadedConfig,
    source: { loadContext },
  });
  const alphaFinding = createFinding({ id: 'finding-alpha' });
  const zetaFinding = createFinding({ id: 'finding-zeta' });
  const analyzeContractMapping = vi.fn(
    (input: AnalyzeContractMappingInput): AnalyzeContractMappingResult => ({
      mappingName: input.mappingName,
      findings: input.mappingName === 'AlphaMapping' ? [alphaFinding] : [zetaFinding],
      warnings:
        input.mappingName === 'AlphaMapping'
          ? [
              {
                code: 'OPENAPI_PARSE_FAILED',
                message: `private diagnostic ${CANONICAL_CONFIG_PATH}`,
                source: 'openapi',
                file: 'shared/schema.txt',
                line: 7,
              },
            ]
          : [
              {
                code: 'TYPESCRIPT_PARSE_FAILED',
                message: 'private parser source content',
                source: 'typescript',
                file: 'src/zeta.ts',
              },
            ],
      compared: input.mappingName === 'ZetaMapping',
    }),
  );
  const sensitiveFinding = createFinding({
    id: 'finding-sensitive',
    ruleId: 'risk.sensitive-file-change',
    source: 'pr-risk-analyzer',
    category: 'risk',
  });
  const missingTestFinding = createFinding({
    id: 'finding-missing-test',
    ruleId: 'risk.missing-related-tests',
    source: 'pr-risk-analyzer',
    category: 'risk',
    severity: 'warning',
  });
  const detectSensitiveFileChanges = vi.fn((_input: SensitiveFileChangeInput) => [
    sensitiveFinding,
  ]);
  const detectMissingRelatedTests = vi.fn((_input: MissingRelatedTestsInput) => [
    missingTestFinding,
  ]);
  const createTestScenarios = vi.fn((_input: CreateTestScenariosInput) => [createGeneratedTest()]);
  const calculateScore = vi.fn((_input: CalculateScoreInput) => createScoreBreakdown());
  const generateAnalysisId = vi.fn((_input: AnalysisIdInput) => 'analysis-0123456789abcdef');
  const buildReport = vi.fn((input: BuildReportInput) => createReport(input));
  const now = vi.fn(() => FIXED_TIME);
  const dependencies = {
    createLocalAnalysisSession: sessionFactory,
    analyzeContractMapping,
    detectSensitiveFileChanges,
    detectMissingRelatedTests,
    createTestScenarios,
    calculateScore,
    generateAnalysisId,
    buildReport,
    now,
    ...overrides,
  } as unknown as AnalyzeRepositoryDependencies;

  return {
    config,
    loadedConfig,
    context,
    sessionFactory,
    loadContext,
    analyzeContractMapping,
    detectSensitiveFileChanges,
    detectMissingRelatedTests,
    createTestScenarios,
    calculateScore,
    generateAnalysisId,
    buildReport,
    now,
    dependencies,
  };
}

async function expectApplicationError(
  action: () => Promise<unknown>,
  code: AnalyzeRepositoryError['code'],
): Promise<AnalyzeRepositoryError> {
  try {
    await action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AnalyzeRepositoryError);
    const applicationError = error as AnalyzeRepositoryError;
    expect(applicationError.code).toBe(code);
    return applicationError;
  }

  throw new Error('Expected an application error');
}

describe('analyzeRepository', () => {
  it('runs one complete local analysis with deterministic ordering, exact references, and private boundaries', async () => {
    const harness = createHarness();
    const analyze = createAnalyzeRepository(harness.dependencies);
    const input = structuredClone(INPUT);
    const beforeConfig = structuredClone(harness.config);
    const beforeContext = structuredClone(harness.context);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
      const result = await analyze(input);

      expect(harness.sessionFactory).toHaveBeenCalledTimes(1);
      expect(harness.sessionFactory).toHaveBeenCalledWith({
        configPath: INPUT.configPath,
        workingDirectory: INPUT.workingDirectory,
      });
      expect(harness.loadContext).toHaveBeenCalledTimes(1);
      expect(harness.loadContext).toHaveBeenCalledWith({
        requirementsOverride: input.requirementsOverride,
      });
      expect(harness.loadContext.mock.calls[0]?.[0]?.requirementsOverride).toBe(
        input.requirementsOverride,
      );
      expect(result.loadedConfig).toBe(harness.loadedConfig);

      expect(harness.analyzeContractMapping).toHaveBeenCalledTimes(2);
      const [alphaInput, zetaInput] = harness.analyzeContractMapping.mock.calls.map(
        ([contractInput]) => contractInput as AnalyzeContractMappingInput,
      );
      expect(alphaInput).toEqual({
        mappingName: 'AlphaMapping',
        openapi: {
          repositoryId: 'backend',
          file: 'shared/schema.txt',
          content: 'backend OpenAPI source',
          schemaName: 'AlphaSchema',
        },
        typescript: {
          repositoryId: 'frontend',
          file: 'shared/schema.txt',
          content: 'frontend Alpha source',
          declarationName: 'AlphaPayload',
        },
      });
      expect(zetaInput?.mappingName).toBe('ZetaMapping');
      expect(alphaInput?.openapi).not.toHaveProperty('format');
      expect(harness.config).toEqual(beforeConfig);

      const sensitiveInput = harness.detectSensitiveFileChanges.mock
        .calls[0]?.[0] as SensitiveFileChangeInput;
      expect(harness.detectSensitiveFileChanges).toHaveBeenCalledTimes(1);
      expect(sensitiveInput.sensitivePatterns).toBe(harness.config.risk?.sensitivePatterns);
      expect(
        sensitiveInput.changedFiles.map((file) => `${file.repositoryId}:${file.path}`),
      ).toEqual(['backend:src/backend.ts', 'frontend:src/a.ts', 'frontend:src/z.ts']);
      expect(harness.detectMissingRelatedTests).toHaveBeenCalledTimes(1);
      expect(harness.detectMissingRelatedTests.mock.calls[0]?.[0]).toEqual({
        changedFiles: sensitiveInput.changedFiles,
      });

      const expectedFindings = [
        'finding-alpha',
        'finding-zeta',
        'finding-sensitive',
        'finding-missing-test',
      ];
      const generatorInput = harness.createTestScenarios.mock
        .calls[0]?.[0] as CreateTestScenariosInput;
      expect(harness.createTestScenarios).toHaveBeenCalledTimes(1);
      expect(generatorInput.findings.map((finding) => finding.id)).toEqual(expectedFindings);
      expect(generatorInput.framework).toBe(harness.config.testing?.framework);
      expect(generatorInput).not.toHaveProperty('requirements');
      expect(generatorInput).not.toHaveProperty('testPatterns');
      expect(harness.calculateScore).toHaveBeenCalledTimes(1);
      expect(harness.calculateScore.mock.calls[0]?.[0]).toEqual({
        findings: generatorInput.findings,
      });

      expect(harness.generateAnalysisId).toHaveBeenCalledTimes(1);
      expect(harness.generateAnalysisId).toHaveBeenCalledWith({
        configPath: CANONICAL_CONFIG_PATH,
        repositories: [
          { repositoryId: 'frontend', baseRef: 'develop', headRef: 'frontend-head' },
          { repositoryId: 'backend', baseRef: 'main', headRef: 'backend-head' },
        ],
      });
      expect(harness.now).toHaveBeenCalledTimes(1);

      expect(harness.buildReport).toHaveBeenCalledTimes(1);
      const buildInput = harness.buildReport.mock.calls[0]?.[0] as BuildReportInput;
      expect(buildInput.analysisId).toBe('analysis-0123456789abcdef');
      expect(buildInput.generatedAt).toBe(FIXED_TIME.toISOString());
      expect(buildInput.context).toBe(harness.context);
      expect(buildInput.findings).toBe(generatorInput.findings);
      expect(buildInput.generatedTests).toEqual([createGeneratedTest()]);
      expect(buildInput.scoreBreakdown).toEqual(createScoreBreakdown());
      expect(buildInput.warnings).toEqual([
        'CONTRACT_WARNING mapping="AlphaMapping" source="openapi" file="shared/schema.txt" line=7 code="OPENAPI_PARSE_FAILED": Contract source could not be fully analyzed.',
        'CONTRACT_WARNING mapping="ZetaMapping" source="typescript" file="src/zeta.ts" code="TYPESCRIPT_PARSE_FAILED": Contract source could not be fully analyzed.',
      ]);
      expect(buildInput.warnings).not.toContain('context warning');
      expect(JSON.stringify(buildInput)).not.toContain(CANONICAL_CONFIG_PATH);
      expect(JSON.stringify(result.report)).not.toContain(CANONICAL_CONFIG_PATH);
      expect(result.report).toBe(harness.buildReport.mock.results[0]?.value);

      expect(input).toEqual(INPUT);
      expect(harness.context).toEqual(beforeContext);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('omits undefined requirements/framework inputs and defaults sensitive patterns to an empty array', async () => {
    const harness = createHarness();
    delete harness.config.risk;
    delete harness.config.testing;
    const analyze = createAnalyzeRepository(harness.dependencies);

    await analyze({ configPath: 'config.yml', workingDirectory: '/working' });

    expect(harness.loadContext).toHaveBeenCalledWith({});
    expect(harness.detectSensitiveFileChanges.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ sensitivePatterns: [] }),
    );
    expect(harness.createTestScenarios.mock.calls[0]?.[0]).not.toHaveProperty('framework');
  });

  it('preserves duplicate returned findings and continues after typed contract warnings', async () => {
    const harness = createHarness();
    const duplicate = createFinding({ id: 'duplicate-finding' });
    harness.analyzeContractMapping.mockImplementation(
      (input: AnalyzeContractMappingInput): AnalyzeContractMappingResult => ({
        mappingName: input.mappingName,
        findings: [duplicate],
        warnings: [{ code: 'EXPECTED_WARNING', message: 'private message', source: 'openapi' }],
        compared: false,
      }),
    );
    const analyze = createAnalyzeRepository(harness.dependencies);

    await analyze(INPUT);

    const findings = (harness.createTestScenarios.mock.calls[0]?.[0] as CreateTestScenariosInput)
      .findings;
    expect(harness.analyzeContractMapping).toHaveBeenCalledTimes(2);
    expect(findings.filter((finding) => finding.id === 'duplicate-finding')).toHaveLength(2);
    expect(harness.buildReport.mock.calls[0]?.[0]).toMatchObject({
      warnings: [
        'CONTRACT_WARNING mapping="AlphaMapping" source="openapi" code="EXPECTED_WARNING": Contract source could not be fully analyzed.',
        'CONTRACT_WARNING mapping="ZetaMapping" source="openapi" code="EXPECTED_WARNING": Contract source could not be fully analyzed.',
      ],
    });
  });

  it.each([
    ['configuration', new ConfigLoadError('CONFIG_SCHEMA_INVALID')],
    ['repository validation', new GitRepositoryValidationError('NOT_A_GIT_REPOSITORY')],
    ['Git diff', new GitDiffError('GIT_DIFF_FAILED')],
    ['Git file load', new GitFileLoadError('GIT_FILE_LOAD_FAILED')],
    ['local context', new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION')],
  ])('passes %s failures through by identity without later work', async (_name, failure) => {
    const harness = createHarness();
    if (failure instanceof ConfigLoadError) {
      harness.sessionFactory.mockRejectedValue(failure);
    } else {
      harness.loadContext.mockRejectedValue(failure);
    }
    const analyze = createAnalyzeRepository(harness.dependencies);

    await expect(analyze(INPUT)).rejects.toBe(failure);
    expect(harness.analyzeContractMapping).not.toHaveBeenCalled();
    expect(harness.buildReport).not.toHaveBeenCalled();
  });

  it('propagates fatal explicit override failures unchanged before any analyzer or report work', async () => {
    const harness = createHarness();
    const failure = new ExplicitRequirementsOverrideError(
      'REQUIREMENTS_OVERRIDE_NOT_FOUND',
      'ignored',
    );
    harness.loadContext.mockRejectedValue(failure);

    await expect(createAnalyzeRepository(harness.dependencies)(INPUT)).rejects.toBe(failure);
    expect(harness.analyzeContractMapping).not.toHaveBeenCalled();
    expect(harness.createTestScenarios).not.toHaveBeenCalled();
    expect(harness.calculateScore).not.toHaveBeenCalled();
    expect(harness.buildReport).not.toHaveBeenCalled();
  });

  it('aborts for duplicate and missing mapped RepositoryFiles before analyzer execution', async () => {
    const duplicateHarness = createHarness();
    const duplicateFile = duplicateHarness.context.files[0];
    if (duplicateFile === undefined) {
      throw new Error('Expected repository file fixture');
    }
    duplicateHarness.context.files.push({ ...duplicateFile });
    const duplicateError = await expectApplicationError(
      () => createAnalyzeRepository(duplicateHarness.dependencies)(INPUT),
      'ANALYSIS_INVARIANT_VIOLATION',
    );
    expect(duplicateError.message).not.toContain('frontend');
    expect(duplicateHarness.analyzeContractMapping).not.toHaveBeenCalled();
    expect(duplicateHarness.buildReport).not.toHaveBeenCalled();

    const missingHarness = createHarness();
    missingHarness.context.files = [];
    await expectApplicationError(
      () => createAnalyzeRepository(missingHarness.dependencies)(INPUT),
      'ANALYSIS_INVARIANT_VIOLATION',
    );
    expect(missingHarness.analyzeContractMapping).not.toHaveBeenCalled();
    expect(missingHarness.buildReport).not.toHaveBeenCalled();
  });

  it.each([
    'analyzeContractMapping',
    'detectSensitiveFileChanges',
    'detectMissingRelatedTests',
    'createTestScenarios',
    'calculateScore',
    'generateAnalysisId',
  ] as const)(
    'wraps an unexpected %s exception without a partial report',
    async (dependencyName) => {
      const harness = createHarness();
      const cause = new Error(`private ${dependencyName} failure`);
      const dependency = harness[dependencyName] as ReturnType<typeof vi.fn>;
      dependency.mockImplementationOnce(() => {
        throw cause;
      });
      const analyze = createAnalyzeRepository(harness.dependencies);

      const error = await expectApplicationError(() => analyze(INPUT), 'ANALYZER_EXECUTION_FAILED');

      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(cause.message);
      expect(harness.buildReport).not.toHaveBeenCalled();
      expect(harness.now).not.toHaveBeenCalled();
    },
  );

  it('does not double-wrap an existing application error from an analyzer', async () => {
    const harness = createHarness();
    const existing = new AnalyzeRepositoryError(
      'ANALYSIS_INVARIANT_VIOLATION',
      'Existing safe application error.',
    );
    harness.analyzeContractMapping.mockImplementationOnce(() => {
      throw existing;
    });

    await expect(createAnalyzeRepository(harness.dependencies)(INPUT)).rejects.toBe(existing);
    expect(harness.buildReport).not.toHaveBeenCalled();
  });

  it('rejects invalid clock values before report construction without exposing input details', async () => {
    const harness = createHarness({ now: () => new Date('not-a-date') });
    const error = await expectApplicationError(
      () => createAnalyzeRepository(harness.dependencies)(INPUT),
      'ANALYSIS_INVARIANT_VIOLATION',
    );

    expect(error.message).not.toContain('not-a-date');
    expect(harness.buildReport).not.toHaveBeenCalled();
  });

  it('wraps report-builder failures with a retained private cause', async () => {
    const privateFailure = new Error(`report schema failed at ${CANONICAL_CONFIG_PATH}`);
    const harness = createHarness({
      buildReport: (() => {
        throw privateFailure;
      }) as AnalyzeRepositoryDependencies['buildReport'],
    });

    const error = await expectApplicationError(
      () => createAnalyzeRepository(harness.dependencies)(INPUT),
      'REPORT_BUILD_FAILED',
    );

    expect(error.cause).toBe(privateFailure);
    expect(error.message).not.toContain(CANONICAL_CONFIG_PATH);
  });
});
