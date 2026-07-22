import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  isPathContainedInRoot,
  resolveRepositoryPath,
  resolveFileInRepository,
  resolveFileWithinRoot,
  resolveOutputFile,
  resolveRuntimeFileWithinRoot,
} from './path-security.js';

const WORKSPACE = '/home/user/project';
const REPO_ROOT = '/home/user/project/api';
const OUTPUT_DIR = '/home/user/project/.devguard';

describe('path-security', () => {
  describe('resolveRepositoryPath', () => {
    it('should resolve a relative repository path from workspace', () => {
      const result = resolveRepositoryPath(WORKSPACE, '../book-api');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.resolve(WORKSPACE, '../book-api'));
      }
    });

    it('should resolve a same-directory repository path', () => {
      const result = resolveRepositoryPath(WORKSPACE, '.');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(WORKSPACE);
      }
    });

    it('should reject an absolute Unix path', () => {
      const result = resolveRepositoryPath(WORKSPACE, '/etc/passwd');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should reject an absolute Windows-style path', () => {
      const result = resolveRepositoryPath(WORKSPACE, 'C:\\Users\\project');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should reject an empty path', () => {
      const result = resolveRepositoryPath(WORKSPACE, '');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_PATH');
      }
    });
  });

  describe('resolveFileInRepository', () => {
    it('should resolve a valid nested file path', () => {
      const result = resolveFileInRepository(REPO_ROOT, 'src/api/types.ts');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(REPO_ROOT, 'src/api/types.ts'));
      }
    });

    it('should resolve a valid repository-relative path', () => {
      const result = resolveFileInRepository(REPO_ROOT, 'docs/openapi.yaml');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(REPO_ROOT, 'docs/openapi.yaml'));
      }
    });

    it('should resolve a normalized path that remains inside the root', () => {
      const result = resolveFileInRepository(REPO_ROOT, 'src/../docs/openapi.yaml');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(REPO_ROOT, 'docs/openapi.yaml'));
      }
    });

    it('should reject a ../ escape', () => {
      const result = resolveFileInRepository(REPO_ROOT, '../secret.txt');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('PATH_OUTSIDE_REPOSITORY');
      }
    });

    it('should reject a deeply nested traversal escape', () => {
      const result = resolveFileInRepository(REPO_ROOT, 'src/../../../../../../etc/passwd');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('PATH_OUTSIDE_REPOSITORY');
      }
    });

    it('should reject an absolute Unix path', () => {
      const result = resolveFileInRepository(REPO_ROOT, '/etc/passwd');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should reject an absolute Windows-style path', () => {
      const result = resolveFileInRepository(REPO_ROOT, 'D:\\data\\file.ts');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should prevent sibling-prefix trap (api vs api-copy)', () => {
      // Repo root is /home/user/project/api
      // A file at /home/user/project/api-copy/file.ts must NOT be considered inside api/
      const result = resolveFileInRepository(REPO_ROOT, '../api-copy/file.ts');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('PATH_OUTSIDE_REPOSITORY');
      }
    });

    it('should reject an empty file path', () => {
      const result = resolveFileInRepository(REPO_ROOT, '');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_PATH');
      }
    });
  });

  describe('resolveOutputFile', () => {
    it('should resolve an output filename inside the output directory', () => {
      const result = resolveOutputFile(OUTPUT_DIR, 'devguard-report.md');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(OUTPUT_DIR, 'devguard-report.md'));
      }
    });

    it('should resolve a nested output path inside the directory', () => {
      const result = resolveOutputFile(OUTPUT_DIR, 'reports/report.json');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(OUTPUT_DIR, 'reports/report.json'));
      }
    });

    it('should reject an output path escaping its directory', () => {
      const result = resolveOutputFile(OUTPUT_DIR, '../outside.md');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('OUTPUT_PATH_OUTSIDE_DIRECTORY');
      }
    });

    it('should reject an absolute output filename', () => {
      const result = resolveOutputFile(OUTPUT_DIR, '/tmp/report.md');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should reject an empty output filename', () => {
      const result = resolveOutputFile(OUTPUT_DIR, '');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_PATH');
      }
    });
  });

  describe('deterministic error codes', () => {
    it('should produce PATH_OUTSIDE_REPOSITORY for file escapes', () => {
      const result = resolveFileInRepository(REPO_ROOT, '../../escape');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('PATH_OUTSIDE_REPOSITORY');
      }
    });

    it('should produce OUTPUT_PATH_OUTSIDE_DIRECTORY for output escapes', () => {
      const result = resolveOutputFile(OUTPUT_DIR, '../../escape');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('OUTPUT_PATH_OUTSIDE_DIRECTORY');
      }
    });

    it('should produce ABSOLUTE_PATH_NOT_ALLOWED for absolute paths', () => {
      const result = resolveFileInRepository(REPO_ROOT, '/absolute/path');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
      }
    });

    it('should produce INVALID_PATH for empty paths', () => {
      const result = resolveFileInRepository(REPO_ROOT, '   ');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_PATH');
      }
    });
  });

  describe('symlink policy documentation', () => {
    it('should validate lexically without resolving symlinks', () => {
      // A path like "symlink-to-outside/secret.txt" would lexically appear
      // contained if the symlink name is inside the root. This is by design
      // for the configuration validation phase.
      //
      // The documented policy states that filesystem adapters MUST revalidate
      // real paths using fs.realpath before reading file contents.
      const result = resolveFileInRepository(REPO_ROOT, 'symlink-to-outside/secret.txt');
      expect(result.valid).toBe(true);
      if (result.valid) {
        // Lexically appears contained — filesystem revalidation is deferred
        expect(result.resolvedPath).toBe(path.join(REPO_ROOT, 'symlink-to-outside/secret.txt'));
      }
    });
  });
});

