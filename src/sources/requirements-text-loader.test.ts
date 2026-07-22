import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadRequirementsText,
  MAX_REQUIREMENTS_FILE_BYTES,
  type LoadRequirementsTextInput,
} from './requirements-text-loader.js';
import { selectRequirementsSource } from '../modules/test-generator/select-requirements-source.js';

const REQUIREMENTS_CONTENT = 'As a librarian, I can reserve a Book.';
const SECRET_CONTENT = 'do-not-copy-this-requirements-content';
const canTestUnixPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;
const canTestUnixSocket = process.platform !== 'win32';

async function withTemporaryRoot(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-requirements-'));

  try {
    await callback(root);
  } finally {
    await fs.chmod(root, 0o700).catch(() => undefined);
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function writeRootFile(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

function createInput(
  root: string,
  selectedPath: string,
  overrides: Partial<LoadRequirementsTextInput> = {},
): LoadRequirementsTextInput {
  return {
    source: 'cli',
    path: selectedPath,
    baseDirectory: root,
    allowedRoot: root,
    ...overrides,
  };
}

function warningCode(result: Awaited<ReturnType<typeof loadRequirementsText>>): string | undefined {
  return result.warnings[0]?.code;
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

describe('loadRequirementsText', () => {
  it('loads a relative CLI-style path from its base directory', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'docs/requirements.md', REQUIREMENTS_CONTENT);

      const result = await loadRequirementsText(createInput(root, 'docs/requirements.md'));

      expect(result).toEqual({
        source: 'cli',
        selectedPath: 'docs/requirements.md',
        content: REQUIREMENTS_CONTENT,
        warnings: [],
      });
    });
  });

  it('loads a relative config-style path from the config-directory base', async () => {
    await withTemporaryRoot(async (root) => {
      const configDirectory = path.join(root, 'config');
      await writeRootFile(root, 'config/requirements.md', REQUIREMENTS_CONTENT);

      const result = await loadRequirementsText(
        createInput(root, 'requirements.md', {
          source: 'config',
          baseDirectory: configDirectory,
        }),
      );

      expect(result.source).toBe('config');
      expect(result.content).toBe(REQUIREMENTS_CONTENT);
      expect(result.selectedPath).toBe('config/requirements.md');
    });
  });

  it('loads an absolute selected path when it remains inside the allowed root', async () => {
    await withTemporaryRoot(async (root) => {
      const filePath = await writeRootFile(root, 'requirements.txt', REQUIREMENTS_CONTENT);

      const result = await loadRequirementsText(createInput(root, filePath));

      expect(result.content).toBe(REQUIREMENTS_CONTENT);
      expect(result.selectedPath).toBe('requirements.txt');
      expect(JSON.stringify(result)).not.toContain(root);
    });
  });

  it('rejects absolute paths outside the allowed root without exposing local paths', async () => {
    await withTemporaryRoot(async (root) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-outside-'));
      const outsideFile = await writeRootFile(outsideRoot, 'requirements.txt', SECRET_CONTENT);

      try {
        const result = await loadRequirementsText(createInput(root, outsideFile));

        expect(warningCode(result)).toBe('REQUIREMENTS_PATH_OUTSIDE_ROOT');
        expect(result.content).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(root);
        expect(JSON.stringify(result)).not.toContain(outsideRoot);
        expect(JSON.stringify(result.warnings)).not.toContain(SECRET_CONTENT);
      } finally {
        await fs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  it('rejects lexical traversal outside the allowed root', async () => {
    await withTemporaryRoot(async (root) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-outside-'));

      try {
        const result = await loadRequirementsText(
          createInput(root, path.join('..', path.basename(outsideRoot), 'requirements.md')),
        );

        expect(warningCode(result)).toBe('REQUIREMENTS_PATH_OUTSIDE_ROOT');
        expect(result.content).toBeUndefined();
      } finally {
        await fs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  it('returns a non-fatal warning for a missing selected file', async () => {
    await withTemporaryRoot(async (root) => {
      const result = await loadRequirementsText(createInput(root, 'missing.md'));

      expect(result.content).toBeUndefined();
      expect(result.selectedPath).toBe('missing.md');
      expect(result.warnings).toMatchObject([
        {
          code: 'REQUIREMENTS_FILE_NOT_FOUND',
          source: 'cli',
        },
      ]);
    });
  });

  it('returns a non-fatal warning for a directory', async () => {
    await withTemporaryRoot(async (root) => {
      await fs.mkdir(path.join(root, 'requirements-directory'));

      const result = await loadRequirementsText(createInput(root, 'requirements-directory'));

      expect(warningCode(result)).toBe('REQUIREMENTS_NOT_REGULAR_FILE');
      expect(result.content).toBeUndefined();
    });
  });

  it.skipIf(!canTestUnixSocket)('returns a non-fatal warning for a Unix socket', async () => {
    await withTemporaryRoot(async (root) => {
      const socketPath = path.join(root, 'requirements.sock');
      const server = await createServer(socketPath);

      try {
        const result = await loadRequirementsText(createInput(root, 'requirements.sock'));

        expect(warningCode(result)).toBe('REQUIREMENTS_NOT_REGULAR_FILE');
        expect(result.content).toBeUndefined();
      } finally {
        await closeServer(server);
      }
    });
  });

  it.skipIf(!canTestUnixPermissions)(
    'returns a safe read warning for an unreadable regular file',
    async () => {
      await withTemporaryRoot(async (root) => {
        const filePath = await writeRootFile(root, 'unreadable.md', REQUIREMENTS_CONTENT);
        await fs.chmod(filePath, 0o000);

        try {
          const result = await loadRequirementsText(createInput(root, 'unreadable.md'));

          expect(warningCode(result)).toBe('REQUIREMENTS_READ_FAILED');
          expect(JSON.stringify(result.warnings)).not.toMatch(/EACCES|permission denied/iu);
        } finally {
          await fs.chmod(filePath, 0o600);
        }
      });
    },
  );

  it('loads a symlink inside the root that targets a file inside the root', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'nested/requirements.md', REQUIREMENTS_CONTENT);
      await fs.symlink(
        path.join('nested', 'requirements.md'),
        path.join(root, 'requirements-link'),
      );

      const result = await loadRequirementsText(createInput(root, 'requirements-link'));

      expect(result.content).toBe(REQUIREMENTS_CONTENT);
      expect(result.selectedPath).toBe('requirements-link');
    });
  });

  it('rejects a symlink that escapes the allowed root', async () => {
    await withTemporaryRoot(async (root) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-outside-'));
      const outsideFile = await writeRootFile(outsideRoot, 'requirements.md', SECRET_CONTENT);
      await fs.symlink(outsideFile, path.join(root, 'escaped-link'));

      try {
        const result = await loadRequirementsText(createInput(root, 'escaped-link'));

        expect(warningCode(result)).toBe('REQUIREMENTS_SYMLINK_OUTSIDE_ROOT');
        expect(JSON.stringify(result)).not.toContain(outsideRoot);
        expect(JSON.stringify(result.warnings)).not.toContain(SECRET_CONTENT);
      } finally {
        await fs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  it('rejects sibling-prefix paths outside the allowed root', async () => {
    await withTemporaryRoot(async (root) => {
      const allowedRoot = path.join(root, 'app');
      const siblingRoot = path.join(root, 'application');
      await fs.mkdir(allowedRoot);
      await writeRootFile(siblingRoot, 'requirements.md', REQUIREMENTS_CONTENT);

      const result = await loadRequirementsText(
        createInput(allowedRoot, path.join('..', 'application', 'requirements.md'), {
          allowedRoot,
        }),
      );

      expect(warningCode(result)).toBe('REQUIREMENTS_PATH_OUTSIDE_ROOT');
      expect(result.content).toBeUndefined();
    });
  });

  it('accepts a valid UTF-8 file exactly at the 1 MiB limit', async () => {
    await withTemporaryRoot(async (root) => {
      const content = 'a'.repeat(MAX_REQUIREMENTS_FILE_BYTES);
      await writeRootFile(root, 'maximum.txt', content);

      const result = await loadRequirementsText(createInput(root, 'maximum.txt'));

      expect(result.content).toBe(content);
      expect(result.warnings).toEqual([]);
    });
  });

  it('rejects a file over the 1 MiB limit before using its content', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'too-large.txt', 'b'.repeat(MAX_REQUIREMENTS_FILE_BYTES + 1));

      const result = await loadRequirementsText(createInput(root, 'too-large.txt'));

      expect(warningCode(result)).toBe('REQUIREMENTS_FILE_TOO_LARGE');
      expect(result.content).toBeUndefined();
    });
  });

  it('loads valid UTF-8 exactly and preserves meaningful leading and trailing whitespace', async () => {
    await withTemporaryRoot(async (root) => {
      const content = `  ${REQUIREMENTS_CONTENT}\n`;
      await writeRootFile(root, 'preserved.md', content);

      const result = await loadRequirementsText(createInput(root, 'preserved.md'));

      expect(result.content).toBe(content);
    });
  });

  it('returns a safe warning for invalid UTF-8 without exposing raw bytes', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'invalid-utf8.txt', new Uint8Array([0xc3, 0x28]));

      const result = await loadRequirementsText(createInput(root, 'invalid-utf8.txt'));

      expect(warningCode(result)).toBe('REQUIREMENTS_INVALID_UTF8');
      expect(result.content).toBeUndefined();
      expect(JSON.stringify(result.warnings)).not.toContain('c3');
    });
  });

  it('returns REQUIREMENTS_EMPTY for empty and whitespace-only content', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'empty.txt', '');
      await writeRootFile(root, 'whitespace.txt', ' \n\t ');

      const empty = await loadRequirementsText(createInput(root, 'empty.txt'));
      const whitespace = await loadRequirementsText(createInput(root, 'whitespace.txt'));

      expect(warningCode(empty)).toBe('REQUIREMENTS_EMPTY');
      expect(warningCode(whitespace)).toBe('REQUIREMENTS_EMPTY');
      expect(empty.content).toBeUndefined();
      expect(whitespace.content).toBeUndefined();
    });
  });

  it('does not fall back from a failed CLI selection to a valid config candidate', async () => {
    await withTemporaryRoot(async (root) => {
      await writeRootFile(root, 'config.md', REQUIREMENTS_CONTENT);
      const selected = selectRequirementsSource({
        cliPath: 'missing-cli.md',
        configPath: 'config.md',
      });

      expect(selected).toEqual({ source: 'cli', path: 'missing-cli.md' });
      if (selected.source === 'none') {
        throw new Error('Expected selected CLI requirements path');
      }

      const result = await loadRequirementsText(
        createInput(root, selected.path, { source: selected.source }),
      );

      expect(warningCode(result)).toBe('REQUIREMENTS_FILE_NOT_FOUND');
      expect(result.content).toBeUndefined();
    });
  });

  it('degrades a failed config selection to no content with one warning', async () => {
    await withTemporaryRoot(async (root) => {
      const result = await loadRequirementsText(
        createInput(root, 'missing-config.md', { source: 'config' }),
      );

      expect(result.source).toBe('config');
      expect(result.content).toBeUndefined();
      expect(result.warnings).toHaveLength(1);
      expect(warningCode(result)).toBe('REQUIREMENTS_FILE_NOT_FOUND');
    });
  });

  it('is deterministic, emits one stable warning, and does not mutate input objects', async () => {
    await withTemporaryRoot(async (root) => {
      const input = createInput(root, 'missing.md');
      const before = structuredClone(input);
      const first = await loadRequirementsText(input);
      const second = await loadRequirementsText(input);

      expect(second).toEqual(first);
      expect(first.warnings).toHaveLength(1);
      expect(JSON.stringify(first)).not.toContain(root);
      expect(input).toEqual(before);
    });
  });

  it('returns non-fatal safe results for malformed, missing, and outside paths', async () => {
    await withTemporaryRoot(async (root) => {
      const inputs = [
        createInput(root, '\u0000invalid'),
        createInput(root, 'missing.md'),
        createInput(root, path.join('..', 'outside.md')),
      ];

      for (const input of inputs) {
        const result = await loadRequirementsText(input);
        expect(result.content).toBeUndefined();
        expect(result.warnings).toHaveLength(1);
      }
    });
  });

  it('keeps warning messages free of source content and raw filesystem diagnostics', async () => {
    await withTemporaryRoot(async (root) => {
      const result = await loadRequirementsText(createInput(root, 'missing.md'));
      const warnings = JSON.stringify(result.warnings);

      expect(warnings).not.toContain(SECRET_CONTENT);
      expect(warnings).not.toMatch(/ENOENT|EACCES|ENOTDIR|no such file|permission denied/iu);
      expect(warnings).not.toContain(root);
    });
  });
});
