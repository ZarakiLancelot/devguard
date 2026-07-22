import { open, rename, unlink } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
  };
});

import {
  AtomicWriteError,
  writeFileAtomically,
  type WriteFileAtomicallyInput,
} from './atomic-writer.js';
import type { FileHandle } from 'node:fs/promises';

const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
const openMock = vi.mocked(open);
const renameMock = vi.mocked(rename);
const unlinkMock = vi.mocked(unlink);

async function withTemporaryRoot(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await actualFs.mkdtemp(path.join(os.tmpdir(), 'devguard-atomic-writer-'));

  try {
    await callback(root);
  } finally {
    await actualFs.chmod(root, 0o700).catch(() => undefined);
    await actualFs.rm(root, { force: true, recursive: true });
  }
}

function createInput(
  root: string,
  filePath = 'report.md',
  content = 'report content',
): WriteFileAtomicallyInput {
  return { allowedRoot: root, filePath, content };
}

function temporaryFiles(directory: string): Promise<string[]> {
  return actualFs
    .readdir(directory)
    .then((entries) =>
      entries.filter((entry) => entry.includes('.devguard-') && entry.endsWith('.tmp')),
    );
}

function codedError(
  code: string,
  message = `${code} private filesystem detail`,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function createFakeHandle(
  options: {
    writeError?: Error;
    closeError?: Error;
    lifecycle?: string[];
  } = {},
): {
  handle: FileHandle;
  writeFile: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
} {
  const writeFile = vi.fn(async () => {
    options.lifecycle?.push('write');
    if (options.writeError !== undefined) {
      throw options.writeError;
    }
  });
  const close = vi.fn(async () => {
    options.lifecycle?.push('close');
    if (options.closeError !== undefined) {
      throw options.closeError;
    }
  });
  const sync = vi.fn(async () => {
    options.lifecycle?.push('sync');
  });

  return { handle: { writeFile, close, sync } as unknown as FileHandle, writeFile, close, sync };
}

async function captureAtomicFailure(action: () => Promise<void>): Promise<AtomicWriteError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(AtomicWriteError);
    return error as AtomicWriteError;
  }

  throw new Error('Expected atomic writer operation to fail');
}

