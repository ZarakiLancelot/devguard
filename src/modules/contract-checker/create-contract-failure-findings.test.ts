import { describe, expect, it } from 'vitest';
import {
  createContractFailureFinding,
  type ContractFailureInput,
} from './create-contract-failure-findings.js';

function schemaNotFoundInput(
  overrides: Partial<Extract<ContractFailureInput, { kind: 'schema-not-found' }>> = {},
): Extract<ContractFailureInput, { kind: 'schema-not-found' }> {
  return {
    kind: 'schema-not-found',
    repositoryId: 'backend',
    mappingName: 'UpdateBook',
    schemaName: 'UpdateBookRequest',
    file: 'docs/openapi.yaml',
    ...overrides,
  };
}

function typeNotFoundInput(
  overrides: Partial<Extract<ContractFailureInput, { kind: 'typescript-type-not-found' }>> = {},
): Extract<ContractFailureInput, { kind: 'typescript-type-not-found' }> {
  return {
    kind: 'typescript-type-not-found',
    repositoryId: 'frontend',
    mappingName: 'UpdateBook',
    declarationName: 'UpdateBookPayload',
    file: 'src/types/book.ts',
    ...overrides,
  };
}

function unsupportedTypeInput(
  overrides: Partial<Extract<ContractFailureInput, { kind: 'unsupported-type' }>> = {},
): Extract<ContractFailureInput, { kind: 'unsupported-type' }> {
  return {
    kind: 'unsupported-type',
    repositoryId: 'frontend',
    mappingName: 'UpdateBook',
    declarationName: 'UpdateBookPayload',
    property: 'author',
    unsupportedType: 'Pick<Book, BookFields>',
    file: 'src/types/book.ts',
    line: 8,
    ...overrides,
  };
}

