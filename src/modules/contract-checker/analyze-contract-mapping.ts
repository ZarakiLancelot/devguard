import { createContractFailureFinding } from './create-contract-failure-findings.js';
import type { ContractFailureInput } from './create-contract-failure-findings.js';
import { createContractFindings } from './create-contract-findings.js';
import { compareNormalizedContracts } from './compare-contracts.js';
import { loadOpenApiDocument } from './openapi/load-openapi.js';
import { normalizeOpenApiSchema } from './openapi/normalize-openapi.js';
import type { NormalizeWarning } from './openapi/normalize-openapi.js';
import { loadTypeScriptDeclaration } from './typescript/load-typescript.js';
import type {
  LoadedTypeScriptDeclaration,
  TypeScriptLoadWarning,
} from './typescript/load-typescript.js';
import { normalizeTypeScriptDeclaration } from './typescript/normalize-typescript.js';
import type { TypeScriptNormalizationWarning } from './typescript/normalize-typescript.js';
import type { AnalysisFinding } from '../../types/findings.js';

/**
 * Explicit in-memory inputs required to analyze one configured contract mapping.
 */
export interface AnalyzeContractMappingInput {
  mappingName: string;
  openapi: {
    repositoryId: string;
    file: string;
    content: string;
    schemaName: string;
    format?: 'yaml' | 'json' | 'auto';
  };
  typescript: {
    repositoryId: string;
    file: string;
    content: string;
    declarationName: string;
  };
}

/**
 * A recoverable internal diagnostic that is not an approved public finding.
 */
export interface ContractAnalysisWarning {
  code: string;
  message: string;
  source: 'openapi' | 'typescript';
  file?: string;
  line?: number;
}

/**
 * Deterministic result of analyzing one configured contract mapping in memory.
 */
export interface AnalyzeContractMappingResult {
  mappingName: string;
  findings: AnalysisFinding[];
  warnings: ContractAnalysisWarning[];
  compared: boolean;
}

type UnsupportedFailureInput = Extract<ContractFailureInput, { kind: 'unsupported-type' }>;

interface UnsupportedFindingCandidate {
  input: UnsupportedFailureInput;
}

/**
 * Runs the Contract Checker pipeline for one mapping without filesystem, Git,
 * configuration, CLI, scoring, or report dependencies.
 */
