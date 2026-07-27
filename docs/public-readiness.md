# Public Readiness

## Audit status

- **Current tree:** `PUBLIC-READY` after the local `pnpm audit:public` check reports no blocking findings in tracked files.
- **Git history:** `PUBLIC-READY` after the authorized history rewrite, post-rewrite validation, and complete reachable-history scan.
- **Package:** `PUBLIC-READY` after production-boundary validation confirms only the intended package files are packed.
- **Remote publication:** `NOT YET PUBLISHED`.
- **Recovery backup:** an external private backup and Git bundle are retained for recovery. They contain the original history and must never be published.

No remote publication has occurred.

## Audit boundaries

`pnpm audit:public` scans current tracked regular files only. It checks filenames and UTF-8 text for machine-specific paths, identities, credential-like filenames, high-confidence secret patterns, private-style URLs, and tracked generated artifacts. Findings are deterministic and repository-relative; output never includes the matched source text.

The audit intentionally allows the approved public author, package identity, GitHub owner and planned repository URL, reserved `example.invalid` fixture emails, neutral fixture paths, and narrowly listed fictional secret-test sentinels. It does not scan Git object internals, ignored workspaces, package-manager stores, `node_modules`, or parent directories.

The npm package has a separate boundary: only production `dist/`, `README.md`, `LICENSE`, and `package.json` are packed. Repository-development audit scripts, visual assets, and this document remain outside that archive.

## Generated report privacy

The verified Book demo produces fictional Book/library findings, repository-relative locations, the expected score and label, and safe repository metadata. The JSON and Markdown reports are checked before use for visual-asset preparation. Report IDs, generated timestamps, and repository commit references may vary and are excluded from public asset framing.

## Completed visual assets

Five deterministic local PNG assets were rendered from actual production CLI output, verified Book demo output, verified threshold output, and generated Book reports:

| Capture | Final filename | Public content | Intended use |
| --- | --- | --- | --- |
| CLI help | `docs/assets/devguard-cli-help.png` | Product usage, description, command, help/version options | README CLI reference; future release or static page |
| Successful Book demo | `docs/assets/devguard-book-demo.png` | Four findings, four scenarios, score `57`, `HIGH_RISK`, report availability | README demo preview; future release or static page |
| Markdown report | `docs/assets/devguard-markdown-report.png` | Report title, health summary, first two findings, relative paths | README report preview; future release or static page |
| Threshold behavior | `docs/assets/devguard-thresholds.png` | Thresholds `56`/`57`/`58` and exits `0`/`0`/`1` | README quality-gate behavior; future release or static page |
| JSON report projection | `docs/assets/devguard-json-report.png` | Stable score, label, summary, rule IDs, scenario count, repository projection | Future release or static page technical proof |

Privacy review passed: assets contain fictional data and exclude shell prompts, machine identities, private or absolute paths, report IDs, generated timestamps, and repository commit references. PNG signatures, dimensions, and metadata were checked. The optional JSON asset is a stable projection of the generated report rather than the complete report.

The generated Book demo workspace and ignored visual-capture workspace must be cleaned after validation. These repository-relative PNGs are intentionally kept outside the npm package; README links use the GitHub repository rendering path after publication.

## Static landing page

A standalone deployment boundary now exists under `site/`, containing semantic HTML, a dependency-free stylesheet, and byte-identical copies of the four approved screenshots it displays. It makes no external runtime requests and has no deployment configuration. Local resource, responsive, accessibility, privacy, and package-boundary checks are required before any future deployment; deployment, AWS region selection, and hosting remain pending.

## Live static-site deployment

The static landing page is live at [https://d9ps2yzxvz3fa.cloudfront.net](https://d9ps2yzxvz3fa.cloudfront.net), deployed reproducibly by the CloudFormation stack `devguard-static-site` in `us-east-1`. Its origin is a private S3 bucket with all Block Public Access settings, `BucketOwnerEnforced` ownership, S3-managed encryption, and no website hosting. CloudFront uses SigV4 Origin Access Control; direct anonymous S3 access is denied, while HTTPS delivery, HTTP-to-HTTPS redirect, the expected object inventory, and cache behavior were verified. No custom domain is configured. The deployment scripts include reproducible teardown; billing safeguards are managed separately and were left unchanged.

## Remaining external actions

Before public publication, complete the final release decision and any required publication review. Repository creation or visibility changes, remotes, tags, releases, video, CI, hosted assets, and static-page deployment remain outside this slice.
