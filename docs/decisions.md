# DevGuard Architecture Decision Record

## ADR-001: Modular Monolith

**Status:** ACCEPTED

**Decision:** DevGuard will use a modular-monolith architecture for the MVP.

**Rationale:** It provides clear module boundaries without the overhead of distributed services or a monorepo framework.

**Consequences:** All modules live in one TypeScript project but communicate through explicit interfaces.

---

## ADR-002: Local Repositories First

**Status:** ACCEPTED

**Decision:** The first complete product flow analyzes real local Git repositories.

**Rationale:** Local repositories provide complete source files and real Git changes without rate limits, permissions, tokens, or network dependencies.

**Consequences:** The MVP remains functional and demonstrable offline.

---

## ADR-003: RepositorySource Abstraction

**Status:** ACCEPTED

**Decision:** Repository input is represented by a `RepositorySource` interface returning a shared `RepositoryContext`.

**Rationale:** Local Git and future GitHub Pull Request inputs must feed the same analysis pipeline.

**Consequences:** Analyzers cannot depend on filesystem-specific or Octokit-specific types.

---

## ADR-004: Independent Diff per Repository

**Status:** ACCEPTED

**Decision:** When frontend and backend are stored in separate repositories, each repository is diffed independently against its configured base reference.

**Rationale:** Separate repositories may use different branching strategies and base branches.

**Consequences:** Findings and files must retain a `repositoryId`.

---

## ADR-005: Explicit Contract Mapping

**Status:** ACCEPTED

**Decision:** OpenAPI schemas and TypeScript declarations are paired explicitly in `.devguard.yml`.

**Rationale:** Automatic name inference is unreliable and would introduce a separate matching subsystem.

**Consequences:** Users must configure mappings. Automatic suggestions may be added later.

---

## ADR-006: Restricted TypeScript Subset

**Status:** ACCEPTED

**Decision:** The MVP supports interfaces and object-literal type aliases containing primitive properties and primitive arrays.

**Rationale:** Resolving arbitrary imports, generics, conditional types, and utility types would exceed the MVP scope.

**Consequences:** Unsupported declarations generate warnings rather than terminating analysis.

---

## ADR-007: Local OpenAPI Source

**Status:** ACCEPTED

**Decision:** The MVP reads OpenAPI from a configured local repository file.

**Rationale:** Remote URLs add authentication, availability, versioning, and reproducibility problems.

**Consequences:** Remote OpenAPI loading is deferred.

---

## ADR-008: Deterministic Analysis Before AI

**Status:** ACCEPTED

**Decision:** Contract comparison, severity, and scoring are deterministic.

**Rationale:** Structural checks must be reproducible and testable.

**Consequences:** LLM features are optional enrichment and cannot alter deterministic results.

---

## ADR-009: Global Health Score

**Status:** ACCEPTED

**Decision:** The MVP calculates one global health score rather than separate category scores.

**Rationale:** A single score is simpler to explain, test, and demonstrate.

**Consequences:** Reports still show finding counts by category. Category scores are deferred.

---

## ADR-010: Score Deduction Rules

**Status:** ACCEPTED

**Decision:** Start at 100 and deduct:

- critical: 20
- high: 10
- warning: 3
- info: 0

Only the highest-severity deduction applies per root cause.

**Rationale:** Fixed rules are transparent and prevent repeated penalties for the same underlying issue.

**Consequences:** The score is deterministic and explainable.

---

## ADR-011: CLI-First Interface

**Status:** ACCEPTED

**Decision:** DevGuard is a CLI for the MVP.

**Rationale:** A CLI is faster to build, easy to automate, and appropriate for a developer tool.

**Consequences:** Web UI is deferred.

---

## ADR-012: Markdown and JSON Reports

**Status:** ACCEPTED

**Decision:** DevGuard produces console, Markdown, and JSON output.

**Rationale:** Console serves developers, Markdown supports review artifacts, and JSON supports automation.

**Consequences:** HTML reporting is deferred.

---

## ADR-013: Fixtures Before Integrations

**Status:** ACCEPTED

**Decision:** Every analysis module is implemented and tested against controlled fixtures before being connected to real Git repositories.

**Rationale:** Fixtures isolate parser and rule behavior from source-integration variability.

**Consequences:** The task plan builds pure modules before local Git and GitHub adapters.

---

## ADR-014: GitHub as a Later Adapter

**Status:** ACCEPTED

**Decision:** GitHub Pull Request support is implemented only after the local MVP passes all acceptance criteria.

**Rationale:** GitHub adds rate limits, permissions, truncated patches, and token management.

**Consequences:** GitHub support improves the product but does not determine whether the MVP succeeds.

---

