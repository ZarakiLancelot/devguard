import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type {
  NormalizedContract,
  NormalizedPrimitive,
  NormalizedProperty,
} from './shared/normalized-contract.js';
import { loadOpenApiDocument } from './openapi/load-openapi.js';
import { normalizeOpenApiSchema } from './openapi/normalize-openapi.js';
import { loadTypeScriptDeclaration } from './typescript/load-typescript.js';
import { normalizeTypeScriptDeclaration } from './typescript/normalize-typescript.js';
import { compareNormalizedContracts } from './compare-contracts.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../fixtures');

function property(
  name: string,
  type: NormalizedPrimitive,
  isArray = false,
  required = false,
): NormalizedProperty {
  return { name, type, isArray, required };
}

function contract(
  name: string,
  source: 'openapi' | 'typescript',
  properties: NormalizedProperty[],
): NormalizedContract {
  return {
    name,
    source,
    properties: new Map(properties.map((item) => [item.name, item])),
  };
}

function loadFixtureContracts(fixtureName: string): {
  openapi: NormalizedContract;
  typescript: NormalizedContract;
} {
  const openapiContent = fs.readFileSync(
    path.join(FIXTURES_DIR, fixtureName, 'backend/docs/openapi.yaml'),
    'utf-8',
  );
  const typescriptContent = fs.readFileSync(
    path.join(FIXTURES_DIR, fixtureName, 'frontend/src/types/book.ts'),
    'utf-8',
  );

  const loadedOpenapi = loadOpenApiDocument({ content: openapiContent });
  if (!loadedOpenapi.success) {
    throw new Error(`Unable to load ${fixtureName} OpenAPI fixture`);
  }

  const normalizedOpenapi = normalizeOpenApiSchema(loadedOpenapi.document, 'UpdateBookRequest');
  if (!normalizedOpenapi.success) {
    throw new Error(`Unable to normalize ${fixtureName} OpenAPI fixture`);
  }

  const loadedTypeScript = loadTypeScriptDeclaration(
    { content: typescriptContent },
    'UpdateBookPayload',
  );
  if (!loadedTypeScript.success) {
    throw new Error(`Unable to load ${fixtureName} TypeScript fixture`);
  }

  const normalizedTypeScript = normalizeTypeScriptDeclaration(loadedTypeScript.declaration);
  if (!normalizedTypeScript.success) {
    throw new Error(`Unable to normalize ${fixtureName} TypeScript fixture`);
  }

  return {
    openapi: normalizedOpenapi.contract,
    typescript: normalizedTypeScript.contract,
  };
}

