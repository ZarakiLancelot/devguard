import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROCESS_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 10_000;
const MAX_CAPTURED_OUTPUT_BYTES = 1_048_576;
const PACKAGE_NAME = '@edwineinsen/devguard';
const PACKAGE_VERSION = '0.1.1';
const PACKAGE_ARCHIVE = 'edwineinsen-devguard-0.1.1.tgz';
const EXPECTED_SUCCESS_OUTPUT = 'DevGuard local analysis completed.\nReports published.\n';
const EXPECTED_THRESHOLD_OUTPUT = 'DevGuard quality threshold not met.\n';
const BASE_COMMIT_DATE = '2026-01-01T00:00:00Z';
const HEAD_COMMIT_DATE = '2026-01-02T00:00:00Z';
const GIT_IDENTITY_NAME = 'DevGuard Demo';
const GIT_IDENTITY_EMAIL = 'demo@devguard.invalid';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const temporaryParent = path.resolve(projectRoot, '.tmp');
const verificationRoot = path.resolve(temporaryParent, 'package-verification');
const archiveDirectory = path.resolve(verificationRoot, 'archive');
const inspectionDirectory = path.resolve(verificationRoot, 'inspection');
const consumerRoot = path.resolve(verificationRoot, 'consumer');
const demoRoot = path.resolve(verificationRoot, 'book-library');
const repositoryRoot = path.resolve(demoRoot, 'library');
const reportsDirectory = path.resolve(demoRoot, 'reports');
const markdownReport = path.resolve(reportsDirectory, 'book-library-report.md');
const jsonReport = path.resolve(reportsDirectory, 'book-library-report.json');
const packageManifestPath = path.resolve(projectRoot, 'package.json');
const expectationManifestPath = path.resolve(projectRoot, 'demo', 'book-library', 'expected.json');
const templateRoot = path.resolve(projectRoot, 'demo', 'book-library');

class VerificationError extends Error {}

async function main() {
  let summary;
  let failed = false;

  try {
    await removeVerificationWorkspace();
    await mkdir(verificationRoot, { recursive: true });
    await assertDirectory(verificationRoot);

    summary = await verifyPackage();
  } catch {
    failed = true;
  }

  try {
    await removeVerificationWorkspace();
    await assertAbsent(verificationRoot);
  } catch {
    failed = true;
  }

  if (failed || summary === undefined) {
    process.stderr.write('DevGuard package verification failed.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    [
      'DevGuard package verification completed.',
      `Package: ${summary.packageName}@${summary.packageVersion}`,
      'Binary: devguard',
      `Installed CLI version: ${summary.packageVersion}`,
      `Book demo score: ${summary.score}/100`,
      `Book demo findings: ${summary.findingCount}`,
      `Book demo scenarios: ${summary.scenarioCount}`,
      'Threshold miss: exit 1 after reports published.',
    ].join('\n') + '\n',
  );
}