export function analyzeContractMapping(
  input: AnalyzeContractMappingInput,
): AnalyzeContractMappingResult {
  const warnings: ContractAnalysisWarning[] = [];
  const unsupportedCandidates: UnsupportedFindingCandidate[] = [];

  const openApiLoadResult: ReturnType<typeof loadOpenApiDocument> = loadOpenApiDocument({
    content: input.openapi.content,
    ...(input.openapi.format === undefined ? {} : { format: input.openapi.format }),
    sourceLabel: input.openapi.file,
  });

  if (!openApiLoadResult.success) {
    warnings.push(
      createInternalWarning(input, 'openapi', openApiLoadResult.error.code, input.openapi.file),
    );
    return createResult(input.mappingName, [], warnings, false);
  }

  for (const warning of openApiLoadResult.warnings) {
    warnings.push(createInternalWarning(input, 'openapi', warning.code, input.openapi.file));
  }

  const openApiNormalizationResult: ReturnType<typeof normalizeOpenApiSchema> =
    normalizeOpenApiSchema(openApiLoadResult.document, input.openapi.schemaName);

  appendOpenApiNormalizationWarnings(
    input,
    openApiNormalizationResult.warnings,
    unsupportedCandidates,
    warnings,
  );

  if (!openApiNormalizationResult.success) {
    if (openApiNormalizationResult.error.code === 'OPENAPI_SCHEMA_NOT_FOUND') {
      return createResult(
        input.mappingName,
        [
          createContractFailureFinding({
            kind: 'schema-not-found',
            repositoryId: input.openapi.repositoryId,
            mappingName: input.mappingName,
            schemaName: input.openapi.schemaName,
            file: input.openapi.file,
          }),
          ...createUnsupportedFindings(unsupportedCandidates),
        ],
        warnings,
        false,
      );
    }

    if (openApiNormalizationResult.error.code === 'OPENAPI_REF_UNSUPPORTED') {
      return createResult(
        input.mappingName,
        [
          createContractFailureFinding({
            kind: 'unsupported-type',
            repositoryId: input.openapi.repositoryId,
            mappingName: input.mappingName,
            unsupportedType: openApiNormalizationResult.error.code,
            sourceType: 'openapi',
            warningCode: openApiNormalizationResult.error.code,
            file: input.openapi.file,
          }),
          ...createUnsupportedFindings(unsupportedCandidates),
        ],
        warnings,
        false,
      );
    }

    warnings.push(
      createInternalWarning(
        input,
        'openapi',
        openApiNormalizationResult.error.code,
        input.openapi.file,
      ),
    );
    return createResult(
      input.mappingName,
      createUnsupportedFindings(unsupportedCandidates),
      warnings,
      false,
    );
  }

  const typeScriptLoadResult: ReturnType<typeof loadTypeScriptDeclaration> =
    loadTypeScriptDeclaration(
      {
        content: input.typescript.content,
        fileName: input.typescript.file,
        sourceLabel: input.typescript.file,
      },
      input.typescript.declarationName,
    );

  if (!typeScriptLoadResult.success) {
    appendTypeScriptLoadWarnings(
      input,
      typeScriptLoadResult.warnings,
      undefined,
      unsupportedCandidates,
      warnings,
    );

    if (typeScriptLoadResult.error.code === 'TYPESCRIPT_DECLARATION_NOT_FOUND') {
      return createResult(
        input.mappingName,
        [
          createContractFailureFinding({
            kind: 'typescript-type-not-found',
            repositoryId: input.typescript.repositoryId,
            mappingName: input.mappingName,
            declarationName: input.typescript.declarationName,
            file: input.typescript.file,
          }),
          ...createUnsupportedFindings(unsupportedCandidates),
        ],
        warnings,
        false,
      );
    }

    if (typeScriptLoadResult.error.code === 'TYPESCRIPT_DECLARATION_UNSUPPORTED') {
      return createResult(
        input.mappingName,
        [
          createContractFailureFinding({
            kind: 'unsupported-type',
            repositoryId: input.typescript.repositoryId,
            mappingName: input.mappingName,
            declarationName: input.typescript.declarationName,
            unsupportedType: typeScriptLoadResult.error.code,
            warningCode: typeScriptLoadResult.error.code,
            file: input.typescript.file,
          }),
          ...createUnsupportedFindings(unsupportedCandidates),
        ],
        warnings,
        false,
      );
    }

    warnings.push(
      createInternalWarning(
        input,
        'typescript',
        typeScriptLoadResult.error.code,
        input.typescript.file,
      ),
    );
    return createResult(
      input.mappingName,
      createUnsupportedFindings(unsupportedCandidates),
      warnings,
      false,
    );
  }

  appendTypeScriptLoadWarnings(
    input,
    typeScriptLoadResult.warnings,
    typeScriptLoadResult.declaration,
    unsupportedCandidates,
    warnings,
  );

  const typeScriptNormalizationResult: ReturnType<typeof normalizeTypeScriptDeclaration> =
    normalizeTypeScriptDeclaration(typeScriptLoadResult.declaration);

  if (!typeScriptNormalizationResult.success) {
    if (typeScriptNormalizationResult.error.code === 'TYPESCRIPT_DECLARATION_EMPTY') {
      return createResult(
        input.mappingName,
        [
          createContractFailureFinding({
            kind: 'unsupported-type',
            repositoryId: input.typescript.repositoryId,
            mappingName: input.mappingName,
            declarationName: input.typescript.declarationName,
            unsupportedType: typeScriptNormalizationResult.error.code,
            warningCode: typeScriptNormalizationResult.error.code,
            file: input.typescript.file,
          }),
          ...createUnsupportedFindings(
            unsupportedCandidates.filter((candidate) => candidate.input.sourceType === 'openapi'),
          ),
        ],
        warnings,
        false,
      );
    }

    warnings.push(
      createInternalWarning(
        input,
        'typescript',
        typeScriptNormalizationResult.error.code,
        input.typescript.file,
      ),
    );
    return createResult(
      input.mappingName,
      createUnsupportedFindings(unsupportedCandidates),
      warnings,
      false,
    );
  }

  appendTypeScriptNormalizationWarnings(
    input,
    typeScriptNormalizationResult.warnings,
    typeScriptLoadResult.declaration,
    unsupportedCandidates,
  );

  const comparison = compareNormalizedContracts(
    openApiNormalizationResult.contract,
    typeScriptNormalizationResult.contract,
  );
  const propertyUnsupportedFindings = createUnsupportedFindings(unsupportedCandidates);
  const comparisonFindings = createContractFindings({
    comparison,
    repository: { repositoryId: input.typescript.repositoryId },
    typescriptFile: { path: input.typescript.file },
    mappingName: input.mappingName,
  });

  return createResult(
    input.mappingName,
    [...propertyUnsupportedFindings, ...comparisonFindings],
    warnings,
    true,
  );
}

