# Public Readiness

## Audit status

- **Current tree:** `PUBLIC-READY` after the local `pnpm audit:public` check reports no blocking findings in tracked files.
- **Git history:** `BLOCKED` for public release review. Historical-only machine-specific path references were detected in reachable commits. No secret-pattern, credential-file, or private-URL category was detected by the local history scan.
- **Author metadata:** one distinct historical author identity was found. Its email needs a publication decision because it is not one of the documented fixture or GitHub noreply forms.
- **History remediation:** recommended before public publication. This slice did not rewrite history, alter authors, remove refs, or change remotes.

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