## ADR-015: No Automatic PR Comments in MVP

**Status:** DEFERRED

**Decision:** The MVP does not publish comments to GitHub.

**Rationale:** Write permissions and GitHub App configuration add unnecessary deployment friction.

**Future:** A GitHub Action or GitHub App may publish the generated Markdown.

---

## ADR-016: No Source Mutation

**Status:** ACCEPTED

**Decision:** DevGuard does not modify target repository files in the MVP.

**Rationale:** Generated tests and recommendations require human review.

**Consequences:** Test code is included only in reports or explicitly exported outside the target repository.

---

## ADR-017: pnpm and Node.js 24

**Status:** ACCEPTED

**Decision:** Use pnpm with Node.js 24.

**Rationale:** Node.js 24 is the runtime available in the development and submission environment. It provides current LTS-track features and aligns with the hackathon infrastructure. pnpm provides predictable dependency management suitable for a modern TypeScript CLI.

---

## ADR-018: ts-morph for Supported TypeScript Parsing

**Status:** ACCEPTED

**Decision:** Use ts-morph to inspect supported TypeScript declarations.

**Rationale:** It provides a practical API over the TypeScript compiler model.

**Consequences:** Use is deliberately restricted to the documented subset.

---

## ADR-019: Vitest for DevGuard Tests

**Status:** ACCEPTED

**Decision:** Use Vitest for DevGuard's own automated tests.

**Rationale:** It integrates well with TypeScript and supports fast unit and snapshot testing.

---

## ADR-020: Offline-Capable MVP

**Status:** ACCEPTED

**Decision:** The local MVP must operate without internet access or LLM credentials.

**Rationale:** Reliability is essential for development and Demo Day.

**Consequences:** Optional AI and GitHub features cannot be core dependencies.

---

## ADR-021: Six-Day Submission Scope

**Status:** ACCEPTED

**Decision:** The hackathon implementation sprint is limited to six days and ends with the completed local MVP, offline demo, and minimum documentation.

**Rationale:** GitHub integration would introduce rate limits, permissions, token handling, and truncated-patch behavior that threaten delivery of the core product.

**Consequences:** The GitHub adapter remains roadmap-only and must not be implemented during this submission, even if required local work finishes early.

---

## ADR-022: Related-Test Filename Heuristic

**Status:** ACCEPTED

**Decision:** A changed `foo.ts` or `foo.tsx` file is considered to have a related changed test only when a matching `foo.test.*` or `foo.spec.*` file changes in the same directory or a sibling/nested `__tests__/` directory.

**Rationale:** A fixed heuristic is deterministic, easy to test, and prevents Kiro from inventing inconsistent matching behavior.

**Consequences:** Semantic test-to-source mapping is deferred.

---

## ADR-023: Git Command Timeout

**Status:** ACCEPTED

**Decision:** Every Git subprocess uses a default timeout of 10 seconds.

**Rationale:** A fixed timeout prevents DevGuard from hanging indefinitely on malformed repositories or expensive Git operations.

**Consequences:** Timed-out commands terminate safely and produce a typed error. Configurable timeouts are deferred.

---

## ADR-025: Public CLI Package and GitHub Release

**Status:** ACCEPTED

**Decision:** DevGuard will be distributed as a public npm-compatible package exposing the `devguard` executable and as a versioned GitHub Release. The final npm package name will be selected after checking registry availability and may use a scope.

**Rationale:** The project must be usable outside its source repository and should demonstrate a real software delivery lifecycle.

**Consequences:** The package must be tested from its generated tarball in a clean environment before publication. Package version, Git tag, and GitHub Release must match. The executable name (`devguard`) remains stable regardless of the final package name.

---

## ADR-026: Minimal Static Demo Page Scope

**Status:** ACCEPTED

**Decision:** The hackathon submission includes one static HTML demo page hosted on S3 + CloudFront. A full documentation site is explicitly deferred.

**Rationale:** A single static page satisfies the submission requirements for an online demo link and AWS usage without competing for time against core CLI functionality during the six-day sprint.

**Consequences:** Multi-page documentation sites, search, and interactive examples are roadmap-only until after the submission.


---

## ADR-027: TypeScript-Only Properties Are Ignored in the MVP

**Status:** ACCEPTED

**Decision:** During contract comparison, properties present only in the TypeScript model and absent from the authoritative OpenAPI schema are ignored.

**Rationale:** The approved MVP focuses on backend contract requirements that the frontend must satisfy. Reporting additional TypeScript-only properties would require a new rule ID, severity, report behavior, and acceptance criteria outside the current six-day scope.

**Consequences:** DevGuard does not currently report frontend payload properties that are absent from OpenAPI. This limitation must be listed in the future README and roadmap. A configurable extra-property rule may be considered after the MVP.


