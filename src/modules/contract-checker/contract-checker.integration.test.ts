import { describe, expect, it } from 'vitest';
import {
  getFixtureDirectory,
  loadContractFixture,
  type FixtureExpectedFinding,
  type FixtureExpectedWarning,
  type FixtureName,
} from '../../fixtures/fixture-loader.js';
import {
  analyzeContractMapping,
  type AnalyzeContractMappingInput,
  type AnalyzeContractMappingResult,
  type ContractAnalysisWarning,
} from './analyze-contract-mapping.js';
import type { AnalysisFinding } from '../../types/findings.js';

const CONTRACT_FIXTURES = [
  'valid-contract',
  'missing-property',
  'incompatible-type',
  'required-mismatch',
  'unsupported-typescript',
  'malformed-openapi',
] as const satisfies readonly FixtureName[];

describe('Contract Checker fixture integration', () => {
  for (const fixtureName of CONTRACT_FIXTURES) {
    it(`runs ${fixtureName} through analyzeContractMapping with complete deterministic output`, () => {
      const fixture = loadContractFixture(fixtureName);

      expect(() => analyzeContractMapping(fixture.input)).not.toThrow();
      const first = analyzeContractMapping(fixture.input);
      const second = analyzeContractMapping(fixture.input);

      assertFixtureResult(fixture.name, fixture.input, fixture.expected, first);
      assertDeterministicResult(first, second);
    });
  }

  it('converts schema-not-found with configured OpenAPI metadata', () => {
    const input = withSchemaName(loadContractFixture('valid-contract').input, 'UpdateBookCommand');
    const result = runDeterministically(input);

    expect(result).toMatchObject({
      mappingName: 'UpdateBook',
      compared: false,
      warnings: [],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.schema-not-found',
      severity: 'high',
      location: {
        repositoryId: 'backend',
        file: 'docs/openapi.yaml',
      },
      metadata: {
        contractMappingName: 'UpdateBook',
        repositoryId: 'backend',
        schemaName: 'UpdateBookCommand',
      },
    });
  });

  it('converts TypeScript declaration-not-found with configured file metadata', () => {
    const input = withDeclarationName(
      loadContractFixture('valid-contract').input,
      'UpdateBookCommandPayload',
    );
    const result = runDeterministically(input);

    expect(result).toMatchObject({
      mappingName: 'UpdateBook',
      compared: false,
      warnings: [],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.typescript-type-not-found',
      severity: 'high',
      location: {
        repositoryId: 'frontend',
        file: 'src/types/book.ts',
      },
      metadata: {
        contractMappingName: 'UpdateBook',
        repositoryId: 'frontend',
        declarationName: 'UpdateBookCommandPayload',
      },
    });
  });

  it('contains malformed TypeScript as an internal parser warning', () => {
    const fixture = loadContractFixture('valid-contract');
    const input: AnalyzeContractMappingInput = {
      ...fixture.input,
      typescript: {
        ...fixture.input.typescript,
        content: 'export interface UpdateBookPayload {',
      },
    };
    const result = runDeterministically(input);

    expect(result.findings).toEqual([]);
    expect(result.compared).toBe(false);
    expect(warningSummary(result.warnings)).toEqual([
      {
        code: 'TYPESCRIPT_PARSE_FAILED',
        source: 'typescript',
        file: 'src/types/book.ts',
      },
    ]);
  });

  it('deduplicates unsupported properties while preserving supported comparison findings', () => {
    const input: AnalyzeContractMappingInput = {
      mappingName: 'UpdateBook',
      openapi: {
        repositoryId: 'backend',
        file: 'docs/openapi.yaml',
        content: `openapi: 3.0.3
info:
  title: Digital Library API
  version: 1.0.0
components:
  schemas:
    UpdateBookRequest:
      type: object
      required:
        - isbn
        - pageCount
      properties:
        isbn:
          type: string
        pageCount:
          type: integer
`,
        schemaName: 'UpdateBookRequest',
        format: 'yaml',
      },
      typescript: {
        repositoryId: 'frontend',
        file: 'src/types/book.ts',
        content: `export interface UpdateBookPayload {
  isbn: string;
  pageCount: string;
  contributors: Array<Book>;
}
`,
        declarationName: 'UpdateBookPayload',
      },
    };
    const result = runDeterministically(input);
    const unsupportedFindings = result.findings.filter(
      (finding) => finding.ruleId === 'contract.unsupported-type',
    );

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'contract.unsupported-type',
      'contract.incompatible-type',
    ]);
    expect(unsupportedFindings).toHaveLength(1);
    expect(new Set(unsupportedFindings.map((finding) => finding.id)).size).toBe(1);
    expect(new Set(unsupportedFindings.map((finding) => finding.rootCauseId)).size).toBe(1);
    expect(unsupportedFindings[0]).toMatchObject({
      location: {
        repositoryId: 'frontend',
        file: 'src/types/book.ts',
        startLine: 4,
      },
      metadata: {
        contractMappingName: 'UpdateBook',
        repositoryId: 'frontend',
        property: 'contributors',
        unsupportedType: 'Array<Book>',
      },
    });
  });

  it('contains every approved integration error condition without uncaught exceptions', () => {
    const validInput = loadContractFixture('valid-contract').input;
    const malformedTypeScript = {
      ...validInput,
      typescript: {
        ...validInput.typescript,
        content: 'export interface UpdateBookPayload {',
      },
    };
    const schemaNotFound = withSchemaName(validInput, 'UpdateBookCommand');
    const typeNotFound = withDeclarationName(validInput, 'UpdateBookCommandPayload');
    const unsupportedDeclaration = loadContractFixture('unsupported-typescript').input;
    const malformedOpenApi = loadContractFixture('malformed-openapi').input;
    const unsupportedProperty = createUnsupportedPropertyInput();

    for (const input of [
      malformedOpenApi,
      malformedTypeScript,
      schemaNotFound,
      typeNotFound,
      unsupportedDeclaration,
      unsupportedProperty,
    ]) {
      expect(() => analyzeContractMapping(input)).not.toThrow();
    }
  });
});

