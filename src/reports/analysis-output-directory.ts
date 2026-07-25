import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPathContainedInRoot, resolveOutputFile } from '../config/path-security.js';
import type { AnalysisOutputPlan } from './analysis-output-plan.js';
import { AnalysisOutputError } from './analysis-output-error.js';

export { AnalysisOutputError } from './analysis-output-error.js';
export type { AnalysisOutputErrorCode as AnalysisOutputDirectoryErrorCode } from './analysis-output-error.js';

const ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE =
  'Analysis output directory could not be prepared safely.';
const NEW_DIRECTORY_MODE = 0o700;

export interface PrepareAnalysisOutputDirectoryInput {
  workspaceBase: string;
  plan: AnalysisOutputPlan;
}

export interface PreparedAnalysisOutputDirectory {
  outputDirectory: string;
  markdownParentDirectory: string;
  jsonParentDirectory: string;
}

interface LexicalOutputDirectories {
  outputDirectory: string;
  markdownParentDirectory: string;
  jsonParentDirectory: string;
}

/**
 * Creates the output directory tree required by a lexical output plan and
 * returns canonical internal directories after containment validation.
 */
export async function prepareAnalysisOutputDirectory(
  input: PrepareAnalysisOutputDirectoryInput,
): Promise<PreparedAnalysisOutputDirectory> {
  try {
    const lexicalDirectories = validateLexicalDirectories(input);
    const canonicalWorkspaceBase = await canonicalizeDirectory(input.workspaceBase);

    await createContainedDirectories(
      input.workspaceBase,
      canonicalWorkspaceBase,
      lexicalDirectories.outputDirectory,
    );

    const canonicalOutputDirectory = await canonicalizeDirectory(
      lexicalDirectories.outputDirectory,
    );
    assertContained(canonicalOutputDirectory, canonicalWorkspaceBase);

    await createContainedDirectories(
      lexicalDirectories.outputDirectory,
      canonicalOutputDirectory,
      lexicalDirectories.markdownParentDirectory,
    );
    await createContainedDirectories(
      lexicalDirectories.outputDirectory,
      canonicalOutputDirectory,
      lexicalDirectories.jsonParentDirectory,
    );

    const verifiedWorkspaceBase = await canonicalizeDirectory(input.workspaceBase);
    const verifiedOutputDirectory = await canonicalizeDirectory(lexicalDirectories.outputDirectory);
    const markdownParentDirectory = await canonicalizeDirectory(
      lexicalDirectories.markdownParentDirectory,
    );
    const jsonParentDirectory = await canonicalizeDirectory(lexicalDirectories.jsonParentDirectory);

    assertContained(verifiedOutputDirectory, verifiedWorkspaceBase);
    assertContained(markdownParentDirectory, verifiedOutputDirectory);
    assertContained(jsonParentDirectory, verifiedOutputDirectory);

    return {
      outputDirectory: verifiedOutputDirectory,
      markdownParentDirectory,
      jsonParentDirectory,
    };
  } catch (error) {
    if (error instanceof AnalysisOutputError) {
      throw error;
    }

    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
      { cause: error },
    );
  }
}

function validateLexicalDirectories(
  input: PrepareAnalysisOutputDirectoryInput,
): LexicalOutputDirectories {
  const { workspaceBase, plan } = input;

  if (!isPathContainedInRoot(plan.outputDirectory, workspaceBase)) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }

  const markdownTarget = resolveOutputFile(plan.outputDirectory, plan.markdownFile);
  const jsonTarget = resolveOutputFile(plan.outputDirectory, plan.jsonFile);

  if (!markdownTarget.valid || !jsonTarget.valid) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }

  return {
    outputDirectory: plan.outputDirectory,
    markdownParentDirectory: path.dirname(markdownTarget.resolvedPath),
    jsonParentDirectory: path.dirname(jsonTarget.resolvedPath),
  };
}

async function createContainedDirectories(
  lexicalBaseDirectory: string,
  canonicalRootDirectory: string,
  lexicalTargetDirectory: string,
): Promise<void> {
  const relativeTargetDirectory = path.relative(lexicalBaseDirectory, lexicalTargetDirectory);

  if (
    path.isAbsolute(relativeTargetDirectory) ||
    relativeTargetDirectory.split(path.sep).includes('..')
  ) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }

  if (relativeTargetDirectory === '') {
    return;
  }

  let currentDirectory = lexicalBaseDirectory;
  for (const component of relativeTargetDirectory.split(path.sep)) {
    currentDirectory = path.join(currentDirectory, component);
    await ensureDirectory(currentDirectory);

    const canonicalDirectory = await canonicalizeDirectory(currentDirectory);
    assertContained(canonicalDirectory, canonicalRootDirectory);
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    const existingStats = await stat(directory);
    if (!existingStats.isDirectory()) {
      throw new AnalysisOutputError(
        'OUTPUT_DIRECTORY_PREPARE_FAILED',
        ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
      );
    }

    return;
  } catch (error) {
    if (error instanceof AnalysisOutputError || !hasErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }

  await mkdir(directory, { recursive: true, mode: NEW_DIRECTORY_MODE });

  const createdStats = await stat(directory);
  if (!createdStats.isDirectory()) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }
}

async function canonicalizeDirectory(directory: string): Promise<string> {
  const directoryStats = await stat(directory);
  if (!directoryStats.isDirectory()) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }

  const canonicalDirectory = await realpath(directory);
  const canonicalStats = await stat(canonicalDirectory);
  if (!canonicalStats.isDirectory()) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }

  return canonicalDirectory;
}

function assertContained(candidatePath: string, rootPath: string): void {
  if (!isPathContainedInRoot(candidatePath, rootPath)) {
    throw new AnalysisOutputError(
      'OUTPUT_DIRECTORY_PREPARE_FAILED',
      ANALYSIS_OUTPUT_DIRECTORY_ERROR_MESSAGE,
    );
  }
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}