---

## ADR-028: Contract-Level Failures Are User-Visible Findings

**Status:** ACCEPTED

**Decision:** Schema-not-found and TypeScript-type-not-found are high-severity contract findings. Unsupported contract types are warning-severity findings. They are generated before contract comparison by a dedicated deterministic converter.

**Rationale:** These failures prevent or limit contract verification and must be visible in the same report model without creating a parallel public warning system.

**Consequences:** Parser and normalization results remain typed internal results. The Contract Checker orchestration converts the approved user-visible failures into `AnalysisFinding` values with stable IDs, evidence, metadata, and locations.


---

## ADR-030: Duplicate ChangedFile Status Tie-Break

**Status:** ACCEPTED

**Decision:** When the same production file appears more than once in `changedFiles` with different statuses, the `missing-related-tests` rule selects one canonical entry using lexical status order (`added` < `modified` < `renamed`).

**Rationale:** Duplicate entries for the same file are an anomalous input that should not occur in a well-formed diff. A simple deterministic tie-break avoids undefined behavior without requiring semantic status prioritization.

**Consequences:** This tie-break is arbitrary but stable and testable. It does not affect normal, well-formed changed-file inputs.


---

## ADR-031: Report Category Ordering

**Status:** ACCEPTED

**Decision:** The final report's global finding order uses this category rank: contract, risk, testing.

**Rationale:** No committed specification defined a category precedence, despite category being a required secondary sort key in design.md §12.1. A stable explicit rank was required to keep report output deterministic.

**Consequences:** The rank is currently implemented locally in `src/reports/report-builder.ts`. If a future task (such as Task 11.4 console summary) needs the same category order, it should reuse this constant rather than defining a second rank.


---

## ADR-032: Local Git Repository Validation Semantics

**Status:** ACCEPTED

**Decision:** Task 10.2 validates one already-resolved runtime repository path at a time. The path may name a repository root, a subdirectory within a worktree, or a symlink to either. DevGuard canonicalizes the Git top-level working-tree path with `fs.realpath` and returns that canonical path rather than the configured candidate path. Normal and linked worktrees are accepted; bare repositories are rejected because later local-source work needs a working tree.

Configured `baseRef` text is preserved for report-facing traceability while its full resolved commit ID is stored separately as `baseCommit`. `headRef` is the full commit ID resolved from `HEAD`, not the symbolic string `HEAD` or a branch name. Base references reject blank, ASCII-control, NUL, and leading-dash values, then Git resolves all remaining commit-ish expressions with `^{commit}`. No custom Git-ref grammar is maintained.

**Rationale:** Canonical top-level paths give later file loading one stable repository boundary without breaking documented sibling repositories. Captured full commit IDs support detached HEADs, deterministic analysis identities, and future immutable diff inputs. Narrow input prevalidation avoids ambiguous/control input and unsafe option-like values without imposing an unapproved Git-version requirement for `--end-of-options`.

**Consequences:** Repository validation does not impose containment beneath the workspace, config directory, or current directory. It does not inspect a literal `.git` directory, dirty state, merge bases, shallow history, diffs, changed files, patches, or repository contents. Merge-base validation, dirty-state behavior, shallow/unrelated-history semantics, and diff execution are deferred to Task 10.3. Public validation errors use safe typed codes and do not disclose paths, refs, commands, Git output, or filesystem diagnostics.


---

## ADR-033: Local Git Changed-File Metadata Semantics

**Status:** ACCEPTED

**Decision:** Task 10.3 compares the immutable Task 10.2 commit IDs using `baseCommit...headRef`. Before diffing, DevGuard runs `git merge-base --all` against those SHAs. No merge base or multiple best merge bases is fatal. The metadata command uses NUL-delimited `--name-status` output with external diff helpers and text conversion disabled, plus an explicit 50% rename threshold.

`A`, `M`, and `D` map directly to the domain statuses. Renames map source to `previousPath` and destination to `path`; similarity scores are validated then discarded. Copies and supported-but-unrepresented status letters map to `unknown`, preserving a destination path where the current model can represent one. Git paths are validated as repository-relative POSIX paths; literal POSIX backslashes are preserved rather than rewritten. Results are code-point sorted and exact duplicate records are preserved.

**Rationale:** Captured SHAs prevent moving refs from changing the comparison. Strict NUL parsing preserves valid unusual filenames and eliminates quote-configuration dependence. Explicit merge-base and rename policies make otherwise ambiguous Git behavior deterministic. Sorting prevents Git configuration such as `diff.orderFile` from affecting public-domain order.

