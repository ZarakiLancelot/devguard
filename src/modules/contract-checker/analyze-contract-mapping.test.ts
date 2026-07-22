import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeContractMapping,
  type AnalyzeContractMappingInput,
} from './analyze-contract-mapping.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../fixtures');

const VALID_OPENAPI = `openapi: 3.0.3
info:
  title: Digital Library API
  version: 1.0.0
components:
  schemas:
    UpdateBookRequest:
      type: object
      required:
        - isbn
      properties:
        isbn:
          type: string
        pageCount:
          type: integer
`;

const VALID_TYPESCRIPT = `export interface UpdateBookPayload {
  isbn: string;
  pageCount?: number;
}
`;

function createInput(
  openapiContent = VALID_OPENAPI,
  typescriptContent = VALID_TYPESCRIPT,
): AnalyzeContractMappingInput {
  return {
    mappingName: 'UpdateBook',
    openapi: {
      repositoryId: 'backend',
      file: 'docs/openapi.yaml',
      content: openapiContent,
      schemaName: 'UpdateBookRequest',
      format: 'yaml',
    },
    typescript: {
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      content: typescriptContent,
      declarationName: 'UpdateBookPayload',
    },
  };
}

function createFixtureInput(fixtureName: string): AnalyzeContractMappingInput {
  return createInput(
    fs.readFileSync(path.join(FIXTURES_DIR, fixtureName, 'backend/docs/openapi.yaml'), 'utf-8'),
    fs.readFileSync(path.join(FIXTURES_DIR, fixtureName, 'frontend/src/types/book.ts'), 'utf-8'),
  );
}

