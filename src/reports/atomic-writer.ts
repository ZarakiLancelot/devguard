import { randomBytes } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import { resolveRuntimeFileWithinRoot } from '../config/path-security.js';

const TEMPORARY_FILE_ATTEMPTS = 3;
const OUTPUT_WRITE_ERROR_MESSAGE = 'Unable to write report output safely.';

export interface WriteFileAtomicallyInput {
  allowedRoot: string;
  filePath: string;
  content: string;
}

/** A safe operational error for an unsuccessful individual report-file write. */
export class AtomicWriteError extends Error {
  readonly code = 'OUTPUT_WRITE_FAILED' as const;

  constructor(cause?: unknown) {
    super(OUTPUT_WRITE_ERROR_MESSAGE, cause === undefined ? undefined : { cause });
    this.name = 'AtomicWriteError';
  }
}

/**
 * Replaces one regular output file through a same-directory temporary file.
 * This is atomic only for the individual final-file replacement after the
 * temporary file is completely written and closed; it provides no multi-file
 * transaction or power-loss durability guarantee.
 */
export async function writeFileAtomically(input: WriteFileAtomicallyInput): Promise<void> {
  let finalPath: string;

  try {
    const resolution = await resolveRuntimeFileWithinRoot(input.allowedRoot, input.filePath);
    if (!resolution.valid) {
      throw new Error(resolution.error.code);
    }

    finalPath = resolution.resolvedPath;
    await assertExistingFinalTargetIsRegular(finalPath);
  } catch (error) {
    throw new AtomicWriteError(error);
  }

  let temporaryPath: string | undefined;
  let temporaryHandle: FileHandle | undefined;

  try {
    const temporaryFile = await createTemporaryFile(
      path.dirname(finalPath),
      path.basename(finalPath),
    );
    temporaryPath = temporaryFile.path;
    temporaryHandle = temporaryFile.handle;

    await temporaryHandle.writeFile(input.content, { encoding: 'utf8' });
    await temporaryHandle.close();
    temporaryHandle = undefined;

    await rename(temporaryPath, finalPath);
    temporaryPath = undefined;
  } catch (error) {
    const primaryError = error;

    if (temporaryHandle !== undefined) {
      try {
        await temporaryHandle.close();
      } catch {
        // Preserve the operation's primary failure rather than a cleanup failure.
      }
    }

    if (temporaryPath !== undefined) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the operation's primary failure rather than a cleanup failure.
      }
    }

    throw new AtomicWriteError(primaryError);
  }
}

async function assertExistingFinalTargetIsRegular(finalPath: string): Promise<void> {
  let finalStats: Awaited<ReturnType<typeof lstat>>;

  try {
    finalStats = await lstat(finalPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return;
    }

    throw error;
  }

  if (finalStats.isSymbolicLink() || !finalStats.isFile()) {
    throw new Error('OUTPUT_TARGET_NOT_REGULAR_FILE');
  }
}

async function createTemporaryFile(
  parentDirectory: string,
  finalBasename: string,
): Promise<{ path: string; handle: FileHandle }> {
  let finalOpenError: unknown;

  for (let attempt = 0; attempt < TEMPORARY_FILE_ATTEMPTS; attempt += 1) {
    const temporaryPath = path.join(
      parentDirectory,
      `.${finalBasename}.devguard-${process.pid}-${randomBytes(16).toString('hex')}.tmp`,
    );

    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      return { path: temporaryPath, handle };
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }

      finalOpenError = error;
    }
  }

  throw finalOpenError ?? new Error('TEMPORARY_FILE_CREATION_FAILED');
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}
