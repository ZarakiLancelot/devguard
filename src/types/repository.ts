export type RepositoryRole = 'frontend' | 'backend' | 'fullstack';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';

export interface ChangedFile {
  repositoryId: string;
  path: string;
  previousPath?: string;
  status: ChangeStatus;
  patch?: string;
  addedLines?: number;
  deletedLines?: number;
}

export interface RepositoryFile {
  repositoryId: string;
  path: string;
  absolutePath?: string;
  content: string;
  sizeBytes: number;
}

export interface RepositoryChangeSet {
  repositoryId: string;
  repositoryPath: string;
  role: RepositoryRole;
  baseRef: string;
  headRef: string;
  changedFiles: ChangedFile[];
}

export interface RepositoryContext {
  sourceType: 'local' | 'github';
  sourceLabel: string;
  repositories: RepositoryChangeSet[];
  files: RepositoryFile[];
  requirements?: string;
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface AnalysisInput {
  configPath: string;
  requirementsPath?: string;
  outputDirectory?: string;
}

export interface RepositorySource {
  loadContext(input: AnalysisInput): Promise<RepositoryContext>;
}
