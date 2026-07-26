import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_TIMEOUT_MS = 10_000;
const GIT_TERMINATION_GRACE_MS = 250;
const CLI_TIMEOUT_MS = 30_000;
const CLI_TERMINATION_GRACE_MS = 500;
const BASE_COMMIT_DATE = '2026-01-01T00:00:00Z';
const HEAD_COMMIT_DATE = '2026-01-02T00:00:00Z';
const GIT_IDENTITY_NAME = 'DevGuard Demo';
const GIT_IDENTITY_EMAIL = 'demo@devguard.invalid';
const BASE_COMMIT_MESSAGE = 'demo: create compatible Book contract';
const HEAD_COMMIT_MESSAGE = 'demo: introduce Book contract drift';
const EXPECTED_REPOSITORY_FILES = [
  'config/access-policy.json',
  'docs/openapi.yaml',
  'src/services/catalog.ts',
  'src/types/book.test.ts',
  'src/types/book.ts',
];
const SUCCESS_OUTPUT = [
  'DevGuard Book demo repository prepared.',
  'Workspace: demo/.work/book-library',
  'Branch: main',
  'Base ref: demo-base',
  'Commits: 2',
].join('\n');

class InvalidCommandError extends Error {}

class SetupError extends Error {}

class VerificationError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

async function main() {
  let mode;

  try {
    mode = parseMode(process.argv.slice(2));
  } catch (error) {
    if (error instanceof InvalidCommandError) {
      process.stderr.write('DevGuard Book demo command is invalid.\n');
      process.exitCode = 1;
      return;
    }

    throw error;
  }

  try {
    const paths = await resolveDemoPaths();
    await prepareDemoRepository(paths);

    if (mode === 'setup') {
      process.stdout.write(`${SUCCESS_OUTPUT}\n`);
      return;
    }

    const result = await verifyBuiltAnalysis(paths);
    process.stdout.write(formatVerificationSuccess(result));
  } catch (error) {
    if (mode === 'verify') {
      process.stderr.write('DevGuard Book demo verification failed.\n');
    } else {
      process.stderr.write('DevGuard Book demo setup failed.\n');
    }
    process.exitCode = 1;
  }
}

function parseMode(argumentsValue) {
  if (argumentsValue.length === 0) {
    return 'setup';
  }

  if (argumentsValue.length === 1 && argumentsValue[0] === '--verify') {
    return 'verify';
  }

  throw new InvalidCommandError();
}

async function prepareDemoRepository(paths) {
  await validateDemoPaths(paths);
  await recreateWorkspace(paths);
  await copyWorkspaceConfiguration(paths);
  await copyTemplateTree(paths.baseTemplateRepository, paths.repositoryRoot);
  await initializeRepository(paths.repositoryRoot);
  const baseCommit = await createBaseCommit(paths.repositoryRoot);
  await createBaseReference(paths.repositoryRoot, baseCommit);
  await applyHeadTemplate(paths);
  await createHeadCommit(paths.repositoryRoot);
  await verifyDemoRepository(paths, baseCommit);
}

async function resolveDemoPaths() {
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  const scriptsDirectory = path.dirname(scriptPath);
  const projectRoot = await realpath(path.resolve(scriptsDirectory, '..'));
  const demoDirectory = path.resolve(projectRoot, 'demo');
  const templateRoot = path.resolve(demoDirectory, 'book-library');
  const generatedParent = path.resolve(demoDirectory, '.work');
  const workspaceRoot = path.resolve(generatedParent, 'book-library');
  const repositoryRoot = path.resolve(workspaceRoot, 'library');

  return {
    projectRoot,
    demoDirectory,
    templateRoot,
    baseTemplateRepository: path.resolve(templateRoot, 'base', 'library'),
    headTemplateRepository: path.resolve(templateRoot, 'head', 'library'),
    templateConfiguration: path.resolve(templateRoot, '.devguard.yml'),
    expectationManifest: path.resolve(templateRoot, 'expected.json'),
    builtCli: path.resolve(projectRoot, 'dist', 'cli', 'index.js'),
    generatedParent,
    workspaceRoot,
    repositoryRoot,
    markdownReport: path.resolve(workspaceRoot, 'reports', 'book-library-report.md'),
    jsonReport: path.resolve(workspaceRoot, 'reports', 'book-library-report.json'),
  };
}