beforeEach(() => {
  openMock.mockReset();
  renameMock.mockReset();
  unlinkMock.mockReset();
  openMock.mockImplementation(actualFs.open);
  renameMock.mockImplementation(actualFs.rename);
  unlinkMock.mockImplementation(actualFs.unlink);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('writeFileAtomically', () => {
  it.each([
    ['new UTF-8 Unicode content', 'report-😀.md', 'Olá, 世界 😀\n'],
    ['empty content', 'empty.txt', ''],
    ['content with significant whitespace', 'spacing.txt', '  first\n\tsecond  \n'],
  ])('writes %s exactly as supplied', async (_description, filePath, content) => {
    await withTemporaryRoot(async (root) => {
      const input = createInput(root, filePath, content);
      const before = structuredClone(input);

      await writeFileAtomically(input);

      expect(await actualFs.readFile(path.join(root, filePath), 'utf8')).toBe(content);
      expect(input).toEqual(before);
      expect(await temporaryFiles(root)).toEqual([]);
    });
  });

  it('replaces an existing regular file repeatedly without leaving temporary files', async () => {
    await withTemporaryRoot(async (root) => {
      const finalPath = path.join(root, 'report.json');
      await actualFs.writeFile(finalPath, 'old', 'utf8');

      await writeFileAtomically(createInput(root, 'report.json', 'first replacement'));
      await writeFileAtomically(createInput(root, 'report.json', 'second replacement'));

      expect(await actualFs.readFile(finalPath, 'utf8')).toBe('second replacement');
      expect(await temporaryFiles(root)).toEqual([]);
    });
  });

  it('writes to an existing nested parent but never creates a missing one', async () => {
    await withTemporaryRoot(async (root) => {
      await actualFs.mkdir(path.join(root, 'nested'));

      await writeFileAtomically(createInput(root, 'nested/report.md', 'nested report'));
      const missingParentError = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'missing/report.md')),
      );

      expect(await actualFs.readFile(path.join(root, 'nested/report.md'), 'utf8')).toBe(
        'nested report',
      );
      await expect(actualFs.access(path.join(root, 'missing'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(missingParentError.message).toBe('Unable to write report output safely.');
    });
  });

  it('uses a same-directory exclusive temporary file with a safe randomized name and mode', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFileAtomically(createInput(root, 'report.md', 'content'));

      const [temporaryPath, flags, mode] = openMock.mock.calls[0] ?? [];
      expect(typeof temporaryPath).toBe('string');
      expect(path.dirname(temporaryPath as string)).toBe(root);
      expect(path.basename(temporaryPath as string)).toMatch(
        new RegExp(`^\\.report\\.md\\.devguard-${process.pid}-[a-f0-9]{32}\\.tmp$`, 'u'),
      );
      expect(flags).toBe('wx');
      expect(mode).toBe(0o600);
      expect(await temporaryFiles(root)).toEqual([]);
    });
  });

  it('rejects lexical escapes, missing roots, parent symlink escapes, and unsafe final targets', async () => {
    await withTemporaryRoot(async (root) => {
      const outsideRoot = await actualFs.mkdtemp(
        path.join(os.tmpdir(), 'devguard-atomic-outside-'),
      );
      const targetDirectory = path.join(root, 'directory-target');
      const symlinkTarget = path.join(root, 'symlink-target');
      await actualFs.mkdir(targetDirectory);
      await actualFs.writeFile(symlinkTarget, 'do not replace', 'utf8');
      await actualFs.symlink(symlinkTarget, path.join(root, 'report-link'));
      await actualFs.symlink(outsideRoot, path.join(root, 'escaped-parent'));

      try {
        const failures = await Promise.all([
          captureAtomicFailure(() => writeFileAtomically(createInput(root, '../outside.md'))),
          captureAtomicFailure(() =>
            writeFileAtomically(createInput(path.join(root, 'missing-root'), 'report.md')),
          ),
          captureAtomicFailure(() =>
            writeFileAtomically(createInput(root, 'escaped-parent/report.md')),
          ),
          captureAtomicFailure(() => writeFileAtomically(createInput(root, 'report-link'))),
          captureAtomicFailure(() => writeFileAtomically(createInput(root, 'directory-target'))),
        ]);

        for (const failure of failures) {
          expect(failure.message).toBe('Unable to write report output safely.');
          expect(failure.message).not.toContain(root);
          expect(failure.message).not.toContain(outsideRoot);
        }
        expect(await actualFs.readFile(symlinkTarget, 'utf8')).toBe('do not replace');
      } finally {
        await actualFs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  it('retries a temporary-name collision once, then succeeds with bounded exclusive opens', async () => {
    await withTemporaryRoot(async (root) => {
      openMock.mockRejectedValueOnce(codedError('EEXIST'));

      await writeFileAtomically(createInput(root, 'report.md', 'collision recovery'));

      expect(openMock).toHaveBeenCalledTimes(2);
      expect(await actualFs.readFile(path.join(root, 'report.md'), 'utf8')).toBe(
        'collision recovery',
      );
      expect(await temporaryFiles(root)).toEqual([]);
    });
  });

  it('stops after bounded temporary-name collision retries and leaves the final file unchanged', async () => {
    await withTemporaryRoot(async (root) => {
      const finalPath = path.join(root, 'report.md');
      await actualFs.writeFile(finalPath, 'existing report', 'utf8');
      openMock.mockRejectedValue(codedError('EEXIST'));

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', 'replacement that must not happen')),
      );

      expect(openMock).toHaveBeenCalledTimes(3);
      expect(await actualFs.readFile(finalPath, 'utf8')).toBe('existing report');
      expect(await temporaryFiles(root)).toEqual([]);
      expect(failure.message).toBe('Unable to write report output safely.');
    });
  });

  it('cleans up after write failure while preserving an existing final file and primary cause', async () => {
    await withTemporaryRoot(async (root) => {
      const primaryError = codedError('EIO', 'write failed with secret report content');
      const fake = createFakeHandle({ writeError: primaryError });
      const finalPath = path.join(root, 'report.md');
      await actualFs.writeFile(finalPath, 'existing report', 'utf8');
      openMock.mockResolvedValue(fake.handle);

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', 'new secret report content')),
      );

      expect(fake.writeFile).toHaveBeenCalledWith('new secret report content', {
        encoding: 'utf8',
      });
      expect(fake.close).toHaveBeenCalledTimes(1);
      expect(unlinkMock).toHaveBeenCalledTimes(1);
      expect(await actualFs.readFile(finalPath, 'utf8')).toBe('existing report');
      expect(failure.cause).toBe(primaryError);
      expect(failure.message).not.toContain('secret report content');
    });
  });

  it('attempts final cleanup after a close failure and never renames before a successful close', async () => {
    await withTemporaryRoot(async (root) => {
      const closeError = codedError('EIO', 'close failure private detail');
      const fake = createFakeHandle({ closeError });
      openMock.mockResolvedValue(fake.handle);

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', 'complete temporary content')),
      );

      expect(fake.writeFile).toHaveBeenCalledWith('complete temporary content', {
        encoding: 'utf8',
      });
      expect(fake.close).toHaveBeenCalledTimes(2);
      expect(renameMock).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledTimes(1);
      expect(failure.cause).toBe(closeError);
    });
  });

  it('cleans up a real temporary file after rename failure and preserves the existing final file', async () => {
    await withTemporaryRoot(async (root) => {
      const finalPath = path.join(root, 'report.md');
      const renameError = codedError('EIO', 'rename failure private detail');
      await actualFs.writeFile(finalPath, 'existing report', 'utf8');
      renameMock.mockRejectedValue(renameError);

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', 'new report')),
      );

      expect(await actualFs.readFile(finalPath, 'utf8')).toBe('existing report');
      expect(await temporaryFiles(root)).toEqual([]);
      expect(unlinkMock).toHaveBeenCalledTimes(1);
      expect(unlinkMock.mock.calls[0]?.[0]).not.toBe(finalPath);
      expect(failure.cause).toBe(renameError);
      expect(failure.message).not.toContain('rename failure private detail');
    });
  });

  it('preserves the primary error when cleanup also fails', async () => {
    await withTemporaryRoot(async (root) => {
      const writeError = codedError('EIO', 'primary write failure');
      const cleanupError = codedError('EACCES', 'cleanup failure');
      const fake = createFakeHandle({ writeError });
      openMock.mockResolvedValue(fake.handle);
      unlinkMock.mockRejectedValue(cleanupError);

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', 'content')),
      );

      expect(failure.cause).toBe(writeError);
      expect(failure.message).toBe('Unable to write report output safely.');
      expect(failure.message).not.toContain('primary write failure');
      expect(failure.message).not.toContain('cleanup failure');
    });
  });

  it('closes before rename, does not unlink the final file, and never fsyncs', async () => {
    await withTemporaryRoot(async (root) => {
      const lifecycle: string[] = [];
      const fake = createFakeHandle({ lifecycle });
      openMock.mockResolvedValue(fake.handle);
      renameMock.mockImplementation(async () => {
        lifecycle.push('rename');
      });

      await writeFileAtomically(createInput(root, 'report.md', 'content'));

      expect(lifecycle).toEqual(['write', 'close', 'rename']);
      expect(fake.sync).not.toHaveBeenCalled();
      expect(unlinkMock).not.toHaveBeenCalled();
    });
  });

  it('wraps open failures in a deterministic safe error without raw paths or OS diagnostics', async () => {
    await withTemporaryRoot(async (root) => {
      const secret = 'absolute-secret-path-and-content';
      openMock.mockRejectedValue(codedError('EACCES', `permission denied: ${secret}`));

      const failure = await captureAtomicFailure(() =>
        writeFileAtomically(createInput(root, 'report.md', secret)),
      );

      expect(failure.code).toBe('OUTPUT_WRITE_FAILED');
      expect(failure.name).toBe('AtomicWriteError');
      expect(failure.message).toBe('Unable to write report output safely.');
      expect(String(failure)).not.toContain(secret);
      expect(failure.message).not.toMatch(/EACCES|permission denied/iu);
      expect(renameMock).not.toHaveBeenCalled();
    });
  });
});
