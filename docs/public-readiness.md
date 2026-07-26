# Public Readiness

## Audit status

- **Current tree:** `PUBLIC-READY` after the local `pnpm audit:public` check reports no blocking findings in tracked files.
- **Git history:** `PUBLIC-READY` only after the authorized history rewrite and every post-rewrite validation and complete-history scan succeed.
- **Package:** `PUBLIC-READY` after production-boundary validation confirms only the intended package files are packed.
- **Remote publication:** `NOT YET PUBLISHED`.
- **Recovery backup:** an external private backup and Git bundle are retained for recovery. They contain the original history and must never be published.

This status is contingent: until the rewrite and validation complete successfully, historical public-readiness is not established. No remote publication has occurred.
## Audit boundaries

`pnpm audit:public` scans current tracked regular files only. It checks filenames and UTF-8 text for machine-specific paths, identities, credential-like filenames, high-confidence secret patterns, private-style URLs, and tracked generated artifacts. Findings are deterministic and repository-relative; output never includes the matched source text.

The audit intentionally allows the approved public author, package identity, GitHub owner and planned repository URL, reserved `example.invalid` fixture emails, neutral fixture paths, and narrowly listed fictional secret-test sentinels. It does not scan Git object internals, ignored workspaces, package-manager stores, `node_modules`, or parent directories.

The npm package has a separate boundary: only production `dist/`, `README.md`, `LICENSE`, and `package.json` are packed. Repository-development audit scripts and this document remain outside that archive.

## Generated report privacy

The verified Book demo produces fictional Book/library findings, repository-relative locations, the expected score and label, and safe repository metadata. The JSON and Markdown reports are checked before use for screenshot preparation. Report IDs and generated timestamps may vary and should be excluded from framing.

## Screenshot capture plan

No screenshots are created by this document. Run each command from the repository root, frame only the command and deterministic output, and crop the shell prompt and unrelated terminal content.

| Capture | Command or source | Target content | Suggested filename | Intended use |
| --- | --- | --- | --- | --- |
| CLI help | `node dist/cli/index.js --help` | Product name, `analyze` command, version/help options | `docs/assets/devguard-cli-help.png` | Optional installation/CLI section |
| Successful Book demo | `pnpm demo` | Four findings, four scenarios, score `57`, `HIGH_RISK`, report availability | `docs/assets/devguard-book-demo.png` | Primary demo preview |
| Markdown report | `demo/.work/book-library/reports/book-library-report.md` | Title, health summary, first findings, relative paths | `docs/assets/devguard-markdown-report.png` | Report preview |
| Threshold behavior | `pnpm demo:thresholds` | Thresholds `56`/`57`/`58` and exits `0`/`0`/`1` | `docs/assets/devguard-thresholds.png` | Quality-gate behavior |
| JSON report (optional) | `demo/.work/book-library/reports/book-library-report.json` | Score, label, finding count, scenario count | `docs/assets/devguard-json-report.png` | Optional technical proof |

For Markdown and JSON captures, exclude unstable report IDs, generated timestamps, and repository commit references. After report inspection, run `pnpm demo:clean`.

## Remaining external actions

Before public publication, decide whether and how to remediate the historical-only path references and review the historical author email. Publication, repository creation, remotes, tags, releases, screenshots, video, CI, and hosted assets remain outside this slice.
