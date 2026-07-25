import net from 'node:net';
import { readFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  };
});

import {
  ExplicitRequirementsOverrideError,
  loadExplicitRequirementsOverride,
  MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES,
  type ExplicitRequirementsOverride,
  type ExplicitRequirementsOverrideErrorCode,
} from './explicit-requirements-override-loader.js';

const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
const readFileMock = vi.mocked(readFile);
const CONTENT = 'As a librarian, I can reserve a book.';
const SECRET = 'private requirements content and path';
const canTestUnixPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;
const canTestUnixSocket = process.platform !== 'win32';

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

async function withTemporaryRoot(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await actualFs.mkdtemp(path.join(os.tmpdir(), 'devguard-explicit-requirements-'));

  try {
    await callback(root);
  } finally {
    await actualFs.chmod(root, 0o700).catch(() => undefined);
    await actualFs.rm(root, { force: true, recursive: true });
  }
}

async function writeFile(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
): Promise<string> {
  const filePath = path.join(root, relativePath);
  await actualFs.mkdir(path.dirname(filePath), { recursive: true });
  await actualFs.writeFile(filePath, content);
  return filePath;
}

function createOverride(
  baseDirectory: string,
  selectedPath = 'requirements.md',
  overrides: Partial<ExplicitRequirementsOverride> = {},
): ExplicitRequirementsOverride {
  return {
    path: selectedPath,
    baseDirectory,
    required: true,
    ...overrides,
  };
}

async function captureFailure(
  override: ExplicitRequirementsOverride,
): Promise<ExplicitRequirementsOverrideError> {
  try {
    await loadExplicitRequirementsOverride(override);
  } catch (error) {
    expect(error).toBeInstanceOf(ExplicitRequirementsOverrideError);
    return error as ExplicitRequirementsOverrideError;
  }

  throw new Error('Expected explicit requirements override loading to fail');
}

async function createFileSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await actualFs.symlink(target, linkPath, process.platform === 'win32' ? 'file' : 'file');
    return true;
  } catch (error) {
    if (hasUnsupportedSymlinkError(error)) {
      return false;
    }

    throw error;
  }
}

function hasUnsupportedSymlinkError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['EACCES', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(String(error.code))
  );
}