**Consequences:** The 500-record limit applies per repository. Overflow is fatal and never truncated. The existing Git runner buffers complete stdout, so this count prevents downstream processing but is not a stream-time memory bound; a future bounded-runner contract is required for that protection. Patch retrieval, line counts, binary handling, and complete file loading remain Task 10.4 responsibilities.


---

## ADR-034: Immutable Git Patch and Repository File Loading

**Status:** ACCEPTED

**Decision:** Task 10.4 loads every patch from Task 10.2's captured immutable `baseCommit...headRef` comparison and loads required complete mapped files only from the captured `headRef` Git tree. It never reads the working tree. Task 10.5, not Task 10.4, selects and groups mapped paths from configuration.

Patches are loaded per changed-file record with at most four simultaneous Git commands. Each command uses literal pathspec handling, disables external diff, text conversion, and color, pins the 50% rename threshold and `a/`/`b/` prefixes, and preserves successful unified-patch output exactly. Renames use old and new paths. Added/deleted line counts remain deferred. Patch output over 256 KiB, containing NUL, unavailable, or timed out is omitted without truncation and recorded as a deterministic warning; changed-file metadata remains available.

Task 10.4 validates Git paths through one shared repository-relative POSIX validator. It preserves accepted text exactly, rejects traversal/absolute forms, and preserves literal backslashes only on POSIX. Exact duplicate mapped paths are loaded once; returned repository files are code-point sorted by repository ID and path.

Required mapped files are loaded atomically through `git cat-file`: verify object type, read byte size, then read `blob` content from `<headRef>:<path>`. Only blobs are accepted. Each blob is limited to 1 MiB and one `loadRepositoryFiles` invocation is limited to 20 MiB over deduplicated complete files. Missing, malformed, non-blob, oversized, binary, or inconsistent blobs are fatal typed errors; no partial file array is returned. Repository-file `absolutePath` remains unset.

**Rationale:** Captured SHAs prevent dirty working trees, branch movement, and later commits from changing patch or content inputs. Literal pathspecs preserve valid unusual Git paths. Object type/size checks avoid filesystem reads and prevent loading an oversized blob. Patch omissions are recoverable because changed-file metadata remains useful, while missing required mapped source prevents contract analysis.

**Consequences:** Task 10.1 intentionally remains unchanged and buffers UTF-8 stdout. Patch-size checks are post-capture rather than stream-time bounds. The runner cannot strictly identify invalid UTF-8 byte sequences after decoding; Task 10.4 can classify NUL content and byte-length mismatch only. Task 10.5 must later enforce the authoritative cross-repository text budget, including retained patches and requirements text, and must aggregate loader warnings into `RepositoryContext`.


---

## ADR-035: Local Repository Context Assembly

**Status:** ACCEPTED

**Decision:** Task 10.5 provides `buildLocalRepositoryContext`, a lower-level builder that receives an already structurally and relationally validated `DevGuardConfig`. Production YAML loading, `RepositorySource.loadContext`, `LocalRepositorySource`, CLI path interpretation, analyzer invocation, report construction, and output behavior remain Milestone 11 responsibilities.

`workspaceBase` is the directory containing the already-loaded `.devguard.yml`. The builder uses it only to resolve configured repository paths and selected filesystem requirements paths. Supported combinations remain one frontend, backend, or fullstack repository, or one frontend plus one backend repository. Repositories are processed sequentially in code-point repository-ID order.

Task 10.5 owns mapped complete-file selection: it adds the configured OpenAPI path to its configured repository and each contract TypeScript file to its configured repository. It preserves exact configured path text, groups by repository ID, code-point sorts paths, and exact-deduplicates within each repository. Mapped files load from Task 10.4 regardless of whether they changed. A duplicate exact mapped path loads once; the same path in distinct repositories remains distinct.

Task 10.5 converts patch warnings to stable strings using JSON-encoded repository IDs and paths, and requirements warnings using JSON-encoded source and optional safe path text. Patch warnings sort by repository ID, path, code, and message before flattening. Combined warning strings are exact-deduplicated and code-point sorted. Requirements source selection is explicit builder input first, then `testing.requirementsFile`, then none; the selected file is loaded from the filesystem relative to `workspaceBase` with `workspaceBase` as its allowed root.

The authoritative aggregate retained-text limit is exactly 20 MiB. It counts UTF-8 bytes for every retained `RepositoryFile.content`, every retained `ChangedFile.patch`, and optional requirements content. Warnings and omitted patches do not count. Duplicate `ChangedFile` patch fields count once per retained record even when their text is identical. Overflow is fatal, does not truncate or omit retained domain data, and returns no partial context.

