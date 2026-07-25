import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DevGuardConfig } from '../config/config-schema.js';
import type * as PathSecurityModule from '../config/path-security.js';
import type { ChangedFile, RepositoryFile } from '../types/repository.js';
import type * as GitDiffModule from './local-git-diff-provider.js';
import type * as GitValidatorModule from './git-repository-validator.js';
import type * as PatchLoaderModule from './repository-patch-loader.js';
import type * as FileLoaderModule from './repository-file-loader.js';
import type * as RequirementsLoaderModule from './requirements-text-loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveRepositoryPath: vi.fn(),
  validateGitRepository: vi.fn(),
  loadChangedFiles: vi.fn(),
  loadChangedFilePatches: vi.fn(),
  loadRepositoryFiles: vi.fn(),
  loadRequirementsText: vi.fn(),
}));

vi.mock('../config/path-security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PathSecurityModule>();
  return { ...actual, resolveRepositoryPath: mocks.resolveRepositoryPath };
});

vi.mock('./git-repository-validator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GitValidatorModule>();
  return { ...actual, validateGitRepository: mocks.validateGitRepository };
});

vi.mock('./local-git-diff-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GitDiffModule>();
  return { ...actual, loadChangedFiles: mocks.loadChangedFiles };
});

vi.mock('./repository-patch-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PatchLoaderModule>();
  return { ...actual, loadChangedFilePatches: mocks.loadChangedFilePatches };
});

vi.mock('./repository-file-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FileLoaderModule>();
  return { ...actual, loadRepositoryFiles: mocks.loadRepositoryFiles };
});

vi.mock('./requirements-text-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RequirementsLoaderModule>();
  return { ...actual, loadRequirementsText: mocks.loadRequirementsText };
});

import { resolveRepositoryPath } from '../config/path-security.js';
import {
  GitDiffError,
  loadChangedFiles,
  type LoadChangedFilesInput,
} from './local-git-diff-provider.js';
import {
  buildLocalRepositoryContext,
  createBuildLocalRepositoryContext,
  MAX_CONTEXT_TEXT_BYTES,
  type BuildLocalRepositoryContextInput,
  type LocalRepositoryContextError,
} from './local-context-builder.js';
import {
  ExplicitRequirementsOverrideError,
  type ExplicitRequirementsOverride,
} from './explicit-requirements-override-loader.js';
import { validateGitRepository, type ValidatedGitRepository } from './git-repository-validator.js';
import { loadChangedFilePatches, type GitPatchWarning } from './repository-patch-loader.js';
import { GitFileLoadError, loadRepositoryFiles } from './repository-file-loader.js';
import { loadRequirementsText } from './requirements-text-loader.js';