function assertFixtureResult(
  fixtureName: FixtureName,
  input: AnalyzeContractMappingInput,
  expected: {
    compared?: boolean;
    expectedFindings: FixtureExpectedFinding[];
    expectedWarnings: FixtureExpectedWarning[];
  },
  result: AnalyzeContractMappingResult,
): void {
  if (expected.compared === undefined) {
    throw new Error(`Fixture "${fixtureName}" must define compared expectation`);
  }

  expect(result.mappingName).toBe(input.mappingName);
  expect(result.compared).toBe(expected.compared);
  expect(result.findings.map((finding) => finding.ruleId)).toEqual(
    expected.expectedFindings.map((finding) => finding.ruleId),
  );
  expect(result.findings.map((finding) => finding.severity)).toEqual(
    expected.expectedFindings.map((finding) => finding.severity),
  );
  expect(warningSummary(result.warnings)).toEqual(expected.expectedWarnings);

  for (const [index, expectedFinding] of expected.expectedFindings.entries()) {
    const finding = result.findings[index];
    if (finding === undefined) {
      throw new Error(`Fixture "${fixtureName}" omitted expected finding at index ${index}`);
    }

    assertFindingMetadata(finding, expectedFinding);
  }

  const serializedResult = JSON.stringify(result);
  expect(serializedResult).not.toContain(input.openapi.content);
  expect(serializedResult).not.toContain(input.typescript.content);
  expect(serializedResult).not.toContain(getFixtureDirectory(fixtureName));
  expect(serializedResult).not.toContain('/home/');
}

function assertFindingMetadata(finding: AnalysisFinding, expected: FixtureExpectedFinding): void {
  if (expected.property !== undefined) {
    expect(finding.metadata?.['property']).toBe(expected.property);
  }

  if (expected.logicalSubject !== undefined) {
    expect(finding.title).toContain(expected.logicalSubject);
  }

  if (expected.repositoryId !== undefined) {
    expect(finding.location?.repositoryId).toBe(expected.repositoryId);
  }

  if (expected.file !== undefined) {
    expect(finding.location?.file).toBe(expected.file);
  }

  if (expected.line !== undefined) {
    expect(finding.location?.startLine).toBe(expected.line);
  }
}

function runDeterministically(input: AnalyzeContractMappingInput): AnalyzeContractMappingResult {
  const first = analyzeContractMapping(input);
  const second = analyzeContractMapping(input);
  assertDeterministicResult(first, second);
  return first;
}

function assertDeterministicResult(
  first: AnalyzeContractMappingResult,
  second: AnalyzeContractMappingResult,
): void {
  expect(second).toEqual(first);
  expect(second.findings.map((finding) => finding.id)).toEqual(
    first.findings.map((finding) => finding.id),
  );
  expect(second.findings.map((finding) => finding.rootCauseId)).toEqual(
    first.findings.map((finding) => finding.rootCauseId),
  );
  expect(second.findings.map((finding) => finding.ruleId)).toEqual(
    first.findings.map((finding) => finding.ruleId),
  );
  expect(warningSummary(second.warnings)).toEqual(warningSummary(first.warnings));
}

function warningSummary(warnings: ContractAnalysisWarning[]): Array<{
  code: string;
  source: 'openapi' | 'typescript';
  file?: string;
  line?: number;
}> {
  return warnings.map((warning) => ({
    code: warning.code,
    source: warning.source,
    ...(warning.file === undefined ? {} : { file: warning.file }),
    ...(warning.line === undefined ? {} : { line: warning.line }),
  }));
}

function withSchemaName(
  input: AnalyzeContractMappingInput,
  schemaName: string,
): AnalyzeContractMappingInput {
  return {
    ...input,
    openapi: {
      ...input.openapi,
      schemaName,
    },
  };
}

function withDeclarationName(
  input: AnalyzeContractMappingInput,
  declarationName: string,
): AnalyzeContractMappingInput {
  return {
    ...input,
    typescript: {
      ...input.typescript,
      declarationName,
    },
  };
}

function createUnsupportedPropertyInput(): AnalyzeContractMappingInput {
  return {
    mappingName: 'UpdateBook',
    openapi: {
      repositoryId: 'backend',
      file: 'docs/openapi.yaml',
      content: `openapi: 3.0.3
info:
  title: Digital Library API
  version: 1.0.0
components:
  schemas:
    UpdateBookRequest:
      type: object
      properties:
        isbn:
          type: string
`,
      schemaName: 'UpdateBookRequest',
      format: 'yaml',
    },
    typescript: {
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      content: `export interface UpdateBookPayload {
  isbn: string;
  contributors: Array<Book>;
}
`,
      declarationName: 'UpdateBookPayload',
    },
  };
}
