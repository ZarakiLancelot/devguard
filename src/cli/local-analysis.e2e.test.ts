import { spawn } from 'node:child_process';
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CHILD_TIMEOUT_MS = 30_000;
const MAX_CAPTURED_OUTPUT_BYTES = 1_048_576;
const SETUP_OUTPUT =
  [
    'DevGuard Book demo repository prepared.',
    'Workspace: demo/.work/book-library',
    'Branch: main',
    'Base ref: demo-base',
    'Commits: 2',
  ].join('\n') + '\n';
const DEFAULT_SUMMARY = 'DevGuard local analysis completed.\nReports published.\n';

interface ExpectedFinding {
  ruleId: string;
  severity: string;
  location: {
    repositoryId: string;
    file: string;
    property?: string;
  };
}

interface ExpectedManifest {
  status: string;
  repository: { id: string; role: string; baseRef: string };
  expectedFindingCount: number;
  expectedFindings: ExpectedFinding[];
  expectedGeneratedScenarioCount: number;
  predictedHealthScore: number;
  predictedHealthLabel: string;
}

interface ReportFinding {
  id: string;
  ruleId: string;
  severity: string;
  category: string;
  location: { repositoryId: string; file: string };
  metadata?: { property?: string };
}

interface ReportTestScenario {
  framework: string;
  relatedFindingIds: string[];
}

interface Report {
  healthScore: number;
  healthLabel: string;
  repositories: Array<{ repositoryId: string; role: string; baseRef: string }>;
  summary: { totalCount: number };
  findings: ReportFinding[];
  generatedTests: ReportTestScenario[];
}

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const generatedParent = path.resolve(projectRoot, 'demo', '.work');
const workspaceRoot = path.resolve(generatedParent, 'book-library');
const repositoryRoot = path.resolve(workspaceRoot, 'library');
const setupScript = path.resolve(projectRoot, 'scripts', 'demo.mjs');
const builtCli = path.resolve(projectRoot, 'dist', 'cli', 'index.js');
const manifestPath = path.resolve(projectRoot, 'demo', 'book-library', 'expected.json');
const markdownReport = path.resolve(workspaceRoot, 'reports', 'book-library-report.md');
const jsonReport = path.resolve(workspaceRoot, 'reports', 'book-library-report.json');
const configPath = 'demo/.work/book-library/.devguard.yml';

let manifest: ExpectedManifest;

describe.sequential('built local analysis Book demo E2E', () => {
  beforeAll(async () => {
    await expectRegularFile(builtCli, 'The E2E suite requires pnpm build before execution.');
    manifest = parseManifest(await readFile(manifestPath, 'utf8'));
    expect(manifest.status).toBe('verified');
    expect(manifest.predictedHealthScore).toBe(57);
    expect(manifest.predictedHealthLabel).toBe('HIGH_RISK');
    expect(manifest.expectedFindingCount).toBe(4);
    expect(manifest.expectedGeneratedScenarioCount).toBe(4);
  });

  beforeEach(async () => {
    await removeGeneratedWorkspace();

    const setup = await runChild(process.execPath, [setupScript], projectRoot);
    expect(setup).toEqual({ exitCode: 0, signal: null, stdout: SETUP_OUTPUT, stderr: '' });
    await expectRegularFile(path.resolve(workspaceRoot, '.devguard.yml'));

    const gitState = await runChild('git', ['rev-parse', '--is-inside-work-tree'], repositoryRoot);
    expect(gitState).toEqual({ exitCode: 0, signal: null, stdout: 'true\n', stderr: '' });
    await expectAbsent(markdownReport);
    await expectAbsent(jsonReport);
  });

  afterEach(async () => {
    await removeGeneratedWorkspace();
  });

  it('publishes the verified Book analysis through the compiled CLI verbose path', async () => {
    const result = await runCli(['--verbose']);

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stdout: `${DEFAULT_SUMMARY}Health score: ${manifest.predictedHealthScore}/100\n`,
      stderr: '',
    });

    const report = await verifyPublishedReports();
    expect(report.healthScore).toBe(manifest.predictedHealthScore);
  });

  it('publishes reports before the compiled CLI returns the quality-threshold exit code', async () => {
    await removeGeneratedReports();
    await expectAbsent(markdownReport);
    await expectAbsent(jsonReport);

    const result = await runCli(['--fail-below', String(manifest.predictedHealthScore + 1)]);

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: 'DevGuard quality threshold not met.\n',
    });

    const report = await verifyPublishedReports();
    expect(report.healthScore).toBe(manifest.predictedHealthScore);
  });
});

async function runCli(options: readonly string[]): Promise<ProcessResult> {
  return runChild(
    process.execPath,
    [builtCli, 'analyze', 'local', '--config', configPath, ...options],
    projectRoot,
  );
}

