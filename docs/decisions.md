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
