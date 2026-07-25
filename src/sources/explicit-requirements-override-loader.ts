import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { isPathContainedInRoot } from '../config/path-security.js';

export const MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES = 1_048_576;

const ERROR_MESSAGES: Readonly<Record<ExplicitRequirementsOverrideErrorCode, string>> = {
  REQUIREMENTS_OVERRIDE_INVALID: 'Requirements override is invalid.',
  REQUIREMENTS_OVERRIDE_NOT_FOUND: 'Requirements override file was not found.',
  REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE: 'Requirements override must be a regular file.',
  REQUIREMENTS_OVERRIDE_READ_FAILED: 'Requirements override file could not be read.',
  REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY:
    'Requirements override must remain inside the working directory.',
  REQUIREMENTS_OVERRIDE_SYMLINK_OUTSIDE_WORKING_DIRECTORY:
    'Requirements override symlink must remain inside the working directory.',
  REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE: 'Requirements override file is too large.',
  REQUIREMENTS_OVERRIDE_INVALID_UTF8: 'Requirements override file must contain valid UTF-8 text.',
  REQUIREMENTS_OVERRIDE_EMPTY: 'Requirements override file must not be empty.',
};

export interface ExplicitRequirementsOverride {
  path: string;
  baseDirectory: string;
  required: true;
}

export type ExplicitRequirementsOverrideErrorCode =
  | 'REQUIREMENTS_OVERRIDE_INVALID'
  | 'REQUIREMENTS_OVERRIDE_NOT_FOUND'
  | 'REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE'
  | 'REQUIREMENTS_OVERRIDE_READ_FAILED'
  | 'REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY'
  | 'REQUIREMENTS_OVERRIDE_SYMLINK_OUTSIDE_WORKING_DIRECTORY'
  | 'REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE'
  | 'REQUIREMENTS_OVERRIDE_INVALID_UTF8'
  | 'REQUIREMENTS_OVERRIDE_EMPTY';

export class ExplicitRequirementsOverrideError extends Error {
  readonly code: ExplicitRequirementsOverrideErrorCode;

  constructor(
    code: ExplicitRequirementsOverrideErrorCode,
    _message: string,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
    this.name = 'ExplicitRequirementsOverrideError';
    this.code = code;
  }
}

export interface LoadedExplicitRequirementsOverride {
  text: string;
}

/**
 * Loads one required CLI requirements override with fatal lexical and canonical
 * containment validation. It does not inspect configuration or produce warnings.
 */
export async function loadExplicitRequirementsOverride(
  override: ExplicitRequirementsOverride,
): Promise<LoadedExplicitRequirementsOverride> {
  try {
    return await loadOverride(override);
  } catch (error) {
    if (error instanceof ExplicitRequirementsOverrideError) {
      throw error;
    }

    throw createError('REQUIREMENTS_OVERRIDE_INVALID', error);
  }
}

async function loadOverride(
  override: ExplicitRequirementsOverride,
): Promise<LoadedExplicitRequirementsOverride> {
  const validatedOverride = validateOverride(override);
  const lexicalPath = resolveLexicalPath(validatedOverride);
  const canonicalBaseDirectory = await canonicalizeBaseDirectory(validatedOverride.baseDirectory);

  await assertTargetExists(lexicalPath);
  const canonicalTargetPath = await canonicalizeTarget(lexicalPath);

  if (!isPathContainedInRoot(canonicalTargetPath, canonicalBaseDirectory)) {
    throw createError('REQUIREMENTS_OVERRIDE_SYMLINK_OUTSIDE_WORKING_DIRECTORY');
  }

  const fileStats = await readTargetStats(canonicalTargetPath);
  if (!fileStats.isFile()) {
    throw createError('REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE');
  }

  if (fileStats.size > MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES) {
    throw createError('REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE');
  }

  const bytes = await readTargetBytes(canonicalTargetPath);
  if (bytes.byteLength > MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES) {
    throw createError('REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE');
  }

  const text = decodeUtf8(bytes);
  if (text.includes('\u0000')) {
    throw createError('REQUIREMENTS_OVERRIDE_INVALID_UTF8');
  }

  if (text.trim().length === 0) {
    throw createError('REQUIREMENTS_OVERRIDE_EMPTY');
  }

  return { text };
}

function validateOverride(override: ExplicitRequirementsOverride): ExplicitRequirementsOverride {
  if (
    override === null ||
    typeof override !== 'object' ||
    override.required !== true ||
    typeof override.path !== 'string' ||
    typeof override.baseDirectory !== 'string' ||
    override.path.trim() === '' ||
    override.baseDirectory.trim() === '' ||
    override.path.includes('\u0000') ||
    override.baseDirectory.includes('\u0000') ||
    !path.isAbsolute(override.baseDirectory)
  ) {
    throw createError('REQUIREMENTS_OVERRIDE_INVALID');
  }

  return override;
}

function resolveLexicalPath(override: ExplicitRequirementsOverride): string {
  if (isForbiddenOverridePath(override.path)) {
    throw createError('REQUIREMENTS_OVERRIDE_INVALID');
  }

  const lexicalPath = path.resolve(override.baseDirectory, override.path);
  if (!isPathContainedInRoot(lexicalPath, override.baseDirectory)) {
    throw createError('REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY');
  }

  return lexicalPath;
}

function isForbiddenOverridePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^[A-Za-z]:(?:$|[^\\/])/.test(value)
  );
}

async function canonicalizeBaseDirectory(baseDirectory: string): Promise<string> {
  let baseStats: Awaited<ReturnType<typeof stat>>;

  try {
    baseStats = await stat(baseDirectory);
  } catch (error) {
    throw createError('REQUIREMENTS_OVERRIDE_READ_FAILED', error);
  }

  if (!baseStats.isDirectory()) {
    throw createError('REQUIREMENTS_OVERRIDE_INVALID');
  }

  try {
    return await realpath(baseDirectory);
  } catch (error) {
    throw createError('REQUIREMENTS_OVERRIDE_READ_FAILED', error);
  }
}

async function assertTargetExists(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
  } catch (error) {
    throw createError(classifyTargetFilesystemFailure(error), error);
  }
}

async function canonicalizeTarget(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    throw createError(classifyTargetFilesystemFailure(error), error);
  }
}

async function readTargetStats(targetPath: string): Promise<Awaited<ReturnType<typeof stat>>> {
  try {
    return await stat(targetPath);
  } catch (error) {
    throw createError(classifyTargetFilesystemFailure(error), error);
  }
}

async function readTargetBytes(targetPath: string): Promise<Buffer> {
  try {
    return await readFile(targetPath);
  } catch (error) {
    throw createError(classifyTargetFilesystemFailure(error), error);
  }
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw createError('REQUIREMENTS_OVERRIDE_INVALID_UTF8', error);
  }
}

function classifyTargetFilesystemFailure(error: unknown): ExplicitRequirementsOverrideErrorCode {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
    ? 'REQUIREMENTS_OVERRIDE_NOT_FOUND'
    : 'REQUIREMENTS_OVERRIDE_READ_FAILED';
}

function createError(
  code: ExplicitRequirementsOverrideErrorCode,
  cause?: unknown,
): ExplicitRequirementsOverrideError {
  return new ExplicitRequirementsOverrideError(
    code,
    ERROR_MESSAGES[code],
    cause === undefined ? undefined : { cause },
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}