Context construction is all-or-nothing for fatal validation, Git metadata, required file, invariant, and aggregate-budget failures. Patch and optional requirements failures remain recoverable warnings. The result has fixed `sourceType: 'local'`, fixed `sourceLabel: 'Local Git Repositories'`, deterministic repository/file/warning ordering, and no metadata. Lower-level typed repository validation, diff, and required-file errors pass through unchanged. No working-tree reads or reference re-resolution are permitted after Task 10.2's captured descriptors.

**Rationale:** A small deterministic builder composes the committed immutable Git boundaries without duplicating Git behavior or prematurely implementing the production source adapter. Explicit ownership for mapped paths, warnings, requirements, and the cross-repository budget keeps the future Milestone 11 orchestration thin while preserving safe, reproducible local contexts.

**Consequences:** The builder can assemble one or two supported repositories for later analyzers, but it does not run analyzers or reports and does not read configuration files. Future Milestone 11 code must supply the validated configuration and `workspaceBase`, may define process-relative CLI requirements behavior before calling this builder, and must not change the builder's immutable Git or aggregate-retained-text guarantees.


---

## ADR-036: Production DevGuard Configuration Loading

**Status:** ACCEPTED

**Decision:** DevGuard configuration remains an explicitly selected required input. Relative configuration paths resolve from a caller-provided working directory; explicitly selected absolute paths and paths outside that directory are allowed. Configuration-file symlinks are allowed, but the loader returns the canonical real target path and uses the canonical target directory as `workspaceBase`.

The loader accepts only regular configuration files up to exactly 1 MiB, reads raw bytes, requires strict UTF-8, and rejects NUL content. It accepts exactly one YAML document. Anchors, aliases, merge keys, duplicate keys, custom tags, binary and timestamp-tagged values, unsupported node forms, and values outside a finite plain JSON-like tree are rejected. Parsed configuration-object schemas reject unknown keys.

Structural Zod validation runs before relational `validateConfig` validation. Structural errors may expose only deterministic schema/index locations; public typed error codes and messages never expose absolute paths, raw filesystem or parser diagnostics, configuration content, or received values. Configuration loading is read-only and atomic: it returns either a complete structurally and relationally validated configuration or no result.

**Rationale:** The Milestone 11 local source must receive one deterministic, validated configuration and canonical workspace base without permissive YAML behavior, path ambiguity, or unsafe diagnostics. Strict configuration keys detect misspelled controls before local Git analysis begins.

**Consequences:** `loadConfig` is the production configuration boundary. `LocalRepositorySource`, `analyzeRepository`, CLI path interpretation, output handling, and all analyzer/report orchestration remain later Milestone 11 work. No source adapter, CLI behavior, Git behavior, or analysis semantics are changed by this decision.


---

## ADR-037: Single-Load Local Analysis Session Ownership

**Status:** ACCEPTED

**Decision:** One local analysis run loads configuration exactly once. `createLocalAnalysisSession` is the sole configuration-loading boundary for that run and owns the resulting `LoadedConfig` snapshot. It returns that same snapshot with one per-session `LocalRepositorySource`, whose constructor receives the exact `LoadedConfig` object.

`LocalRepositorySource.loadContext` accepts only an optional raw `requirementsPath`. It forwards that value unchanged, when present, together with the snapshot's exact `config` reference and `workspaceBase` to `buildLocalRepositoryContext`. Configuration paths and output settings are not source-load inputs. The source does not implement the preliminary generic `RepositorySource`; `AnalysisInput` and `RepositorySource` remain deferred until broader orchestration settles their final ownership.

The source is created per session and has no already-used guard. The snapshot is immutable by convention: neither the session factory nor the source clones, freezes, re-reads, re-parses, revalidates, or reconstructs it. Its canonical `configPath` is retained for future deterministic analysis-ID generation. Requirements CLI-relative interpretation remains deferred; this boundary forwards the raw selected string unchanged.

Lower-level builder and Git errors pass through unchanged, and operational/configuration failures never become findings. Output writing, analyzers, reports, CLI behavior, console rendering, exit codes, generic source refactoring, and GitHub support are excluded from this decision.

**Rationale:** One validated canonical configuration snapshot prevents configuration drift between repository assembly and future analyzers while keeping the Task 10.5 builder and later CLI responsibilities separate. A minimal source input avoids prematurely coupling configuration selection, output policy, or Commander.js behavior to repository-context construction.

**Consequences:** Future local orchestration must reuse the session's `LoadedConfig.config` reference and `workspaceBase`, and use its canonical `configPath` when generating analysis identities. It must not reload configuration during the same run. The future full `RepositorySource` adaptation, CLI-relative requirements policy, analysis pipeline, and GitHub adapter require separate approved work.


---

