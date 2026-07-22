# DevGuard MVP Technical Design

## 1. Architecture Summary

DevGuard uses a modular-monolith architecture with explicit boundaries between:

- repository input sources;
- deterministic analyzers;
- optional AI enrichment;
- scoring;
- reporting;
- CLI orchestration.

The core pipeline must not depend on GitHub, Octokit, terminal formatting, or a specific source implementation.

```text
Local Repository Source ──────┐
                              ├── RepositoryContext
Future GitHub PR Source ──────┘          |
                                         v
                               PR Risk Analyzer
                                         |
                               Contract Checker
                                         |
                               Test Generator
                                         |
                               Score Calculator
                                         |
                               Report Builder
                                         |
                         Console + Markdown + JSON
```

## 2. Technology Decisions

- Runtime: Node.js 24
- Language: TypeScript
- Package manager: pnpm
- CLI: Commander.js
- Validation: Zod
- Tests: Vitest
- TypeScript parsing: ts-morph
- OpenAPI/YAML parsing: established OpenAPI and YAML libraries
- Git access: safe child-process wrapper using argument arrays
- Architecture: modular monolith
- Primary interface: CLI

No Nx or Turborepo is required for the MVP.

## 3. Suggested Repository Structure

```text
devguard/
├── .kiro/
│   ├── specs/
│   │   ├── requirements.md
│   │   ├── design.md
│   │   └── tasks.md
│   └── steering/
│       └── devguard-guidelines.md
├── docs/
│   └── decisions.md
├── src/
│   ├── application/
│   │   └── analyze-repository.ts
│   ├── cli/
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   └── analyze-local.ts
│   │   └── console-reporter.ts
│   ├── config/
│   │   ├── config-schema.ts
│   │   ├── load-config.ts
│   │   └── path-security.ts
│   ├── sources/
│   │   ├── repository-source.ts
│   │   ├── local-repository-source.ts
│   │   ├── local-git-diff-provider.ts
│   │   ├── repository-file-loader.ts
│   │   └── github-pr-source.ts
│   ├── modules/
│   │   ├── pr-risk-analyzer/
│   │   ├── contract-checker/
│   │   ├── test-generator/
│   │   └── score-calculator/
│   ├── reports/
│   │   ├── report-builder.ts
│   │   ├── markdown-formatter.ts
│   │   └── json-formatter.ts
│   ├── types/
│   │   ├── findings.ts
│   │   ├── repository.ts
│   │   ├── reports.ts
│   │   └── tests.ts
│   └── shared/
│       ├── errors.ts
│       ├── ids.ts
│       └── result.ts
├── fixtures/
│   ├── valid-contract/
│   ├── missing-property/
│   ├── incompatible-type/
│   ├── required-mismatch/
│   └── missing-tests/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── vitest.config.ts
```

`github-pr-source.ts` may begin as an interface-compatible placeholder and should not block the local MVP.

## 4. Domain Types

### 4.1 Findings

```typescript
export type Severity =
  | 'info'
  | 'warning'
  | 'high'
  | 'critical';

export type Category =
  | 'risk'
  | 'contract'
  | 'testing';

export type FindingSource =
  | 'pr-risk-analyzer'
  | 'contract-checker'
  | 'test-generator';

export interface SourceLocation {
  repositoryId: string;
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface FindingEvidence {
  expected?: string;
  actual?: string;
  codeSnippet?: string;
  details?: Record<string, unknown>;
}

export interface AnalysisFinding {
  id: string;
  ruleId: string;
  rootCauseId?: string;
  source: FindingSource;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  location?: SourceLocation;
  evidence?: FindingEvidence;
  recommendation?: string;
  relatedFindingIds?: string[];
  metadata?: Record<string, unknown>;
}
```

### 4.2 Repository context