/**
 * Converts OpenAPI property-level normalization warnings into finding candidates.
 */
function appendOpenApiNormalizationWarnings(
  input: AnalyzeContractMappingInput,
  normalizationWarnings: NormalizeWarning[],
  unsupportedCandidates: UnsupportedFindingCandidate[],
  warnings: ContractAnalysisWarning[],
): void {
  for (const warning of normalizationWarnings) {
    if (warning.property === undefined) {
      warnings.push(createInternalWarning(input, 'openapi', warning.code, input.openapi.file));
      continue;
    }

    unsupportedCandidates.push({
      input: {
        kind: 'unsupported-type',
        repositoryId: input.openapi.repositoryId,
        mappingName: input.mappingName,
        property: warning.property,
        sourceType: 'openapi',
        warningCode: warning.code,
        file: input.openapi.file,
      },
    });
  }
}

/**
 * Converts supported-declaration loading warnings when a member target is known.
 */
function appendTypeScriptLoadWarnings(
  input: AnalyzeContractMappingInput,
  loadWarnings: TypeScriptLoadWarning[],
  declaration: LoadedTypeScriptDeclaration | undefined,
  unsupportedCandidates: UnsupportedFindingCandidate[],
  warnings: ContractAnalysisWarning[],
): void {
  for (const warning of loadWarnings) {
    if (warning.member === undefined) {
      warnings.push(
        createInternalWarning(input, 'typescript', warning.code, input.typescript.file),
      );
      continue;
    }

    const property = declaration?.properties.find((item) => item.name === warning.member);
    unsupportedCandidates.push({
      input: {
        kind: 'unsupported-type',
        repositoryId: input.typescript.repositoryId,
        mappingName: input.mappingName,
        declarationName: input.typescript.declarationName,
        property: warning.member,
        ...(property === undefined ? {} : { unsupportedType: property.typeText }),
        warningCode: warning.code,
        file: input.typescript.file,
        ...(property?.line === undefined ? {} : { line: property.line }),
      },
    });
  }
}

/**
 * Converts omitted unsupported TypeScript properties into finding candidates.
 */
function appendTypeScriptNormalizationWarnings(
  input: AnalyzeContractMappingInput,
  normalizationWarnings: TypeScriptNormalizationWarning[],
  declaration: LoadedTypeScriptDeclaration,
  unsupportedCandidates: UnsupportedFindingCandidate[],
): void {
  for (const warning of normalizationWarnings) {
    const property = declaration.properties.find((item) => item.name === warning.property);
    unsupportedCandidates.push({
      input: {
        kind: 'unsupported-type',
        repositoryId: input.typescript.repositoryId,
        mappingName: input.mappingName,
        declarationName: input.typescript.declarationName,
        property: warning.property,
        ...(property === undefined ? {} : { unsupportedType: property.typeText }),
        warningCode: warning.code,
        file: input.typescript.file,
        ...(property?.line === undefined ? {} : { line: property.line }),
      },
    });
  }
}

