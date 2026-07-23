import { describe, expect, it, vi } from 'vitest';
import { AnalyzeRepositoryError, createRepositoryFileIndex } from './repository-file-index.js';
import type { RepositoryFile } from '../types/repository.js';

function createFile(overrides: Partial<RepositoryFile> = {}): RepositoryFile {
  return {
    repositoryId: 'frontend',
    path: 'src/types/book.ts',
    content: 'export interface Book {}',
    sizeBytes: 24,
    ...overrides,
  };
}

function expectInvariantError(action: () => unknown): AnalyzeRepositoryError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AnalyzeRepositoryError);
    const applicationError = error as AnalyzeRepositoryError;
    expect(applicationError.code).toBe('ANALYSIS_INVARIANT_VIOLATION');
    return applicationError;
  }

  throw new Error('Expected an application invariant error');
}

describe('createRepositoryFileIndex', () => {
  it('looks up exact repository ID and path pairs and preserves original object identity', () => {
    const frontendFile = createFile();
    const backendFile = createFile({ repositoryId: 'backend' });
    const index = createRepositoryFileIndex([frontendFile, backendFile]);

    expect(index.getRequired('frontend', 'src/types/book.ts')).toBe(frontendFile);
    expect(index.getRequired('backend', 'src/types/book.ts')).toBe(backendFile);
  });

  it('preserves unusual Unicode, whitespace, quotes, slash forms, case, and path text exactly', () => {
    const unusual = createFile({
      repositoryId: 'fronténd ��',
      path: ' src/Ω/quote"/back\\slash.ts ',
    });
    const index = createRepositoryFileIndex([unusual]);

    expect(index.getRequired('fronténd ��', ' src/Ω/quote"/back\\slash.ts ')).toBe(unusual);
    expectInvariantError(() => index.getRequired('fronténd ��', 'src/Ω/quote"/back/slash.ts'));
    expectInvariantError(() => index.getRequired('FRONTÉND ��', unusual.path));
  });

  it('rejects duplicate exact identities without exposing identifiers or paths', () => {
    const duplicate = createFile({ repositoryId: 'private-repository', path: 'secret path.ts' });
    const error = expectInvariantError(() =>
      createRepositoryFileIndex([duplicate, { ...duplicate }]),
    );

    expect(error.message).not.toContain('private-repository');
    expect(error.message).not.toContain('secret path.ts');
  });

  it('rejects missing exact identities without exposing identifiers or paths', () => {
    const index = createRepositoryFileIndex([createFile()]);
    const error = expectInvariantError(() =>
      index.getRequired('private-repository', 'secret path.ts'),
    );

    expect(error.message).not.toContain('private-repository');
    expect(error.message).not.toContain('secret path.ts');
  });

  it('does not mutate input files and does not log', () => {
    const files = [createFile({ path: 'src\\types\\book.ts' })];
    const before = structuredClone(files);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
      const index = createRepositoryFileIndex(files);
      index.getRequired('frontend', 'src\\types\\book.ts');

      expect(files).toEqual(before);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