```typescript
export type RepositoryRole =
  | 'frontend'
  | 'backend'
  | 'fullstack';

export type ChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'unknown';

export interface ChangedFile {
  repositoryId: string;
  path: string;
  previousPath?: string;
  status: ChangeStatus;
  patch?: string;
  addedLines?: number;
  deletedLines?: number;
}

export interface RepositoryFile {
  repositoryId: string;
  path: string;
  absolutePath?: string;
  content: string;
  sizeBytes: number;
}

export interface RepositoryChangeSet {
  repositoryId: string;
  repositoryPath: string;
  role: RepositoryRole;
  baseRef: string;
  headRef: string;
  changedFiles: ChangedFile[];
}

export interface RepositoryContext {
  sourceType: 'local' | 'github';
  sourceLabel: string;
  repositories: RepositoryChangeSet[];
  files: RepositoryFile[];
  requirements?: string;
  warnings: string[];
  metadata?: Record<string, unknown>;
}
```

### 4.3 Source abstraction

```typescript
export interface AnalysisInput {
  configPath: string;
  requirementsPath?: string;
  outputDirectory?: string;
}

export interface RepositorySource {
  loadContext(input: AnalysisInput): Promise<RepositoryContext>;
}
```

The application layer receives `RepositorySource` through dependency injection.

### 4.4 Tests

```typescript
export type SupportedTestFramework =
  | 'vitest'
  | 'jest'
  | 'scenario-only';

export interface GeneratedTest {
  id: string;
  framework: SupportedTestFramework;
  title: string;
  rationale: string;
  filePath?: string;
  code?: string;
  relatedFindingIds: string[];
}
```

### 4.5 Scoring

```typescript
export interface ScoreDeduction {
  findingId: string;
  rootCauseId?: string;
  severity: Severity;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  initialScore: 100;
  finalScore: number;
  deductions: ScoreDeduction[];
}
```

### 4.6 Report

```typescript
export interface FindingSummary {
  totalCount: number;
  criticalCount: number;
  highCount: number;
  warningCount: number;
  infoCount: number;
  riskCount: number;
  contractCount: number;
  testingCount: number;
}

export interface PRHealthReport {
  version: '1.0';
  analysisId: string;
  generatedAt: string;
  source: {
    type: 'local' | 'github';
    label: string;
  };
  repositories: Array<{
    repositoryId: string;
    role: RepositoryRole;
    baseRef: string;
    headRef: string;
  }>;
  healthScore: number;
  healthLabel: 'HEALTHY' | 'REVIEW' | 'HIGH_RISK' | 'CRITICAL_RISK';
  scoreBreakdown: ScoreBreakdown;
  summary: FindingSummary;
  findings: AnalysisFinding[];
  generatedTests: GeneratedTest[];
  warnings: string[];
}
```

## 5. Configuration Design

### 5.1 TypeScript representation

```typescript
export interface DevGuardConfig {
  version: 1;
  repositories: Record<string, {
    path: string;
    baseRef: string;
    role: RepositoryRole;
  }>;
  openapi: {
    repository: string;
    path: string;
  };
  contracts: Array<{
    name: string;
    openapiSchema: string;
    typescript: {
      repository: string;
      file: string;
      type: string;
    };
  }>;
  risk?: {
    sensitivePatterns?: string[];
    productionPatterns?: string[];
  };
  testing?: {
    testPatterns?: string[];
    requirementsFile?: string;
    framework?: 'vitest' | 'jest' | 'scenario-only';
  };
  output?: {
    directory?: string;
    markdown?: string;
    json?: string;
  };
}
```

### 5.2 Zod schema responsibilities

The Zod schema must enforce structural validity.

Post-schema validation must enforce relational rules:

- referenced repositories exist;
- only supported repository-role combinations are used;
- contract names are unique;
- all configured paths remain inside their repository root;
- output paths remain inside the output directory;
- at most one frontend and one backend repository exist unless using one fullstack repository.

## 6. Local Source Design

`LocalRepositorySource` performs these steps:

1. Load and validate configuration.
2. Resolve repository roots.
3. Verify each directory is a Git repository.
4. Obtain current HEAD.
5. Calculate independent diffs against each configured `baseRef`.
6. Build `RepositoryChangeSet` values.
7. Select complete files required for:
   - configured contract mappings;
   - changed production files;
   - changed test files;
   - OpenAPI;
   - optional requirements.
8. Read files subject to:
   - repository-boundary validation;
   - supported text-file extensions;
   - maximum file-size limits.
9. Return `RepositoryContext`.

### 6.1 Safe Git process execution

Use:

```typescript
spawn(command, args, options)
```

or an equivalent API with an argument array.

Never construct an interpolated shell command.

