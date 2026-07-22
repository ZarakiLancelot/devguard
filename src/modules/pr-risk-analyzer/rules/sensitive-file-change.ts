import { minimatch } from 'minimatch';
import { generateFindingId, generateRootCauseId } from '../../../shared/ids.js';
import type { AnalysisFinding, FindingEvidence } from '../../../types/findings.js';
import type { ChangedFile } from '../../../types/repository.js';

const RULE_ID = 'risk.sensitive-file-change';
const ROOT_CAUSE_DISCRIMINATOR = 'sensitive-file-change';

const MATCH_OPTIONS = {
  nocase: false,
  dot: true,
  matchBase: false,
  nocomment: true,
  nonegate: true,
  noglobstar: false,
} as const;

/**
 * Input for pure sensitive-file detection against configured glob patterns.
 */
export interface SensitiveFileChangeInput {
  changedFiles: readonly ChangedFile[];
  sensitivePatterns: readonly string[];
}

interface SensitiveFileMatch {
  changedFile: ChangedFile;
  file: string;
  pattern: string;
}

/**
 * Detects changed repository-relative paths that match configured sensitive-file
 * patterns. It does not read files, inspect patches, access Git, or mutate input.
 */
export function detectSensitiveFileChanges(input: SensitiveFileChangeInput): AnalysisFinding[] {
  if (input.changedFiles.length === 0 || input.sensitivePatterns.length === 0) {
    return [];
  }

  const matches = input.changedFiles.flatMap((changedFile) => {
    const file = normalizeRepositoryRelativePath(changedFile.path);
    if (isAbsolutePath(file)) {
      return [];
    }

    const pattern = input.sensitivePatterns.find((candidate) =>
      minimatch(file, candidate, MATCH_OPTIONS),
    );

    return pattern === undefined ? [] : [{ changedFile, file, pattern }];
  });

  const orderedMatches = [...matches].sort(compareMatches);
  const seenFiles = new Set<string>();
  const findings: AnalysisFinding[] = [];

  for (const match of orderedMatches) {
    const identity = `${match.changedFile.repositoryId}\x00${match.file}`;
    if (seenFiles.has(identity)) {
      continue;
    }

    seenFiles.add(identity);
    findings.push(createSensitiveFileFinding(match));
  }

  return findings;
}

/**
 * Converts Windows separators and leading current-directory notation to a
 * normalized repository-relative path without accessing the filesystem.
 */
function normalizeRepositoryRelativePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
}

/**
 * Rejects absolute paths so they cannot enter findings intended for repository-relative paths.
 */
function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//u.test(filePath);
}

/**
 * Sorts matches independently of ChangedFile input order before deduplication.
 */
function compareMatches(left: SensitiveFileMatch, right: SensitiveFileMatch): number {
  const repositoryOrder = compareText(
    left.changedFile.repositoryId,
    right.changedFile.repositoryId,
  );
  if (repositoryOrder !== 0) {
    return repositoryOrder;
  }

  const fileOrder = compareText(left.file, right.file);
  if (fileOrder !== 0) {
    return fileOrder;
  }

  const patternOrder = compareText(left.pattern, right.pattern);
  if (patternOrder !== 0) {
    return patternOrder;
  }

  return compareText(left.changedFile.status, right.changedFile.status);
}

/**
 * Uses an explicit lexical comparison to keep cross-platform ordering stable.
 */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/**
 * Creates one actionable finding without exposing source, patch, or absolute paths.
 */
function createSensitiveFileFinding(match: SensitiveFileMatch): AnalysisFinding {
  const { changedFile, file, pattern } = match;

  return {
    id: generateFindingId({
      ruleId: RULE_ID,
      repositoryId: changedFile.repositoryId,
      file,
      subject: file,
    }),
    rootCauseId: generateRootCauseId({
      repositoryId: changedFile.repositoryId,
      file,
      subject: file,
      discriminator: ROOT_CAUSE_DISCRIMINATOR,
    }),
    ruleId: RULE_ID,
    source: 'pr-risk-analyzer',
    category: 'risk',
    severity: 'high',
    title: `Sensitive file change: ${file}`,
    description: `The changed path "${file}" matches configured sensitive-file pattern "${pattern}" and requires elevated review.`,
    location: {
      repositoryId: changedFile.repositoryId,
      file,
    },
    evidence: createEvidence(changedFile, file, pattern),
    recommendation: `Review the change to "${file}" carefully before merging because its path matches configured sensitive-file pattern "${pattern}".`,
    metadata: {
      matchingPattern: pattern,
      changeStatus: changedFile.status,
    },
  };
}

/**
 * Builds safe deterministic evidence from metadata only.
 */
function createEvidence(changedFile: ChangedFile, file: string, pattern: string): FindingEvidence {
  return {
    expected: 'a changed path outside configured sensitive-file patterns',
    actual: `changed path "${file}" matches configured sensitive-file pattern "${pattern}"`,
    details: {
      matchingPattern: pattern,
      changeStatus: changedFile.status,
    },
  };
}
