# DevGuard MVP Requirements

## 1. Product Vision

DevGuard is a developer productivity CLI that performs preventive code-review analysis before changes are merged.

It analyzes real local Git repositories, detects risky changes, compares backend OpenAPI contracts with frontend TypeScript models, identifies missing test coverage, suggests test scenarios, and produces reproducible Markdown and JSON reports.

GitHub Pull Request support is a planned adapter that will reuse the same analysis pipeline. The MVP must not depend on GitHub to remain functional or demonstrable.

## 2. Problem Statement

Frontend and backend changes frequently drift apart:

- API schemas change without corresponding frontend updates.
- Required properties become optional or disappear.
- Primitive types become incompatible.
- Sensitive files are modified without sufficient review context.
- Production code changes without related tests.
- Acceptance criteria are not translated into concrete test scenarios.

These problems are often detected late, after integration or deployment. DevGuard moves these checks earlier into the development workflow.

## 3. Target Users

Primary users:

- Frontend and backend developers.
- Small engineering teams.
- Pull Request reviewers.
- Technical leads.
- Developers maintaining separate frontend and backend repositories.

## 4. MVP Scope

The MVP must support:

- Local Git repositories.
- One monorepository containing frontend and backend, or:
  - one frontend repository; and
  - one backend repository.
- Independent Git diff calculation for every configured repository.
- Configurable base branch or base reference per repository.
- OpenAPI 3.x documents stored locally.
- TypeScript interfaces and object-literal type aliases.
- Explicit OpenAPI-to-TypeScript mappings in `.devguard.yml`.
- Detection of:
  - sensitive-file changes;
  - production changes without related test changes;
  - missing properties;
  - incompatible primitive types;
  - required-versus-optional mismatches.
- Suggested test scenarios.
- A deterministic global health score.
- Console, Markdown, and JSON output.
- Partial-failure warnings when individual files cannot be analyzed.

## 5. Out of Scope for the MVP

The MVP will not include:

- GitLab or Bitbucket integration.
- Mandatory GitHub connectivity.
- Automatic GitHub comments.
- A web UI.
- Automatic commits or source-code modification.
- Execution of untrusted repository code.
- Full security auditing.
- Automatic inference of arbitrary OpenAPI-to-TypeScript mappings.
- Complete resolution of every TypeScript language construct.
- Support for Java, C#, Python, Ruby, or PHP models.
- Separate risk, contract, and testing scores.
- Analysis of an unrestricted number of microservice repositories.
- Remote OpenAPI URLs.

## 6. Core User Flow

1. The user adds `.devguard.yml`.
2. The user runs DevGuard from the command line.
3. DevGuard validates the configuration.
4. DevGuard calculates the Git diff for each configured repository.
5. DevGuard loads the complete contents of relevant files.
6. The Risk Analyzer creates deterministic findings.
7. The Contract Checker compares configured OpenAPI schemas with TypeScript models.
8. The Test Generator produces suggested scenarios using:
   - explicit requirements;
   - deterministic findings; and
   - changed-file context.
9. The Score Calculator assigns a global score.
10. DevGuard writes:
    - a console summary;
    - `devguard-report.md`; and
    - `devguard-report.json`.

## 7. CLI Requirements

The primary command must follow this general form:

```bash
devguard analyze local --config .devguard.yml
```

Optional overrides may include:

```bash
devguard analyze local \
  --config .devguard.yml \
  --requirements requirements.md \
  --output ./reports
```

The CLI must:

- return exit code `0` when analysis completes successfully;
- return a non-zero exit code for invalid configuration or unrecoverable input errors;
- continue when an individual supported file cannot be parsed;
- display warnings without exposing secrets;
- create the configured output directory when it does not exist.

The CLI should support a strict threshold option in a later MVP increment:

```bash
devguard analyze local --fail-below 70
```

When enabled, DevGuard returns a non-zero exit code if the final score is below the threshold.

## 8. Configuration Requirements

DevGuard must read `.devguard.yml`.

Example:

```yaml
version: 1

repositories:
  backend:
    path: ../customer-store-api
    baseRef: main
    role: backend

  frontend:
    path: ../customer-store-web
    baseRef: develop
    role: frontend

openapi:
  repository: backend
  path: docs/openapi.yaml

contracts:
  - name: UpdateCustomerStore
    openapiSchema: UpdateCustomerStoreRequest
    typescript:
      repository: frontend
      file: src/api/customer-store.types.ts
      type: UpdateCustomerStorePayload

risk:
  sensitivePatterns:
    - "**/.env*"
    - "**/auth/**"
    - "**/migrations/**"
    - "**/Dockerfile"
    - "**/.github/workflows/**"

testing:
  testPatterns:
    - "**/*.test.ts"
    - "**/*.spec.ts"
  requirementsFile: requirements.md

output:
  directory: .devguard
  markdown: devguard-report.md
  json: devguard-report.json
```