function createServer(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

beforeEach(() => {
  readFileMock.mockReset();
  readFileMock.mockImplementation(actualFs.readFile);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('loadExplicitRequirementsOverride', () => {
  it('loads valid relative and nested files without trimming Unicode or line endings', async () => {
    await withTemporaryRoot(async (root) => {
      const unicodeContent = `  ${CONTENT} — 你好\r\n`;
      await writeFile(root, 'requirements.md', CONTENT);
      await writeFile(root, 'nested/requirements.md', unicodeContent);

      await expect(loadExplicitRequirementsOverride(createOverride(root))).resolves.toEqual({
        text: CONTENT,
      });
      await expect(
        loadExplicitRequirementsOverride(createOverride(root, 'nested/requirements.md')),
      ).resolves.toEqual({ text: unicodeContent });
    });
  });

  it('accepts a contained symlink', async (context) => {
    await withTemporaryRoot(async (root) => {
      const target = await writeFile(root, 'nested/requirements.md', CONTENT);
      const linkPath = path.join(root, 'requirements-link');
      if (!(await createFileSymlink(target, linkPath))) {
        context.skip();
        return;
      }

      await expect(
        loadExplicitRequirementsOverride(createOverride(root, 'requirements-link')),
      ).resolves.toEqual({
        text: CONTENT,
      });
    });
  });

  it.each([
    ['empty path', (root: string) => createOverride(root, '')],
    ['whitespace path', (root: string) => createOverride(root, ' \t ')],
    ['NUL path', (root: string) => createOverride(root, 'bad\u0000path')],
    ['empty base directory', () => createOverride('', 'requirements.md')],
    ['whitespace base directory', () => createOverride('  ', 'requirements.md')],
    ['relative base directory', () => createOverride('relative/base', 'requirements.md')],
    ['NUL base directory', () => createOverride('/tmp\u0000root', 'requirements.md')],
    ['POSIX absolute path', () => createOverride('/tmp', '/etc/requirements.md')],
    ['Windows absolute path', () => createOverride('/tmp', 'C:\\requirements.md')],
    ['drive-relative path', () => createOverride('/tmp', 'C:requirements.md')],
    ['UNC path', () => createOverride('/tmp', '\\\\server\\share\\requirements.md')],
  ])('rejects invalid %s', async (_name, createInvalidOverride) => {
    const error = await captureFailure(createInvalidOverride('/tmp'));

    expect(error.code).toBe('REQUIREMENTS_OVERRIDE_INVALID');
    expect(error.message).toBe(ERROR_MESSAGES.REQUIREMENTS_OVERRIDE_INVALID);
  });

  it('rejects lexical traversal and sibling-prefix escapes', async () => {
    await withTemporaryRoot(async (root) => {
      const workspace = path.join(root, 'workspace');
      const sibling = path.join(root, 'workspace-copy');
      await actualFs.mkdir(workspace);
      await writeFile(sibling, 'requirements.md', CONTENT);

      const traversal = await captureFailure(createOverride(workspace, '../outside.md'));
      const siblingEscape = await captureFailure(
        createOverride(workspace, '../workspace-copy/requirements.md'),
      );

      expect(traversal.code).toBe('REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY');
      expect(siblingEscape.code).toBe('REQUIREMENTS_OVERRIDE_OUTSIDE_WORKING_DIRECTORY');
    });
  });

  it('rejects missing or non-directory base directories safely', async () => {
    await withTemporaryRoot(async (root) => {
      const baseFile = await writeFile(root, 'base-file', CONTENT);
      const missing = await captureFailure(createOverride(path.join(root, 'missing')));
      const file = await captureFailure(createOverride(baseFile));

      expect(missing.code).toBe('REQUIREMENTS_OVERRIDE_READ_FAILED');
      expect(file.code).toBe('REQUIREMENTS_OVERRIDE_INVALID');
    });
  });

  it('rejects missing and non-regular targets', async () => {
    await withTemporaryRoot(async (root) => {
      await actualFs.mkdir(path.join(root, 'directory'));
      const missing = await captureFailure(createOverride(root, 'missing.md'));
      const directory = await captureFailure(createOverride(root, 'directory'));

      expect(missing.code).toBe('REQUIREMENTS_OVERRIDE_NOT_FOUND');
      expect(directory.code).toBe('REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE');
    });
  });

  it.skipIf(!canTestUnixSocket)('rejects another non-regular target', async () => {
    await withTemporaryRoot(async (root) => {
      const socketPath = path.join(root, 'requirements.sock');
      const server = await createServer(socketPath);

      try {
        const error = await captureFailure(createOverride(root, 'requirements.sock'));

        expect(error.code).toBe('REQUIREMENTS_OVERRIDE_NOT_REGULAR_FILE');
      } finally {
        await closeServer(server);
      }
    });
  });

  it('rejects a symlink escaping the canonical base directory', async (context) => {
    await withTemporaryRoot(async (root) => {
      const outside = await actualFs.mkdtemp(
        path.join(os.tmpdir(), 'devguard-requirements-outside-'),
      );
      const target = await writeFile(outside, 'requirements.md', SECRET);
      const linkPath = path.join(root, 'escaped-link');
      if (!(await createFileSymlink(target, linkPath))) {
        await actualFs.rm(outside, { force: true, recursive: true });
        context.skip();
        return;
      }

      try {
        const error = await captureFailure(createOverride(root, 'escaped-link'));

        expect(error.code).toBe('REQUIREMENTS_OVERRIDE_SYMLINK_OUTSIDE_WORKING_DIRECTORY');
        expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(outside);
      } finally {
        await actualFs.rm(outside, { force: true, recursive: true });
      }
    });
  });

  it.skipIf(!canTestUnixPermissions)('rejects an unreadable target', async () => {
    await withTemporaryRoot(async (root) => {
      const filePath = await writeFile(root, 'unreadable.md', CONTENT);
      await actualFs.chmod(filePath, 0o000);

      try {
        const error = await captureFailure(createOverride(root, 'unreadable.md'));

        expect(error.code).toBe('REQUIREMENTS_OVERRIDE_READ_FAILED');
      } finally {
        await actualFs.chmod(filePath, 0o600);
      }
    });
  });

  it('accepts a valid file exactly at 1 MiB and rejects pre-read overflow', async () => {
    await withTemporaryRoot(async (root) => {
      const maximum = 'a'.repeat(MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES);
      await writeFile(root, 'maximum.txt', maximum);
      await writeFile(
        root,
        'too-large.txt',
        'b'.repeat(MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES + 1),
      );

      await expect(
        loadExplicitRequirementsOverride(createOverride(root, 'maximum.txt')),
      ).resolves.toEqual({
        text: maximum,
      });
      await expect(
        loadExplicitRequirementsOverride(createOverride(root, 'too-large.txt')),
      ).rejects.toMatchObject({ code: 'REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE' });
      expect(readFileMock).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects post-read byte-size overflow', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFile(root, 'small.txt', CONTENT);
      readFileMock.mockResolvedValueOnce(
        Buffer.alloc(MAX_EXPLICIT_REQUIREMENTS_OVERRIDE_BYTES + 1, 65),
      );

      const error = await captureFailure(createOverride(root, 'small.txt'));

      expect(error.code).toBe('REQUIREMENTS_OVERRIDE_FILE_TOO_LARGE');
    });
  });

  it('rejects invalid UTF-8, NUL content, and empty content', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFile(root, 'invalid.txt', new Uint8Array([0xc3, 0x28]));
      await writeFile(root, 'nul.txt', `valid\u0000${SECRET}`);
      await writeFile(root, 'empty.txt', ' \n\t ');

      const invalidUtf8 = await captureFailure(createOverride(root, 'invalid.txt'));
      const nul = await captureFailure(createOverride(root, 'nul.txt'));
      const empty = await captureFailure(createOverride(root, 'empty.txt'));

      expect(invalidUtf8.code).toBe('REQUIREMENTS_OVERRIDE_INVALID_UTF8');
      expect(nul.code).toBe('REQUIREMENTS_OVERRIDE_INVALID_UTF8');
      expect(empty.code).toBe('REQUIREMENTS_OVERRIDE_EMPTY');
    });
  });

  it('uses fixed safe messages for every error code', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      const error = new ExplicitRequirementsOverrideError(
        code as ExplicitRequirementsOverrideErrorCode,
        `${SECRET} must never become public`,
        { cause: new Error(SECRET) },
      );

      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(SECRET);
    }
  });

  it('hides raw paths, base directories, errno, and content while retaining a private cause', async () => {
    await withTemporaryRoot(async (root) => {
      const rawPath = `missing-${SECRET}.md`;
      const error = await captureFailure(createOverride(root, rawPath));
      const publicError = `${String(error)} ${JSON.stringify(error)}`;

      expect(error.cause).toBeInstanceOf(Error);
      expect(publicError).not.toContain(root);
      expect(publicError).not.toContain(rawPath);
      expect(publicError).not.toContain(SECRET);
      expect(publicError).not.toMatch(/ENOENT|EACCES|no such file|permission denied/iu);
    });
  });

  it('does not mutate overrides, returns no warnings, and is deterministic', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFile(root, 'requirements.md', CONTENT);
      const override = createOverride(root);
      const before = structuredClone(override);

      const first = await loadExplicitRequirementsOverride(override);
      const second = await loadExplicitRequirementsOverride(override);

      expect(first).toEqual({ text: CONTENT });
      expect(second).toEqual(first);
      expect(Object.keys(first)).toEqual(['text']);
      expect(override).toEqual(before);
    });
  });

  it('does not log or touch stdout/stderr', async () => {
    await withTemporaryRoot(async (root) => {
      await writeFile(root, 'requirements.md', CONTENT);
      const log = vi.spyOn(console, 'log');
      const stdout = vi.spyOn(process.stdout, 'write');
      const stderr = vi.spyOn(process.stderr, 'write');

      await loadExplicitRequirementsOverride(createOverride(root));

      expect(log).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    });
  });
});
