# DevGuard Kiro Steering Guidelines

## Product Direction

DevGuard is a focused developer productivity CLI.

Do not transform it into:

- a generic AI coding assistant;
- a full security scanner;
- a replacement for human review;
- a multi-language platform during the MVP;
- a web dashboard;
- a GitHub-only application.

The MVP must work against real local Git repositories and remain useful without internet access.

## Source of Truth

Use these documents in priority order:

1. `.kiro/specs/requirements.md`
2. `.kiro/specs/design.md`
3. `.kiro/specs/tasks.md`
4. `docs/decisions.md`
5. this steering file

Do not reopen accepted architectural decisions unless implementation evidence reveals a critical flaw.

## Engineering Principles

- Prefer deterministic behavior over LLM inference.
- Keep repository-source adapters separate from analyzers.
- Keep domain models free from Octokit and Commander.js types.
- Use dependency injection at application boundaries.
- Implement small pure rule functions.
- Generate stable finding IDs.
- Validate all external input.
- Fail fast for invalid configuration.
- Continue safely for recoverable parser failures.
- Never expose secrets.
- Do not execute untrusted target-project code.

## MVP Boundaries

Support only:

- Node.js 24;
- TypeScript;
- OpenAPI 3.x;
- local Git;
- one fullstack repository or one frontend plus one backend repository;
- exact mapping from OpenAPI schema to TypeScript declaration;
- interfaces and object-literal type aliases;
- primitive values and primitive arrays;
- Vitest/Jest scenario output.

Do not silently add support for:

- imported generic type graphs;
- utility types such as `Pick`, `Omit`, or conditional types;
- arbitrary monorepo discovery;
- remote OpenAPI endpoints;
- automatic GitHub comments;
- source-code mutation;
- category-specific health scores.

Unsupported constructs must create warnings and preserve the rest of the analysis.

## Hackathon Timebox

The active implementation sprint lasts six days.

Required priority:

1. deterministic local analysis;
2. reliable CLI;
3. Markdown and JSON reports;
4. offline end-to-end demo;
5. minimum README and packaging.

GitHub, Octokit, LLM integration, web UI, and automatic PR comments are explicitly outside this submission.

## Implementation Order

1. Shared types.
2. Config validation.
3. Fixtures.
4. Pure parsers and analyzers.
5. Test generation.
6. Score.
7. Reports.
8. Local Git adapter.
9. CLI.
10. End-to-end demo.
11. Documentation.
12. Stop after the local MVP, demo, and minimum documentation are complete.

The GitHub adapter is outside the six-day hackathon sprint. Do not implement Octokit or GitHub integration during this submission, even if local work finishes early.

## Code Style

- TypeScript strict mode.
- Avoid `any`.
- Prefer named exports.
- Prefer small files with one clear responsibility.
- Prefer interfaces at module boundaries.
- Prefer immutable values.
- Prefer pure functions for rules and transformations.
- Add return types to exported functions.
- Use domain-specific names rather than abbreviations.
- Do not hide errors with empty `catch` blocks.
- Avoid premature abstractions and framework-heavy patterns.

## Testing Expectations

Every feature must include tests.

Use:

- unit tests for parsers, normalizers, rules, scoring, and formatting;
- fixture tests for contract scenarios;
- end-to-end tests for the local CLI.

Tests must not depend on:

- live GitHub;
- LLM providers;
- network access;
- private repositories;
- machine-specific absolute paths.

## Security Expectations

- Use safe child-process APIs with argument arrays.
- Validate repository and file paths.
- Prevent directory traversal.
- Limit file size and total loaded content.
- Redact likely secrets from diagnostic content.
- Never read `.env` contents merely because the file changed.
- A sensitive-file finding should normally use metadata and patch information, not secret values.

## Reporting Expectations

Reports must be actionable.

Every finding should answer:

- What rule was triggered?
- How severe is it?
- Where did it happen?
- What was expected?
- What was found?
- What should the developer do next?

Keep console output concise. Put detailed evidence in Markdown and JSON.

## LLM Boundaries

The deterministic MVP must work without an LLM.

An LLM may later:

- improve explanations;
- summarize findings;
- create optional test scaffolds.

An LLM must not:

- decide whether structural mismatches exist;
- assign severity;
- calculate health scores;
- approve or reject changes;
- receive unrestricted repository contents by default.

## Change-Control Rule

When a task appears to require expanding the MVP:

1. record the proposed change;
2. classify it as accepted, rejected, deferred, or needs evidence;
3. update `docs/decisions.md`;
4. do not implement it until accepted.

## Demo Priority

The project must always preserve a working local demo.

A reliable offline local demonstration is the required submission target. Remote GitHub integration is roadmap-only for this hackathon.

## Static Demo Page Scope

The hackathon submission includes one single static HTML page hosted on S3 + CloudFront.

The page is limited to:

- product name, tagline, version badge;
- install and run commands;
- one terminal recording;
- example report snippets;
- link to the GitHub repository.

Do not add during this submission:

- VitePress, Docusaurus, or any documentation framework;
- multiple pages, navigation, or search;
- interactive playgrounds or live editors;
- guides, tutorials, or API reference documentation.

A full documentation site under a dedicated domain is a post-hackathon roadmap item. Do not reserve, purchase, or hardcode a domain or npm package name until the final packaging task.

## Confidentiality for Public Assets

All public examples, fixtures, screenshots, terminal recordings, and demo assets must use fictional data only. Do not include employer, client, proprietary, private-repository, credential, or internal-business information in public project materials.
