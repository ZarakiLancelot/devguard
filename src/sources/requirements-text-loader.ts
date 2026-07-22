import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { isPathContainedInRoot, resolveFileWithinRoot } from '../config/path-security.js';

/** Maximum permitted requirements file size: 1 MiB. */
export const MAX_REQUIREMENTS_FILE_BYTES = 1_048_576;

const GENERIC_SELECTED_PATH = 'requirements file';

/** The origin of a selected requirements path. */
export type RequirementsSourceKind = 'cli' | 'config';

/** Stable non-fatal diagnostics emitted by the requirements text loader. */
export type RequirementsLoadWarningCode =
  | 'REQUIREMENTS_FILE_NOT_FOUND'
  | 'REQUIREMENTS_NOT_REGULAR_FILE'
  | 'REQUIREMENTS_READ_FAILED'
  | 'REQUIREMENTS_PATH_OUTSIDE_ROOT'
  | 'REQUIREMENTS_INVALID_PATH'
  | 'REQUIREMENTS_SYMLINK_OUTSIDE_ROOT'
  | 'REQUIREMENTS_FILE_TOO_LARGE'
  | 'REQUIREMENTS_INVALID_UTF8'
  | 'REQUIREMENTS_EMPTY';

export interface RequirementsLoadWarning {
  code: RequirementsLoadWarningCode;
  message: string;
  source: RequirementsSourceKind;
  /** Safe root-relative path text when available; never an absolute path. */
  path?: string;
}

/** Input needed to resolve and load one selected optional requirements file. */
export interface LoadRequirementsTextInput {
  source: RequirementsSourceKind;
  path: string;
  baseDirectory: string;
  allowedRoot: string;
}

/**
 * Result of loading optional requirements text. Expected failures are warnings
 * and leave content absent so later analysis can continue from findings alone.
 */
export interface LoadRequirementsTextResult {
  source: RequirementsSourceKind;
  /** Safe root-relative path text, or a generic label for an invalid path. */
  selectedPath: string;
  content?: string;
  warnings: readonly RequirementsLoadWarning[];
}

const WARNING_MESSAGES: Readonly<Record<RequirementsLoadWarningCode, string>> = {
  REQUIREMENTS_FILE_NOT_FOUND: 'Selected requirements file was not found.',
  REQUIREMENTS_NOT_REGULAR_FILE: 'Selected requirements path is not a regular file.',
  REQUIREMENTS_READ_FAILED: 'Selected requirements file could not be read.',
  REQUIREMENTS_PATH_OUTSIDE_ROOT: 'Selected requirements path is outside the allowed root.',
  REQUIREMENTS_INVALID_PATH: 'Selected requirements path is invalid.',
  REQUIREMENTS_SYMLINK_OUTSIDE_ROOT:
    'Selected requirements path resolves outside the allowed root.',
  REQUIREMENTS_FILE_TOO_LARGE: 'Selected requirements file exceeds the maximum allowed size.',
  REQUIREMENTS_INVALID_UTF8: 'Selected requirements file is not valid UTF-8.',
  REQUIREMENTS_EMPTY: 'Selected requirements file contains no non-whitespace text.',
};

/**
 * Loads UTF-8 requirements text using lexical and realpath containment checks.
 * It performs no fallback selection and does not throw for expected failures.
 */