async function verifyPackage() {
  assertStrictChild(verificationRoot, temporaryParent);
  assertStrictChild(archiveDirectory, verificationRoot);
  assertStrictChild(inspectionDirectory, verificationRoot);
  assertStrictChild(consumerRoot, verificationRoot);
  assertStrictChild(demoRoot, verificationRoot);

  const packageManifest = await readJson(packageManifestPath);
  verifySourcePackageMetadata(packageManifest);
  const expectations = await readJson(expectationManifestPath);
  const expected = readExpectations(expectations);

  await runRequired(pnpmCommand(), ['run', 'build:prod'], projectRoot, PROCESS_TIMEOUT_MS);
  const archive = await createArchive();
  await verifyArchive(archive, packageManifest);
  const installedCli = await installConsumer(archive);
  await verifyInstalledCli(installedCli.shim, expected.packageVersion);
  await prepareBookRepository();

  const successfulRun = await runProcess(
    installedCli.shim,
    ['analyze', 'local', '--config', '.devguard.yml', '--verbose'],
    demoRoot,
    PROCESS_TIMEOUT_MS,
  );
  requireProcess(
    successfulRun,
    0,
    `${EXPECTED_SUCCESS_OUTPUT}Health score: ${expected.score}/100\n`,
    '',
  );

  const verifiedReport = await verifyReports(expected, [
    successfulRun.stdout,
    successfulRun.stderr,
  ]);
  await removeReports();
  await assertAbsent(markdownReport);
  await assertAbsent(jsonReport);

  const thresholdRun = await runProcess(
    installedCli.shim,
    ['analyze', 'local', '--config', '.devguard.yml', '--fail-below', String(expected.score + 1)],
    demoRoot,
    PROCESS_TIMEOUT_MS,
  );
  requireProcess(thresholdRun, 1, '', EXPECTED_THRESHOLD_OUTPUT);
  const thresholdReport = await verifyReports(expected, [thresholdRun.stdout, thresholdRun.stderr]);
  if (!sameProjection(verifiedReport, thresholdReport)) {
    throw new VerificationError();
  }

  return {
    packageName: expected.packageName,
    packageVersion: expected.packageVersion,
    score: expected.score,
    findingCount: expected.findingCount,
    scenarioCount: expected.scenarioCount,
  };
}

async function createArchive() {
  await mkdir(archiveDirectory, { recursive: true });
  const archive = path.resolve(archiveDirectory, PACKAGE_ARCHIVE);
  assertStrictChild(archive, archiveDirectory);
  await rm(archive, { force: true });

  const result = await runProcess(
    npmCommand(),
    ['pack', '--pack-destination', archiveDirectory, '--json'],
    projectRoot,
    PROCESS_TIMEOUT_MS,
  );
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new VerificationError();
  }

  const packed = parsePackResult(result.stdout);
  if (packed.filename !== PACKAGE_ARCHIVE) {
    throw new VerificationError();
  }
  await assertRegularFile(archive);
  return archive;
}

async function verifyArchive(archive, packageManifest) {
  const listing = await runRequired('tar', ['-tzf', archive], verificationRoot, PROCESS_TIMEOUT_MS);
  const entries = listing.stdout
    .split('\n')
    .filter((entry) => entry.length > 0)
    .sort();
  const requiredEntries = [
    'package/package.json',
    'package/LICENSE',
    'package/README.md',
    'package/dist/cli/index.js',
  ];
  if (!requiredEntries.every((entry) => entries.includes(entry))) {
    throw new VerificationError();
  }
  if (
    entries.some((entry) =>
      /(^package\/(src|demo|fixtures|scripts|docs|\.kiro)\/|\.test\.|\.map$|^package\/\.git|tsconfig|vitest|eslint)/u.test(
        entry,
      ),
    )
  ) {
    throw new VerificationError();
  }

  const packedManifest = await extractArchiveJson(archive, 'package/package.json');
  verifyPackedMetadata(packedManifest, packageManifest);
  const archiveText = JSON.stringify(packedManifest) + '\n' + entries.join('\n');
  assertPrivateContentAbsent(archiveText);
}