Validation rules:

- `version` must equal `1`.
- Repository identifiers must be unique.
- Repository paths must exist.
- Every repository must define `baseRef` and `role`.
- `openapi.repository` must reference a configured repository.
- Every contract mapping must reference a configured repository.
- Every contract name must be unique.
- File paths must remain inside their configured repository root.
- Output paths must not escape the output directory.

## 9. Repository Analysis Requirements

For each configured repository, DevGuard must conceptually execute:

```bash
git -C <repository-path> diff --name-status <base-ref>...HEAD
git -C <repository-path> diff --unified=0 <base-ref>...HEAD
```

Implementation may use a safe process wrapper rather than a shell string.

DevGuard must capture:

- repository identifier;
- repository path;
- base reference;
- current HEAD reference;
- changed file path;
- change status;
- patch when available;
- relevant line ranges when available.

Each repository must be diffed independently.

The MVP supports a maximum of:

- one frontend repository;
- one backend repository; or
- one repository with role `fullstack`.

## 10. Risk Analyzer Requirements

The Risk Analyzer must produce findings for:

### 10.1 Sensitive files

A changed file matching a configured sensitive pattern produces:

```text
risk.sensitive-file-change
```

Default severity:

- `high` for environment, authentication, deployment, workflow, and migration files.
- Configurable rules may be introduced later.

### 10.2 Missing related tests

When production TypeScript files change and no matching test file changes, DevGuard produces:

```text
risk.missing-related-tests
```

Default severity: `warning`.

The MVP must use this deterministic filename heuristic:

- for a changed production file named `foo.ts`, search for `foo.test.ts` or `foo.spec.ts`;
- search first in the same directory;
- also search in a sibling or nested `__tests__/` directory;
- for `foo.tsx`, use `foo.test.tsx` or `foo.spec.tsx`;
- a changed matching test file suppresses the warning;
- semantic test-to-source mapping is outside the MVP.

The heuristic must be documented in the report when it produces `risk.missing-related-tests`.

### 10.3 Large change set

DevGuard may produce:

```text
risk.large-change-set
```

when changed-file or changed-line thresholds are exceeded.

This rule is optional for the first working increment but must be supported by the shared rule model.

## 11. Contract Checker Requirements

The Contract Checker must:

- parse the configured OpenAPI document;
- locate schemas by exact configured schema name;
- parse the configured TypeScript file;
- locate interfaces and object-literal type aliases by exact configured type name;
- normalize supported types;
- compare property names, optionality, and primitive types;
- create deterministic findings.

Supported OpenAPI values:

- `string`
- `integer`
- `number`
- `boolean`
- arrays of supported primitive values

Supported TypeScript values:

- `string`
- `number`
- `boolean`
- arrays of supported primitive values
- optional properties using `?`

Supported declaration examples:

```typescript
export interface CustomerStore {
  id: number;
  storeNumber: string;
  active?: boolean;
  tags: string[];
}
```

```typescript
export type UpdateCustomerStorePayload = {
  modelTierId: number;
  compositeRank?: number;
};
```

Initially unsupported examples include:

```typescript
type CustomerStore = Pick<ApiResponse<Normalized<Customer>>, CustomerFields>;
```

Unsupported constructs must generate warnings, not crashes.

Required rules:

- `contract.missing-property`
- `contract.incompatible-type`
- `contract.required-mismatch`
- `contract.schema-not-found`
- `contract.typescript-type-not-found`
- `contract.unsupported-type`

Property-name comparison is exact and case-sensitive in the MVP.

## 12. Test Generator Requirements

The Test Generator must consume:

- acceptance criteria or requirements text when provided;
- changed files;
- contract findings;
- risk findings.

Sources of requirements, in priority order:

1. CLI `--requirements` file.
2. `testing.requirementsFile` from configuration.
3. No functional requirements; generate scenarios from findings only.

The generator must produce at least one scenario for every critical or high contract finding.

For a required property mismatch, a scenario may be:

```text
Reject or prevent submission when modelTierId is missing.
```

The MVP must support structured test scenarios. Executable Vitest scaffolds are optional but desirable.

Generated code must never overwrite repository files automatically.

## 13. Scoring Requirements

DevGuard must calculate one global deterministic score.

Initial score:

```text
100
```

Default deductions:

- critical: `-20`
- high: `-10`
- warning: `-3`
- info: `0`

Final score:

```text
max(0, 100 - deductions)
```