async function validateDemoPaths(paths) {
  await assertDirectory(paths.projectRoot);
  await assertDirectory(paths.demoDirectory);
  await assertDirectory(paths.templateRoot);
  await assertDirectory(paths.baseTemplateRepository);
  await assertDirectory(paths.headTemplateRepository);
  await assertRegularFile(paths.templateConfiguration);
  await assertRegularFile(paths.expectationManifest);

  if (
    !isStrictChild(paths.demoDirectory, paths.projectRoot) ||
    !isStrictChild(paths.templateRoot, paths.demoDirectory) ||
    !isStrictChild(paths.generatedParent, paths.demoDirectory) ||
    !isStrictChild(paths.workspaceRoot, paths.generatedParent) ||
    !isStrictChild(paths.repositoryRoot, paths.workspaceRoot)
  ) {
    throw new SetupError();
  }

  await assertTemplateTree(paths.baseTemplateRepository);
  await assertTemplateTree(paths.headTemplateRepository);
  await ensureGeneratedParent(paths);
}

async function recreateWorkspace(paths) {
  const parentRealPath = await realpath(paths.generatedParent);
  if (!isStrictChild(parentRealPath, paths.demoDirectory)) {
    throw new SetupError();
  }

  const existingWorkspace = await lstatOrUndefined(paths.workspaceRoot);
  if (existingWorkspace !== undefined) {
    if (!existingWorkspace.isDirectory() || existingWorkspace.isSymbolicLink()) {
      throw new SetupError();
    }

    const workspaceRealPath = await realpath(paths.workspaceRoot);
    if (!isStrictChild(workspaceRealPath, parentRealPath)) {
      throw new SetupError();
    }

    await rm(paths.workspaceRoot, { force: true, recursive: true });
  }

  await mkdir(paths.workspaceRoot, { recursive: true });
  const workspaceRealPath = await realpath(paths.workspaceRoot);
  if (!isStrictChild(workspaceRealPath, parentRealPath)) {
    throw new SetupError();
  }
}

async function copyWorkspaceConfiguration(paths) {
  await copyTextFile(
    paths.templateConfiguration,
    path.resolve(paths.workspaceRoot, '.devguard.yml'),
    paths.workspaceRoot,
  );
}

async function copyTemplateTree(sourceRoot, targetRoot) {
  await mkdir(targetRoot, { recursive: true });

  for (const relativeFile of EXPECTED_REPOSITORY_FILES) {
    const sourceFile = path.resolve(sourceRoot, relativeFile);
    const targetFile = path.resolve(targetRoot, relativeFile);
    if (!isStrictChild(sourceFile, sourceRoot) || !isStrictChild(targetFile, targetRoot)) {
      throw new SetupError();
    }

    await copyTextFile(sourceFile, targetFile, targetRoot);
  }
}

async function initializeRepository(repositoryRoot) {
  await runGit(['init', '-b', 'main'], repositoryRoot);
  await runGit(['config', '--local', 'user.name', GIT_IDENTITY_NAME], repositoryRoot);
  await runGit(['config', '--local', 'user.email', GIT_IDENTITY_EMAIL], repositoryRoot);
  await runGit(['config', '--local', 'core.autocrlf', 'false'], repositoryRoot);
  await runGit(['config', '--local', 'core.eol', 'lf'], repositoryRoot);
  await runGit(['config', '--local', 'commit.gpgSign', 'false'], repositoryRoot);

  const hooksDirectory = path.resolve(repositoryRoot, '.git', 'devguard-hooks');
  if (!isStrictChild(hooksDirectory, path.resolve(repositoryRoot, '.git'))) {
    throw new SetupError();
  }

  await mkdir(hooksDirectory, { recursive: true });
  await runGit(['config', '--local', 'core.hooksPath', '.git/devguard-hooks'], repositoryRoot);
}

