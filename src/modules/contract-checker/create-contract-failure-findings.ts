import { generateFindingId, generateRootCauseId } from '../../shared/ids.js';
import type {
  AnalysisFinding,
  FindingEvidence,
  Severity,
  SourceLocation,
} from '../../types/findings.js';

/**
 * Approved recoverable failures that occur before a normalized contract
 * comparison result can be created.
 */
export type ContractFailureInput =
  | {
      kind: 'schema-not-found';
      repositoryId: string;
      mappingName: string;
      schemaName: string;
      file?: string;
    }
  | {
      kind: 'typescript-type-not-found';
      repositoryId: string;
      mappingName: string;
      declarationName: string;
      file?: string;
    }
  | {
      kind: 'unsupported-type';
      repositoryId: string;
      mappingName: string;
      declarationName?: string;
      property?: string;
      unsupportedType?: string;
      /** Source contract in which the unsupported construct was observed. */
      sourceType?: 'openapi' | 'typescript';
      /** Stable warning code used when no specific unsupported type text is available. */
      warningCode?: string;
      file?: string;
      line?: number;
    };

interface ContractFailureRuleDefinition {
  ruleId: string;
  severity: Severity;
}

const RULE_DEFINITIONS: Readonly<
  Record<ContractFailureInput['kind'], ContractFailureRuleDefinition>
> = {
  'schema-not-found': {
    ruleId: 'contract.schema-not-found',
    severity: 'high',
  },
  'typescript-type-not-found': {
    ruleId: 'contract.typescript-type-not-found',
    severity: 'high',
  },
  'unsupported-type': {
    ruleId: 'contract.unsupported-type',
    severity: 'warning',
  },
};

/**
 * Converts one approved pre-comparison contract failure into a deterministic
 * public finding. It does not parse, load, or compare contract sources.
 */
export function createContractFailureFinding(input: ContractFailureInput): AnalysisFinding {
  const rule = RULE_DEFINITIONS[input.kind];
  const identity = getFailureIdentity(input);
  const location = createLocation(input);

  return {
    id: generateFindingId({
      ruleId: rule.ruleId,
      repositoryId: input.repositoryId,
      ...(input.file === undefined ? {} : { file: input.file }),
      subject: identity,
      discriminator: input.mappingName,
    }),
    rootCauseId: generateRootCauseId({
      repositoryId: input.repositoryId,
      ...(input.file === undefined ? {} : { file: input.file }),
      mappingName: input.mappingName,
      subject: identity,
      discriminator: input.kind,
    }),
    ruleId: rule.ruleId,
    source: 'contract-checker',
    category: 'contract',
    severity: rule.severity,
    title: createTitle(input),
    description: createDescription(input),
    ...(location === undefined ? {} : { location }),
    evidence: createEvidence(input),
    recommendation: createRecommendation(input),
    metadata: createMetadata(input),
  };
}

/**
 * Returns the stable logical target of a failure without source content.
 */
function getFailureSubject(input: ContractFailureInput): string {
  switch (input.kind) {
    case 'schema-not-found':
      return input.schemaName;
    case 'typescript-type-not-found':
      return input.declarationName;
    case 'unsupported-type':
      if (input.declarationName !== undefined && input.property !== undefined) {
        return `${input.declarationName}.${input.property}`;
      }

      return (
        input.declarationName ??
        input.property ??
        input.unsupportedType ??
        'unsupported-contract-type'
      );
  }
}

/**
 * Returns the identity components used by stable IDs and root causes.
 */
function getFailureIdentity(input: ContractFailureInput): string {
  switch (input.kind) {
    case 'schema-not-found':
      return input.schemaName;
    case 'typescript-type-not-found':
      return input.declarationName;
    case 'unsupported-type':
      return [
        getFailureSubject(input),
        getUnsupportedSourceType(input),
        input.unsupportedType ?? input.warningCode ?? 'unsupported-contract-type',
      ].join('\x00');
  }
}

/**
 * Defaults unsupported conditions to TypeScript for backward-compatible Task 5.3 inputs.
 */
function getUnsupportedSourceType(
  input: Extract<ContractFailureInput, { kind: 'unsupported-type' }>,
): 'openapi' | 'typescript' {
  return input.sourceType ?? 'typescript';
}

/**
 * Creates a source location only when a configured source file is available.
 */
function createLocation(input: ContractFailureInput): SourceLocation | undefined {
  if (input.file === undefined) {
    return undefined;
  }

  return {
    repositoryId: input.repositoryId,
    file: input.file,
    ...(input.kind !== 'unsupported-type' || input.line === undefined
      ? {}
      : { startLine: input.line }),
  };
}