const actualPathSecurity = await vi.importActual<typeof PathSecurityModule>(
  '../config/path-security.js',
);
const actualGitValidator = await vi.importActual<typeof GitValidatorModule>(
  './git-repository-validator.js',
);
const actualGitDiff = await vi.importActual<typeof GitDiffModule>('./local-git-diff-provider.js');
const actualPatchLoader = await vi.importActual<typeof PatchLoaderModule>(
  './repository-patch-loader.js',
);
const actualFileLoader = await vi.importActual<typeof FileLoaderModule>(
  './repository-file-loader.js',
);
const actualRequirementsLoader = await vi.importActual<typeof RequirementsLoaderModule>(
  './requirements-text-loader.js',
);
const execFileAsync = promisify(execFile);
const BASE_COMMIT = 'a'.repeat(40);
const HEAD_COMMIT = 'b'.repeat(40);

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }

  mocks.resolveRepositoryPath.mockImplementation(
    (workspaceBase: string, repositoryPath: string) => ({
      valid: true,
      resolvedPath: path.join(workspaceBase, repositoryPath),
    }),
  );
  mocks.validateGitRepository.mockImplementation(
    async ({
      repositoryPath: repositoryPathValue,
      baseRef,
    }: {
      repositoryPath: string;
      baseRef: string;
    }) => repositoryDescriptor(repositoryPathValue, baseRef),
  );
  mocks.loadChangedFiles.mockImplementation(
    async ({ repositoryId }: LoadChangedFilesInput): Promise<ChangedFile[]> => [
      { repositoryId, path: `src/${repositoryId}.ts`, status: 'modified' },
    ],
  );
  mocks.loadChangedFilePatches.mockImplementation(
    async ({ changedFiles }: { changedFiles: readonly ChangedFile[] }) => ({
      changedFiles: changedFiles.map((changedFile: ChangedFile) => ({ ...changedFile })),
      warnings: [],
    }),
  );
  mocks.loadRepositoryFiles.mockImplementation(
    async ({ repositoryId, paths }: { repositoryId: string; paths: readonly string[] }) => ({
      files: paths.map((filePath: string) =>
        repositoryFile(repositoryId, filePath, `content:${filePath}`),
      ),
    }),
  );
  mocks.loadRequirementsText.mockResolvedValue({
    source: 'config',
    selectedPath: 'requirements.md',
    warnings: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function repositoryDescriptor(repositoryPath: string, baseRef: string): ValidatedGitRepository {
  return {
    repositoryPath: `/canonical${repositoryPath}`,
    baseRef,
    baseCommit: BASE_COMMIT,
    headRef: HEAD_COMMIT,
  };
}

function repositoryFile(repositoryId: string, filePath: string, content: string): RepositoryFile {
  return {
    repositoryId,
    path: filePath,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  };
}

function makeConfig(overrides: Partial<DevGuardConfig> = {}): DevGuardConfig {
  return {
    version: 1,
    repositories: {
      app: { path: '../app', baseRef: 'main', role: 'fullstack' },
    },
    openapi: { repository: 'app', path: 'docs/openapi.yaml' },
    contracts: [
      {
        name: 'Book',
        openapiSchema: 'Book',
        typescript: { repository: 'app', file: 'src/book.ts', type: 'Book' },
      },
    ],
    ...overrides,
  };
}

function makeInput(
  config: DevGuardConfig,
  overrides: Partial<BuildLocalRepositoryContextInput> = {},
): BuildLocalRepositoryContextInput {
  return { workspaceBase: '/workspace/config', config, ...overrides };
}

async function expectContextError(
  action: () => Promise<unknown>,
  code: LocalRepositoryContextError['code'],
): Promise<void> {
  await expect(action).rejects.toMatchObject({
    name: 'LocalRepositoryContextError',
    code,
  });
}

function useRealGitSources(): void {
  mocks.resolveRepositoryPath.mockImplementation(actualPathSecurity.resolveRepositoryPath);
  mocks.validateGitRepository.mockImplementation(actualGitValidator.validateGitRepository);
  mocks.loadChangedFiles.mockImplementation(actualGitDiff.loadChangedFiles);
  mocks.loadChangedFilePatches.mockImplementation(actualPatchLoader.loadChangedFilePatches);
  mocks.loadRepositoryFiles.mockImplementation(actualFileLoader.loadRepositoryFiles);
  mocks.loadRequirementsText.mockImplementation(actualRequirementsLoader.loadRequirementsText);
}

async function runGit(args: readonly string[], repositoryPath?: string): Promise<string> {
  const commandArgs = repositoryPath === undefined ? [...args] : ['-C', repositoryPath, ...args];
  return (await execFileAsync('git', commandArgs, { encoding: 'utf8' })).stdout;
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devguard-local-context-'));
  try {
    await callback(directory);
  } finally {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
}

async function createRepository(
  parentDirectory: string,
  name: string,
  baseBranch: string,
  initialFiles: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>>,
): Promise<{ repositoryPath: string; baseRef: string; headRef: string }> {
  const repositoryPath = path.join(parentDirectory, name);
  await runGit(['init', '--initial-branch=main', repositoryPath]);
  await runGit(['config', 'user.name', 'DevGuard Tests'], repositoryPath);
  await runGit(['config', 'user.email', 'devguard-tests@example.invalid'], repositoryPath);

  for (const [filePath, content] of Object.entries(initialFiles)) {
    await mkdir(path.dirname(path.join(repositoryPath, filePath)), { recursive: true });
    await writeFile(path.join(repositoryPath, filePath), content, { encoding: 'utf8' });
  }
  await runGit(['add', '--all'], repositoryPath);
  await runGit(['commit', '-m', 'base'], repositoryPath);
  await runGit(['branch', baseBranch], repositoryPath);

  for (const [filePath, content] of Object.entries(changes)) {
    await mkdir(path.dirname(path.join(repositoryPath, filePath)), { recursive: true });
    await writeFile(path.join(repositoryPath, filePath), content, { encoding: 'utf8' });
  }
  await runGit(['add', '--all'], repositoryPath);
  await runGit(['commit', '-m', 'change'], repositoryPath);

  return {
    repositoryPath,
    baseRef: baseBranch,
    headRef: (await runGit(['rev-parse', 'HEAD'], repositoryPath)).trim(),
  };
}

describe('buildLocalRepositoryContext mocked composition', () => {
  it.each([
    ['frontend', 'frontend'],
    ['backend', 'backend'],
    ['fullstack', 'fullstack'],
  ] as const)('supports one %s repository without requiring two', async (repositoryId, role) => {
    const config = makeConfig({
      repositories: { [repositoryId]: { path: `../${repositoryId}`, baseRef: 'base', role } },
      openapi: { repository: repositoryId, path: 'docs/openapi.yaml' },
      contracts: [],
    });

    const context = await buildLocalRepositoryContext(makeInput(config));

    expect(context.repositories).toHaveLength(1);
    expect(context.repositories[0]).toMatchObject({ repositoryId, role, baseRef: 'base' });
  });

  it('processes frontend and backend sequentially in code-point repository-ID order', async () => {
    const events: string[] = [];
    const config = makeConfig({
      repositories: {
        frontend: { path: '../web', baseRef: 'web-base', role: 'frontend' },
        backend: { path: '../api', baseRef: 'api-base', role: 'backend' },
      },
      openapi: { repository: 'backend', path: 'docs/openapi.yaml' },
      contracts: [
        {
          name: 'Book',
          openapiSchema: 'Book',
          typescript: { repository: 'frontend', file: 'src/book.ts', type: 'Book' },
        },
      ],
    });

    mocks.validateGitRepository.mockImplementation(
      async ({ repositoryPath: repositoryPathValue, baseRef }) => {
        events.push(`validate:${baseRef}`);
        return repositoryDescriptor(repositoryPathValue, baseRef);
      },
    );
    mocks.loadChangedFiles.mockImplementation(async ({ repositoryId }: LoadChangedFilesInput) => {
      events.push(`diff:${repositoryId}`);
      return [{ repositoryId, path: `${repositoryId}.ts`, status: 'modified' }];
    });
    mocks.loadChangedFilePatches.mockImplementation(
      async ({
        repositoryId,
        changedFiles,
      }: {
        repositoryId: string;
        changedFiles: readonly ChangedFile[];
      }) => {
        events.push(`patch:${repositoryId}`);
        return {
          changedFiles: changedFiles.map((changedFile: ChangedFile) => ({ ...changedFile })),
          warnings: [],
        };
      },
    );
    mocks.loadRepositoryFiles.mockImplementation(async ({ repositoryId, paths }) => {
      events.push(`files:${repositoryId}`);
      return {
        files: paths.map((filePath: string) => repositoryFile(repositoryId, filePath, filePath)),
      };
    });

    const strictLoader = vi.fn().mockResolvedValue({ text: 'unused' });
    const builder = createBuildLocalRepositoryContext({
      loadExplicitRequirementsOverride: strictLoader,
    });
    const context = await builder(makeInput(config));

    expect(strictLoader).not.toHaveBeenCalled();

    expect(events).toEqual([
      'validate:api-base',
      'diff:backend',
      'patch:backend',
      'files:backend',
      'validate:web-base',
      'diff:frontend',
      'patch:frontend',
      'files:frontend',
    ]);
    expect(context.repositories.map((repository) => repository.repositoryId)).toEqual([
      'backend',
      'frontend',
    ]);
    expect(validateGitRepository).toHaveBeenNthCalledWith(1, {
      repositoryPath: '/workspace/api',
      baseRef: 'api-base',
    });
    expect(validateGitRepository).toHaveBeenNthCalledWith(2, {
      repositoryPath: '/workspace/web',
      baseRef: 'web-base',
    });
  });

  it('uses workspaceBase for each configured repository path and flows one descriptor through its pipeline', async () => {
    const descriptor = repositoryDescriptor('/resolved/app', 'configured-base');
    mocks.resolveRepositoryPath.mockReturnValue({ valid: true, resolvedPath: '/resolved/app' });
    mocks.validateGitRepository.mockResolvedValue(descriptor);
    mocks.loadChangedFiles.mockResolvedValue([
      { repositoryId: 'app', path: 'src/change.ts', status: 'modified' },
    ]);
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [
        { repositoryId: 'app', path: 'src/change.ts', status: 'modified', patch: 'diff' },
      ],
      warnings: [],
    });

    await buildLocalRepositoryContext(makeInput(makeConfig()));

    expect(resolveRepositoryPath).toHaveBeenCalledWith('/workspace/config', '../app');
    expect(loadChangedFiles).toHaveBeenCalledWith({ repositoryId: 'app', repository: descriptor });
    expect(loadChangedFilePatches).toHaveBeenCalledWith({
      repositoryId: 'app',
      repository: descriptor,
      changedFiles: [{ repositoryId: 'app', path: 'src/change.ts', status: 'modified' }],
    });
    expect(loadRepositoryFiles).toHaveBeenCalledWith({
      repositoryId: 'app',
      repository: descriptor,
      paths: ['docs/openapi.yaml', 'src/book.ts'],
    });
  });

  it('groups mapped OpenAPI and TypeScript paths by repository, deduplicates exact paths, and preserves text', async () => {
    const config = makeConfig({
      repositories: {
        api: { path: '../api', baseRef: 'api-base', role: 'backend' },
        web: { path: '../web', baseRef: 'web-base', role: 'frontend' },
      },
      openapi: { repository: 'api', path: 'docs/Z.yaml' },
      contracts: [
        {
          name: 'A',
          openapiSchema: 'A',
          typescript: { repository: 'web', file: 'src/é.ts', type: 'A' },
        },
        {
          name: 'B',
          openapiSchema: 'B',
          typescript: { repository: 'web', file: 'src/a.ts', type: 'B' },
        },
        {
          name: 'C',
          openapiSchema: 'C',
          typescript: { repository: 'web', file: 'src/é.ts', type: 'C' },
        },
        {
          name: 'D',
          openapiSchema: 'D',
          typescript: { repository: 'api', file: 'src/Exact\\path.ts', type: 'D' },
        },
      ],
    });

    await buildLocalRepositoryContext(makeInput(config));

    expect(loadRepositoryFiles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        repositoryId: 'api',
        paths: ['docs/Z.yaml', 'src/Exact\\path.ts'],
      }),
    );
    expect(loadRepositoryFiles).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        repositoryId: 'web',
        paths: ['src/a.ts', 'src/é.ts'],
      }),
    );
  });

  it('loads mapped files even when unchanged and keeps same paths in separate repositories distinct', async () => {
    const config = makeConfig({
      repositories: {
        backend: { path: '../backend', baseRef: 'backend-base', role: 'backend' },
        frontend: { path: '../frontend', baseRef: 'frontend-base', role: 'frontend' },
      },
      openapi: { repository: 'backend', path: 'shared/model.ts' },
      contracts: [
        {
          name: 'Book',
          openapiSchema: 'Book',
          typescript: { repository: 'frontend', file: 'shared/model.ts', type: 'Book' },
        },
      ],
    });
    mocks.loadChangedFiles.mockImplementation(async ({ repositoryId }: LoadChangedFilesInput) => [
      { repositoryId, path: 'unrelated.ts', status: 'modified' },
    ]);

    const context = await buildLocalRepositoryContext(makeInput(config));

    expect(loadRepositoryFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: 'backend',
        paths: ['shared/model.ts'],
      }),
    );
    expect(loadRepositoryFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: 'frontend',
        paths: ['shared/model.ts'],
      }),
    );
    expect(context.files.map((file) => `${file.repositoryId}:${file.path}`)).toEqual([
      'backend:shared/model.ts',
      'frontend:shared/model.ts',
    ]);
  });

  it('constructs copied change sets and files with canonical repository paths and no baseCommit or absolutePath', async () => {
    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        {
          ...repositoryFile('app', 'src/book.ts', 'book'),
          absolutePath: '/private/absolute/path.ts',
        },
        repositoryFile('app', 'docs/openapi.yaml', 'openapi'),
      ],
    });

    const context = await buildLocalRepositoryContext(makeInput(makeConfig()));

    expect(context.repositories[0]).toEqual({
      repositoryId: 'app',
      repositoryPath: '/canonical/workspace/app',
      role: 'fullstack',
      baseRef: 'main',
      headRef: HEAD_COMMIT,
      changedFiles: [{ repositoryId: 'app', path: 'src/app.ts', status: 'modified' }],
    });
    expect(context.repositories[0]).not.toHaveProperty('baseCommit');
    expect(context.files).toEqual([
      repositoryFile('app', 'docs/openapi.yaml', 'openapi'),
      repositoryFile('app', 'src/book.ts', 'book'),
    ]);
    expect(context.files[1]).not.toHaveProperty('absolutePath');
  });

  it('sorts final files by repository ID and path without mutating caller inputs or loader records', async () => {
    const config = makeConfig({
      repositories: {
        beta: { path: '../beta', baseRef: 'base-beta', role: 'backend' },
        alpha: { path: '../alpha', baseRef: 'base-alpha', role: 'frontend' },
      },
      openapi: { repository: 'beta', path: 'z.yaml' },
      contracts: [
        {
          name: 'Alpha',
          openapiSchema: 'A',
          typescript: { repository: 'alpha', file: 'z.ts', type: 'A' },
        },
        {
          name: 'Beta',
          openapiSchema: 'B',
          typescript: { repository: 'alpha', file: 'a.ts', type: 'B' },
        },
      ],
    });
    const originalConfig = structuredClone(config);
    const loaderFiles = [
      repositoryFile('alpha', 'z.ts', 'z'),
      repositoryFile('alpha', 'a.ts', 'a'),
    ];
    mocks.loadRepositoryFiles.mockImplementation(async ({ repositoryId, paths }) => ({
      files:
        repositoryId === 'alpha'
          ? loaderFiles
          : paths.map((filePath: string) => repositoryFile(repositoryId, filePath, filePath)),
    }));

    const context = await buildLocalRepositoryContext(makeInput(config));

    expect(context.files.map((file) => `${file.repositoryId}:${file.path}`)).toEqual([
      'alpha:a.ts',
      'alpha:z.ts',
      'beta:z.yaml',
    ]);
    expect(config).toEqual(originalConfig);
    expect(loaderFiles.map((file) => file.path)).toEqual(['z.ts', 'a.ts']);
    expect(context.files[0]).not.toBe(loaderFiles[1]);
  });

  it('formats, safely escapes, exact-deduplicates, and deterministically sorts patch warnings', async () => {
    const warning: GitPatchWarning = {
      code: 'PATCH_TOO_LARGE',
      message: 'Patch was omitted because it exceeds the maximum allowed size.',
      repositoryId: 'app"\\\t\n',
      path: 'src/"\\\t\n.ts',
    };
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [{ repositoryId: 'app', path: 'src/app.ts', status: 'modified' }],
      warnings: [warning, warning, { ...warning, code: 'PATCH_BINARY', message: 'Binary.' }],
    });

    const context = await buildLocalRepositoryContext(makeInput(makeConfig()));

    expect(context.warnings).toEqual([
      'PATCH_BINARY: Binary. repository="app\\"\\\\\\t\\n" path="src/\\"\\\\\\t\\n.ts"',
      'PATCH_TOO_LARGE: Patch was omitted because it exceeds the maximum allowed size. repository="app\\"\\\\\\t\\n" path="src/\\"\\\\\\t\\n.ts"',
    ]);
  });

  it('formats requirements warnings, omits an unavailable warning path, and retains optional failures', async () => {
    const config = makeConfig({ testing: { requirementsFile: 'requirements.md' } });
    mocks.loadRequirementsText.mockResolvedValue({
      source: 'config',
      selectedPath: 'requirements.md',
      warnings: [
        {
          code: 'REQUIREMENTS_FILE_NOT_FOUND',
          message: 'Selected requirements file was not found.',
          source: 'config',
        },
        {
          code: 'REQUIREMENTS_INVALID_PATH',
          message: 'Selected requirements path is invalid.',
          source: 'config',
          path: 'bad\tpath',
        },
      ],
    });

    const context = await buildLocalRepositoryContext(makeInput(config));

    expect(context.requirements).toBeUndefined();
    expect(context.warnings).toEqual([
      'REQUIREMENTS_FILE_NOT_FOUND: Selected requirements file was not found. source="config"',
      'REQUIREMENTS_INVALID_PATH: Selected requirements path is invalid. source="config" path="bad\\tpath"',
    ]);
  });

  it('loads an explicit override once before every repository dependency, retains its text, and bypasses configured requirements loading', async () => {
    const config = makeConfig({ testing: { requirementsFile: 'config-requirements.md' } });
    const override: ExplicitRequirementsOverride = {
      path: 'cli-requirements.md',
      baseDirectory: '/captured/working-directory',
      required: true,
    };
    const events: string[] = [];
    const strictLoader = vi.fn(async () => {
      events.push('strict');
      return { text: 'Explicit requirements text.' };
    });
    const dependencies = { loadExplicitRequirementsOverride: strictLoader };
    const builder = createBuildLocalRepositoryContext(dependencies);
    mocks.resolveRepositoryPath.mockImplementation(
      (workspaceBase: string, repositoryPath: string) => {
        events.push('resolve');
        return { valid: true, resolvedPath: path.join(workspaceBase, repositoryPath) };
      },
    );
    mocks.validateGitRepository.mockImplementation(
      async ({ repositoryPath, baseRef }: { repositoryPath: string; baseRef: string }) => {
        events.push('validate');
        return repositoryDescriptor(repositoryPath, baseRef);
      },
    );
    mocks.loadChangedFiles.mockImplementation(async ({ repositoryId }: LoadChangedFilesInput) => {
      events.push('diff');
      return [{ repositoryId, path: 'src/app.ts', status: 'modified' }];
    });
    mocks.loadChangedFilePatches.mockImplementation(
      async ({ changedFiles }: { changedFiles: readonly ChangedFile[] }) => {
        events.push('patch');
        return { changedFiles, warnings: [] };
      },
    );
    mocks.loadRepositoryFiles.mockImplementation(
      async ({ repositoryId, paths }: { repositoryId: string; paths: readonly string[] }) => {
        events.push('files');
        return { files: paths.map((filePath) => repositoryFile(repositoryId, filePath, filePath)) };
      },
    );
    mocks.loadRequirementsText.mockImplementation(async () => {
      events.push('configured');
      return { source: 'config', selectedPath: 'config-requirements.md', warnings: [] };
    });
    const beforeOverride = structuredClone(override);
    const originalDependency = dependencies.loadExplicitRequirementsOverride;
    const log = vi.spyOn(console, 'log');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');

    try {
      const context = await builder(makeInput(config, { requirementsOverride: override }));

      expect(strictLoader).toHaveBeenCalledTimes(1);
      expect(strictLoader).toHaveBeenCalledWith(override);
      expect((strictLoader.mock.calls as unknown as [ExplicitRequirementsOverride][])[0]?.[0]).toBe(
        override,
      );
      expect(events).toEqual(['strict', 'resolve', 'validate', 'diff', 'patch', 'files']);
      expect(loadRequirementsText).not.toHaveBeenCalled();
      expect(context.requirements).toBe('Explicit requirements text.');
      expect(context.warnings).toEqual([]);
      expect(context).not.toHaveProperty('requirementsOverride');
      expect(JSON.stringify(context)).not.toContain(override.path);
      expect(JSON.stringify(context)).not.toContain(override.baseDirectory);
      expect(override).toEqual(beforeOverride);
      expect(dependencies.loadExplicitRequirementsOverride).toBe(originalDependency);
      expect(log).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it.each([
    ['typed', new ExplicitRequirementsOverrideError('REQUIREMENTS_OVERRIDE_NOT_FOUND', 'ignored')],
    ['unknown', { private: 'unknown strict failure' }],
  ])('propagates a %s strict-loader failure before repository work', async (_name, failure) => {
    const config = makeConfig({ testing: { requirementsFile: 'config-requirements.md' } });
    const override: ExplicitRequirementsOverride = {
      path: 'requirements.md',
      baseDirectory: '/captured/working-directory',
      required: true,
    };
    const strictLoader = vi.fn().mockRejectedValue(failure);
    const builder = createBuildLocalRepositoryContext({
      loadExplicitRequirementsOverride: strictLoader,
    });
    const log = vi.spyOn(console, 'log');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');

    try {
      await expect(
        builder(makeInput(config, { workspaceBase: '', requirementsOverride: override })),
      ).rejects.toBe(failure);

      expect(strictLoader).toHaveBeenCalledTimes(1);
      expect(mocks.resolveRepositoryPath).not.toHaveBeenCalled();
      expect(mocks.validateGitRepository).not.toHaveBeenCalled();
      expect(mocks.loadChangedFiles).not.toHaveBeenCalled();
      expect(mocks.loadChangedFilePatches).not.toHaveBeenCalled();
      expect(mocks.loadRepositoryFiles).not.toHaveBeenCalled();
      expect(mocks.loadRequirementsText).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('falls back to configured requirements and does not call the loader without a selected source', async () => {
    const withConfigRequirements = makeConfig({ testing: { requirementsFile: 'config.md' } });
    await buildLocalRepositoryContext(makeInput(withConfigRequirements));
    expect(loadRequirementsText).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'config',
        path: 'config.md',
      }),
    );

    mocks.loadRequirementsText.mockClear();
    await buildLocalRepositoryContext(makeInput(makeConfig()));
    expect(loadRequirementsText).not.toHaveBeenCalled();
  });

  it('accounts file, retained patch, and requirements UTF-8 bytes while excluding omitted patches', async () => {
    const config = makeConfig({ testing: { requirementsFile: 'requirements.md' } });
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [
        { repositoryId: 'app', path: 'with-patch.ts', status: 'modified', patch: 'é' },
        { repositoryId: 'app', path: 'without-patch.ts', status: 'modified' },
      ],
      warnings: [
        {
          code: 'PATCH_TOO_LARGE',
          message: 'omitted',
          repositoryId: 'app',
          path: 'without-patch.ts',
        },
      ],
    });
    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        repositoryFile('app', 'docs/openapi.yaml', 'x'),
        repositoryFile('app', 'src/book.ts', 'y'),
      ],
    });
    mocks.loadRequirementsText.mockResolvedValue({
      source: 'config',
      selectedPath: 'requirements.md',
      content: 'é',
      warnings: [],
    });

    const context = await buildLocalRepositoryContext(makeInput(config));

    expect(context.requirements).toBe('é');
    expect(context.warnings).toHaveLength(1);
  });

  it('accepts exactly 20 MiB of retained content and rejects one byte over', async () => {
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [{ repositoryId: 'app', path: 'src/app.ts', status: 'modified' }],
      warnings: [],
    });
    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        repositoryFile('app', 'docs/openapi.yaml', 'x'.repeat(MAX_CONTEXT_TEXT_BYTES)),
        repositoryFile('app', 'src/book.ts', ''),
      ],
    });

    await expect(buildLocalRepositoryContext(makeInput(makeConfig()))).resolves.toBeDefined();

    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        repositoryFile('app', 'docs/openapi.yaml', 'x'.repeat(MAX_CONTEXT_TEXT_BYTES + 1)),
        repositoryFile('app', 'src/book.ts', ''),
      ],
    });
    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(makeConfig())),
      'LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED',
    );
  });

  it('counts duplicate retained patch records individually and counts duplicate mapped files once', async () => {
    expect.hasAssertions();
    const duplicatePatch = 'x'.repeat(MAX_CONTEXT_TEXT_BYTES / 2 + 1);
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [
        { repositoryId: 'app', path: 'duplicate.ts', status: 'modified', patch: duplicatePatch },
        { repositoryId: 'app', path: 'duplicate.ts', status: 'modified', patch: duplicatePatch },
      ],
      warnings: [],
    });
    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        repositoryFile('app', 'docs/openapi.yaml', ''),
        repositoryFile('app', 'src/book.ts', ''),
      ],
    });

    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(makeConfig())),
      'LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED',
    );
  });

  it('enforces the aggregate budget across individually valid repositories and requirements', async () => {
    expect.hasAssertions();
    const half = 'x'.repeat(MAX_CONTEXT_TEXT_BYTES / 2);
    const config = makeConfig({
      repositories: {
        backend: { path: '../backend', baseRef: 'backend-base', role: 'backend' },
        frontend: { path: '../frontend', baseRef: 'frontend-base', role: 'frontend' },
      },
      openapi: { repository: 'backend', path: 'openapi.yaml' },
      contracts: [
        {
          name: 'Book',
          openapiSchema: 'Book',
          typescript: { repository: 'frontend', file: 'book.ts', type: 'Book' },
        },
      ],
      testing: { requirementsFile: 'requirements.md' },
    });
    mocks.loadRepositoryFiles.mockImplementation(async ({ repositoryId, paths }) => ({
      files: paths.map((filePath: string) => repositoryFile(repositoryId, filePath, half)),
    }));
    mocks.loadRequirementsText.mockResolvedValue({
      source: 'config',
      selectedPath: 'requirements.md',
      content: 'x',
      warnings: [],
    });

    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(config)),
      'LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED',
    );
  });

  it('returns safe config errors for builder input and missing mapping repositories without lower-level calls', async () => {
    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(makeConfig(), { workspaceBase: '' })),
      'LOCAL_SOURCE_CONFIG_INVALID',
    );
    await expectContextError(
      () =>
        buildLocalRepositoryContext(
          makeInput(makeConfig({ openapi: { repository: 'missing', path: 'openapi.yaml' } })),
        ),
      'LOCAL_SOURCE_CONFIG_INVALID',
    );
    expect(validateGitRepository).not.toHaveBeenCalled();
  });

  it('fails safely for changed-file, repository-file, and loader-result invariants', async () => {
    expect.hasAssertions();
    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [{ repositoryId: 'other', path: 'src/file.ts', status: 'modified' }],
      warnings: [],
    });
    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(makeConfig())),
      'LOCAL_SOURCE_INVARIANT_VIOLATION',
    );

    mocks.loadChangedFilePatches.mockResolvedValue({
      changedFiles: [{ repositoryId: 'app', path: 'src/app.ts', status: 'modified' }],
      warnings: [],
    });
    mocks.loadRepositoryFiles.mockResolvedValue({
      files: [
        repositoryFile('other', 'docs/openapi.yaml', 'content'),
        repositoryFile('app', 'src/book.ts', 'content'),
      ],
    });
    await expectContextError(
      () => buildLocalRepositoryContext(makeInput(makeConfig())),
      'LOCAL_SOURCE_INVARIANT_VIOLATION',
    );
  });

  it('passes lower-level validation, diff, and required-file errors through unchanged and remains atomic', async () => {
    const validationError = new Error('safe validation error');
    mocks.validateGitRepository.mockRejectedValueOnce(validationError);
    await expect(buildLocalRepositoryContext(makeInput(makeConfig()))).rejects.toBe(
      validationError,
    );

    mocks.loadChangedFiles.mockRejectedValueOnce(new GitDiffError('GIT_DIFF_FAILED'));
    await expect(buildLocalRepositoryContext(makeInput(makeConfig()))).rejects.toMatchObject({
      code: 'GIT_DIFF_FAILED',
    });

    mocks.loadRepositoryFiles.mockRejectedValueOnce(new GitFileLoadError('FILE_OBJECT_NOT_FOUND'));
    await expect(buildLocalRepositoryContext(makeInput(makeConfig()))).rejects.toMatchObject({
      code: 'FILE_OBJECT_NOT_FOUND',
    });

    const twoRepositories = makeConfig({
      repositories: {
        backend: { path: '../backend', baseRef: 'backend-base', role: 'backend' },
        frontend: { path: '../frontend', baseRef: 'frontend-base', role: 'frontend' },
      },
      openapi: { repository: 'backend', path: 'openapi.yaml' },
      contracts: [],
    });
    mocks.loadChangedFiles.mockImplementation(async ({ repositoryId }: LoadChangedFilesInput) => {
      if (repositoryId === 'frontend') throw new GitDiffError('GIT_DIFF_FAILED');
      return [{ repositoryId, path: 'changed.ts', status: 'modified' }];
    });
    await expect(buildLocalRepositoryContext(makeInput(twoRepositories))).rejects.toMatchObject({
      code: 'GIT_DIFF_FAILED',
    });
  });

  it('returns the fixed local result shape and repeatable deep-equal contexts without invoking analysis boundaries', async () => {
    const input = makeInput(makeConfig());
    const first = await buildLocalRepositoryContext(input);
    const second = await buildLocalRepositoryContext(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      sourceType: 'local',
      sourceLabel: 'Local Git Repositories',
    });
    expect(first).not.toHaveProperty('metadata');
  });
});