async function verifyBuiltAnalysis(paths) {
  await assertVerificationRegularFile(paths.builtCli, 'missing-built-cli');

  const cliResult = await runBuiltCli(paths);
  if (cliResult.exitCode !== 0 || cliResult.signal !== null) {
    throw new VerificationError('cli-execution-failure');
  }

  if (cliResult.stderr !== '') {
    throw new VerificationError('cli-stderr-not-empty');
  }

  await assertVerificationRegularFile(paths.jsonReport, 'missing-json-report');
  await assertVerificationRegularFile(paths.markdownReport, 'missing-markdown-report');

  const report = await readJsonReport(paths.jsonReport);
  const manifest = await readExpectationManifest(paths.expectationManifest);
  const result = verifyReportStructure(report, manifest);
  const expectedCliOutput = `DevGuard local analysis completed.\nReports published.\nHealth score: ${result.healthScore}/100\n`;
  if (cliResult.stdout !== expectedCliOutput) {
    throw new VerificationError('cli-stdout-mismatch');
  }

  const markdown = await readReportText(paths.markdownReport, 'markdown-read-failure');
  verifyMarkdownReport(markdown, result);
  verifyPrivacy([JSON.stringify(report), markdown, cliResult.stdout, cliResult.stderr], paths);

  return result;
}

function formatVerificationSuccess(result) {
  return (
    [
      'DevGuard Book demo verified.',
      `Findings: ${result.findingCount}`,
      `Scenarios: ${result.scenarioCount}`,
      `Health score: ${result.healthScore}/100`,
      `Health label: ${result.healthLabel}`,
      'Reports: Markdown and JSON',
    ].join('\n') + '\n'
  );
}

async function runBuiltCli(paths) {
  return runProcess(
    process.execPath,
    [
      paths.builtCli,
      'analyze',
      'local',
      '--config',
      'demo/.work/book-library/.devguard.yml',
      '--verbose',
    ],
    paths.projectRoot,
    CLI_TIMEOUT_MS,
    CLI_TERMINATION_GRACE_MS,
  );
}

async function readJsonReport(file) {
  const text = await readReportText(file, 'invalid-json');

  try {
    const report = JSON.parse(text);
    if (!isPlainObject(report)) {
      throw new Error('Report must be an object');
    }
    return report;
  } catch {
    throw new VerificationError('invalid-json');
  }
}

async function readExpectationManifest(file) {
  const text = await readReportText(file, 'invalid-manifest');

  try {
    const manifest = JSON.parse(text);
    if (!isPlainObject(manifest)) {
      throw new Error('Manifest must be an object');
    }
    return manifest;
  } catch {
    throw new VerificationError('invalid-manifest');
  }
}

async function readReportText(file, failureKind) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw new VerificationError(failureKind);
  }
}

function verifyReportStructure(report, manifest) {
  const repository = requirePlainObject(manifest.repository, 'manifest-repository');
  const expectedFindings = requireArray(manifest.expectedFindings, 'manifest-findings');
  const expectedFindingCount = requireNumber(
    manifest.expectedFindingCount,
    'manifest-finding-count',
  );
  const expectedScenarioCount = requireNumber(
    manifest.expectedGeneratedScenarioCount,
    'manifest-scenario-count',
  );
  const expectedHealthScore = requireNumber(manifest.predictedHealthScore, 'manifest-health-score');
  const expectedHealthLabel = requireString(manifest.predictedHealthLabel, 'manifest-health-label');
  const manifestStatus = requireString(manifest.status, 'manifest-status');

  if (manifestStatus !== 'predicted-unverified' && manifestStatus !== 'verified') {
    throw new VerificationError('manifest-status');
  }

  const repositoryId = requireString(repository.id, 'manifest-repository-id');
  const repositoryRole = requireString(repository.role, 'manifest-repository-role');
  const baseRef = requireString(repository.baseRef, 'manifest-base-ref');
  const reportRepositories = requireArray(report.repositories, 'report-repositories');
  if (reportRepositories.length !== 1) {
    throw new VerificationError('repository-mismatch');
  }

  const reportRepository = requirePlainObject(reportRepositories[0], 'report-repository');
  if (
    requireString(reportRepository.repositoryId, 'report-repository-id') !== repositoryId ||
    requireString(reportRepository.role, 'report-repository-role') !== repositoryRole ||
    requireString(reportRepository.baseRef, 'report-base-ref') !== baseRef
  ) {
    throw new VerificationError('repository-mismatch');
  }

  const findings = requireArray(report.findings, 'report-findings');
  const generatedTests = requireArray(report.generatedTests, 'report-generated-tests');
  const summary = requirePlainObject(report.summary, 'report-summary');
  const healthScore = requireNumber(report.healthScore, 'report-health-score');
  const healthLabel = requireString(report.healthLabel, 'report-health-label');

  if (
    report.version !== '1.0' ||
    findings.length !== expectedFindingCount ||
    findings.length !== expectedFindings.length ||
    generatedTests.length !== expectedScenarioCount ||
    healthScore !== expectedHealthScore ||
    healthLabel !== expectedHealthLabel ||
    requireNumber(summary.totalCount, 'summary-total') !== findings.length
  ) {
    throw new VerificationError('report-expectation-mismatch');
  }

  const actualFindings = findings.map(projectFinding);
  const expectedProjection = expectedFindings.map(projectExpectedFinding);
  if (!sameJson(actualFindings, expectedProjection) || !areFindingsOrdered(findings)) {
    throw new VerificationError('finding-mismatch');
  }

  verifySummary(summary, actualFindings);
  verifyGeneratedTests(generatedTests, findings);

  return {
    findingCount: findings.length,
    scenarioCount: generatedTests.length,
    healthScore,
    healthLabel,
    findingProjection: actualFindings,
    scenarioProjection: projectScenarios(generatedTests, findings),
  };
}

