# DevGuard Submission Checklist

## Official Deliverables

- **Project title:** DevGuard
- **Brief project description:** Developer productivity CLI that performs preventive code-review analysis on local Git repositories, detecting contract mismatches between OpenAPI schemas and TypeScript models, identifying risky changes, and generating deterministic health reports.
- **Challenge being solved:** Frontend and backend changes frequently drift apart — API schemas change without corresponding frontend updates, primitive types become incompatible, sensitive files are modified without review context, and production code changes without related tests. DevGuard moves these checks earlier into the development workflow.
- **Public GitHub repository** with project source code and README
- **Public online demo link**
- **Project presentation video**
  - Maximum video duration: **5 minutes**
  - The video must show:
    - Solution objectives
    - Main components
    - A functional demonstration
    - Optional non-sensitive code fragments
  - One final video for the project

## Internal Completion Items

- [ ] Public repository URL
- [ ] Online demo URL (S3 + CloudFront static page)
- [ ] Video URL
- [ ] README completed
- [ ] Installation instructions verified from a clean environment
- [ ] Demo fixture verified
- [ ] No sensitive information committed
- [ ] Final build and tests passing

## Package Distribution

- [ ] npm package name verified for availability
- [ ] `npm pack --dry-run` shows only intended files
- [ ] Tarball installs and runs in a clean temporary project
- [ ] Package version is `0.1.0`
- [ ] Git tag `v0.1.0` created
- [ ] GitHub Release created with matching version
- [ ] Published package exposes `devguard` executable
- [ ] README install commands use the final verified package name

## Static Demo Page

- [ ] Single HTML page created (no framework)
- [ ] Product name, tagline, and version badge present
- [ ] Install and run commands use the final published package name
- [ ] Terminal recording embedded (GIF or asciinema)
- [ ] Example report snippets included (contract mismatch, score, summary)
- [ ] Link to public GitHub repository
- [ ] Page deployed to S3 + CloudFront
- [ ] Online demo URL accessible and renders correctly
