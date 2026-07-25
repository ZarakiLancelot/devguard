import type { DevGuardConfig } from '../config/config-schema.js';
import { resolveRepositoryPath } from '../config/path-security.js';
import { selectRequirementsSource } from '../modules/test-generator/select-requirements-source.js';
import type {
  ChangedFile,
  RepositoryChangeSet,
  RepositoryContext,
  RepositoryFile,
} from '../types/repository.js';
import { loadChangedFiles } from './local-git-diff-provider.js';
import { loadChangedFilePatches, type GitPatchWarning } from './repository-patch-loader.js';
import { loadRepositoryFiles } from './repository-file-loader.js';
import {
  loadExplicitRequirementsOverride,
  type ExplicitRequirementsOverride,
} from './explicit-requirements-override-loader.js';
import { loadRequirementsText, type RequirementsLoadWarning } from './requirements-text-loader.js';
import { validateGitRepository } from './git-repository-validator.js';

/** Maximum logical UTF-8 text retained by one local repository context: 20 MiB. */
export const MAX_CONTEXT_TEXT_BYTES = 20 * 1_048_576;

const ERROR_MESSAGES: Readonly<Record<LocalRepositoryContextErrorCode, string>> = {
  LOCAL_SOURCE_CONFIG_INVALID: 'Local repository source configuration is invalid.',
  LOCAL_SOURCE_INVARIANT_VIOLATION: 'Local repository context could not be assembled safely.',
  LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED:
    'Local repository source text exceeds the supported total size limit.',
};

export interface BuildLocalRepositoryContextInput {
  /** Directory containing the already-loaded .devguard.yml configuration file. */
  workspaceBase: string;
  /** Configuration that has already completed structural and relational validation. */
  config: DevGuardConfig;
  /** A caller-selected, required CLI requirements override. */
  requirementsOverride?: ExplicitRequirementsOverride;
}

export type LocalRepositoryContextErrorCode =
  | 'LOCAL_SOURCE_CONFIG_INVALID'
  | 'LOCAL_SOURCE_INVARIANT_VIOLATION'
  | 'LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED';

/** A safe fatal error raised while building a local RepositoryContext. */
export class LocalRepositoryContextError extends Error {
  readonly code: LocalRepositoryContextErrorCode;

  constructor(code: LocalRepositoryContextErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'LocalRepositoryContextError';
    this.code = code;
  }
}

export interface BuildLocalRepositoryContextDependencies {
  loadExplicitRequirementsOverride: typeof loadExplicitRequirementsOverride;
}

const DEFAULT_DEPENDENCIES: Readonly<BuildLocalRepositoryContextDependencies> = Object.freeze({
  loadExplicitRequirementsOverride,
});

const defaultBuildLocalRepositoryContext = createBuildLocalRepositoryContext();

/**
 * Builds one deterministic local RepositoryContext from an already validated configuration.
 * It intentionally does not parse configuration, adapt RepositorySource, invoke analyzers,
 * or inspect working-tree content.
 */
export async function buildLocalRepositoryContext(
  input: BuildLocalRepositoryContextInput,
): Promise<RepositoryContext> {
  return defaultBuildLocalRepositoryContext(input);
}

/** Creates an isolated context builder with immutable factory-scoped dependencies. */
export function createBuildLocalRepositoryContext(
  overrides: Partial<BuildLocalRepositoryContextDependencies> = {},
): (input: BuildLocalRepositoryContextInput) => Promise<RepositoryContext> {
  const dependencies: BuildLocalRepositoryContextDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };

  return async (input: BuildLocalRepositoryContextInput): Promise<RepositoryContext> =>
    buildLocalRepositoryContextWithDependencies(input, dependencies);
}