function projectExpectedFinding(value) {
  const finding = requirePlainObject(value, 'expected-finding');
  const location = requirePlainObject(finding.location, 'expected-location');
  const ruleId = requireString(finding.ruleId, 'expected-rule-id');

  return {
    ruleId,
    severity: requireString(finding.severity, 'expected-severity'),
    category: expectedCategory(ruleId),
    repositoryId: requireString(location.repositoryId, 'expected-location-repository'),
    file: requireString(location.file, 'expected-location-file'),
    ...(location.property === undefined
      ? {}
      : { property: requireString(location.property, 'expected-location-property') }),
  };
}

function projectFinding(value) {
  const finding = requirePlainObject(value, 'report-finding');
  const location = requirePlainObject(finding.location, 'report-finding-location');
  const ruleId = requireString(finding.ruleId, 'report-finding-rule');
  const metadata =
    finding.metadata === undefined ? undefined : requirePlainObject(finding.metadata, 'metadata');

  return {
    ruleId,
    severity: requireString(finding.severity, 'report-finding-severity'),
    category: requireString(finding.category, 'report-finding-category'),
    repositoryId: requireString(location.repositoryId, 'report-finding-repository'),
    file: requireString(location.file, 'report-finding-file'),
    ...(metadata?.property === undefined
      ? {}
      : { property: requireString(metadata.property, 'report-finding-property') }),
  };
}

function expectedCategory(ruleId) {
  return ruleId.startsWith('contract.') ? 'contract' : 'risk';
}

function verifySummary(summary, findings) {
  const counts = {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
    contract: findings.filter((finding) => finding.category === 'contract').length,
    risk: findings.filter((finding) => finding.category === 'risk').length,
    testing: findings.filter((finding) => finding.category === 'testing').length,
  };

  if (
    requireNumber(summary.criticalCount, 'summary-critical') !== counts.critical ||
    requireNumber(summary.highCount, 'summary-high') !== counts.high ||
    requireNumber(summary.warningCount, 'summary-warning') !== counts.warning ||
    requireNumber(summary.infoCount, 'summary-info') !== counts.info ||
    requireNumber(summary.contractCount, 'summary-contract') !== counts.contract ||
    requireNumber(summary.riskCount, 'summary-risk') !== counts.risk ||
    requireNumber(summary.testingCount, 'summary-testing') !== counts.testing
  ) {
    throw new VerificationError('summary-mismatch');
  }
}

