import type { RepositoryFile } from '../types/repository.js';

export type AnalyzeRepositoryErrorCode =
  | 'ANALYSIS_INVARIANT_VIOLATION'
  | 'ANALYZER_EXECUTION_FAILED'
  | 'REPORT_BUILD_FAILED';

/** A safe fatal error owned by local analysis orchestration. */
export class AnalyzeRepositoryError extends Error {
  readonly code: AnalyzeRepositoryErrorCode;

  constructor(code: AnalyzeRepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalyzeRepositoryError';
    this.code = code;
  }
}

export interface RepositoryFileIndex {
  getRequired(repositoryId: string, path: string): RepositoryFile;
}

const DUPLICATE_FILE_MESSAGE = 'Repository file index contains a duplicate file identity.';
const MISSING_FILE_MESSAGE = 'A required repository file is unavailable for analysis.';

/**
 * Indexes repository files by their exact repository ID and exact path. It does
 * not normalize, copy, or mutate caller-owned file records.
 */
export function createRepositoryFileIndex(files: readonly RepositoryFile[]): RepositoryFileIndex {
  const filesByRepository = new Map<string, Map<string, RepositoryFile>>();

  for (const file of files) {
    let filesByPath = filesByRepository.get(file.repositoryId);
    if (filesByPath === undefined) {
      filesByPath = new Map<string, RepositoryFile>();
      filesByRepository.set(file.repositoryId, filesByPath);
    }

    if (filesByPath.has(file.path)) {
      throw new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', DUPLICATE_FILE_MESSAGE);
    }

    filesByPath.set(file.path, file);
  }

  return {
    getRequired(repositoryId: string, path: string): RepositoryFile {
      const file = filesByRepository.get(repositoryId)?.get(path);
      if (file === undefined) {
        throw new AnalyzeRepositoryError('ANALYSIS_INVARIANT_VIOLATION', MISSING_FILE_MESSAGE);
      }

      return file;
    },
  };
}