describe('createContractFailureFinding', () => {
  it('creates a high schema-not-found finding with the approved rule ID', () => {
    const finding = createContractFailureFinding(schemaNotFoundInput());

    expect(finding).toMatchObject({
      ruleId: 'contract.schema-not-found',
      source: 'contract-checker',
      category: 'contract',
      severity: 'high',
      title: 'OpenAPI schema not found: UpdateBookRequest',
    });
  });

  it('creates a high typescript-type-not-found finding with the approved rule ID', () => {
    const finding = createContractFailureFinding(typeNotFoundInput());

    expect(finding).toMatchObject({
      ruleId: 'contract.typescript-type-not-found',
      source: 'contract-checker',
      category: 'contract',
      severity: 'high',
      title: 'TypeScript declaration not found: UpdateBookPayload',
    });
  });

  it('creates a warning unsupported-type finding with the approved rule ID', () => {
    const finding = createContractFailureFinding(unsupportedTypeInput());

    expect(finding).toMatchObject({
      ruleId: 'contract.unsupported-type',
      source: 'contract-checker',
      category: 'contract',
      severity: 'warning',
      title: 'Unsupported contract type: UpdateBookPayload.author',
    });
  });

  it('generates deterministic finding and root-cause IDs', () => {
    const input = schemaNotFoundInput();
    const first = createContractFailureFinding(input);
    const second = createContractFailureFinding(input);

    expect(first.id).toBe(second.id);
    expect(first.rootCauseId).toBe(second.rootCauseId);
    expect(first.id).toMatch(/^finding-[a-f0-9]{16}$/);
    expect(first.rootCauseId).toMatch(/^root-[a-f0-9]{16}$/);
  });

  it('creates different finding IDs for different failure kinds', () => {
    const schemaFinding = createContractFailureFinding(schemaNotFoundInput({ schemaName: 'Book' }));
    const declarationFinding = createContractFailureFinding(
      typeNotFoundInput({ declarationName: 'Book' }),
    );
    const unsupportedFinding = createContractFailureFinding(
      unsupportedTypeInput({ declarationName: 'Book', property: 'title' }),
    );

    expect(new Set([schemaFinding.id, declarationFinding.id, unsupportedFinding.id]).size).toBe(3);
  });

  it('uses a stable root cause for the same logical failed target', () => {
    const first = createContractFailureFinding(unsupportedTypeInput());
    const second = createContractFailureFinding(unsupportedTypeInput());

    expect(first.rootCauseId).toBe(second.rootCauseId);
  });

  it('preserves repository and mapping metadata', () => {
    const finding = createContractFailureFinding(typeNotFoundInput());

    expect(finding.metadata).toEqual({
      contractMappingName: 'UpdateBook',
      repositoryId: 'frontend',
      failureKind: 'typescript-type-not-found',
      declarationName: 'UpdateBookPayload',
    });
  });

  it('uses the configured OpenAPI file location for schema-not-found', () => {
    const finding = createContractFailureFinding(schemaNotFoundInput());

    expect(finding.location).toEqual({
      repositoryId: 'backend',
      file: 'docs/openapi.yaml',
    });
  });

  it('uses the configured TypeScript file location for typescript-type-not-found', () => {
    const finding = createContractFailureFinding(typeNotFoundInput());

    expect(finding.location).toEqual({
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
    });
  });

  it('uses the TypeScript line for unsupported-type when available', () => {
    const finding = createContractFailureFinding(unsupportedTypeInput());

    expect(finding.location).toEqual({
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      startLine: 8,
    });
  });

  it('omits location when no supported source file is available', () => {
    const finding = createContractFailureFinding({
      kind: 'unsupported-type',
      repositoryId: 'frontend',
      mappingName: 'UpdateBook',
      declarationName: 'UpdateBookPayload',
      property: 'author',
    });

    expect(finding.location).toBeUndefined();
  });

  it('includes safe structured evidence for schema-not-found', () => {
    const finding = createContractFailureFinding(schemaNotFoundInput());

    expect(finding.evidence).toEqual({
      expected: 'configured OpenAPI schema "UpdateBookRequest"',
      actual: 'schema not found',
      details: {
        mappingName: 'UpdateBook',
        schemaName: 'UpdateBookRequest',
        sourceType: 'openapi',
      },
    });
  });

  it('includes safe structured evidence for typescript-type-not-found', () => {
    const finding = createContractFailureFinding(typeNotFoundInput());

    expect(finding.evidence).toEqual({
      expected: 'configured TypeScript declaration "UpdateBookPayload"',
      actual: 'declaration not found',
      details: {
        mappingName: 'UpdateBook',
        declarationName: 'UpdateBookPayload',
        sourceType: 'typescript',
      },
    });
  });

  it('includes only supplied safe metadata for unsupported-type evidence', () => {
    const finding = createContractFailureFinding(unsupportedTypeInput());

    expect(finding.evidence).toEqual({
      expected: 'a TypeScript type in the MVP-supported contract subset',
      actual: 'Pick<Book, BookFields>',
      details: {
        mappingName: 'UpdateBook',
        sourceType: 'typescript',
        declarationName: 'UpdateBookPayload',
        property: 'author',
        unsupportedType: 'Pick<Book, BookFields>',
      },
    });
  });

  it('uses deterministic recommendation templates', () => {
    expect(createContractFailureFinding(schemaNotFoundInput()).recommendation).toBe(
      'Verify that configured OpenAPI schema "UpdateBookRequest" exists for contract mapping "UpdateBook".',
    );
    expect(createContractFailureFinding(typeNotFoundInput()).recommendation).toBe(
      'Verify that configured TypeScript declaration "UpdateBookPayload" exists for contract mapping "UpdateBook".',
    );
    expect(createContractFailureFinding(unsupportedTypeInput()).recommendation).toBe(
      'Replace or simplify the unsupported type using the MVP-supported primitive and primitive-array subset.',
    );
  });

  it('does not expose full source content', () => {
    const finding = createContractFailureFinding(unsupportedTypeInput());
    const sourceContent = 'export interface UpdateBookPayload { author: Pick<Book, BookFields>; }';
    const serializedFinding = JSON.stringify(finding);

    expect(serializedFinding).not.toContain(sourceContent);
    expect(serializedFinding).not.toContain('export interface');
  });

  it('treats schema and declaration names as case-sensitive logical targets', () => {
    const schemaUppercase = createContractFailureFinding(
      schemaNotFoundInput({ schemaName: 'Book' }),
    );
    const schemaLowercase = createContractFailureFinding(
      schemaNotFoundInput({ schemaName: 'book' }),
    );
    const declarationUppercase = createContractFailureFinding(
      typeNotFoundInput({ declarationName: 'UpdateBookPayload' }),
    );
    const declarationLowercase = createContractFailureFinding(
      typeNotFoundInput({ declarationName: 'updateBookPayload' }),
    );

    expect(schemaUppercase.rootCauseId).not.toBe(schemaLowercase.rootCauseId);
    expect(declarationUppercase.rootCauseId).not.toBe(declarationLowercase.rootCauseId);
  });

  it('returns stable complete output across repeated calls for every approved failure kind', () => {
    const inputs: ContractFailureInput[] = [
      schemaNotFoundInput(),
      typeNotFoundInput(),
      unsupportedTypeInput(),
    ];

    for (const input of inputs) {
      expect(createContractFailureFinding(input)).toEqual(createContractFailureFinding(input));
    }
  });
});