function verifyGeneratedTests(generatedTests, findings) {
  const findingIds = new Set(
    findings.map((finding) =>
      requireString(requirePlainObject(finding, 'finding').id, 'finding-id'),
    ),
  );
  const relatedIds = [];

  for (const value of generatedTests) {
    const generatedTest = requirePlainObject(value, 'generated-test');
    if (requireString(generatedTest.framework, 'generated-test-framework') !== 'scenario-only') {
      throw new VerificationError('scenario-framework-mismatch');
    }

    const relatedFindingIds = requireArray(
      generatedTest.relatedFindingIds,
      'generated-test-related-findings',
    );
    if (relatedFindingIds.length !== 1) {
      throw new VerificationError('scenario-relationship-mismatch');
    }

    const relatedId = requireString(relatedFindingIds[0], 'generated-test-related-finding');
    if (!findingIds.has(relatedId)) {
      throw new VerificationError('scenario-relationship-mismatch');
    }

    relatedIds.push(relatedId);
  }

  if (
    new Set(relatedIds).size !== findings.length ||
    !sameTextList(relatedIds, [...findingIds]) ||
    !areGeneratedTestsOrdered(generatedTests)
  ) {
    throw new VerificationError('scenario-relationship-mismatch');
  }
}

function projectScenarios(generatedTests, findings) {
  const findingById = new Map(
    findings.map((value) => {
      const finding = requirePlainObject(value, 'finding');
      return [
        requireString(finding.id, 'finding-id'),
        requireString(finding.ruleId, 'finding-rule'),
      ];
    }),
  );

  return generatedTests.map((value) => {
    const generatedTest = requirePlainObject(value, 'generated-test');
    const relatedFindingIds = requireArray(generatedTest.relatedFindingIds, 'related-finding-ids');
    return {
      framework: requireString(generatedTest.framework, 'generated-test-framework'),
      relatedRuleIds: relatedFindingIds.map((id) =>
        findingById.get(requireString(id, 'related-finding-id')),
      ),
    };
  });
}

function areFindingsOrdered(findings) {
  return findings.every((value, index) => {
    if (index === 0) {
      return true;
    }

    return compareFindings(findings[index - 1], value) <= 0;
  });
}

function compareFindings(leftValue, rightValue) {
  const left = requirePlainObject(leftValue, 'left-finding');
  const right = requirePlainObject(rightValue, 'right-finding');
  const leftLocation = requirePlainObject(left.location, 'left-location');
  const rightLocation = requirePlainObject(right.location, 'right-location');
  const severityRank = { critical: 0, high: 1, warning: 2, info: 3 };
  const categoryRank = { contract: 0, risk: 1, testing: 2 };

  return (
    (severityRank[requireString(left.severity, 'left-severity')] ?? 99) -
      (severityRank[requireString(right.severity, 'right-severity')] ?? 99) ||
    (categoryRank[requireString(left.category, 'left-category')] ?? 99) -
      (categoryRank[requireString(right.category, 'right-category')] ?? 99) ||
    compareText(
      requireString(leftLocation.repositoryId, 'left-repository'),
      requireString(rightLocation.repositoryId, 'right-repository'),
    ) ||
    compareText(
      requireString(leftLocation.file, 'left-file'),
      requireString(rightLocation.file, 'right-file'),
    ) ||
    compareText(
      requireString(left.ruleId, 'left-rule'),
      requireString(right.ruleId, 'right-rule'),
    ) ||
    compareText(requireString(left.id, 'left-id'), requireString(right.id, 'right-id')) ||
    compareText(
      left.rootCauseId === undefined ? '' : requireString(left.rootCauseId, 'left-root-cause'),
      right.rootCauseId === undefined ? '' : requireString(right.rootCauseId, 'right-root-cause'),
    )
  );
}

function areGeneratedTestsOrdered(generatedTests) {
  return generatedTests.every((value, index) => {
    if (index === 0) {
      return true;
    }

    return compareGeneratedTests(generatedTests[index - 1], value) <= 0;
  });
}