describe('resolveFileWithinRoot', () => {
  it('should resolve a relative path against its base directory inside the allowed root', () => {
    const result = resolveFileWithinRoot(REPO_ROOT, WORKSPACE, 'docs/requirements.md');

    expect(result).toEqual({
      valid: true,
      resolvedPath: path.join(REPO_ROOT, 'docs/requirements.md'),
    });
  });

  it('should accept an absolute path already inside the allowed root', () => {
    const absoluteFile = path.join(REPO_ROOT, 'requirements.md');
    const result = resolveFileWithinRoot(WORKSPACE, WORKSPACE, absoluteFile);

    expect(result).toEqual({ valid: true, resolvedPath: absoluteFile });
  });

  it('should reject traversal and sibling-prefix paths outside the allowed root', () => {
    const traversal = resolveFileWithinRoot(REPO_ROOT, REPO_ROOT, '../secret.md');
    const sibling = resolveFileWithinRoot(REPO_ROOT, REPO_ROOT, '../api-copy/requirements.md');

    expect(traversal).toMatchObject({
      valid: false,
      error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
    });
    expect(sibling).toMatchObject({
      valid: false,
      error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
    });
  });

  it('should reject empty and null-byte paths', () => {
    expect(resolveFileWithinRoot(REPO_ROOT, REPO_ROOT, '')).toMatchObject({
      valid: false,
      error: { code: 'INVALID_PATH' },
    });
    expect(resolveFileWithinRoot(REPO_ROOT, REPO_ROOT, 'bad\u0000path')).toMatchObject({
      valid: false,
      error: { code: 'INVALID_PATH' },
    });
  });
});

describe('isPathContainedInRoot', () => {
  it('should use a separator-aware boundary for equal, nested, and sibling paths', () => {
    expect(isPathContainedInRoot(REPO_ROOT, REPO_ROOT)).toBe(true);
    expect(isPathContainedInRoot(path.join(REPO_ROOT, 'docs/file.md'), REPO_ROOT)).toBe(true);
    expect(isPathContainedInRoot('/home/user/project/api-copy/file.md', REPO_ROOT)).toBe(false);
  });
});

async function withTemporaryOutputRoot(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-output-path-'));

  try {
    await callback(root);
  } finally {
    await fs.chmod(root, 0o700).catch(() => undefined);
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe('resolveRuntimeFileWithinRoot', () => {
  it('accepts a new target in an existing nested parent without creating directories', async () => {
    await withTemporaryOutputRoot(async (root) => {
      const nestedParent = path.join(root, 'reports', 'daily');
      await fs.mkdir(nestedParent, { recursive: true });

      const result = await resolveRuntimeFileWithinRoot(root, 'reports/daily/report.json');

      expect(result).toEqual({
        valid: true,
        resolvedPath: path.join(nestedParent, 'report.json'),
      });
      await expect(fs.access(path.join(nestedParent, 'report.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  it('rejects lexical escapes before filesystem access', async () => {
    await withTemporaryOutputRoot(async (root) => {
      const result = await resolveRuntimeFileWithinRoot(root, '../outside/report.json');

      expect(result).toMatchObject({
        valid: false,
        error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
      });
    });
  });

  it('rejects a missing or non-directory allowed root with safe deterministic errors', async () => {
    await withTemporaryOutputRoot(async (root) => {
      const rootFile = path.join(root, 'not-a-directory');
      await fs.writeFile(rootFile, 'file', 'utf8');

      await expect(
        resolveRuntimeFileWithinRoot(path.join(root, 'missing'), 'report.md'),
      ).resolves.toMatchObject({
        valid: false,
        error: { code: 'ALLOWED_ROOT_INVALID' },
      });
      await expect(resolveRuntimeFileWithinRoot(rootFile, 'report.md')).resolves.toMatchObject({
        valid: false,
        error: { code: 'ALLOWED_ROOT_INVALID' },
      });
    });
  });

  it('rejects a missing or non-directory target parent', async () => {
    await withTemporaryOutputRoot(async (root) => {
      const parentFile = path.join(root, 'parent-file');
      await fs.writeFile(parentFile, 'file', 'utf8');

      await expect(resolveRuntimeFileWithinRoot(root, 'missing/report.md')).resolves.toMatchObject({
        valid: false,
        error: { code: 'PARENT_DIRECTORY_INVALID' },
      });
      await expect(
        resolveRuntimeFileWithinRoot(root, 'parent-file/report.md'),
      ).resolves.toMatchObject({
        valid: false,
        error: { code: 'PARENT_DIRECTORY_INVALID' },
      });
    });
  });

  it('rejects a lexical in-root parent symlink that resolves outside the allowed root', async () => {
    await withTemporaryOutputRoot(async (root) => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-output-outside-'));
      await fs.symlink(outsideRoot, path.join(root, 'escaped-parent'));

      try {
        const result = await resolveRuntimeFileWithinRoot(root, 'escaped-parent/report.md');

        expect(result).toMatchObject({
          valid: false,
          error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
        });
        expect(JSON.stringify(result)).not.toContain(outsideRoot);
      } finally {
        await fs.rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });
});