async function buildLocalRepositoryContextWithDependencies(
  input: BuildLocalRepositoryContextInput,
  dependencies: BuildLocalRepositoryContextDependencies,
): Promise<RepositoryContext> {
  const explicitRequirementsText =
    input.requirementsOverride === undefined
      ? undefined
      : (await dependencies.loadExplicitRequirementsOverride(input.requirementsOverride)).text;
  const repositoryEntries = getValidatedRepositoryEntries(input);
  const mappedPaths = selectMappedPaths(
    input.config,
    repositoryEntries.map(([repositoryId]) => repositoryId),
  );
  const repositories: RepositoryChangeSet[] = [];
  const files: RepositoryFile[] = [];
  const patchWarnings: GitPatchWarning[] = [];
  let retainedTextBytes = 0;

  for (const [repositoryId, configuredRepository] of repositoryEntries) {
    const resolvedRepositoryPath = resolveConfiguredRepositoryPath(
      input.workspaceBase,
      configuredRepository.path,
    );
    const repository = await validateGitRepository({
      repositoryPath: resolvedRepositoryPath,
      baseRef: configuredRepository.baseRef,
    });
    const changedFiles = await loadChangedFiles({ repositoryId, repository });
    const patchedResult = await loadChangedFilePatches({
      repositoryId,
      repository,
      changedFiles,
    });
    const patchedChangedFiles = copyChangedFiles(repositoryId, patchedResult.changedFiles);
    const paths = mappedPaths.get(repositoryId);

    if (paths === undefined) {
      throw new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION');
    }

    const loadedResult = await loadRepositoryFiles({ repositoryId, repository, paths });
    const loadedFiles = copyAndValidateFiles(repositoryId, paths, loadedResult.files);

    retainedTextBytes = addRepositoryRetainedText(
      retainedTextBytes,
      patchedChangedFiles,
      loadedFiles,
    );
    repositories.push({
      repositoryId,
      repositoryPath: repository.repositoryPath,
      role: configuredRepository.role,
      baseRef: configuredRepository.baseRef,
      headRef: repository.headRef,
      changedFiles: patchedChangedFiles,
    });
    files.push(...loadedFiles);
    patchWarnings.push(...copyPatchWarnings(patchedResult.warnings));
  }

  const requirementsResult =
    explicitRequirementsText === undefined
      ? await loadSelectedRequirements(input)
      : { content: explicitRequirementsText, warnings: [] };
  const requirements = requirementsResult?.content;
  if (requirements !== undefined) {
    retainedTextBytes = addRetainedTextBytes(retainedTextBytes, requirements);
  }

  const warnings = normalizeWarnings(patchWarnings, requirementsResult?.warnings ?? []);

  return {
    sourceType: 'local',
    sourceLabel: 'Local Git Repositories',
    repositories,
    files: files.sort(compareRepositoryFiles),
    ...(requirements === undefined ? {} : { requirements }),
    warnings,
  };
}

function getValidatedRepositoryEntries(
  input: BuildLocalRepositoryContextInput,
): Array<[string, DevGuardConfig['repositories'][string]]> {
  if (
    input.workspaceBase.trim().length === 0 ||
    input.workspaceBase.includes('\u0000') ||
    input.config.repositories === undefined
  ) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_CONFIG_INVALID');
  }

  const repositoryIds = Object.keys(input.config.repositories).sort(compareCodePoints);
  if (repositoryIds.length === 0 || repositoryIds.length > 2) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_CONFIG_INVALID');
  }

  return repositoryIds.map((repositoryId) => {
    const configuredRepository = input.config.repositories[repositoryId];
    if (configuredRepository === undefined) {
      throw new LocalRepositoryContextError('LOCAL_SOURCE_CONFIG_INVALID');
    }

    return [repositoryId, configuredRepository];
  });
}

function resolveConfiguredRepositoryPath(workspaceBase: string, configuredPath: string): string {
  const resolution = resolveRepositoryPath(workspaceBase, configuredPath);
  if (!resolution.valid) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_CONFIG_INVALID');
  }

  return resolution.resolvedPath;
}

function selectMappedPaths(
  config: DevGuardConfig,
  repositoryIds: readonly string[],
): Map<string, string[]> {
  const pathsByRepository = new Map(
    repositoryIds.map((repositoryId) => [repositoryId, new Set<string>()]),
  );

  addMappedPath(pathsByRepository, config.openapi.repository, config.openapi.path);
  for (const contract of config.contracts) {
    addMappedPath(pathsByRepository, contract.typescript.repository, contract.typescript.file);
  }

  return new Map(
    [...pathsByRepository.entries()].map(([repositoryId, paths]) => [
      repositoryId,
      [...paths].sort(compareCodePoints),
    ]),
  );
}

function addMappedPath(
  pathsByRepository: Map<string, Set<string>>,
  repositoryId: string,
  path: string,
): void {
  const paths = pathsByRepository.get(repositoryId);
  if (paths === undefined) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_CONFIG_INVALID');
  }

  paths.add(path);
}

function copyChangedFiles(
  repositoryId: string,
  changedFiles: readonly ChangedFile[],
): ChangedFile[] {
  const copiedChangedFiles: ChangedFile[] = [];

  for (const changedFile of changedFiles) {
    if (changedFile.repositoryId !== repositoryId) {
      throw new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION');
    }

    copiedChangedFiles.push({ ...changedFile });
  }

  return copiedChangedFiles;
}