function compareGeneratedTests(leftValue, rightValue) {
  const left = requirePlainObject(leftValue, 'left-generated-test');
  const right = requirePlainObject(rightValue, 'right-generated-test');
  const leftRelated = requireArray(left.relatedFindingIds, 'left-related-findings');
  const rightRelated = requireArray(right.relatedFindingIds, 'right-related-findings');

  return (
    compareText(
      requireString(left.framework, 'left-framework'),
      requireString(right.framework, 'right-framework'),
    ) ||
    compareText(
      requireString(left.title, 'left-title'),
      requireString(right.title, 'right-title'),
    ) ||
    compareText(requireString(left.id, 'left-test-id'), requireString(right.id, 'right-test-id')) ||
    compareText(
      [...new Set(leftRelated.map((id) => requireString(id, 'left-related-id')))]
        .sort()
        .join('\u0000'),
      [...new Set(rightRelated.map((id) => requireString(id, 'right-related-id')))]
        .sort()
        .join('\u0000'),
    )
  );
}

function verifyMarkdownReport(markdown, result) {
  const requiredFragments = [
    '# DevGuard PR Health Report',
    '## Health Score',
    `- Score: ${result.healthScore} / 100`,
    `- Status: ${formatMarkdownHealthLabel(result.healthLabel)}`,
    '## Suggested Tests',
    escapeMarkdownInline('library:src/types/book.ts'),
    escapeMarkdownInline('library:config/access-policy.json'),
    escapeMarkdownInline('library:src/services/catalog.ts'),
    ...result.findingProjection.map((finding) => `- Rule: ${escapeMarkdownInline(finding.ruleId)}`),
  ];

  if (!requiredFragments.every((fragment) => markdown.includes(fragment))) {
    throw new VerificationError('markdown-expectation-mismatch');
  }
}