describe('buildLocalRepositoryContext real Git integration', () => {
  it.each([
    ['fullstack', 'fullstack'],
    ['frontend', 'frontend'],
    ['backend', 'backend'],
  ] as const)('builds a deterministic one-%s immutable Git context', async (repositoryId, role) => {
    useRealGitSources();
    await withTemporaryDirectory(async (root) => {
      const workspaceBase = path.join(root, 'workspace');
      await mkdir(workspaceBase);
      const repository = await createRepository(
        root,
        repositoryId,
        `${repositoryId}-base`,
        {
          'docs/openapi.yaml': 'openapi: 3.0.0\n',
          'src/model.ts': 'export interface Model { value: string; }\n',
        },
        { 'src/model.ts': 'export interface Model { value: number; }\n' },
      );
      const config = makeConfig({
        repositories: {
          [repositoryId]: {
            path: `../${repositoryId}`,
            baseRef: repository.baseRef,
            role,
          },
        },
        openapi: { repository: repositoryId, path: 'docs/openapi.yaml' },
        contracts: [
          {
            name: 'Model',
            openapiSchema: 'Model',
            typescript: { repository: repositoryId, file: 'src/model.ts', type: 'Model' },
          },
        ],
      });

      const context = await buildLocalRepositoryContext(makeInput(config, { workspaceBase }));

      expect(context.repositories).toEqual([
        expect.objectContaining({
          repositoryId,
          repositoryPath: repository.repositoryPath,
          baseRef: repository.baseRef,
          headRef: repository.headRef,
        }),
      ]);
      expect(context.repositories[0]?.changedFiles[0]?.repositoryId).toBe(repositoryId);
      expect(context.files.map((file) => `${file.repositoryId}:${file.path}`)).toEqual([
        `${repositoryId}:docs/openapi.yaml`,
        `${repositoryId}:src/model.ts`,
      ]);
      expect(context.files.every((file) => file.absolutePath === undefined)).toBe(true);
    });
  });

  it('combines frontend and backend repositories with independent base refs and stable repository/file order', async () => {
    useRealGitSources();
    await withTemporaryDirectory(async (root) => {
      const workspaceBase = path.join(root, 'workspace');
      await mkdir(workspaceBase);
      const backend = await createRepository(
        root,
        'backend',
        'backend-base',
        { 'docs/openapi.yaml': 'openapi: 3.0.0\n', 'src/backend.ts': 'export const value = 1;\n' },
        { 'docs/openapi.yaml': 'openapi: 3.0.1\n' },
      );
      const frontend = await createRepository(
        root,
        'frontend',
        'frontend-base',
        { 'src/model.ts': 'export interface Model { value: string; }\n' },
        { 'src/frontend.ts': 'export const value = 2;\n' },
      );
      const config = makeConfig({
        repositories: {
          frontend: { path: '../frontend', baseRef: frontend.baseRef, role: 'frontend' },
          backend: { path: '../backend', baseRef: backend.baseRef, role: 'backend' },
        },
        openapi: { repository: 'backend', path: 'docs/openapi.yaml' },
        contracts: [
          {
            name: 'Model',
            openapiSchema: 'Model',
            typescript: { repository: 'frontend', file: 'src/model.ts', type: 'Model' },
          },
        ],
      });

      const context = await buildLocalRepositoryContext(makeInput(config, { workspaceBase }));

      expect(context.repositories.map((repository) => repository.repositoryId)).toEqual([
        'backend',
        'frontend',
      ]);
      expect(context.repositories.map((repository) => repository.baseRef)).toEqual([
        backend.baseRef,
        frontend.baseRef,
      ]);
      expect(context.repositories.map((repository) => repository.headRef)).toEqual([
        backend.headRef,
        frontend.headRef,
      ]);
      expect(context.files.map((file) => `${file.repositoryId}:${file.path}`)).toEqual([
        'backend:docs/openapi.yaml',
        'frontend:src/model.ts',
      ]);
      expect(context.repositories[0]?.changedFiles[0]?.repositoryId).toBe('backend');
      expect(context.files.map((file) => file.repositoryId)).toEqual(['backend', 'frontend']);
    });
  });
});