/**
 * Creates a concise deterministic failure title.
 */
function createTitle(input: ContractFailureInput): string {
  switch (input.kind) {
    case 'schema-not-found':
      return `OpenAPI schema not found: ${input.schemaName}`;
    case 'typescript-type-not-found':
      return `TypeScript declaration not found: ${input.declarationName}`;
    case 'unsupported-type':
      return `Unsupported contract type: ${getFailureSubject(input)}`;
  }
}

/**
 * Explains the failed configured target without reading or exposing source.
 */
function createDescription(input: ContractFailureInput): string {
  switch (input.kind) {
    case 'schema-not-found':
      return `Contract mapping "${input.mappingName}" could not find the configured OpenAPI schema "${input.schemaName}".`;
    case 'typescript-type-not-found':
      return `Contract mapping "${input.mappingName}" could not find the configured TypeScript declaration "${input.declarationName}".`;
    case 'unsupported-type':
      return `Contract mapping "${input.mappingName}" contains an unsupported ${getUnsupportedSourceType(input) === 'openapi' ? 'OpenAPI' : 'TypeScript'} contract type at "${getFailureSubject(input)}".`;
  }
}

/**
 * Creates safe structured evidence for an approved failure kind.
 */
function createEvidence(input: ContractFailureInput): FindingEvidence {
  switch (input.kind) {
    case 'schema-not-found':
      return {
        expected: `configured OpenAPI schema "${input.schemaName}"`,
        actual: 'schema not found',
        details: {
          mappingName: input.mappingName,
          schemaName: input.schemaName,
          sourceType: 'openapi',
        },
      };
    case 'typescript-type-not-found':
      return {
        expected: `configured TypeScript declaration "${input.declarationName}"`,
        actual: 'declaration not found',
        details: {
          mappingName: input.mappingName,
          declarationName: input.declarationName,
          sourceType: 'typescript',
        },
      };
    case 'unsupported-type':
      return {
        expected:
          getUnsupportedSourceType(input) === 'openapi'
            ? 'an OpenAPI type in the MVP-supported contract subset'
            : 'a TypeScript type in the MVP-supported contract subset',
        actual:
          input.unsupportedType ??
          `unsupported ${getUnsupportedSourceType(input)} contract construct`,
        details: {
          mappingName: input.mappingName,
          sourceType: getUnsupportedSourceType(input),
          ...(input.declarationName === undefined
            ? {}
            : { declarationName: input.declarationName }),
          ...(input.property === undefined ? {} : { property: input.property }),
          ...(input.unsupportedType === undefined
            ? {}
            : { unsupportedType: input.unsupportedType }),
          ...(input.warningCode === undefined ? {} : { warningCode: input.warningCode }),
        },
      };
  }
}

/**
 * Produces deterministic remediation text for every approved failure kind.
 */
function createRecommendation(input: ContractFailureInput): string {
  switch (input.kind) {
    case 'schema-not-found':
      return `Verify that configured OpenAPI schema "${input.schemaName}" exists for contract mapping "${input.mappingName}".`;
    case 'typescript-type-not-found':
      return `Verify that configured TypeScript declaration "${input.declarationName}" exists for contract mapping "${input.mappingName}".`;
    case 'unsupported-type':
      return getUnsupportedSourceType(input) === 'openapi'
        ? 'Replace or simplify the unsupported OpenAPI type using the MVP-supported primitive and primitive-array subset.'
        : 'Replace or simplify the unsupported type using the MVP-supported primitive and primitive-array subset.';
  }
}

/**
 * Preserves mapping and repository context without retaining source content.
 */
function createMetadata(input: ContractFailureInput): Record<string, unknown> {
  switch (input.kind) {
    case 'schema-not-found':
      return {
        contractMappingName: input.mappingName,
        repositoryId: input.repositoryId,
        failureKind: input.kind,
        schemaName: input.schemaName,
      };
    case 'typescript-type-not-found':
      return {
        contractMappingName: input.mappingName,
        repositoryId: input.repositoryId,
        failureKind: input.kind,
        declarationName: input.declarationName,
      };
    case 'unsupported-type':
      return {
        contractMappingName: input.mappingName,
        repositoryId: input.repositoryId,
        failureKind: input.kind,
        sourceType: getUnsupportedSourceType(input),
        ...(input.declarationName === undefined ? {} : { declarationName: input.declarationName }),
        ...(input.property === undefined ? {} : { property: input.property }),
        ...(input.unsupportedType === undefined ? {} : { unsupportedType: input.unsupportedType }),
        ...(input.warningCode === undefined ? {} : { warningCode: input.warningCode }),
      };
  }
}
