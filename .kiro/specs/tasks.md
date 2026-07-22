# DevGuard MVP Implementation Tasks

## Execution Rules

- Implement tasks in order.
- Keep the local pipeline functional after every milestone.
- Build analyzers against fixtures before integrating real local repositories.
- Do not begin GitHub integration until the local MVP is complete.
- Every completed task must include tests.
- Do not expand support beyond the explicitly documented TypeScript and OpenAPI subset.

## Milestone 1 — Project Foundation

### Task 1.1 — Initialize the TypeScript CLI project

Create:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/cli/index.ts`
- base scripts for build, test, lint, and CLI execution.

Use:

- Node.js 24
- pnpm
- TypeScript
- Commander.js
- Vitest
- Zod

Acceptance:

- `pnpm build` succeeds.
- `pnpm test` succeeds.
- `pnpm dev -- --help` displays CLI help.

### Task 1.2 — Add code-quality configuration

Add:

- ESLint;
- Prettier;
- strict TypeScript settings;
- import-boundary conventions where practical.

Acceptance:

- lint command succeeds;
- formatting command succeeds;
- no use of `any` without a documented reason.

### Task 1.3 — Create domain types

Implement shared types for:

- findings;
- repository context;
- generated tests;
- scoring;
- final report.

Acceptance:

- types match `design.md`;
- unit tests validate severity ordering and health-label mapping.

## Milestone 2 — Configuration

### Task 2.1 — Define the Zod configuration schema

Implement the structural schema for `.devguard.yml`.

Acceptance:

- valid config parses;
- missing required fields fail with actionable messages;
- unsupported version fails.

### Task 2.2 — Implement relational validation

Validate:

- referenced repositories;
- unique contract names;
- supported repository-role combinations;
- maximum repository count;
- OpenAPI repository references;
- TypeScript mapping references.

Acceptance:

- invalid references produce specific errors;
- one fullstack repository is valid;
- one frontend plus one backend repository is valid;
- unsupported combinations fail.

### Task 2.3 — Implement secure path resolution

Implement repository-root containment checks.

Acceptance:

- valid relative files resolve;
- `../` traversal outside repository roots fails;
- output files cannot escape the output directory;
- symlink behavior is documented and tested.

## Milestone 3 — Shared Fixtures and Pure Analysis

### Task 3.1 — Create fixture scenarios

Create fixture directories for:

- valid contract;
- missing property;
- incompatible type;
- required mismatch;
- missing tests;
- unsupported TypeScript;
- malformed OpenAPI.

Each fixture must include:

- `.devguard.yml`;
- minimal backend content;
- minimal frontend content;
- OpenAPI;
- optional requirements;
- expected findings.

Acceptance:

- fixtures are small;
- fixtures are deterministic;
- every fixture documents its expected result.

### Task 3.2 — Implement deterministic ID generation

Create stable finding and analysis ID helpers.

Acceptance:

- identical inputs generate identical finding IDs;
- IDs change when the rule, repository, file, or property changes.

## Milestone 4 — OpenAPI and TypeScript Parsing

### Task 4.1 — Implement OpenAPI document loading

Load YAML and JSON OpenAPI documents.

Acceptance:

- valid YAML loads;
- valid JSON loads;
- malformed content produces a typed recoverable error;
- configured schema can be found by exact name.

### Task 4.2 — Normalize supported OpenAPI schemas

Normalize:

- string;
- integer;
- number;
- boolean;
- primitive arrays;
- required properties.

Acceptance:

- integer and number normalize to `number`;
- unsupported nested values produce warnings;
- required state is correct.

### Task 4.3 — Implement TypeScript declaration loading with ts-morph

Locate:

- interfaces;
- object-literal type aliases.

Acceptance:

- exact configured declaration is selected;
- optional properties are detected;
- exported and non-exported declarations can be read;
- missing declarations produce a deterministic finding or warning.

### Task 4.4 — Normalize supported TypeScript properties

Normalize:

- string;
- number;
- boolean;
- primitive arrays;
- optional properties.

Acceptance:

- unsupported generics or utility types do not crash;
- unsupported values produce warnings;
- supported declarations match the normalized model.

## Milestone 5 — Contract Checker

### Task 5.1 — Compare normalized contracts (completed)

Compare normalized OpenAPI and TypeScript contracts.

Acceptance:

- missing property differences detected;
- incompatible primitive or scalar-versus-array type differences detected;
- required-state differences detected;
- matching properties produce no differences;
- TypeScript-only properties are ignored, because OpenAPI is authoritative in the MVP.

### Task 5.2 — Convert contract differences into findings (completed)

Convert the `ContractDifference` values from a usable `ContractComparisonResult` into deterministic `AnalysisFinding` values.

Acceptance:

- `missing-property` maps to `contract.missing-property` with `high` severity;
- `incompatible-type` maps to `contract.incompatible-type` with `critical` severity;
- `required-mismatch` maps to `contract.required-mismatch` with `high` severity;
- findings preserve comparison order and exact property names;
- finding IDs and root-cause IDs are deterministic;
- findings preserve mapping, repository, and TypeScript file metadata;
- evidence and recommendations use normalized values and do not expose complete source content.

### Task 5.3 — Convert contract-level failures into findings

Convert approved recoverable contract-level failures into deterministic `AnalysisFinding` values before comparison.

These conditions occur before a usable `ContractComparisonResult` exists. They must be handled by a converter separate from `createContractFindings`:

- OpenAPI schema not found: `contract.schema-not-found`, `high` severity;
- TypeScript declaration not found: `contract.typescript-type-not-found`, `high` severity;
- unsupported contract type: `contract.unsupported-type`, `warning` severity.

Acceptance:

- each approved recoverable user-visible failure becomes an `AnalysisFinding` with a stable ID, rule ID, `contract-checker` source, `contract` category, approved severity, mapping name, repository metadata, evidence, and recommendation;
- schema-not-found uses the OpenAPI file location when available;
- typescript-type-not-found uses the configured TypeScript file location;
- unsupported-type uses the TypeScript file and line when available;
- internal parser warnings remain internal until the Contract Checker orchestration converts an approved user-visible failure;
- parser failures not listed above remain outside this task unless separately approved.

### Task 5.4 — Add Contract Checker orchestration

Define the application boundary that runs the Contract Checker for each configured mapping.

Acceptance:

- the boundary connects OpenAPI loading, OpenAPI normalization, TypeScript loading, TypeScript normalization, normalized contract comparison, difference finding conversion, and contract-level failure finding conversion;
- comparison and `createContractFindings` run only when both normalized contracts are usable;
- the separate contract-level failure converter handles approved failures before comparison;
- the boundary preserves mapping and repository metadata for all generated findings;
- internal parser warnings remain typed internal results until explicitly converted under the approved Task 5.3 rules.

### Task 5.5 — Add Contract Checker integration tests

Run all approved contract fixtures through the Contract Checker orchestration boundary.

Acceptance:

- complete expected findings, including IDs, root-cause IDs, rule IDs, severity, metadata, locations, evidence, and recommendations, match exactly;
- valid contracts produce no findings;
- approved property-difference and contract-level failure fixtures are covered;
- repeated orchestration runs are deterministic.

## Milestone 6 — Risk Analyzer

### Task 6.1 — Implement sensitive-file detection

Use configured glob patterns.

Acceptance:

- matching changed files produce high findings;
- non-matching files do not;
- evidence identifies the matching pattern.

### Task 6.2 — Implement missing-related-test detection

Use this exact deterministic heuristic:

- `foo.ts` maps to `foo.test.ts` or `foo.spec.ts`;
- `foo.tsx` maps to `foo.test.tsx` or `foo.spec.tsx`;
- search in the same directory and in a sibling or nested `__tests__/` directory;
- only changed test files suppress the warning;
- semantic test-to-source mapping is not part of the MVP.

Acceptance:

- a changed production file without a related changed test produces a warning;
- a changed matching test file suppresses that warning;
- the finding explains which candidate test paths were checked;
- behavior is documented for monorepos and split repositories.

### Task 6.3 — Implement optional large-change-set rule

Detect configured file or line thresholds.

Acceptance:

- thresholds are deterministic;
- the rule can be disabled;
- the rule does not block the MVP if deferred.

## Milestone 7 — Test Scenario Generator

### Task 7.1 — Create deterministic scenario templates

Map finding rules to scenario templates.

Acceptance:

- every critical or high contract finding generates at least one scenario;
- generated tests link to finding IDs;
- duplicate scenarios are removed.

### Task 7.2 — Load requirements text

Support:

- CLI requirements path;
- config requirements path;
- no requirements.

Acceptance:

- CLI path has priority;
- missing optional requirements do not fail;
- requirements content is included only where useful.

### Task 7.3 — Generate optional Vitest scaffolds

Generate safe, reviewable scaffolds without writing into the target repositories.

Acceptance:

- code is stored in the report model only;
- code includes related finding references;
- no automatic overwrite occurs.

This task may be deferred until after the local end-to-end flow.

## Milestone 8 — Score Calculator

### Task 8.1 — Implement severity deductions

Use:

- critical: 20;
- high: 10;
- warning: 3;
- info: 0.

Acceptance:

- final score never falls below zero;
- deduction entries explain their source.

### Task 8.2 — Implement root-cause deduplication

Group by `rootCauseId ?? finding.id`.

Acceptance:

- only the highest-severity deduction per root cause applies;
- all findings remain visible in the report.

### Task 8.3 — Implement health labels

Acceptance:

- `90-100`: HEALTHY;
- `75-89`: REVIEW;
- `50-74`: HIGH_RISK;
- `0-49`: CRITICAL_RISK.

## Milestone 9 — Report Generation

### Task 9.1 — Implement report builder

Combine:

- source;
- repository references;
- findings;
- test scenarios;
- score;
- warnings.

Acceptance:

- JSON model validates;
- summary counts are correct.

### Task 9.2 — Implement Markdown formatter

Include:

- source header;
- repository comparisons;
- score;
- summary;
- ordered findings;
- diff-style evidence;
- test scenarios;
- warnings;
- collapsible generated code.

Acceptance:

- snapshot tests cover formatting;
- special Markdown characters are safely handled.

### Task 9.3 — Implement JSON formatter

Acceptance:

- output is valid UTF-8 JSON;
- stable field ordering is used where practical;
- repeated identical analysis produces equivalent JSON except timestamp and analysis ID if time-based.

### Task 9.4 — Implement atomic report writing

Acceptance:

- temporary files are cleaned on failure;
- final files are not partially written.

## Milestone 10 — Local Git Source

### Task 10.1 — Implement safe Git command wrapper

Acceptance:

- no shell interpolation;
- every Git command uses a 10-second timeout;
- timed-out processes are terminated and reported with a typed error;
- stdout and stderr are captured safely;
- secrets are not logged.

### Task 10.2 — Implement Git repository validation

Acceptance:

- valid repositories pass;
- non-Git directories fail clearly;
- missing base refs fail clearly.

### Task 10.3 — Parse changed-file metadata

Support:

- added;
- modified;
- deleted;
- renamed.

Acceptance:

- parser unit tests cover each status;
- paths are normalized.

### Task 10.4 — Load patches and complete relevant files

Acceptance:

- changed files contain patch metadata when available;
- complete mapped TypeScript and OpenAPI files are loaded;
- deleted files do not cause crashes;
- file-size limits are enforced.

### Task 10.5 — Combine two repository change sets

Acceptance:

- backend and frontend use independent base refs;
- one unified `RepositoryContext` is created;
- repository IDs remain attached to all files and findings.

## Milestone 11 — Application Orchestration and CLI

### Task 11.1 — Implement `analyzeRepository`

Wire:

- source;
- risk analyzer;
- contract checker;
- test generator;
- score calculator;
- report builder.

Acceptance:

- application layer imports no Commander.js or Octokit types;
- dependencies are injectable for tests.

### Task 11.2 — Implement `analyze local` CLI command

Acceptance:

```bash
devguard analyze local --config .devguard.yml
```

runs the complete pipeline.

### Task 11.3 — Implement output options

Support:

- custom output directory;
- custom requirements file;
- verbose mode;
- optional fail-below threshold.

Acceptance:

- exit codes are documented and tested.

### Task 11.4 — Implement polished console summary

Acceptance:

- output adapts to one or two repositories;
- no emojis are required for machine-readable modes;
- output remains readable in terminals without color.

## Milestone 12 — End-to-End Validation

### Task 12.1 — Create temporary Git repository test harness

Programmatically create fixture Git repositories with:

- base branch;
- changed frontend file;
- changed backend/OpenAPI file;
- optional tests.

Acceptance:

- test does not rely on the developer's global Git configuration beyond executable availability.

### Task 12.2 — Execute full CLI integration tests

Verify:

- exit code;
- console summary;
- findings;
- score;
- Markdown report;
- JSON report.

### Task 12.3 — Validate offline operation

Acceptance:

- local analysis succeeds without network access;
- no LLM key is required.

### Task 12.4 — Prepare demo fixture

Create a demo with:

- incompatible property type;
- required missing property;
- changed sensitive file;
- missing related test;
- at least three generated scenarios.

Acceptance:

- demo completes with one command;
- expected score and findings are documented.

## Milestone 13 — Documentation and Packaging

### Task 13.1 — Write README

Include:

- problem;
- features;
- installation (using the final verified package name);
- sample config;
- CLI usage;
- supported type subset;
- limitations;
- demo instructions;
- roadmap to GitHub support.

### Task 13.2 — Add sample project and report screenshots

Use generated text reports or terminal captures without exposing private repositories.

### Task 13.3 — Package the CLI for public distribution

Acceptance:

- executable `devguard` binary entry is configured;
- initial version is `0.1.0`;
- `npm pack --dry-run` lists only intended files;
- `npm pack` generates a valid tarball;
- the tarball installs cleanly in a temporary project and `devguard --help` works;
- the package does not include secrets, generated reports, private fixtures, internal session files, or unnecessary development artifacts;
- package name is verified against the npm registry for availability;
- clean checkout can build and run.

### Task 13.4 — Create GitHub Release

Acceptance:

- a Git tag matches the package version (`v0.1.0`);
- a GitHub Release is created with the same version;
- release notes summarize features and known limitations;
- the tarball is attached or installation instructions reference the published package.

### Task 13.5 — Create static demo page

Create a single static HTML page.

The page must include:

- product name, one-line tagline, and npm version badge;
- verified install and run commands using the actual published package name;
- one recorded terminal demo (GIF or asciinema embed);
- 3–4 short example report snippets (contract mismatch, score, summary);
- a link to the public GitHub repository.

The page must NOT include:

- a documentation framework (VitePress, Docusaurus, or similar);
- a navigation system, search, or multiple pages;
- interactive playgrounds or live editors;
- guides, API reference, or versioned docs.

Acceptance:

- page renders correctly when opened as a local HTML file;
- page deploys to S3 + CloudFront;
- the online URL satisfies the "public online demo link" submission requirement;
- no framework build step is required — single static HTML file only.

### Task 13.6 — Verify installation from published package

Acceptance:

- installation instructions in the README use the final verified package name;
- a fresh `npm install -g <package-name>` or `npx <package-name>` produces a working `devguard` command;
- the demo page install commands match the README.

## Roadmap Only — GitHub Adapter

**This milestone is outside the six-day hackathon submission and must not be implemented during the current sprint.** It is documented only to preserve the intended extension path after the local MVP is submitted.

### Task 14.1 — Define GitHub input configuration

Support a single GitHub PR initially.

### Task 14.2 — Implement Octokit metadata loading

Load:

- repository;
- PR number;
- base SHA;
- head SHA;
- changed files.

### Task 14.3 — Load complete relevant files

Use GitHub contents or blob APIs.

Acceptance:

- truncated patches do not prevent full-file retrieval;
- rate-limit errors are actionable.

### Task 14.4 — Produce `RepositoryContext`

Acceptance:

- analyzers require no changes;
- local and GitHub reports share the same schema.

### Task 14.5 — Add GitHub fixture/mocked integration tests

No live GitHub dependency in unit or CI tests.

## Required Six-Day Execution Order

### Day 1

- Milestones 1-3
- Project foundation
- Configuration
- Security-oriented path validation
- Fixture setup

### Day 2

- Milestone 4
- OpenAPI parser
- TypeScript parser
- Normalized contract model

### Day 3

- Milestone 5
- Contract Checker
- Milestone 6
- Risk Analyzer

### Day 4

- Milestone 7
- Deterministic test scenarios
- Milestone 8
- Score calculator

Executable Vitest scaffolds are deferred unless all required work is already passing.

### Day 5

- Milestone 9
- Markdown and JSON reports
- Milestone 10
- Local Git source

### Day 6

- Milestone 11
- CLI orchestration
- Milestone 12
- End-to-end demo
- Minimum README and packaging work from Milestone 13

### Explicit Sprint Exclusions

During this six-day sprint, do not implement:

- GitHub adapter;
- Octokit integration;
- automatic GitHub comments;
- web UI;
- LLM integration;
- optional category scores;
- nonessential report decorations.

These remain roadmap items even if required local work finishes early.

## Definition of Done

The MVP is done only when:

- local repositories are analyzed through real Git diffs;
- contract findings are deterministic;
- reports are generated;
- tests pass;
- the demo works offline;
- GitHub support is not required for a successful presentation.
