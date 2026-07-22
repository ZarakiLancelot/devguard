import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  resolveRepositoryPath,
  resolveFileInRepository,
  resolveOutputFile,
} from './path-security.js';

const WORKSPACE = '/home/user/project';
const REPO_ROOT = '/home/user/project/api';
const OUTPUT_DIR = '/home/user/project/.devguard';

describe('path-security', () => {
  describe('resolveRepositoryPath', () => {
    it('should resolve a relative repository path from workspace', () => {
      const result = resolveRepositoryPath(WORKSPACE, '../customer-store-api');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.resolve(WORKSPACE, '../customer-store-api'));
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
