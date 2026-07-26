import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_TIMEOUT_MS = 10_000;
const GIT_TERMINATION_GRACE_MS = 250;
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

class SetupError extends Error {}

async function main() {
  if (process.argv.length !== 2) {
    throw new SetupError();
  }

  const paths = await resolveDemoPaths();
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

  process.stdout.write(`${SUCCESS_OUTPUT}\n`);
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
    generatedParent,
    workspaceRoot,
    repositoryRoot,
  };
}

async function validateDemoPaths(paths) {
  await assertDirectory(paths.projectRoot);
  await assertDirectory(paths.demoDirectory);
  await assertDirectory(paths.templateRoot);
  await assertDirectory(paths.baseTemplateRepository);
  await assertDirectory(paths.headTemplateRepository);
  await assertRegularFile(paths.templateConfiguration);

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

void main().catch(() => {
  process.stderr.write('DevGuard Book demo setup failed.\n');
  process.exitCode = 1;
});