async function installConsumer(archive) {
  await mkdir(consumerRoot, { recursive: true });
  const relativeArchive = path.relative(consumerRoot, archive).split(path.sep).join('/');
  await writeFile(
    path.resolve(consumerRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'devguard-package-consumer',
        version: '0.0.0',
        private: true,
        dependencies: { [PACKAGE_NAME]: `file:${relativeArchive}` },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  await runRequired(
    pnpmCommand(),
    ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'],
    consumerRoot,
    PROCESS_TIMEOUT_MS,
  );

  const installedPackage = path.resolve(consumerRoot, 'node_modules', '@edwineinsen', 'devguard');
  const installedEntryPoint = path.resolve(installedPackage, 'dist', 'cli', 'index.js');
  const shim = path.resolve(
    consumerRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'devguard.cmd' : 'devguard',
  );
  assertStrictChild(installedPackage, consumerRoot);
  assertStrictChild(installedEntryPoint, consumerRoot);
  assertStrictChild(shim, consumerRoot);
  const installedPackageRealPath = await realpath(installedPackage);
  assertStrictChild(installedPackageRealPath, consumerRoot);
  await assertDirectory(installedPackageRealPath);
  await assertRegularFile(installedEntryPoint);
  const installedEntryPointRealPath = await realpath(installedEntryPoint);
  assertStrictChild(installedEntryPointRealPath, consumerRoot);
  await assertRegularFile(shim);
  await assertInstalledPackagePrivacy(installedPackageRealPath);
  return { entryPoint: installedEntryPointRealPath, shim };
}

async function verifyInstalledCli(shim, version) {
  const help = await runProcess(shim, ['--help'], consumerRoot, PROCESS_TIMEOUT_MS);
  requireProcess(help, 0, undefined, '');
  if (!help.stdout.includes('analyze')) {
    throw new VerificationError();
  }

  const versionResult = await runProcess(shim, ['--version'], consumerRoot, PROCESS_TIMEOUT_MS);
  requireProcess(versionResult, 0, `${version}\n`, '');

  const analyzeHelp = await runProcess(
    shim,
    ['analyze', 'local', '--help'],
    consumerRoot,
    PROCESS_TIMEOUT_MS,
  );
  requireProcess(analyzeHelp, 0, undefined, '');
  for (const option of ['--config', '--requirements', '--output', '--fail-below', '--verbose']) {
    if (!analyzeHelp.stdout.includes(option)) {
      throw new VerificationError();
    }
  }
  assertPrivateContentAbsent(
    `${help.stdout}${help.stderr}${versionResult.stdout}${analyzeHelp.stdout}`,
  );
}

async function prepareBookRepository() {
  assertStrictChild(demoRoot, verificationRoot);
  assertStrictChild(repositoryRoot, demoRoot);
  await mkdir(demoRoot, { recursive: true });
  await cp(path.resolve(templateRoot, '.devguard.yml'), path.resolve(demoRoot, '.devguard.yml'));
  await cp(path.resolve(templateRoot, 'base', 'library'), repositoryRoot, { recursive: true });

  await runRequired('git', ['init', '-b', 'main'], repositoryRoot, GIT_TIMEOUT_MS);
  await runRequired(
    'git',
    ['config', '--local', 'user.name', GIT_IDENTITY_NAME],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  await runRequired(
    'git',
    ['config', '--local', 'user.email', GIT_IDENTITY_EMAIL],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  await runRequired(
    'git',
    ['config', '--local', 'commit.gpgSign', 'false'],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  await runRequired('git', ['add', '--all'], repositoryRoot, GIT_TIMEOUT_MS);
  await commitBook('demo: create compatible Book contract', BASE_COMMIT_DATE);
  await runRequired('git', ['tag', 'demo-base'], repositoryRoot, GIT_TIMEOUT_MS);

  for (const entry of await readdir(repositoryRoot, { withFileTypes: true })) {
    if (entry.name !== '.git') {
      await rm(path.resolve(repositoryRoot, entry.name), { force: true, recursive: true });
    }
  }
  await cp(path.resolve(templateRoot, 'head', 'library'), repositoryRoot, { recursive: true });
  await runRequired('git', ['add', '--all'], repositoryRoot, GIT_TIMEOUT_MS);
  await commitBook('demo: introduce Book contract drift', HEAD_COMMIT_DATE);

  const worktree = await runRequired(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  const branch = await runRequired(
    'git',
    ['branch', '--show-current'],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  const commits = await runRequired(
    'git',
    ['rev-list', '--count', 'HEAD'],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  const status = await runRequired(
    'git',
    ['status', '--porcelain'],
    repositoryRoot,
    GIT_TIMEOUT_MS,
  );
  if (
    worktree.stdout !== 'true\n' ||
    branch.stdout !== 'main\n' ||
    commits.stdout !== '2\n' ||
    status.stdout !== ''
  ) {
    throw new VerificationError();
  }
  await assertAbsent(reportsDirectory);
}

async function commitBook(message, date) {
  await runRequired(
    'git',
    ['-c', 'commit.gpgSign=false', 'commit', '--no-gpg-sign', '-m', message],
    repositoryRoot,
    GIT_TIMEOUT_MS,
    {
      ...process.env,
      GIT_AUTHOR_NAME: GIT_IDENTITY_NAME,
      GIT_AUTHOR_EMAIL: GIT_IDENTITY_EMAIL,
      GIT_COMMITTER_NAME: GIT_IDENTITY_NAME,
      GIT_COMMITTER_EMAIL: GIT_IDENTITY_EMAIL,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      TZ: 'UTC',
    },
  );
}

async function verifyReports(expected, terminalOutput) {
  await assertRegularFile(markdownReport);
  await assertRegularFile(jsonReport);
  const [markdown, json] = await Promise.all([
    readFile(markdownReport, 'utf8'),
    readFile(jsonReport, 'utf8'),
  ]);
  const report = parseObject(json);
  const findings = requireArray(report.findings);
  const scenarios = requireArray(report.generatedTests);
  const repositories = requireArray(report.repositories);

  if (
    requireNumber(report.healthScore) !== expected.score ||
    requireString(report.healthLabel) !== expected.label ||
    findings.length !== expected.findingCount ||
    scenarios.length !== expected.scenarioCount ||
    repositories.length !== 1
  ) {
    throw new VerificationError();
  }

  const repository = requireObject(repositories[0]);
  if (
    requireString(repository.repositoryId) !== 'library' ||
    requireString(repository.role) !== 'fullstack' ||
    requireString(repository.baseRef) !== 'demo-base'
  ) {
    throw new VerificationError();
  }

  const projection = findings.map((value) => {
    const finding = requireObject(value);
    const location = requireObject(finding.location);
    const metadata = finding.metadata === undefined ? undefined : requireObject(finding.metadata);
    return {
      id: requireString(finding.id),
      ruleId: requireString(finding.ruleId),
      severity: requireString(finding.severity),
      repositoryId: requireString(location.repositoryId),
      file: requireString(location.file),
      ...(metadata?.property === undefined ? {} : { property: requireString(metadata.property) }),
    };
  });
  const expectedProjection = expected.findings.map((finding) => ({ ...finding }));
  if (
    JSON.stringify(projection.map(({ id: _id, ...finding }) => finding)) !==
    JSON.stringify(expectedProjection)
  ) {
    throw new VerificationError();
  }

  const findingIds = new Set(projection.map((finding) => finding.id));
  const relatedIds = scenarios.flatMap((value) => {
    const scenario = requireObject(value);
    if (requireString(scenario.framework) !== 'scenario-only') {
      throw new VerificationError();
    }
    const ids = requireArray(scenario.relatedFindingIds);
    if (ids.length !== 1 || !findingIds.has(requireString(ids[0]))) {
      throw new VerificationError();
    }
    return ids.map(requireString);
  });
  if (
    new Set(relatedIds).size !== findingIds.size ||
    relatedIds.length !== expected.scenarioCount
  ) {
    throw new VerificationError();
  }

  const markdownRequired = [
    '# DevGuard PR Health Report',
    `- Score: ${expected.score} / 100`,
    '- Status: HIGH RISK',
    '## Suggested Tests',
    ...expected.findings.flatMap((finding) => [
      `- Rule: ${escapeMarkdown(finding.ruleId)}`,
      escapeMarkdown(`library:${finding.file}`),
    ]),
  ];
  if (!markdownRequired.every((fragment) => markdown.includes(fragment))) {
    throw new VerificationError();
  }

  assertPrivateContentAbsent([...terminalOutput, json, markdown].join('\n'));
  return {
    score: expected.score,
    label: expected.label,
    findings: projection.map(({ id: _id, ...finding }) => finding),
    scenarioCount: scenarios.length,
  };
}

async function removeReports() {
  assertStrictChild(reportsDirectory, demoRoot);
  await rm(reportsDirectory, { force: true, recursive: true });
}

function readExpectations(value) {
  if (requireString(value.status) !== 'verified') {
    throw new VerificationError();
  }
  const findings = requireArray(value.expectedFindings).map((item) => {
    const finding = requireObject(item);
    const location = requireObject(finding.location);
    return {
      ruleId: requireString(finding.ruleId),
      severity: requireString(finding.severity),
      repositoryId: requireString(location.repositoryId),
      file: requireString(location.file),
      ...(location.property === undefined ? {} : { property: requireString(location.property) }),
    };
  });
  return {
    packageName: PACKAGE_NAME,
    packageVersion: PACKAGE_VERSION,
    score: requireNumber(value.predictedHealthScore),
    label: requireString(value.predictedHealthLabel),
    findingCount: requireNumber(value.expectedFindingCount),
    scenarioCount: requireNumber(value.expectedGeneratedScenarioCount),
    findings,
  };
}

function verifySourcePackageMetadata(value) {
  verifyPackedMetadata(value, value);
}

function verifyPackedMetadata(value, source) {
  if (
    requireString(value.name) !== PACKAGE_NAME ||
    requireString(value.version) !== PACKAGE_VERSION ||
    requireString(value.license) !== 'MIT' ||
    value.private === true
  ) {
    throw new VerificationError();
  }
  const bin = requireObject(value.bin);
  if (requireString(bin.devguard) !== 'dist/cli/index.js') {
    throw new VerificationError();
  }
  const repository = requireObject(value.repository);
  if (
    requireString(repository.type) !== 'git' ||
    !requireString(repository.url).includes('github.com/ZarakiLancelot/devguard')
  ) {
    throw new VerificationError();
  }
  const dependencies = requireObject(value.dependencies);
  for (const dependency of ['commander', 'minimatch', 'ts-morph', 'yaml', 'zod']) {
    if (typeof dependencies[dependency] !== 'string') {
      throw new VerificationError();
    }
  }
  if (
    source !== value &&
    JSON.stringify(value.dependencies) !== JSON.stringify(source.dependencies)
  ) {
    throw new VerificationError();
  }
}

async function assertInstalledPackagePrivacy(installedPackage) {
  const entries = (await listFiles(installedPackage)).filter(
    (entry) => !entry.startsWith('node_modules/'),
  );
  if (
    entries.some((entry) =>
      /(^|\/)(src|demo|fixtures|scripts|docs|\.kiro)(\/|$)|\.test\.|\.map$/u.test(entry),
    )
  ) {
    throw new VerificationError();
  }
  const contents = await Promise.all(
    entries.map((entry) => readFile(path.resolve(installedPackage, entry), 'utf8')),
  );
  assertPackageContentAbsent(contents.join('\n'));
}

async function listFiles(root, relative = '') {
  const directory = path.resolve(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (relative === '' && entry.name === 'node_modules') {
      continue;
    }
    const child = path.resolve(directory, entry.name);
    assertStrictChild(child, root);
    const childRelative = path.relative(root, child).split(path.sep).join('/');
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, childRelative)));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      files.push(childRelative);
    } else {
      throw new VerificationError();
    }
  }
  return files.sort();
}

async function extractArchiveJson(archive, entry) {
  const extracted = await runRequired(
    'tar',
    ['-xOf', archive, entry],
    verificationRoot,
    PROCESS_TIMEOUT_MS,
  );
  return parseObject(extracted.stdout);
}

async function readJson(file) {
  return parseObject(await readFile(file, 'utf8'));
}

function parseObject(value) {
  try {
    return requireObject(JSON.parse(value));
  } catch {
    throw new VerificationError();
  }
}

function parsePackResult(stdout) {
  try {
    const value = JSON.parse(stdout);
    if (!Array.isArray(value) || value.length !== 1) {
      throw new Error();
    }
    return { filename: requireString(requireObject(value[0]).filename) };
  } catch {
    throw new VerificationError();
  }
}

async function runRequired(executable, args, cwd, timeout, env = process.env) {
  const result = await runProcess(executable, args, cwd, timeout, env);
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new VerificationError();
  }
  return result;
}

function requireProcess(result, exitCode, stdout, stderr) {
  if (
    result.exitCode !== exitCode ||
    result.signal !== null ||
    (stdout !== undefined && result.stdout !== stdout) ||
    result.stderr !== stderr
  ) {
    throw new VerificationError();
  }
}

function runProcess(executable, args, cwd, timeoutMilliseconds, env = process.env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new VerificationError());
      return;
    }
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finishFailure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new VerificationError());
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finishFailure();
    }, timeoutMilliseconds);
    const append = (stream, chunk) => {
      if (settled) return;
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_CAPTURED_OUTPUT_BYTES) return finishFailure();
        stdout += chunk.toString('utf8');
      } else {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_CAPTURED_OUTPUT_BYTES) return finishFailure();
        stderr += chunk.toString('utf8');
      }
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', finishFailure);
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