async function verifyPublishedReports(): Promise<Report> {
  await expectRegularFile(markdownReport);
  await expectRegularFile(jsonReport);

  const [markdown, json] = await Promise.all([
    readFile(markdownReport, 'utf8'),
    readFile(jsonReport, 'utf8'),
  ]);
  const report = JSON.parse(json) as Report;

  expect(report.healthScore).toBe(manifest.predictedHealthScore);
  expect(report.healthLabel).toBe(manifest.predictedHealthLabel);
  expect(report.summary.totalCount).toBe(manifest.expectedFindingCount);
  expect(report.findings).toHaveLength(manifest.expectedFindingCount);
  expect(report.generatedTests).toHaveLength(manifest.expectedGeneratedScenarioCount);
  expect(report.repositories).toEqual([
    {
      repositoryId: manifest.repository.id,
      role: manifest.repository.role,
      baseRef: manifest.repository.baseRef,
      headRef: expect.any(String),
    },
  ]);

  const findingProjection = report.findings.map((finding) => ({
    ruleId: finding.ruleId,
    severity: finding.severity,
    category: finding.category,
    repositoryId: finding.location.repositoryId,
    file: finding.location.file,
    ...(finding.metadata?.property === undefined ? {} : { property: finding.metadata.property }),
  }));
  expect(findingProjection).toEqual(
    manifest.expectedFindings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      category: finding.ruleId.startsWith('contract.') ? 'contract' : 'risk',
      repositoryId: finding.location.repositoryId,
      file: finding.location.file,
      ...(finding.location.property === undefined ? {} : { property: finding.location.property }),
    })),
  );

  const findingIds = new Set(report.findings.map((finding) => finding.id));
  const relatedFindingIds = report.generatedTests.flatMap((scenario) => {
    expect(scenario.framework).toBe('scenario-only');
    expect(scenario.relatedFindingIds).toHaveLength(1);
    expect(findingIds.has(scenario.relatedFindingIds[0] ?? '')).toBe(true);
    return scenario.relatedFindingIds;
  });
  expect(new Set(relatedFindingIds).size).toBe(report.findings.length);
  expect([...new Set(relatedFindingIds)].sort()).toEqual([...findingIds].sort());

  const requiredMarkdown = [
    '# DevGuard PR Health Report',
    `- Score: ${manifest.predictedHealthScore} / 100`,
    '- Status: HIGH RISK',
    '## Suggested Tests',
    escapeMarkdownInline('library:src/types/book.ts'),
    escapeMarkdownInline('library:config/access-policy.json'),
    escapeMarkdownInline('library:src/services/catalog.ts'),
    ...manifest.expectedFindings.map(
      (finding) => `- Rule: ${escapeMarkdownInline(finding.ruleId)}`,
    ),
  ];
  for (const fragment of requiredMarkdown) {
    expect(markdown).toContain(fragment);
  }

  assertPrivateContentAbsent(`${json}\n${markdown}`);
  return report;
}

async function removeGeneratedReports(): Promise<void> {
  const reportsDirectory = path.resolve(workspaceRoot, 'reports');
  assertStrictChild(reportsDirectory, workspaceRoot);
  await rm(reportsDirectory, { force: true, recursive: true });
}

async function removeGeneratedWorkspace(): Promise<void> {
  assertStrictChild(workspaceRoot, generatedParent);
  const stats = await lstatOrUndefined(workspaceRoot);
  if (stats?.isSymbolicLink()) {
    throw new Error('Generated workspace must not be a symbolic link.');
  }
  await rm(workspaceRoot, { force: true, recursive: true });
}

async function expectRegularFile(file: string, message?: string): Promise<void> {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(message ?? 'Expected a regular, non-symbolic-link file.');
  }
  expect(stats.isFile()).toBe(true);
  expect(stats.isSymbolicLink()).toBe(false);
}

async function expectAbsent(file: string): Promise<void> {
  expect(await lstatOrUndefined(file)).toBeUndefined();
}

async function lstatOrUndefined(
  file: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(file);
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function assertStrictChild(candidate: string, parent: string): void {
  const relative = path.relative(parent, candidate);
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new Error('Generated workspace cleanup path is invalid.');
  }
}

function parseManifest(content: string): ExpectedManifest {
  return JSON.parse(content) as ExpectedManifest;
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/[`*_{}[\]()#+.!|>-]/gu, '\\$&');
}

function assertPrivateContentAbsent(content: string): void {
  const privateValues = [
    projectRoot,
    workspaceRoot,
    process.env.HOME,
    process.env.USER,
    process.env.LOGNAME,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const value of privateValues) {
    expect(content).not.toContain(value);
  }
  expect(content).not.toContain('/home/');
  expect(content).not.toMatch(/(?:token|secret|credential|password|stack trace)/iu);
}

function runChild(
  executable: string,
  args: readonly string[],
  workingDirectory: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finishFailure(new Error('Child process timed out.'));
    }, CHILD_TIMEOUT_MS);

    const finishFailure = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (settled) return;
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_CAPTURED_OUTPUT_BYTES) {
          child.kill('SIGTERM');
          finishFailure(new Error('Child stdout exceeded the capture limit.'));
          return;
        }
        stdout += chunk.toString('utf8');
        return;
      }

      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CAPTURED_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        finishFailure(new Error('Child stderr exceeded the capture limit.'));
        return;
      }
      stderr += chunk.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', () => finishFailure(new Error('Child process could not start.')));
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, signal });
    });
  });
}