## ADR-038: Application Analysis Orchestration and Fatal Error Boundary

**Status:** ACCEPTED

**Decision:** `analyzeRepository` owns one complete local analysis run. It creates exactly one `LocalAnalysisSession`, loads one `RepositoryContext` from that session, and reuses the same immutable-by-convention `LoadedConfig.config` reference for all configuration-dependent analysis decisions. It returns only the session `LoadedConfig` for later internal Milestone 11 composition and the public `PRHealthReport` for later formatting; `LoadedConfig`, canonical configuration paths, workspace bases, source contents, requirements, patches, and repository paths never enter reports, findings, generated tests, warnings, logs, or console output.

Repository-file identity is the exact pair `(repositoryId, path)`, represented with nested maps. Duplicate exact identities and required lookup misses are fatal application invariants. Contract mappings run exactly once in code-point mapping-name order. Changed files are copied, flattened across repositories, and code-point sorted before the two existing risk rules run. Findings originate only from returned Contract Checker findings and the two approved risk rules; they retain semantic aggregation order and are finally sorted by `buildReport`.

Returned typed OpenAPI and TypeScript parser/normalizer outcomes remain recoverable Contract Checker warnings or approved findings. Contract warning messages are never exposed. The application sorts structured contract warnings deterministically, then emits generic warning text with JSON-encoded mapping, source, optional repository-relative file, optional valid line, and code fields. `buildReport` remains responsible for combining context warnings, exact warning deduplication, and final warning sorting.

Unexpected analyzer, risk-rule, scenario-generator, score-calculator, and analysis-ID exceptions are fatal `ANALYZER_EXECUTION_FAILED` errors. Repository-file and clock invariants are fatal `ANALYSIS_INVARIANT_VIOLATION` errors. Report-builder or report-schema failures are fatal `REPORT_BUILD_FAILED` errors. Each has a stable generic public message and retains its cause without copying arbitrary diagnostic text. Existing typed configuration, Git, file-loading, session, source, and local-context operational errors pass through unchanged. Fatal operational failures never become warnings, findings, scores, partial reports, or partial analysis results.

`generateAnalysisId` receives only the session’s canonical `LoadedConfig.configPath` and repository ID/base-ref/head-ref tuples. The clock is injected, read exactly once after successful analyzer/score/ID work, and converted once to the report timestamp. Default dependencies are immutable factory defaults; tests override them through `createAnalyzeRepository` without module-global application mocks.

**Rationale:** This operationalizes ADR-037’s one-load session ownership and resolves the historical double-load pseudocode path in `design.md` without rewriting that historical design document. It provides a deterministic, private, testable application boundary while leaving source assembly, analyzers, report formatting, output writing, CLI wiring, console summaries, thresholds, exit codes, and GitHub support in their assigned later scopes.

**Consequences:** Task 11.2–11.4 may reuse the returned `LoadedConfig` internally without reloading configuration, but may not expose it. Output selection/writing, Markdown/JSON formatting selection, Commander behavior, verbosity, fail-below policy, console summaries, exit codes, and all GitHub/Octokit behavior remain out of scope for this decision.


---

## ADR-039: CLI Analysis Adapter and Safe Error Presentation

**Status:** ACCEPTED

**Decision:** Task 11.2 maps only the required lexical `devguard analyze local --config <path>` value to one `analyzeRepository` invocation. `runAnalyzeLocal` is the narrow CLI-to-application adapter: it reads working directory exactly once during command execution through an injected dependency, forwards the lexical configuration text unchanged with that working directory, and returns the unchanged internal `AnalyzeRepositoryResult`. It neither reloads configuration nor creates another session, source, context, analyzer run, report, or output operation.

The Commander program receives factory-scoped injected dependencies for analysis, working-directory lookup, stdout, and stderr. It uses Commander `exitOverride` and configured output writers so reusable program parsing never directly terminates Node and tests do not require global stream or console mocks. The executable entrypoint uses controlled `parseAsync`; only that entrypoint may assign `process.exitCode`. Task 11.2 uses provisional generic code `1` for handled analysis or unexpected entrypoint failure. Final documented/tested exit-code taxonomy remains Task 11.3.

Successful Task 11.2 execution emits only `DevGuard local analysis completed.` followed by a newline. It does not format, serialize, print, or write the report. `LoadedConfig`, canonical configuration paths, workspace bases, repository paths, source content, requirements, patches, findings, warnings, scores, generated tests, and report metadata remain private. The command action discards the returned result after successful completion.

