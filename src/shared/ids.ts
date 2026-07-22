import { createHash } from 'node:crypto';

/**
 * Input components for generating a stable finding ID.
 * Identical inputs always produce the same ID.
 */
export interface FindingIdInput {
  ruleId: string;
  repositoryId: string;
  file?: string;
  subject?: string;
  discriminator?: string;
}

/**
 * Input components for generating a stable root-cause ID.
 * Deliberately excludes ruleId so that related findings with
 * different rules can share the same root cause.
 */
export interface RootCauseIdInput {
  repositoryId: string;
  file?: string;
  mappingName?: string;
  subject?: string;
  discriminator?: string;
}

/**
 * Input components for generating a stable analysis ID.
 * Identical inputs always produce the same ID.
 */
export interface AnalysisIdInput {
  configPath: string;
  repositories: Array<{
    repositoryId: string;
    baseRef: string;
    headRef: string;
  }>;
}

const SEPARATOR = '\x00';

/**
 * Normalizes file paths to use forward slashes for cross-platform determinism.
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Produces a truncated SHA-256 hex hash from a payload string.
 */
function hashPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Generates a deterministic finding ID from structured input.
 *
 * The ID is a prefixed truncated SHA-256 hex hash derived from the concatenation of:
 * - ruleId
 * - repositoryId
 * - file (normalized, if provided)
 * - subject (property name or logical subject, if provided)
 * - discriminator (additional stable value, if provided)
 *
 * Identical inputs always produce identical IDs.
 * Changing any component produces a different ID.
 *
 * @returns `finding-<16 lowercase hex characters>`
 */
export function generateFindingId(input: FindingIdInput): string {
  const parts = [
    input.ruleId,
    input.repositoryId,
    input.file ? normalizePath(input.file) : '',
    input.subject ?? '',
    input.discriminator ?? '',
  ];

  const payload = parts.join(SEPARATOR);
  return `finding-${hashPayload(payload)}`;
}

/**
 * Generates a deterministic root-cause ID from structured input.
 *
 * Deliberately excludes ruleId so that related findings with different
 * rule IDs (e.g., contract.missing-property and contract.required-mismatch)
 * can share the same root-cause ID when they originate from the same
 * repository, file, mapping, and subject.
 *
 * @returns `root-<16 lowercase hex characters>`
 */
export function generateRootCauseId(input: RootCauseIdInput): string {
  const parts = [
    input.repositoryId,
    input.file ? normalizePath(input.file) : '',
    input.mappingName ?? '',
    input.subject ?? '',
    input.discriminator ?? '',
  ];

  const payload = parts.join(SEPARATOR);
  return `root-${hashPayload(payload)}`;
}

/**
 * Generates a deterministic analysis ID from structured input.
 *
 * The ID is derived from the configuration path and the set of repository
 * references being analyzed. This ensures the same analysis configuration
 * and repository state produces the same analysis ID.
 *
 * @returns `analysis-<16 lowercase hex characters>`
 */
export function generateAnalysisId(input: AnalysisIdInput): string {
  const repoParts = input.repositories
    .map((r) => `${r.repositoryId}:${r.baseRef}:${r.headRef}`)
    .sort()
    .join(SEPARATOR);

  const payload = [input.configPath, repoParts].join(SEPARATOR);
  return `analysis-${hashPayload(payload)}`;
}
