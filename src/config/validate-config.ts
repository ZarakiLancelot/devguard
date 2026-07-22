import type { DevGuardConfig } from './config-schema.js';

export interface ConfigValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ConfigValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: ConfigValidationIssue[] };

const MAX_REPOSITORIES = 2;

/**
 * Validates relational rules on an already structurally parsed DevGuardConfig.
 * Does not check filesystem paths or repository existence on disk.
 */
export function validateConfig(config: DevGuardConfig): ConfigValidationResult {
  const issues: ConfigValidationIssue[] = [];
  const repositoryIds = Object.keys(config.repositories);

  validateRepositoryCount(repositoryIds, issues);
  validateRepositoryRoleCombinations(config, repositoryIds, issues);
  validateOpenapiRepositoryReference(config, repositoryIds, issues);
  validateContractRepositoryReferences(config, repositoryIds, issues);
  validateUniqueContractNames(config, issues);

  if (issues.length === 0) {
    return { valid: true, issues: [] as const };
  }

  return { valid: false, issues };
}

function validateRepositoryCount(repositoryIds: string[], issues: ConfigValidationIssue[]): void {
  if (repositoryIds.length > MAX_REPOSITORIES) {
    issues.push({
      code: 'MAX_REPOSITORIES_EXCEEDED',
      path: 'repositories',
      message: `At most ${MAX_REPOSITORIES} repositories may be configured, found ${repositoryIds.length}`,
    });
  }
}

function validateRepositoryRoleCombinations(
  config: DevGuardConfig,
  repositoryIds: string[],
  issues: ConfigValidationIssue[],
): void {
  const roles = repositoryIds.map((id) => {
    const repo = config.repositories[id];
    return repo ? repo.role : 'fullstack';
  });

  const frontendCount = roles.filter((r) => r === 'frontend').length;
  const backendCount = roles.filter((r) => r === 'backend').length;
  const fullstackCount = roles.filter((r) => r === 'fullstack').length;

  if (fullstackCount > 0 && repositoryIds.length > 1) {
    issues.push({
      code: 'INVALID_ROLE_COMBINATION',
      path: 'repositories',
      message: 'A fullstack repository cannot be combined with other repositories',
    });
    return;
  }

  if (frontendCount > 1) {
    issues.push({
      code: 'INVALID_ROLE_COMBINATION',
      path: 'repositories',
      message: 'At most one frontend repository is allowed',
    });
  }

  if (backendCount > 1) {
    issues.push({
      code: 'INVALID_ROLE_COMBINATION',
      path: 'repositories',
      message: 'At most one backend repository is allowed',
    });
  }
}

function validateOpenapiRepositoryReference(
  config: DevGuardConfig,
  repositoryIds: string[],
  issues: ConfigValidationIssue[],
): void {
  if (!repositoryIds.includes(config.openapi.repository)) {
    issues.push({
      code: 'OPENAPI_REPOSITORY_NOT_FOUND',
      path: 'openapi.repository',
      message: `OpenAPI repository "${config.openapi.repository}" does not reference a configured repository. Available: ${repositoryIds.join(', ')}`,
    });
  }
}

function validateContractRepositoryReferences(
  config: DevGuardConfig,
  repositoryIds: string[],
  issues: ConfigValidationIssue[],
): void {
  for (let i = 0; i < config.contracts.length; i++) {
    const contract = config.contracts[i];
    if (!contract) continue;
    const tsRepo = contract.typescript.repository;

    if (!repositoryIds.includes(tsRepo)) {
      issues.push({
        code: 'CONTRACT_REPOSITORY_NOT_FOUND',
        path: `contracts[${i}].typescript.repository`,
        message: `Contract "${contract.name}" references repository "${tsRepo}" which is not configured. Available: ${repositoryIds.join(', ')}`,
      });
    }
  }
}

function validateUniqueContractNames(
  config: DevGuardConfig,
  issues: ConfigValidationIssue[],
): void {
  const seen = new Set<string>();

  for (let i = 0; i < config.contracts.length; i++) {
    const contract = config.contracts[i];
    if (!contract) continue;
    const name = contract.name;

    if (seen.has(name)) {
      issues.push({
        code: 'DUPLICATE_CONTRACT_NAME',
        path: `contracts[${i}].name`,
        message: `Duplicate contract name "${name}"`,
      });
    }

    seen.add(name);
  }
}