function escapeMarkdownInline(value) {
  return value.replace(/[`*_{}[\]()#+.!|>-]/gu, '\\$&');
}

function formatMarkdownHealthLabel(healthLabel) {
  return healthLabel.replace(/_/gu, ' ');
}

function verifyPrivacy(values, paths) {
  const content = values.join('\n');
  const forbiddenValues = [
    paths.projectRoot,
    paths.workspaceRoot,
    process.env.HOME,
    process.env.USER,
    process.env.LOGNAME,
  ].filter((value) => typeof value === 'string' && value.length > 0);

  if (
    forbiddenValues.some((value) => content.includes(value)) ||
    content.includes('/home/') ||
    /(?:token|secret|credential|password)/iu.test(content) ||
    /(?:stack trace|error:\s)/iu.test(content)
  ) {
    throw new VerificationError('privacy-violation');
  }
}

async function assertVerificationRegularFile(file, failureKind) {
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('not regular');
    }
  } catch {
    throw new VerificationError(failureKind);
  }
}

function requirePlainObject(value, failureKind) {
  if (!isPlainObject(value)) {
    throw new VerificationError(failureKind);
  }
  return value;
}

function requireArray(value, failureKind) {
  if (!Array.isArray(value)) {
    throw new VerificationError(failureKind);
  }
  return value;
}

function requireString(value, failureKind) {
  if (typeof value !== 'string') {
    throw new VerificationError(failureKind);
  }
  return value;
}

function requireNumber(value, failureKind) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VerificationError(failureKind);
  }
  return value;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function createBaseCommit(repositoryRoot) {
  await stageExpectedFiles(repositoryRoot, EXPECTED_REPOSITORY_FILES);
  await createCommit(repositoryRoot, BASE_COMMIT_MESSAGE, BASE_COMMIT_DATE);
  return readGitValue(['rev-parse', 'HEAD'], repositoryRoot);
}

async function createBaseReference(repositoryRoot, baseCommit) {
  await runGit(['tag', 'demo-base', baseCommit], repositoryRoot);
  const resolvedBase = await readGitValue(['rev-parse', 'demo-base^{commit}'], repositoryRoot);
  if (resolvedBase !== baseCommit) {
    throw new SetupError();
  }
}

async function applyHeadTemplate(paths) {
  await removeRepositoryContent(paths.repositoryRoot);
  await copyTemplateTree(paths.headTemplateRepository, paths.repositoryRoot);
}

async function createHeadCommit(repositoryRoot) {
  await stageExpectedFiles(repositoryRoot, EXPECTED_REPOSITORY_FILES);
  await createCommit(repositoryRoot, HEAD_COMMIT_MESSAGE, HEAD_COMMIT_DATE);
}

async function verifyDemoRepository(paths, baseCommit) {
  const headCommit = await readGitValue(['rev-parse', 'HEAD'], paths.repositoryRoot);
  const resolvedBase = await readGitValue(
    ['rev-parse', 'demo-base^{commit}'],
    paths.repositoryRoot,
  );
  const parentCommit = await readGitValue(['rev-parse', 'HEAD^'], paths.repositoryRoot);
  const mergeBase = await readGitValue(['merge-base', 'demo-base', 'HEAD'], paths.repositoryRoot);
  const branch = await readGitValue(['symbolic-ref', '--short', 'HEAD'], paths.repositoryRoot);
  const commitCount = await readGitValue(['rev-list', '--count', 'HEAD'], paths.repositoryRoot);
  const changedPaths = await readGitLines(
    ['diff', '--name-only', 'demo-base...HEAD'],
    paths.repositoryRoot,
  );
  const repositoryFiles = await readGitLines(
    ['ls-tree', '-r', '--name-only', 'HEAD'],
    paths.repositoryRoot,
  );
  const status = await readGitValue(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    paths.repositoryRoot,
  );
  const remotes = await readGitValue(['remote'], paths.repositoryRoot);

  if (
    headCommit === baseCommit ||
    resolvedBase !== baseCommit ||
    parentCommit !== baseCommit ||
    mergeBase !== baseCommit ||
    branch !== 'main' ||
    commitCount !== '2' ||
    status !== '' ||
    remotes !== '' ||
    !sameTextList(changedPaths, EXPECTED_REPOSITORY_FILES) ||
    !sameTextList(repositoryFiles, EXPECTED_REPOSITORY_FILES)
  ) {
    throw new SetupError();
  }

  const workspaceEntries = (await readdir(paths.workspaceRoot)).sort();
  if (!sameTextList(workspaceEntries, ['.devguard.yml', 'library'])) {
    throw new SetupError();
  }

  const configuration = await readFile(path.resolve(paths.workspaceRoot, '.devguard.yml'), 'utf8');
  if (
    !configuration.includes('path: ./library\n') ||
    paths.repositoryRoot !== path.resolve(paths.workspaceRoot, 'library')
  ) {
    throw new SetupError();
  }

  await assertAbsent(path.resolve(paths.workspaceRoot, 'reports'));
  await assertAbsent(path.resolve(paths.workspaceRoot, 'requirements.md'));
}

async function stageExpectedFiles(repositoryRoot, expectedFiles) {
  await runGit(['add', '--all'], repositoryRoot);
  const stagedPaths = await readGitLines(['diff', '--cached', '--name-only'], repositoryRoot);
  if (!sameTextList(stagedPaths, expectedFiles)) {
    throw new SetupError();
  }
}

async function createCommit(repositoryRoot, message, date) {
  await runGit(
    ['-c', 'commit.gpgSign=false', 'commit', '--no-gpg-sign', '-m', message],
    repositoryRoot,
    {
      ...createCommitEnvironment(date),
    },
  );
}

function createCommitEnvironment(date) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: GIT_IDENTITY_NAME,
    GIT_AUTHOR_EMAIL: GIT_IDENTITY_EMAIL,
    GIT_COMMITTER_NAME: GIT_IDENTITY_NAME,
    GIT_COMMITTER_EMAIL: GIT_IDENTITY_EMAIL,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    TZ: 'UTC',
  };
}

async function removeRepositoryContent(repositoryRoot) {
  const entries = await readdir(repositoryRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git') {
      const gitMetadata = await lstat(path.resolve(repositoryRoot, entry.name));
      if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
        throw new SetupError();
      }
      continue;
    }

    const target = path.resolve(repositoryRoot, entry.name);
    if (!isStrictChild(target, repositoryRoot)) {
      throw new SetupError();
    }

    await rm(target, { force: true, recursive: true });
  }
}

async function assertTemplateTree(templateRoot) {
  const discoveredFiles = await listRegularFiles(templateRoot);
  if (!sameTextList(discoveredFiles, EXPECTED_REPOSITORY_FILES)) {
    throw new SetupError();
  }
}

async function listRegularFiles(root, relativeDirectory = '') {
  const directory = path.resolve(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const fullPath = path.resolve(root, relativePath);
    if (!isStrictChild(fullPath, root)) {
      throw new SetupError();
    }

    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink()) {
      throw new SetupError();
    }

    if (stats.isDirectory()) {
      files.push(...(await listRegularFiles(root, relativePath)));
      continue;
    }

    if (!stats.isFile()) {
      throw new SetupError();
    }

    files.push(relativePath);
  }

  return files.sort();
}

async function copyTextFile(sourceFile, targetFile, targetRoot) {
  await assertRegularFile(sourceFile);
  if (!isStrictChild(targetFile, targetRoot)) {
    throw new SetupError();
  }

  const content = await readFile(sourceFile, 'utf8');
  if (content.includes('\u0000') || content.startsWith('\uFEFF')) {
    throw new SetupError();
  }

  await mkdir(path.dirname(targetFile), { recursive: true });
  await writeFile(targetFile, content.replace(/\r\n?/gu, '\n'), 'utf8');
}

async function ensureGeneratedParent(paths) {
  const existingParent = await lstatOrUndefined(paths.generatedParent);
  if (existingParent !== undefined) {
    if (!existingParent.isDirectory() || existingParent.isSymbolicLink()) {
      throw new SetupError();
    }
  } else {
    await mkdir(paths.generatedParent, { recursive: true });
  }

  const demoRealPath = await realpath(paths.demoDirectory);
  const parentRealPath = await realpath(paths.generatedParent);
  if (!isStrictChild(parentRealPath, demoRealPath)) {
    throw new SetupError();
  }
}

async function assertDirectory(directory) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SetupError();
  }
}

async function assertRegularFile(file) {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SetupError();
  }
}

async function assertAbsent(candidate) {
  if ((await lstatOrUndefined(candidate)) !== undefined) {
    throw new SetupError();
  }
}

async function lstatOrUndefined(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw new SetupError();
  }
}

function isNotFoundError(error) {
  return typeof error === 'object' && error !== null && error.code === 'ENOENT';
}

function isStrictChild(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..');
}

function sameTextList(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function readGitValue(args, repositoryRoot) {
  return (await runGit(args, repositoryRoot)).stdout.trim();
}

async function readGitLines(args, repositoryRoot) {
  const output = await readGitValue(args, repositoryRoot);
  return output === ''
    ? []
    : output
        .split('\n')
        .filter((line) => line.length > 0)
        .sort();
}

function runProcess(executable, args, workingDirectory, timeoutMilliseconds, graceMilliseconds) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(executable, args, {
        cwd: workingDirectory,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new VerificationError('cli-execution-failure'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let terminationTimer;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(terminationTimer);
      resolve(result);
    };

    const fail = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(terminationTimer);
      reject(new VerificationError('cli-execution-failure'));
    };

    const terminate = (signal) => {
      try {
        child.kill(signal);
      } catch {
        // The fixed verification timeout outcome remains authoritative.
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', fail);
    child.once('close', (exitCode, signal) => {
      if (timedOut) {
        fail();
        return;
      }

      finish({ stdout, stderr, exitCode, signal });
    });

    timeoutTimer = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      terminate('SIGTERM');
      terminationTimer = setTimeout(() => {
        terminate('SIGKILL');
        fail();
      }, graceMilliseconds);
    }, timeoutMilliseconds);
  });
}

function runGit(args, repositoryRoot, environment = process.env) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn('git', args, {
        cwd: repositoryRoot,
        env: environment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new SetupError());
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let terminationTimer;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(terminationTimer);

      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    };

    const terminate = (signal) => {
      try {
        child.kill(signal);
      } catch {
        // The fixed timeout outcome remains authoritative.
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', () => finish(new SetupError()));
    child.once('close', (exitCode, signal) => {
      if (timedOut || exitCode !== 0 || signal !== null) {
        finish(new SetupError());
        return;
      }

      finish();
    });

    timeoutTimer = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      terminate('SIGTERM');
      terminationTimer = setTimeout(() => {
        terminate('SIGKILL');
        finish(new SetupError());
      }, GIT_TERMINATION_GRACE_MS);
    }, GIT_TIMEOUT_MS);
  });
}

void main();