/**
 * Deduplicates unsupported properties by repository, file, mapping, property,
 * and unsupported type text; warning code supplies the identity when text is absent.
 */
function createUnsupportedFindings(candidates: UnsupportedFindingCandidate[]): AnalysisFinding[] {
  const orderedCandidates = [...candidates].sort(compareUnsupportedCandidates);
  const identities = new Set<string>();
  const findings: AnalysisFinding[] = [];

  for (const candidate of orderedCandidates) {
    const identity = getUnsupportedCandidateIdentity(candidate);
    if (identities.has(identity)) {
      continue;
    }

    identities.add(identity);
    findings.push(createContractFailureFinding(candidate.input));
  }

  return findings;
}

/**
 * Orders candidates so deduplication preserves the first deterministic occurrence.
 */
function compareUnsupportedCandidates(
  left: UnsupportedFindingCandidate,
  right: UnsupportedFindingCandidate,
): number {
  const sourceOrder = compareText(
    left.input.sourceType ?? 'typescript',
    right.input.sourceType ?? 'typescript',
  );
  if (sourceOrder !== 0) {
    return sourceOrder;
  }

  const fileOrder = compareText(left.input.file ?? '', right.input.file ?? '');
  if (fileOrder !== 0) {
    return fileOrder;
  }

  const lineOrder =
    (left.input.line ?? Number.MAX_SAFE_INTEGER) - (right.input.line ?? Number.MAX_SAFE_INTEGER);
  if (lineOrder !== 0) {
    return lineOrder;
  }

  const propertyOrder = compareText(left.input.property ?? '', right.input.property ?? '');
  if (propertyOrder !== 0) {
    return propertyOrder;
  }

  return compareText(
    left.input.unsupportedType ?? left.input.warningCode ?? '',
    right.input.unsupportedType ?? right.input.warningCode ?? '',
  );
}

/**
 * Builds the approved deduplication identity without source content.
 */
function getUnsupportedCandidateIdentity(candidate: UnsupportedFindingCandidate): string {
  const input = candidate.input;
  return [
    input.repositoryId,
    input.file ?? '',
    input.mappingName,
    input.property ?? '',
    input.unsupportedType ?? input.warningCode ?? '',
  ].join('\x00');
}

/**
 * Creates a safe internal warning without copying raw source or parser details.
 */
function createInternalWarning(
  input: AnalyzeContractMappingInput,
  source: ContractAnalysisWarning['source'],
  code: string,
  file: string,
  line?: number,
): ContractAnalysisWarning {
  return {
    code,
    message: `Contract mapping "${input.mappingName}" reported internal ${source} diagnostic ${code}.`,
    source,
    file,
    ...(line === undefined ? {} : { line }),
  };
}

/**
 * Orders internal diagnostics by source, file, line, code, then message.
 */
function compareWarnings(left: ContractAnalysisWarning, right: ContractAnalysisWarning): number {
  const sourceOrder = compareText(left.source, right.source);
  if (sourceOrder !== 0) {
    return sourceOrder;
  }

  const fileOrder = compareText(left.file ?? '', right.file ?? '');
  if (fileOrder !== 0) {
    return fileOrder;
  }

  const lineOrder =
    (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
  if (lineOrder !== 0) {
    return lineOrder;
  }

  const codeOrder = compareText(left.code, right.code);
  if (codeOrder !== 0) {
    return codeOrder;
  }

  return compareText(left.message, right.message);
}

/**
 * Uses a locale-independent lexical comparison for stable result ordering.
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
 * Produces a result while enforcing deterministic warning ordering.
 */
function createResult(
  mappingName: string,
  findings: AnalysisFinding[],
  warnings: ContractAnalysisWarning[],
  compared: boolean,
): AnalyzeContractMappingResult {
  return {
    mappingName,
    findings,
    warnings: [...warnings].sort(compareWarnings),
    compared,
  };
}
