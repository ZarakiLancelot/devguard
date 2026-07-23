import { afterEach, describe, expect, it, vi } from 'vitest';
import * as openApiLoader from './openapi/load-openapi.js';
import * as openApiNormalizer from './openapi/normalize-openapi.js';
import * as typeScriptLoader from './typescript/load-typescript.js';
import * as typeScriptNormalizer from './typescript/normalize-typescript.js';
import type * as OpenApiLoaderModule from './openapi/load-openapi.js';
import type * as OpenApiNormalizerModule from './openapi/normalize-openapi.js';
import type * as TypeScriptLoaderModule from './typescript/load-typescript.js';
import type * as TypeScriptNormalizerModule from './typescript/normalize-typescript.js';
import {
  analyzeContractMapping,
  type AnalyzeContractMappingInput,
  type AnalyzeContractMappingResult,
} from './analyze-contract-mapping.js';

vi.mock('./openapi/load-openapi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApiLoaderModule>();

  return {
    ...actual,
    loadOpenApiDocument: vi.fn(actual.loadOpenApiDocument),
  };
});

vi.mock('./openapi/normalize-openapi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApiNormalizerModule>();

  return {
    ...actual,
    normalizeOpenApiSchema: vi.fn(actual.normalizeOpenApiSchema),
  };
});

vi.mock('./typescript/load-typescript.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TypeScriptLoaderModule>();

  return {
    ...actual,
    loadTypeScriptDeclaration: vi.fn(actual.loadTypeScriptDeclaration),
  };
});

vi.mock('./typescript/normalize-typescript.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TypeScriptNormalizerModule>();

  return {
    ...actual,
    normalizeTypeScriptDeclaration: vi.fn(actual.normalizeTypeScriptDeclaration),
  };
});

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

function expectUnexpectedThrow(
  invoke: () => AnalyzeContractMappingResult,
  unexpected: unknown,
): void {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let result: AnalyzeContractMappingResult | undefined;
  let thrown: unknown;

  try {
    result = invoke();
  } catch (caught: unknown) {
    thrown = caught;
  }

  expect(thrown).toBe(unexpected);
  expect(result).toBeUndefined();
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyzeContractMapping exception boundary', () => {
  it('keeps an expected OpenAPI parser result recoverable without copying parser details', () => {
    const sourceContent = 'openapi: [unclosed';
    const result = analyzeContractMapping(createInput(sourceContent));

    expect(result).toMatchObject({
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

  it('keeps an expected TypeScript parser result recoverable without copying parser details', () => {
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

  it('keeps expected normalization warnings recoverable as approved unsupported-type findings', () => {
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

    expect(result.compared).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(['contract.unsupported-type']);
  });

  it('does not mutate the input while producing deterministic valid output', () => {
    const input = createInput();
    const expectedInput = structuredClone(input);

    const first = analyzeContractMapping(input);
    const second = analyzeContractMapping(input);

    expect(first).toEqual(second);
    expect(input).toEqual(expectedInput);
  });

  it('rethrows an unexpected OpenAPI loader error by identity without a result or logging', () => {
    const unexpected = new Error('unexpected OpenAPI loader failure');
    vi.mocked(openApiLoader.loadOpenApiDocument).mockImplementationOnce(() => {
      throw unexpected;
    });

    expectUnexpectedThrow(() => analyzeContractMapping(createInput()), unexpected);
    expect(vi.mocked(openApiLoader.loadOpenApiDocument)).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unexpected OpenAPI normalizer error by identity without a result or logging', () => {
    const unexpected = new Error('unexpected OpenAPI normalizer failure');
    vi.mocked(openApiNormalizer.normalizeOpenApiSchema).mockImplementationOnce(() => {
      throw unexpected;
    });

    expectUnexpectedThrow(() => analyzeContractMapping(createInput()), unexpected);
    expect(vi.mocked(openApiNormalizer.normalizeOpenApiSchema)).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unexpected TypeScript loader error by identity without a result or logging', () => {
    const unexpected = new Error('unexpected TypeScript loader failure');
    vi.mocked(typeScriptLoader.loadTypeScriptDeclaration).mockImplementationOnce(() => {
      throw unexpected;
    });

    expectUnexpectedThrow(() => analyzeContractMapping(createInput()), unexpected);
    expect(vi.mocked(typeScriptLoader.loadTypeScriptDeclaration)).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unexpected TypeScript normalizer error by identity without a result or logging', () => {
    const unexpected = new Error('unexpected TypeScript normalizer failure');
    vi.mocked(typeScriptNormalizer.normalizeTypeScriptDeclaration).mockImplementationOnce(() => {
      throw unexpected;
    });

    expectUnexpectedThrow(() => analyzeContractMapping(createInput()), unexpected);
    expect(vi.mocked(typeScriptNormalizer.normalizeTypeScriptDeclaration)).toHaveBeenCalledTimes(1);
  });
});
