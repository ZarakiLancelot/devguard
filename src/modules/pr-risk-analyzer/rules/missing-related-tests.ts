import { generateFindingId, generateRootCauseId } from '../../../shared/ids.js';
import type { AnalysisFinding, FindingEvidence } from '../../../types/findings.js';
import type { ChangedFile, ChangeStatus } from '../../../types/repository.js';

const RULE_ID = 'risk.missing-related-tests';
const ROOT_CAUSE_DISCRIMINATOR = 'missing-related-tests';
const HEURISTIC_ID = 'related-test-filename-v1';

/**
 * Input for pure missing-related-test detection from an in-memory changed-file set.
 */
export interface MissingRelatedTestsInput {
  changedFiles: readonly ChangedFile[];
}

interface ProductionFileCandidate {
  changedFile: ChangedFile;
  file: string;
  candidateTestPaths: string[];
}

/**
 * Detects eligible changed TypeScript production files with no exact related
 * changed test in the same repository. It does not inspect the filesystem,
 * source contents, patches, Git, configuration, or test frameworks.
 */
export function detectMissingRelatedTests(input: MissingRelatedTestsInput): AnalysisFinding[] {
  if (input.changedFiles.length === 0) {
    return [];
  }

  const changedTests = createChangedTestSet(input.changedFiles);
  const candidates = input.changedFiles.flatMap((changedFile) => {
    const file = normalizeRepositoryRelativePath(changedFile.path);
    if (!isEligibleProductionFile(changedFile, file)) {
      return [];
    }

    const candidateTestPaths = createCandidateTestPaths(file);
    const hasRelatedChangedTest = candidateTestPaths.some((candidatePath) =>
      changedTests.has(createRepositoryPathKey(changedFile.repositoryId, candidatePath)),
    );

    return hasRelatedChangedTest ? [] : [{ changedFile, file, candidateTestPaths }];
  });

  const orderedCandidates = [...candidates].sort(compareProductionCandidates);
  const seenProductionFiles = new Set<string>();
  const findings: AnalysisFinding[] = [];

  for (const candidate of orderedCandidates) {
    const identity = createRepositoryPathKey(candidate.changedFile.repositoryId, candidate.file);
    if (seenProductionFiles.has(identity)) {
      continue;
    }

    seenProductionFiles.add(identity);
    findings.push(createMissingRelatedTestFinding(candidate));
  }

  return findings;
}

/**
 * Builds a set of trusted changed test paths, isolated by repository.
 */
function createChangedTestSet(changedFiles: readonly ChangedFile[]): Set<string> {
  const changedTests = new Set<string>();

  for (const changedFile of changedFiles) {
    const file = normalizeRepositoryRelativePath(changedFile.path);
    if (isTrustedChangedTest(changedFile, file)) {
      changedTests.add(createRepositoryPathKey(changedFile.repositoryId, file));
    }
  }

  return changedTests;
}

/**
 * Limits production candidates to supported TypeScript files and statuses.
 */
function isEligibleProductionFile(changedFile: ChangedFile, file: string): boolean {
  return (
    isEligibleProductionStatus(changedFile.status) &&
    !isAbsolutePath(file) &&
    isTypeScriptSourceFile(file) &&
    !isTestFile(file) &&
    !isDeclarationFile(file) &&
    !isInsideTestsDirectory(file) &&
    !isConfigurationFile(file)
  );
}

/**
 * Limits suppressing tests to trusted changed test statuses.
 */
function isTrustedChangedTest(changedFile: ChangedFile, file: string): boolean {
  return isTrustedTestStatus(changedFile.status) && !isAbsolutePath(file) && isTestFile(file);
}

/**
 * Treats added, modified, and renamed files as production changes to review.
 */
function isEligibleProductionStatus(status: ChangeStatus): boolean {
  return status === 'added' || status === 'modified' || status === 'renamed';
}

/**
 * Trusts only changed tests that remain available in the new change set.
 */
function isTrustedTestStatus(status: ChangeStatus): boolean {
  return status === 'added' || status === 'modified' || status === 'renamed';
}