Known in-process DevGuard fatal errors use a closed CLI-owned code-to-safe-message table. The CLI never renders arbitrary error messages, names, stacks, causes, issue locations, or foreign object properties. Unknown thrown values render only `INTERNAL_ERROR` with a generic message. After rendering an analysis error, the action throws one CLI-owned handled-failure signal with no retained original cause. Commander syntax errors, unknown options/commands, help, and version remain Commander-controlled behavior and are not sent through the analysis-error presenter.

Task 11.2 temporarily removes placeholder `--requirements`, `--output`, `--verbose`, and `--fail-below` options from the active command. Their intended spellings are reserved for Task 11.3, which owns requirements-path semantics, output directories/formats/filenames/writing, verbose mode, fail-below behavior, output-error taxonomy, and final exit codes. Task 11.4 owns the polished console summary. `--format` is not introduced.

**Rationale:** One small injected adapter preserves ADR-037 and ADR-038 single-session ownership while making the real local command safe, deterministic, testable, and usable without prematurely establishing output, requirements, or exit policies. A closed error renderer prevents low-level diagnostics and retained causes from reaching terminal output.

**Consequences:** Task 11.2 does not modify application, source, configuration, analyzer, report, formatter, writer, or path-security behavior. It does not create files/directories, implement report output, or add GitHub support. ADR-040 is reserved for Task 11.3 output and exit policies.


---

## ADR-040 — Output Planning and Safe Report Publication

**Status:** ACCEPTED

**Decision:** Runtime analysis output defaults are directory `.devguard`, Markdown report `devguard-report.md`, and JSON report `devguard-report.json`. Every successful final analysis execution must produce both Markdown and JSON reports. DevGuard has no format-selection option, and omitting either configured filename never disables that report.

Output-directory selection is, in order: the future CLI `--output` override, `config.output.directory`, then `.devguard`. Markdown selection is `config.output.markdown`, then `devguard-report.md`; JSON selection is `config.output.json`, then `devguard-report.json`. A future CLI directory override changes only the selected output directory and does not reset configured Markdown or JSON filenames.

The selected output directory resolves relative to canonical `LoadedConfig.workspaceBase` and must remain both lexically and canonically contained within `workspaceBase`. Directory values reject empty or whitespace-only input, NUL, POSIX absolute paths, Windows absolute or drive-relative paths, UNC paths, and lexical traversal outside the workspace. Nested relative output directories are allowed.

Markdown and JSON targets are relative to the selected output directory. Nested relative report paths are allowed, but each target must remain inside that directory, must not resolve to the output root itself, and must be distinct after normalization. Targets reject empty or whitespace-only input, NUL, absolute paths, and traversal outside the output directory. The planner does not enforce `.md` or `.json` extensions.

`planAnalysisOutput` is a pure lexical planner: it performs no filesystem access, process-state access, environment-variable access, clock or randomness access, or input mutation. `resolveOutputDirectory` provides pure component-aware lexical containment rather than string-prefix security checks. Internal output plans may contain an absolute lexical output directory; `markdownFile` and `jsonFile` remain normalized relative paths under that directory. Public display paths are normalized relative to the workspace, use `/` separators, and must not contain absolute or canonical path text, leading slashes, or `..` components. Absolute or canonical paths must never enter reports, warnings, findings, CLI output, public error messages, or logs.

Planning failures use code `OUTPUT_PLAN_INVALID` and the exact public message `Analysis output configuration is invalid.` Planning errors never expose raw paths, configuration values, or underlying diagnostics.

Future runtime publication will prepare required directories and then perform canonical `realpath` containment after directory creation. Existing symlinked path components may be accepted only when their canonical targets remain contained within the canonical workspace and output roots. Both report contents will be formatted before any filesystem mutation. Planned publication order is: prepare and validate directories, write Markdown atomically, then write JSON atomically. Individual report replacement is atomic, but the two-report publication is not one transaction. If JSON publication fails after Markdown succeeds, the successful Markdown remains, no rollback is attempted, only writer-owned temporary files are cleaned, and the command fails with a safe output-write error.

Output failures are fatal operational failures. They never become findings, warnings, generated tests, score adjustments, or report content. The approved future output-error taxonomy is `OUTPUT_PLAN_INVALID`, `OUTPUT_DIRECTORY_PREPARE_FAILED`, `OUTPUT_FORMAT_FAILED`, and `OUTPUT_WRITE_FAILED`. Output errors use stable public messages and may retain private causes that are never printed.

The current committed output-planning implementation includes only `resolveOutputDirectory`, `planAnalysisOutput`, defaults, lexical validation, and safe display paths. Directory creation, runtime canonical validation, formatting, atomic publication, and CLI integration remain future Task 11.3 work. Requirements override semantics remain reserved for ADR-041. Final CLI outcomes, verbose behavior, fail-below behavior, and exit-code policy remain reserved for ADR-042. Task 11.4 continues to own the polished console summary.