Every Git process must have a default timeout of **10 seconds**. A timeout must terminate the process and produce a typed `GIT_COMMAND_FAILED` error with a safe diagnostic message. The timeout may become configurable after the hackathon.

Example conceptual invocation:

```typescript
runGit(repositoryPath, [
  'diff',
  '--name-status',
  `${baseRef}...HEAD`,
]);
```

### 6.2 Git parsing

The diff provider should expose:

```typescript
export interface GitDiffProvider {
  getHeadRef(repositoryPath: string): Promise<string>;
  getChangedFiles(
    repositoryPath: string,
    baseRef: string,
    headRef: string,
  ): Promise<ChangedFile[]>;
}
```

Patch retrieval may be batched or performed per file.

## 7. Risk Analyzer Design

```typescript
export interface RiskAnalyzer {
  analyze(
    context: RepositoryContext,
    config: DevGuardConfig,
  ): AnalysisFinding[];
}
```

Rules should be implemented as independent pure functions:

```text
modules/pr-risk-analyzer/rules/
├── sensitive-file-change.ts
├── missing-related-tests.ts
└── large-change-set.ts
```

Every rule returns zero or more `AnalysisFinding` values.

Stable finding IDs should derive from:

```text
ruleId + repositoryId + file + relevant property
```

Use a deterministic hash rather than random UUIDs for findings.

## 8. Contract Checker Design

### 8.1 Processing flow

For each configured mapping:

1. Load the OpenAPI schema.
2. Load the complete TypeScript file.
3. Find the configured TypeScript declaration.
4. Normalize both contracts.
5. Compare normalized properties.
6. Produce findings and warnings.

### 8.2 Normalized contract model

```typescript
export type NormalizedPrimitive =
  | 'string'
  | 'number'
  | 'boolean';

export interface NormalizedProperty {
  name: string;
  type: NormalizedPrimitive;
  isArray: boolean;
  required: boolean;
}

export interface NormalizedContract {
  name: string;
  source: 'openapi' | 'typescript';
  properties: Map<string, NormalizedProperty>;
}
```

OpenAPI `integer` and `number` normalize to TypeScript `number`.

### 8.3 Comparison rules

For each OpenAPI property:

- missing in TypeScript:
  - `contract.missing-property`;
- normalized type differs:
  - `contract.incompatible-type`;
- required state differs:
  - `contract.required-mismatch`.

Additional findings:

- missing OpenAPI schema;
- missing TypeScript declaration;
- unsupported type;
- parser failure.

Unsupported values must add a report warning and may add an informational finding.

### 8.4 Severity defaults

- required backend property missing in frontend: `high`
- incompatible primitive type: `critical`
- required-versus-optional mismatch: `high`
- schema/type not found: `high`
- unsupported construct: `warning`

Severity must come from deterministic rules.

## 9. Test Generator Design

The first increment should produce structured scenarios deterministically.

Example mapping:

```text
contract.missing-property
  -> Validate behavior when the required property is absent.
  -> Verify the frontend payload includes the property.

contract.incompatible-type
  -> Reject or convert an invalid frontend value.
  -> Verify the serialized request matches the API primitive type.

contract.required-mismatch
  -> Prevent submission when the backend-required value is absent.

risk.missing-related-tests
  -> Add a regression test covering the changed production behavior.
```

An optional LLM enrichment adapter may later improve wording or generate code.

```typescript
export interface TestGenerator {
  generate(
    context: RepositoryContext,
    findings: AnalysisFinding[],
    config: DevGuardConfig,
  ): Promise<GeneratedTest[]>;
}
```

The deterministic generator must work without credentials.

## 10. Score Calculator Design

```typescript
const DEDUCTIONS: Record<Severity, number> = {
  critical: 20,
  high: 10,
  warning: 3,
  info: 0,
};
```

Algorithm:

1. Group findings by `rootCauseId ?? finding.id`.
2. Select the highest-severity finding in each group.
3. Create one deduction for that group.
4. Sum deductions.
5. Calculate `max(0, 100 - total)`.
6. Assign health label.

Severity ranking:

```text
critical > high > warning > info
```

The output must include all applied deductions.

## 11. Application Orchestration