/**
 * Recognizes exactly the TypeScript and TSX production extensions in scope.
 */
function isTypeScriptSourceFile(file: string): boolean {
  return file.endsWith('.ts') || file.endsWith('.tsx');
}

/**
 * Recognizes only the exact test filename suffixes supported by this heuristic.
 */
function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.(?:ts|tsx)$/u.test(file);
}

/**
 * Excludes declaration files from production-file analysis.
 */
function isDeclarationFile(file: string): boolean {
  return file.endsWith('.d.ts');
}

/**
 * Excludes source files located under any __tests__ path segment.
 */
function isInsideTestsDirectory(file: string): boolean {
  return file.split('/').includes('__tests__');
}

/**
 * Excludes only the configured filename form for TypeScript configuration files.
 */
function isConfigurationFile(file: string): boolean {
  return file.endsWith('.config.ts') || file.endsWith('.config.tsx');
}

/**
 * Generates the four exact test paths for a TypeScript or TSX source file.
 */
function createCandidateTestPaths(file: string): string[] {
  const extension = file.endsWith('.tsx') ? '.tsx' : '.ts';
  const sourceWithoutExtension = file.slice(0, -extension.length);
  const lastSeparator = sourceWithoutExtension.lastIndexOf('/');
  const directory = lastSeparator === -1 ? '' : sourceWithoutExtension.slice(0, lastSeparator);
  const basename = sourceWithoutExtension.slice(lastSeparator + 1);
  const directoryPrefix = directory === '' ? '' : `${directory}/`;

  return [
    `${directoryPrefix}${basename}.test${extension}`,
    `${directoryPrefix}${basename}.spec${extension}`,
    `${directoryPrefix}__tests__/${basename}.test${extension}`,
    `${directoryPrefix}__tests__/${basename}.spec${extension}`,
  ];
}

/**
 * Converts Windows separators and leading current-directory notation without filesystem access.
 */
function normalizeRepositoryRelativePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
}

/**
 * Rejects absolute paths so repository-relative findings cannot expose local paths.
 */
function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//u.test(filePath);
}

/**
 * Creates a stable repository-and-path identity for deduplication and test lookup.
 */
function createRepositoryPathKey(repositoryId: string, file: string): string {
  return `${repositoryId}\x00${file}`;
}

/**
 * Sorts duplicate production entries deterministically before selecting one.
 */
function compareProductionCandidates(
  left: ProductionFileCandidate,
  right: ProductionFileCandidate,
): number {
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

  return compareText(left.changedFile.status, right.changedFile.status);
}

/**
 * Uses an explicit lexical comparison to make ordering independent of input order.
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
 * Creates one warning finding using only changed-file metadata and candidate paths.
 */
function createMissingRelatedTestFinding(candidate: ProductionFileCandidate): AnalysisFinding {
  const { changedFile, file, candidateTestPaths } = candidate;

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
    severity: 'warning',
    title: `Missing related changed test: ${file}`,
    description: `No related changed test was found for production file "${file}" using the deterministic filename heuristic.`,
    location: {
      repositoryId: changedFile.repositoryId,
      file,
    },
    evidence: createEvidence(changedFile, file, candidateTestPaths),
    recommendation:
      'Review whether this change should include an update to one of the checked related test paths.',
    metadata: {
      productionFile: file,
      changeStatus: changedFile.status,
      candidateTestPaths,
      heuristic: HEURISTIC_ID,
    },
  };
}

/**
 * Builds safe deterministic evidence from current changed-file metadata only.
 */
function createEvidence(
  changedFile: ChangedFile,
  file: string,
  candidateTestPaths: string[],
): FindingEvidence {
  return {
    expected: 'at least one related changed test path in the current changed-file set',
    actual: 'no related changed test path was present in the current changed-file set',
    details: {
      repositoryId: changedFile.repositoryId,
      productionFile: file,
      productionChangeStatus: changedFile.status,
      candidateTestPaths,
      heuristic: HEURISTIC_ID,
    },
  };
}