async function removeVerificationWorkspace() {
  assertStrictChild(verificationRoot, temporaryParent);
  const stats = await lstatOrUndefined(verificationRoot);
  if (stats?.isSymbolicLink()) {
    throw new VerificationError();
  }
  await rm(verificationRoot, { force: true, recursive: true });
}

async function assertDirectory(directory) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new VerificationError();
  }
}

async function assertRegularFile(file) {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new VerificationError();
  }
}

async function assertAbsent(file) {
  if ((await lstatOrUndefined(file)) !== undefined) {
    throw new VerificationError();
  }
}

async function lstatOrUndefined(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function assertStrictChild(candidate, parent) {
  const relative = path.relative(parent, candidate);
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new VerificationError();
  }
}

function requireObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VerificationError();
  }
  return value;
}

function requireArray(value) {
  if (!Array.isArray(value)) {
    throw new VerificationError();
  }
  return value;
}

function requireString(value) {
  if (typeof value !== 'string') {
    throw new VerificationError();
  }
  return value;
}

function requireNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VerificationError();
  }
  return value;
}

function escapeMarkdown(value) {
  return value.replace(/[`*_{}[\]()#+.!|>-]/gu, '\\$&');
}

function sameProjection(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPrivateContentAbsent(content) {
  const forbidden = [projectRoot, verificationRoot, process.env.HOME].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (
    forbidden.some((value) => content.includes(value)) ||
    content.includes('/home/') ||
    /(?:password\s*[:=]|credential\s*[:=]|secret\s*[:=]|token\s*[:=]|stack trace|error:\s)/iu.test(
      content,
    )
  ) {
    throw new VerificationError();
  }
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** @typedef {{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }} ProcessResult */
/** @typedef {{ packageName: string, packageVersion: string, score: number, label: string, findingCount: number, scenarioCount: number, findings: Array<{ ruleId: string, severity: string, repositoryId: string, file: string, property?: string }> }} Expectations */
/** @typedef {{ score: number, label: string, findings: Array<{ ruleId: string, severity: string, repositoryId: string, file: string, property?: string }>, scenarioCount: number }} StableProjection */

function assertPackageContentAbsent(content) {
  const forbidden = [projectRoot, verificationRoot, process.env.HOME].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (forbidden.some((value) => content.includes(value)) || content.includes('/home/')) {
    throw new VerificationError();
  }
}
void main();