**Rationale:** A fixed two-report contract supports both developer-readable review artifacts and machine-readable automation without adding an unapproved format-selection surface. Separating pure lexical planning from later runtime filesystem checks keeps deterministic policy testable while ensuring symlink-aware containment is enforced before publication. Stable sanitized errors preserve useful operational boundaries without disclosing workspace paths, configuration values, or filesystem diagnostics.

**Consequences:** Task 11.3 must implement the approved directory preparation, canonical containment, formatting, ordered atomic writes, partial-publication behavior, output-error taxonomy, and CLI directory override without changing planning precedence or display-path rules. It must retain both report outputs on every successful run and must not expose private path diagnostics. Task 11.4 may consume only the approved safe display paths when rendering its polished console summary.


---

## ADR-041 — CLI Requirements Override Semantics

**Status:** ACCEPTED

**Decision:** `--requirements <path>` is an explicit CLI override. A relative CLI requirements path resolves against the working directory captured once when the command executes. It is not resolved relative to the configuration file, `LoadedConfig.workspaceBase`, or a repository root. The CLI forwards the lexical path unchanged with that already captured working directory unchanged; neither CLI nor application code reads `process.cwd()` again.

The structured internal override is:

```ts
{
  path: string;
  baseDirectory: string;
  required: true;
}
```

The path, base directory, and fatal semantics travel together to prevent accidental reinterpretation. The structured override will travel through the active production path: `runAnalyzeLocal`, `AnalyzeRepositoryInput`, `LocalRepositorySource.loadContext`, and `buildLocalRepositoryContext`. The generic `RepositorySource` abstraction remains unchanged and deferred; it is not part of this production transport path.

`config.testing.requirementsFile` retains its existing behavior: it resolves relative to `LoadedConfig.workspaceBase`, must remain canonically contained in `workspaceBase`, and failures become recoverable requirements warnings. Source precedence is explicit CLI override, then configured `testing.requirementsFile`, then no requirements source. When an explicit override is present, its failure never falls back to the configured requirements file.

Explicit override validation is fatal and aborts the whole analysis before analyzers, findings, test generation, scoring, report construction, and report publication. Explicit override failures never become warnings, findings, generated tests, score adjustments, or report content. Explicit paths must remain lexically and canonically contained within the captured working directory. Existing symlinks are allowed only when their canonical target remains inside that captured working directory.

Accepted explicit input is an existing readable regular file that is valid strict UTF-8, non-empty after whitespace evaluation, no larger than 1 MiB, and canonically contained. The following explicit-override conditions are fatal: invalid or empty path; NUL in a path; missing or unreadable file; a directory or other non-regular file; lexical or sibling-prefix escape; symlink escape; invalid UTF-8; NUL content; oversized file; and empty or whitespace-only content.

A new strict source-layer loader owns explicit override filesystem validation. The existing requirements-text loader remains unchanged and continues to own configured recoverable warning behavior. Commander remains thin and performs no requirements filesystem access. Configuration is loaded exactly once.

The approved fatal error codes are:

- `REQUIREMENTS_OVERRIDE_INVALID`
- `REQUIREMENTS_OVERRIDE_NOT_FOUND`
- `REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE`
- `REQUIREMENTS_OVERRIDE_READ_FAILED`
- `REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY`
- `REQUIREMENTS_OVERRIDE_SYMLINK_OUTSIDE_WORKING_DIRECTORY`
- `REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE`
- `REQUIREMENTS_OVERRIDE_INVALID_UTF8`
- `REQUIREMENTS_OVERRIDE_EMPTY`

Fatal public messages are fixed and safe. They never contain user-supplied paths, absolute paths, base directories, symlink targets, errno, source content, parser diagnostics, private cause messages, or stacks. Private operational causes may be retained internally but are never printed.

ADR-041 does not implement source loading, API transport, Commander option registration, verbose behavior, fail-below behavior, or final exit codes. ADR-042 remains reserved for final CLI outcomes and exit-code policy.

**Rationale:** CLI-relative requirements are command inputs rather than configuration-relative data. Carrying the selected lexical path, its captured base directory, and fatal intent as one structured value preserves the caller's meaning and prevents configuration-relative fallback or accidental reinterpretation. A strict loader isolates fatal explicit-input semantics from the existing recoverable configured-file loader.

**Consequences:** Future implementation must preserve one captured CLI working directory throughout explicit override transport, validate it before analysis work proceeds, and expose only fixed safe operational errors. Configured requirements loading remains recoverable and workspace-relative. CLI wiring and final error presentation require their separately approved Task 11.3 and ADR-042 work.