function copyAndValidateFiles(
  repositoryId: string,
  selectedPaths: readonly string[],
  loadedFiles: readonly RepositoryFile[],
): RepositoryFile[] {
  if (loadedFiles.length !== selectedPaths.length) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION');
  }

  const selectedPathsSet = new Set(selectedPaths);
  const loadedPaths = new Set<string>();
  const copiedFiles: RepositoryFile[] = [];

  for (const file of loadedFiles) {
    if (
      file.repositoryId !== repositoryId ||
      !selectedPathsSet.has(file.path) ||
      loadedPaths.has(file.path)
    ) {
      throw new LocalRepositoryContextError('LOCAL_SOURCE_INVARIANT_VIOLATION');
    }

    loadedPaths.add(file.path);
    copiedFiles.push({
      repositoryId: file.repositoryId,
      path: file.path,
      content: file.content,
      sizeBytes: file.sizeBytes,
    });
  }

  return copiedFiles;
}

function addRepositoryRetainedText(
  currentBytes: number,
  changedFiles: readonly ChangedFile[],
  files: readonly RepositoryFile[],
): number {
  let retainedTextBytes = currentBytes;

  for (const file of files) {
    retainedTextBytes += Buffer.byteLength(file.content, 'utf8');
  }

  for (const changedFile of changedFiles) {
    if (changedFile.patch !== undefined) {
      retainedTextBytes += Buffer.byteLength(changedFile.patch, 'utf8');
    }
  }

  if (retainedTextBytes > MAX_CONTEXT_TEXT_BYTES) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED');
  }

  return retainedTextBytes;
}

function addRetainedTextBytes(currentBytes: number, text: string): number {
  const retainedTextBytes = currentBytes + Buffer.byteLength(text, 'utf8');
  if (retainedTextBytes > MAX_CONTEXT_TEXT_BYTES) {
    throw new LocalRepositoryContextError('LOCAL_SOURCE_TOTAL_TEXT_LIMIT_EXCEEDED');
  }

  return retainedTextBytes;
}

async function loadSelectedRequirements(
  input: BuildLocalRepositoryContextInput,
): Promise<Awaited<ReturnType<typeof loadRequirementsText>> | undefined> {
  const selection = selectRequirementsSource({
    ...(input.config.testing?.requirementsFile === undefined
      ? {}
      : { configPath: input.config.testing.requirementsFile }),
  });

  if (selection.source === 'none') {
    return undefined;
  }

  return loadRequirementsText({
    source: selection.source,
    path: selection.path,
    baseDirectory: input.workspaceBase,
    allowedRoot: input.workspaceBase,
  });
}

function copyPatchWarnings(warnings: readonly GitPatchWarning[]): GitPatchWarning[] {
  return warnings.map((warning) => ({ ...warning }));
}

function normalizeWarnings(
  patchWarnings: readonly GitPatchWarning[],
  requirementsWarnings: readonly RequirementsLoadWarning[],
): string[] {
  const formattedPatchWarnings = [...patchWarnings]
    .sort(comparePatchWarnings)
    .map(formatPatchWarning);
  const formattedRequirementsWarnings = requirementsWarnings.map(formatRequirementsWarning);

  return [...new Set([...formattedPatchWarnings, ...formattedRequirementsWarnings])].sort(
    compareCodePoints,
  );
}

function formatPatchWarning(warning: GitPatchWarning): string {
  return `${warning.code}: ${warning.message} repository=${JSON.stringify(
    warning.repositoryId,
  )} path=${JSON.stringify(warning.path)}`;
}

function formatRequirementsWarning(warning: RequirementsLoadWarning): string {
  return `${warning.code}: ${warning.message} source=${JSON.stringify(warning.source)}${
    warning.path === undefined ? '' : ` path=${JSON.stringify(warning.path)}`
  }`;
}

function comparePatchWarnings(left: GitPatchWarning, right: GitPatchWarning): number {
  return (
    compareCodePoints(left.repositoryId, right.repositoryId) ||
    compareCodePoints(left.path, right.path) ||
    compareCodePoints(left.code, right.code) ||
    compareCodePoints(left.message, right.message)
  );
}

function compareRepositoryFiles(left: RepositoryFile, right: RepositoryFile): number {
  return (
    compareCodePoints(left.repositoryId, right.repositoryId) ||
    compareCodePoints(left.path, right.path)
  );
}

function compareCodePoints(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftCodePoint = leftCodePoints[index]?.codePointAt(0) ?? 0;
    const rightCodePoint = rightCodePoints[index]?.codePointAt(0) ?? 0;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