export async function loadRequirementsText(
  input: LoadRequirementsTextInput,
): Promise<LoadRequirementsTextResult> {
  const lexicalResolution = resolveFileWithinRoot(
    input.baseDirectory,
    input.allowedRoot,
    input.path,
  );

  if (!lexicalResolution.valid) {
    return createFailure(
      input,
      GENERIC_SELECTED_PATH,
      lexicalResolution.error.code === 'PATH_OUTSIDE_ALLOWED_ROOT'
        ? 'REQUIREMENTS_PATH_OUTSIDE_ROOT'
        : 'REQUIREMENTS_INVALID_PATH',
    );
  }

  const lexicalPath = lexicalResolution.resolvedPath;
  const selectedPath = createSafeSelectedPath(lexicalPath, input.allowedRoot);

  try {
    await lstat(lexicalPath);
  } catch (error: unknown) {
    return createFailure(input, selectedPath, classifyFilesystemFailure(error));
  }

  const realAllowedRoot = await resolveAllowedRoot(input, selectedPath);
  if (typeof realAllowedRoot !== 'string') {
    return realAllowedRoot;
  }

  let realSelectedPath: string;
  try {
    realSelectedPath = await realpath(lexicalPath);
  } catch (error: unknown) {
    return createFailure(input, selectedPath, classifyFilesystemFailure(error));
  }

  if (!isPathContainedInRoot(realSelectedPath, realAllowedRoot)) {
    return createFailure(input, selectedPath, 'REQUIREMENTS_SYMLINK_OUTSIDE_ROOT');
  }

  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(realSelectedPath);
  } catch (error: unknown) {
    return createFailure(input, selectedPath, classifyFilesystemFailure(error));
  }

  if (!fileStats.isFile()) {
    return createFailure(input, selectedPath, 'REQUIREMENTS_NOT_REGULAR_FILE');
  }

  if (fileStats.size > MAX_REQUIREMENTS_FILE_BYTES) {
    return createFailure(input, selectedPath, 'REQUIREMENTS_FILE_TOO_LARGE');
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(realSelectedPath);
  } catch (error: unknown) {
    return createFailure(input, selectedPath, classifyFilesystemFailure(error));
  }

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return createFailure(input, selectedPath, 'REQUIREMENTS_INVALID_UTF8');
  }

  if (content.trim().length === 0) {
    return createFailure(input, selectedPath, 'REQUIREMENTS_EMPTY');
  }

  return {
    source: input.source,
    selectedPath,
    content,
    warnings: [],
  };
}

async function resolveAllowedRoot(
  input: LoadRequirementsTextInput,
  selectedPath: string,
): Promise<string | LoadRequirementsTextResult> {
  try {
    return await realpath(input.allowedRoot);
  } catch {
    return createFailure(input, selectedPath, 'REQUIREMENTS_INVALID_PATH');
  }
}

function createFailure(
  input: LoadRequirementsTextInput,
  selectedPath: string,
  code: RequirementsLoadWarningCode,
): LoadRequirementsTextResult {
  return {
    source: input.source,
    selectedPath,
    warnings: [createWarning(input.source, selectedPath, code)],
  };
}

function createWarning(
  source: RequirementsSourceKind,
  selectedPath: string,
  code: RequirementsLoadWarningCode,
): RequirementsLoadWarning {
  return {
    code,
    message: WARNING_MESSAGES[code],
    source,
    ...(selectedPath === GENERIC_SELECTED_PATH ? {} : { path: selectedPath }),
  };
}

function createSafeSelectedPath(resolvedPath: string, allowedRoot: string): string {
  const normalizedRoot = path.resolve(allowedRoot);
  if (!isPathContainedInRoot(resolvedPath, normalizedRoot)) {
    return GENERIC_SELECTED_PATH;
  }

  const relativePath = path.relative(normalizedRoot, resolvedPath).replace(/\\/gu, '/');
  return relativePath.length === 0 ? GENERIC_SELECTED_PATH : relativePath;
}

function classifyFilesystemFailure(error: unknown): RequirementsLoadWarningCode {
  const code = getFilesystemErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return 'REQUIREMENTS_FILE_NOT_FOUND';
  }

  if (code === 'ERR_INVALID_ARG_TYPE' || code === 'ERR_INVALID_ARG_VALUE' || code === 'EINVAL') {
    return 'REQUIREMENTS_INVALID_PATH';
  }

  return 'REQUIREMENTS_READ_FAILED';
}

function getFilesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
