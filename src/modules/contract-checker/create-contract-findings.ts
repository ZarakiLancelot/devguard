import type {
  ContractComparisonResult,
  ContractDifference,
  ContractDifferenceKind,
} from './compare-contracts.js';
import type { NormalizedProperty } from './shared/normalized-contract.js';
import { generateFindingId, generateRootCauseId } from '../../shared/ids.js';
import type { AnalysisFinding, FindingEvidence, Severity } from '../../types/findings.js';

/**
 * Repository metadata required to locate generated contract findings.
 */
export interface ContractFindingRepositoryMetadata {
  repositoryId: string;
}

/**
 * TypeScript file metadata required to locate generated contract findings.
 */
export interface ContractFindingFileMetadata {
  path: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Input for deterministic contract finding generation.
 */
export interface ContractFindingInput {
  comparison: ContractComparisonResult;
  repository: ContractFindingRepositoryMetadata;
  typescriptFile: ContractFindingFileMetadata;
  mappingName: string;
}

interface FindingRuleDefinition {
  ruleId: string;
  severity: Severity;
}

const RULE_DEFINITIONS: Readonly<Record<ContractDifferenceKind, FindingRuleDefinition>> = {
  'missing-property': {
    ruleId: 'contract.missing-property',
    severity: 'high',
  },
  'incompatible-type': {
    ruleId: 'contract.incompatible-type',
    severity: 'critical',
  },
  'required-mismatch': {
    ruleId: 'contract.required-mismatch',
    severity: 'high',
  },
};

/**
 * Creates deterministic contract AnalysisFinding values in the same order as
 * the already ordered comparison differences.
 */
export function createContractFindings(input: ContractFindingInput): AnalysisFinding[] {
  return input.comparison.differences.map((difference) => createContractFinding(difference, input));
}

/**
 * Creates one deterministic contract finding for a comparison difference.
 */
function createContractFinding(
  difference: ContractDifference,
  input: ContractFindingInput,
): AnalysisFinding {
  const rule = RULE_DEFINITIONS[difference.kind];
  const location = {
    repositoryId: input.repository.repositoryId,
    file: input.typescriptFile.path,
    ...(input.typescriptFile.startLine === undefined
      ? {}
      : { startLine: input.typescriptFile.startLine }),
    ...(input.typescriptFile.endLine === undefined
      ? {}
      : { endLine: input.typescriptFile.endLine }),
  };

  return {
    id: generateFindingId({
      ruleId: rule.ruleId,
      repositoryId: input.repository.repositoryId,
      file: input.typescriptFile.path,
      subject: difference.property,
      discriminator: input.mappingName,
    }),
    rootCauseId: generateRootCauseId({
      repositoryId: input.repository.repositoryId,
      file: input.typescriptFile.path,
      mappingName: input.mappingName,
      subject: difference.property,
    }),
    ruleId: rule.ruleId,
    source: 'contract-checker',
    category: 'contract',
    severity: rule.severity,
    title: createTitle(difference),
    description: createDescription(difference, input.comparison),
    location,
    evidence: createEvidence(difference),
    recommendation: createRecommendation(difference, input.comparison.typescriptContract),
    metadata: {
      contractMappingName: input.mappingName,
      property: difference.property,
      openapiContract: input.comparison.openapiContract,
      typescriptContract: input.comparison.typescriptContract,
    },
  };
}

/**
 * Creates a concise deterministic title for each difference kind.
 */
function createTitle(difference: ContractDifference): string {
  switch (difference.kind) {
    case 'missing-property':
      return `Missing TypeScript property: ${difference.property}`;
    case 'incompatible-type':
      return `Incompatible property type: ${difference.property}`;
    case 'required-mismatch':
      return `Required property mismatch: ${difference.property}`;
  }
}

/**
 * Creates an actionable deterministic description without source content.
 */
function createDescription(
  difference: ContractDifference,
  comparison: ContractComparisonResult,
): string {
  switch (difference.kind) {
    case 'missing-property':
      return `OpenAPI contract "${comparison.openapiContract}" defines "${difference.property}", but TypeScript contract "${comparison.typescriptContract}" does not.`;
    case 'incompatible-type':
      return `Property "${difference.property}" has incompatible shapes between OpenAPI contract "${comparison.openapiContract}" and TypeScript contract "${comparison.typescriptContract}".`;
    case 'required-mismatch':
      return `Property "${difference.property}" has different required status in OpenAPI contract "${comparison.openapiContract}" and TypeScript contract "${comparison.typescriptContract}".`;
  }
}

/**
 * Creates deterministic expected-versus-actual evidence for each rule.
 */
function createEvidence(difference: ContractDifference): FindingEvidence {
  const openapi = difference.openapi;
  const typescript = difference.typescript;

  switch (difference.kind) {
    case 'missing-property':
      return {
        expected: formatProperty(openapi),
        actual: 'absent from TypeScript payload',
        details: {
          property: difference.property,
          openapi: propertyDetails(openapi),
          typescript: 'absent',
        },
      };
    case 'incompatible-type':
      return {
        expected: formatProperty(openapi),
        actual: formatProperty(typescript),
        details: {
          property: difference.property,
          openapi: propertyDetails(openapi),
          typescript: propertyDetails(typescript),
        },
      };
    case 'required-mismatch':
      return {
        expected: openapi?.required ? 'required by OpenAPI' : 'optional in OpenAPI',
        actual: typescript?.required ? 'required in TypeScript' : 'optional in TypeScript',
        details: {
          property: difference.property,
          openapiRequired: openapi?.required ?? null,
          typescriptRequired: typescript?.required ?? null,
        },
      };
  }
}

/**
 * Creates deterministic recommendation text for each rule.
 */
function createRecommendation(difference: ContractDifference, typescriptContract: string): string {
  switch (difference.kind) {
    case 'missing-property':
      return `Add property "${difference.property}" to TypeScript payload "${typescriptContract}" to match OpenAPI.`;
    case 'incompatible-type':
      return `Align TypeScript property "${difference.property}" type and array shape with OpenAPI.`;
    case 'required-mismatch':
      return `Align TypeScript property "${difference.property}" optionality with the backend OpenAPI contract.`;
  }
}

/**
 * Formats a normalized property without including raw source content.
 */
function formatProperty(property: NormalizedProperty | undefined): string {
  if (!property) {
    return 'unavailable';
  }

  const type = property.isArray ? `${property.type}[]` : property.type;
  return `${property.name}: ${type} (${property.required ? 'required' : 'optional'})`;
}

/**
 * Returns structured normalized values for evidence details.
 */
function propertyDetails(property: NormalizedProperty | undefined): Record<string, unknown> | null {
  if (!property) {
    return null;
  }

  return {
    name: property.name,
    type: property.type,
    isArray: property.isArray,
    required: property.required,
  };
}