describe('compareNormalizedContracts', () => {
  it('should produce no differences for identical contracts', () => {
    const openapi = contract('OpenApiBook', 'openapi', [
      property('isbn', 'string', false, true),
      property('authors', 'string', true),
    ]);
    const typescript = contract('BookPayload', 'typescript', [
      property('isbn', 'string', false, true),
      property('authors', 'string', true),
    ]);

    const result = compareNormalizedContracts(openapi, typescript);

    expect(result).toEqual({
      openapiContract: 'OpenApiBook',
      typescriptContract: 'BookPayload',
      differences: [],
    });
  });

  it('should detect a missing TypeScript property', () => {
    const openapiProperty = property('authorId', 'number', false, true);
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [openapiProperty]),
      contract('Payload', 'typescript', []),
    );

    expect(result.differences).toEqual([
      {
        kind: 'missing-property',
        property: 'authorId',
        openapi: openapiProperty,
      },
    ]);
  });

  it('should ignore TypeScript-only properties', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('isbn', 'string')]),
      contract('Payload', 'typescript', [
        property('isbn', 'string'),
        property('clientOnly', 'boolean'),
      ]),
    );

    expect(result.differences).toEqual([]);
  });

  it('should report string versus number as incompatible-type', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('pageCount', 'string')]),
      contract('Payload', 'typescript', [property('pageCount', 'number')]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['incompatible-type']);
  });

  it('should report boolean versus string as incompatible-type', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('available', 'boolean')]),
      contract('Payload', 'typescript', [property('available', 'string')]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['incompatible-type']);
  });

  it('should report scalar versus array as incompatible-type', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('categories', 'string')]),
      contract('Payload', 'typescript', [property('categories', 'string', true)]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['incompatible-type']);
  });

  it('should report array versus scalar as incompatible-type', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('categories', 'string', true)]),
      contract('Payload', 'typescript', [property('categories', 'string')]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['incompatible-type']);
  });

  it('should produce one incompatible-type when primitive and array shape both differ', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('keywords', 'number', true)]),
      contract('Payload', 'typescript', [property('keywords', 'string')]),
    );

    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.kind).toBe('incompatible-type');
  });

  it('should report required OpenAPI versus optional TypeScript as required-mismatch', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('isbn', 'string', false, true)]),
      contract('Payload', 'typescript', [property('isbn', 'string', false, false)]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['required-mismatch']);
  });

  it('should report optional OpenAPI versus required TypeScript as required-mismatch', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('isbn', 'string', false, false)]),
      contract('Payload', 'typescript', [property('isbn', 'string', false, true)]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual(['required-mismatch']);
  });

  it('should report incompatible-type and required-mismatch for one property', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('pageCount', 'number', false, true)]),
      contract('Payload', 'typescript', [property('pageCount', 'string', false, false)]),
    );

    expect(result.differences.map((difference) => difference.kind)).toEqual([
      'incompatible-type',
      'required-mismatch',
    ]);
  });

  it('should collect differences across multiple properties', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [
        property('authorId', 'number', false, true),
        property('category', 'string', false, true),
        property('pageCount', 'number'),
      ]),
      contract('Payload', 'typescript', [
        property('category', 'string', false, false),
        property('pageCount', 'string'),
      ]),
    );

    expect(
      result.differences.map((difference) => `${difference.property}:${difference.kind}`),
    ).toEqual([
      'authorId:missing-property',
      'category:required-mismatch',
      'pageCount:incompatible-type',
    ]);
  });

  it('should use exact case-sensitive property matching', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [property('isbn', 'string')]),
      contract('Payload', 'typescript', [property('ISBN', 'string')]),
    );

    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.kind).toBe('missing-property');
    expect(result.differences[0]?.property).toBe('isbn');
  });

  it('should order differences by property and stable difference kind', () => {
    const result = compareNormalizedContracts(
      contract('Request', 'openapi', [
        property('zebra', 'number', false, true),
        property('alpha', 'string', false, true),
        property('middle', 'boolean'),
      ]),
      contract('Payload', 'typescript', [
        property('middle', 'string'),
        property('zebra', 'string', false, false),
      ]),
    );

    expect(
      result.differences.map((difference) => `${difference.property}:${difference.kind}`),
    ).toEqual([
      'alpha:missing-property',
      'middle:incompatible-type',
      'zebra:incompatible-type',
      'zebra:required-mismatch',
    ]);
  });

  it('should compare empty contracts without differences', () => {
    const result = compareNormalizedContracts(
      contract('EmptyRequest', 'openapi', []),
      contract('EmptyPayload', 'typescript', []),
    );

    expect(result.differences).toEqual([]);
  });

  describe('fixture scenarios', () => {
    it('should produce no differences for valid-contract fixture', () => {
      const { openapi, typescript } = loadFixtureContracts('valid-contract');
      const result = compareNormalizedContracts(openapi, typescript);
      expect(result.differences).toEqual([]);
    });

    it('should detect the missing-property fixture mismatch', () => {
      const { openapi, typescript } = loadFixtureContracts('missing-property');
      const result = compareNormalizedContracts(openapi, typescript);

      expect(
        result.differences.map((difference) => `${difference.property}:${difference.kind}`),
      ).toEqual(['authorId:missing-property']);
    });

    it('should detect the incompatible-type fixture mismatch', () => {
      const { openapi, typescript } = loadFixtureContracts('incompatible-type');
      const result = compareNormalizedContracts(openapi, typescript);

      expect(
        result.differences.map((difference) => `${difference.property}:${difference.kind}`),
      ).toEqual(['pageCount:incompatible-type']);
    });

    it('should detect the required-mismatch fixture mismatch', () => {
      const { openapi, typescript } = loadFixtureContracts('required-mismatch');
      const result = compareNormalizedContracts(openapi, typescript);

      expect(
        result.differences.map((difference) => `${difference.property}:${difference.kind}`),
      ).toEqual(['category:required-mismatch']);
    });
  });
});