```typescript
export async function analyzeRepository(
  source: RepositorySource,
  input: AnalysisInput,
  dependencies: {
    riskAnalyzer: RiskAnalyzer;
    contractChecker: ContractChecker;
    testGenerator: TestGenerator;
    scoreCalculator: ScoreCalculator;
    reportBuilder: ReportBuilder;
  },
): Promise<PRHealthReport> {
  const context = await source.loadContext(input);
  const config = await loadConfig(input.configPath);

  const riskFindings = dependencies.riskAnalyzer.analyze(context, config);
  const contractResult = dependencies.contractChecker.analyze(context, config);

  const findings = [
    ...riskFindings,
    ...contractResult.findings,
  ];

  const generatedTests = await dependencies.testGenerator.generate(
    context,
    findings,
    config,
  );

  const testingFindings = createTestingFindings(generatedTests, findings);
  const allFindings = [...findings, ...testingFindings];

  const scoreBreakdown = dependencies.scoreCalculator.calculate(allFindings);

  return dependencies.reportBuilder.build({
    context,
    findings: allFindings,
    generatedTests,
    scoreBreakdown,
  });
}
```

Implementations may refine signatures, but the dependency direction must remain the same.

## 12. Reporting Design

### 12.1 Ordering

Findings must be ordered by:

1. severity;
2. category;
3. repository;
4. file;
5. rule ID.

### 12.2 Markdown evidence

A contract mismatch should render as:

```diff
- OpenAPI UpdateBookRequest: authorId: number (required)
+ TypeScript UpdateBookPayload: authorId is missing
```

### 12.3 Long code sections

Use:

```html
<details>
<summary>Generated Vitest scaffold</summary>

```typescript
// generated suggestion
```

</details>
```

### 12.4 Atomic writes

Reports should be written atomically:

1. write temporary file;
2. rename temporary file to final path.

This avoids partial reports.

## 13. Error Model

Use typed application errors:

```typescript
export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'REPOSITORY_NOT_FOUND'
  | 'NOT_A_GIT_REPOSITORY'
  | 'BASE_REF_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'PATH_OUTSIDE_REPOSITORY'
  | 'OPENAPI_PARSE_FAILED'
  | 'TYPESCRIPT_PARSE_FAILED'
  | 'OUTPUT_WRITE_FAILED';
```

Recoverable parser errors become warnings.

Unrecoverable configuration and repository errors terminate execution.

## 14. Testing Strategy

### 14.1 Unit tests

Test:

- Zod configuration schema;
- relational configuration validation;
- path containment;
- Git output parsing;
- every risk rule;
- OpenAPI normalization;
- TypeScript normalization;
- contract comparison;
- root-cause score deduplication;
- Markdown formatting;
- JSON schema compliance.

### 14.2 Fixture integration tests

Required fixture scenarios:

- valid contract;
- missing property;
- incompatible type;
- required mismatch;
- missing related tests;
- unsupported TypeScript construct;
- malformed OpenAPI;
- multiple repositories with independent base refs.

### 14.3 End-to-end test

Execute the CLI against a temporary Git repository fixture and verify:

- exit code;
- console output;
- Markdown report;
- JSON report;
- deterministic score.

## 15. GitHub Adapter Design Boundary

The future GitHub adapter implements `RepositorySource`.

It may use Octokit, but must return the same domain model as local mode.

The analysis modules must not import Octokit types.

GitHub-specific data belongs in `RepositoryContext.metadata`.

## 16. Performance Limits

Default limits should be configurable constants:

- maximum repositories: 2
- maximum changed files: 500
- maximum individual file size: 1 MB
- maximum total loaded text: 20 MB
- maximum patch size per file: 250 KB
- Git command timeout: 10 seconds

Exceeding limits should produce a clear warning or fail safely depending on the limit.

## 17. Observability

The CLI should support:

```bash
--verbose
```

Verbose logs may show:

- configuration path;
- repositories loaded;
- Git commands without secrets;
- files selected;
- module durations;
- warning counts.

Default output remains concise.

## 18. Future Extension Points

- `GitHubPullRequestSource`
- LLM test scaffold generation
- GitHub Action wrapper
- automatic mapping suggestions
- Zod schema inspection
- category-specific scores
- HTML report
- additional languages and test frameworks