describe('analyzeContractMapping', () => {
  it('returns no findings and compared true for matching valid Book contracts', () => {
    const result = analyzeContractMapping(createInput());

    expect(result).toEqual({
      mappingName: 'UpdateBook',
      findings: [],
      warnings: [],
      compared: true,
    });
  });

  it('converts the missing-property Book fixture comparison finding', () => {
    const result = analyzeContractMapping(createFixtureInput('missing-property'));

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.missing-property',
      severity: 'high',
      category: 'contract',
      metadata: {
        contractMappingName: 'UpdateBook',
        property: 'authorId',
      },
    });
  });

  it('converts the incompatible-type Book fixture comparison finding', () => {
    const result = analyzeContractMapping(createFixtureInput('incompatible-type'));

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.incompatible-type',
      severity: 'critical',
      category: 'contract',
    });
  });

  it('converts the required-mismatch Book fixture comparison finding', () => {
    const result = analyzeContractMapping(createFixtureInput('required-mismatch'));

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.required-mismatch',
      severity: 'high',
      category: 'contract',
    });
  });

  it('converts a missing schema into a high finding without comparison', () => {
    const input = createInput();
    input.openapi.schemaName = 'UpdateBookCommand';
    input.typescript.content = 'export interface UpdateBookPayload {';

    const result = analyzeContractMapping(input);

    expect(result.compared).toBe(false);
    expect(result.warnings).toEqual([]);
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

  it('converts a missing TypeScript declaration into a high finding without comparison', () => {
    const input = createInput();
    input.typescript.declarationName = 'UpdateBookCommandPayload';

    const result = analyzeContractMapping(input);

    expect(result.compared).toBe(false);
    expect(result.warnings).toEqual([]);
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

  it('converts an unsupported declaration into one warning finding without comparison', () => {
    const result = analyzeContractMapping(
      createInput(VALID_OPENAPI, 'export type UpdateBookPayload = Pick<Book, "isbn">;\n'),
    );

    expect(result.compared).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.unsupported-type',
      severity: 'warning',
      location: {
        repositoryId: 'frontend',
        file: 'src/types/book.ts',
      },
    });
  });

  it('preserves supported comparison while reporting unsupported TypeScript properties first', () => {
    const result = analyzeContractMapping(
      createInput(
        VALID_OPENAPI,
        `export interface UpdateBookPayload {
  isbn: number;
  pageCount?: number;
  contributors: Array<Book>;
}
`,
      ),
    );

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'contract.unsupported-type',
      'contract.incompatible-type',
    ]);
    expect(result.findings[0]).toMatchObject({
      location: {
        repositoryId: 'frontend',
        file: 'src/types/book.ts',
        startLine: 4,
      },
      metadata: {
        contractMappingName: 'UpdateBook',
        property: 'contributors',
        sourceType: 'typescript',
      },
    });
  });

  it('keeps malformed OpenAPI as an internal warning without an invented finding', () => {
    const sourceContent = 'openapi: [unclosed';
    const result = analyzeContractMapping(createInput(sourceContent));

    expect(result).toMatchObject({
      mappingName: 'UpdateBook',
      findings: [],
      compared: false,
      warnings: [
        {
          code: 'OPENAPI_PARSE_FAILED',
          source: 'openapi',
          file: 'docs/openapi.yaml',
        },
      ],
    });
    expect(JSON.stringify(result.warnings)).not.toContain(sourceContent);
  });

  it('keeps malformed TypeScript as an internal warning without an invented finding', () => {
    const sourceContent = 'export interface UpdateBookPayload {';
    const result = analyzeContractMapping(createInput(VALID_OPENAPI, sourceContent));

    expect(result).toMatchObject({
      findings: [],
      compared: false,
      warnings: [
        {
          code: 'TYPESCRIPT_PARSE_FAILED',
          source: 'typescript',
          file: 'src/types/book.ts',
        },
      ],
    });
    expect(JSON.stringify(result.warnings)).not.toContain(sourceContent);
  });

  it('does not expose complete TypeScript source in unsupported property findings', () => {
    const sourceContent = `export interface UpdateBookPayload {
  isbn: string;
  pageCount?: number;
  contributors: Array<Book>;
}
`;
    const result = analyzeContractMapping(createInput(VALID_OPENAPI, sourceContent));

    expect(JSON.stringify(result.findings)).not.toContain(sourceContent);
    expect(JSON.stringify(result.findings)).not.toContain('export interface');
  });

  it('reports an unsupported OpenAPI property while comparing supported properties', () => {
    const openapiContent = `openapi: 3.0.3
info:
  title: Digital Library API
  version: 1.0.0
components:
  schemas:
    UpdateBookRequest:
      type: object
      required:
        - isbn
      properties:
        isbn:
          type: string
        author:
          type: object
`;
    const result = analyzeContractMapping(
      createInput(
        openapiContent,
        `export interface UpdateBookPayload {
  isbn: string;
}
`,
      ),
    );

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'contract.unsupported-type',
      severity: 'warning',
      location: {
        repositoryId: 'backend',
        file: 'docs/openapi.yaml',
      },
      evidence: {
        details: {
          mappingName: 'UpdateBook',
          property: 'author',
          sourceType: 'openapi',
          warningCode: 'OPENAPI_PROPERTY_UNSUPPORTED',
        },
      },
      metadata: {
        contractMappingName: 'UpdateBook',
        repositoryId: 'backend',
        property: 'author',
        sourceType: 'openapi',
      },
    });
  });

  it('deduplicates unsupported property findings and keeps their IDs unique', () => {
    const result = analyzeContractMapping(
      createInput(
        VALID_OPENAPI,
        `export interface UpdateBookPayload {
  isbn: string;
  pageCount?: number;
  contributor: Array<Book>;
}
`,
      ),
    );
    const unsupportedFindings = result.findings.filter(
      (finding) => finding.ruleId === 'contract.unsupported-type',
    );

    expect(unsupportedFindings).toHaveLength(1);
    expect(new Set(result.findings.map((finding) => finding.id)).size).toBe(result.findings.length);
  });

  it('returns stable findings and deterministically ordered warnings across repeated runs', () => {
    const input = createInput('openapi: [unclosed');
    const first = analyzeContractMapping(input);
    const second = analyzeContractMapping(input);

    expect(first).toEqual(second);
    expect(first.warnings).toEqual([...first.warnings].sort(compareWarnings));
  });

  it('contains loader and normalizer failures without uncaught exceptions', () => {
    expect(() =>
      analyzeContractMapping(createInput('openapi: 3.0.3\ncomponents: []\n')),
    ).not.toThrow();
    expect(() =>
      analyzeContractMapping(createInput(VALID_OPENAPI, 'export interface UpdateBookPayload {')),
    ).not.toThrow();
  });
});

function compareWarnings(
  left: { source: string; file?: string; line?: number; code: string },
  right: { source: string; file?: string; line?: number; code: string },
): number {
  const leftKey = [
    left.source,
    left.file ?? '',
    String(left.line ?? Number.MAX_SAFE_INTEGER).padStart(16, '0'),
    left.code,
  ].join('\x00');
  const rightKey = [
    right.source,
    right.file ?? '',
    String(right.line ?? Number.MAX_SAFE_INTEGER).padStart(16, '0'),
    right.code,
  ].join('\x00');

  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