Findings sharing the same `rootCauseId` must not receive duplicate primary deductions. The highest-severity deduction for that root cause applies.

The LLM must never calculate or modify the score.

Health labels:

- `90-100`: HEALTHY
- `75-89`: REVIEW
- `50-74`: HIGH RISK
- `0-49`: CRITICAL RISK

## 14. Reporting Requirements

### 14.1 Console

The console report must adapt to the source.

Example:

```text
DevGuard Review v1.0
Source: Local Git Repositories
Repositories: backend, frontend
Comparison:
- backend: main...HEAD
- frontend: develop...HEAD

Health Score: 67/100 [HIGH RISK]
Critical: 1 | High: 2 | Warning: 1 | Info: 0
Suggested Tests: 4

Reports:
- .devguard/devguard-report.md
- .devguard/devguard-report.json
```

### 14.2 Markdown

The Markdown report must include:

- source information;
- repository comparisons;
- score and health label;
- summary counts;
- critical and high findings first;
- file and line information when available;
- expected-versus-actual evidence;
- suggested test scenarios;
- warnings and analysis limitations;
- collapsible sections for long generated test code.

### 14.3 JSON

The JSON report must validate against the shared `PRHealthReport` schema.

## 15. Security and Privacy Requirements

DevGuard must:

- never log tokens;
- never include environment-variable values in reports;
- normalize and validate filesystem paths;
- reject path traversal outside repository roots;
- invoke Git without shell interpolation;
- limit file sizes read into memory;
- avoid sending repository content to an LLM unless explicitly enabled;
- redact likely secrets before optional LLM requests.

LLM usage is optional for the MVP. Deterministic modules must work without an LLM key.

## 16. Reliability Requirements

DevGuard must:

- fail clearly for invalid configuration;
- continue analysis after recoverable parser failures;
- collect limitations in a `warnings` field;
- use stable finding identifiers;
- produce deterministic results for identical inputs;
- operate offline in local mode.

## 17. Acceptance Criteria

The MVP is complete when:

1. A valid `.devguard.yml` can configure one or two local repositories.
2. Each repository is diffed independently against its own base reference.
3. DevGuard loads complete relevant files after identifying changes.
4. A sensitive-file change produces a finding.
5. A production change without a related test change produces a finding.
6. DevGuard parses a valid local OpenAPI 3.x document.
7. DevGuard parses a supported TypeScript interface.
8. DevGuard parses a supported TypeScript object-literal type alias.
9. A missing property is detected.
10. An incompatible primitive type is detected.
11. A required-versus-optional mismatch is detected.
12. Unsupported constructs create warnings rather than crashing.
13. At least three useful test scenarios can be generated for the demo fixture.
14. A deterministic score and deduction list are produced.
15. Root-cause deduplication prevents duplicate score penalties.
16. Valid Markdown and JSON reports are generated.
17. The CLI prints a concise summary.
18. Fixtures cover valid and invalid contract scenarios.
19. The full local flow runs without internet access.
20. No secret values are written to logs or reports.

## 18. Planned Post-MVP Capability

A future `GitHubPullRequestSource` will use Octokit to load:

- Pull Request metadata;
- changed files and patches;
- complete relevant files;
- base and head references.

It must produce the same `RepositoryContext` consumed by the local pipeline.

## 19. Package Distribution Requirements

DevGuard must be distributed as a public npm-compatible package.

Requirements:

1. The installed executable command must be `devguard`.
2. The npm package name will be selected after checking registry availability and may be scoped. The package name and executable name are separate decisions.
3. The package must be validated using `npm pack --dry-run` and `npm pack`.
4. The generated tarball must be installed and tested in a clean temporary project.
5. A GitHub Release must be created using the same semantic version as the package and Git tag.
6. Installation instructions must appear in the README and the static demo page, using the final verified package name once selected.
7. The initial public MVP version is `0.1.0`.
8. Package publication must not include secrets, generated reports, private fixtures, internal session files, or unnecessary development artifacts.

## 20. Static Demo Page Requirements

The submission requires a single static HTML demo page hosted on S3 + CloudFront.

The page must include:

- product name, one-line tagline, and npm version badge;
- the final verified install and run commands using the actual published package name;
- the installed executable itself must remain `devguard`;
- one recorded terminal demo (GIF or asciinema embed);
- 3–4 short example report snippets (contract mismatch, score, summary);
- a link to the public GitHub repository.

The page must NOT include:

- a documentation framework (VitePress, Docusaurus, or similar);
- a navigation system, search, or multiple pages;
- interactive playgrounds or live editors;
- guides, API reference, or versioned docs.

A full documentation site is a post-hackathon roadmap item.
