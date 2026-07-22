import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadOpenApiDocument } from './load-openapi.js';
import { normalizeOpenApiSchema } from './normalize-openapi.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../fixtures');

/** Helper to load a fixture's OpenAPI document. */
function loadFixtureDocument(fixtureName: string): Record<string, unknown> {
  const content = fs.readFileSync(
    path.join(FIXTURES_DIR, fixtureName, 'backend/docs/openapi.yaml'),
    'utf-8',
  );
  const result = loadOpenApiDocument({ content });
  if (!result.success) {
    throw new Error(`Failed to load fixture ${fixtureName}: ${result.error.message}`);
  }
  return result.document;
}

/** Helper to build a minimal valid OpenAPI document with a given schema. */
function makeDocument(schemas: Record<string, unknown>): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    components: { schemas },
  };
}

describe('normalizeOpenApiSchema', () => {
  describe('schema lookup', () => {
    it('should find a schema by exact name', () => {
      const doc = makeDocument({
        MySchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'MySchema');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.name).toBe('MySchema');
      }
    });

    it('should return OPENAPI_SCHEMA_NOT_FOUND when schema does not exist', () => {
      const doc = makeDocument({ OtherSchema: { type: 'object', properties: {} } });
      const result = normalizeOpenApiSchema(doc, 'NonExistent');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMA_NOT_FOUND');
      }
    });

    it('should perform case-sensitive lookup', () => {
      const doc = makeDocument({
        MySchema: { type: 'object', properties: { a: { type: 'string' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'myschema');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMA_NOT_FOUND');
      }
    });

    it('should return OPENAPI_SCHEMA_NOT_FOUND when document has no components', () => {
      const doc = { openapi: '3.0.3', paths: {} };
      const result = normalizeOpenApiSchema(doc, 'Schema');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMA_NOT_FOUND');
      }
    });

    it('should return OPENAPI_SCHEMA_INVALID for non-object schema', () => {
      const doc = makeDocument({ BadSchema: 'not an object' });
      const result = normalizeOpenApiSchema(doc, 'BadSchema');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMA_INVALID');
      }
    });
  });

  describe('primitive type normalization', () => {
    it('should normalize string property', () => {
      const doc = makeDocument({
        S: { type: 'object', properties: { name: { type: 'string' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        const prop = result.contract.properties.get('name');
        expect(prop).toEqual({ name: 'name', type: 'string', isArray: false, required: false });
      }
    });

    it('should normalize integer to number', () => {
      const doc = makeDocument({
        S: { type: 'object', properties: { count: { type: 'integer' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        const prop = result.contract.properties.get('count');
        expect(prop?.type).toBe('number');
        expect(prop?.isArray).toBe(false);
      }
    });

    it('should normalize number to number', () => {
      const doc = makeDocument({
        S: { type: 'object', properties: { score: { type: 'number' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('score')?.type).toBe('number');
      }
    });

    it('should normalize boolean property', () => {
      const doc = makeDocument({
        S: { type: 'object', properties: { active: { type: 'boolean' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        const prop = result.contract.properties.get('active');
        expect(prop?.type).toBe('boolean');
        expect(prop?.isArray).toBe(false);
      }
    });
  });

  describe('array normalization', () => {
    it('should normalize primitive string array', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        const prop = result.contract.properties.get('tags');
        expect(prop).toEqual({ name: 'tags', type: 'string', isArray: true, required: false });
      }
    });

    it('should normalize primitive number array (integer items)', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          properties: { ids: { type: 'array', items: { type: 'integer' } } },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        const prop = result.contract.properties.get('ids');
        expect(prop?.type).toBe('number');
        expect(prop?.isArray).toBe(true);
      }
    });
  });

  describe('required/optional handling', () => {
    it('should mark property as required when in required array', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('name')?.required).toBe(true);
      }
    });

    it('should mark property as optional when not in required array', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          required: ['other'],
          properties: { name: { type: 'string' }, other: { type: 'string' } },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('name')?.required).toBe(false);
        expect(result.contract.properties.get('other')?.required).toBe(true);
      }
    });
  });

  describe('multiple properties', () => {
    it('should normalize multiple supported properties', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            active: { type: 'boolean' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.size).toBe(4);
        expect(result.contract.properties.get('id')).toEqual({
          name: 'id',
          type: 'number',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('name')).toEqual({
          name: 'name',
          type: 'string',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('active')).toEqual({
          name: 'active',
          type: 'boolean',
          isArray: false,
          required: false,
        });
        expect(result.contract.properties.get('tags')).toEqual({
          name: 'tags',
          type: 'string',
          isArray: true,
          required: false,
        });
      }
    });
  });

  describe('invalid schema structure', () => {
    it('should handle missing properties object (empty contract)', () => {
      const doc = makeDocument({
        S: { type: 'object' },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.size).toBe(0);
      }
    });

    it('should return OPENAPI_PROPERTIES_INVALID for non-object properties', () => {
      const doc = makeDocument({
        S: { type: 'object', properties: 'invalid' },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_PROPERTIES_INVALID');
      }
    });

    it('should return OPENAPI_REQUIRED_INVALID for non-array required', () => {
      const doc = makeDocument({
        S: { type: 'object', required: 'name', properties: { name: { type: 'string' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_REQUIRED_INVALID');
      }
    });

    it('should return OPENAPI_REQUIRED_INVALID for non-string entries in required', () => {
      const doc = makeDocument({
        S: { type: 'object', required: [123], properties: { name: { type: 'string' } } },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_REQUIRED_INVALID');
      }
    });
  });

  describe('unsupported properties', () => {
    it('should warn and skip unsupported object property', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'object', properties: { street: { type: 'string' } } },
          },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.has('name')).toBe(true);
        expect(result.contract.properties.has('address')).toBe(false);
        expect(result.warnings.some((w) => w.property === 'address')).toBe(true);
      }
    });

    it('should warn and skip unsupported nested array (object items)', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object' } },
          },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.has('items')).toBe(false);
        expect(result.warnings.some((w) => w.code === 'OPENAPI_ARRAY_ITEMS_UNSUPPORTED')).toBe(
          true,
        );
      }
    });

    it('should warn and skip $ref property', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            nested: { $ref: '#/components/schemas/Other' },
          },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.has('name')).toBe(true);
        expect(result.contract.properties.has('nested')).toBe(false);
        expect(result.warnings.some((w) => w.code === 'OPENAPI_REF_UNSUPPORTED')).toBe(true);
      }
    });

    it('should return OPENAPI_REF_UNSUPPORTED for schema-level $ref', () => {
      const doc = makeDocument({
        S: { $ref: '#/components/schemas/Other' },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_REF_UNSUPPORTED');
      }
    });

    it('should preserve supported properties when another is unsupported', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            nested: { type: 'object', properties: {} },
            name: { type: 'string' },
          },
        },
      });
      const result = normalizeOpenApiSchema(doc, 'S');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.size).toBe(2);
        expect(result.contract.properties.get('id')?.type).toBe('number');
        expect(result.contract.properties.get('name')?.type).toBe('string');
        expect(result.warnings).toHaveLength(1);
      }
    });
  });

  describe('deterministic output', () => {
    it('should produce deterministic property map contents', () => {
      const doc = makeDocument({
        S: {
          type: 'object',
          required: ['b'],
          properties: {
            a: { type: 'string' },
            b: { type: 'integer' },
            c: { type: 'boolean' },
          },
        },
      });
      const r1 = normalizeOpenApiSchema(doc, 'S');
      const r2 = normalizeOpenApiSchema(doc, 'S');
      expect(r1).toEqual(r2);
    });
  });

  describe('fixture scenarios', () => {
    it('should normalize the valid-contract fixture schema', () => {
      const doc = loadFixtureDocument('valid-contract');
      const result = normalizeOpenApiSchema(doc, 'UpdateBookRequest');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('isbn')).toEqual({
          name: 'isbn',
          type: 'string',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('active')).toEqual({
          name: 'active',
          type: 'boolean',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('tags')).toEqual({
          name: 'tags',
          type: 'string',
          isArray: true,
          required: false,
        });
        expect(result.warnings).toHaveLength(0);
      }
    });

    it('should normalize the incompatible-type fixture schema', () => {
      const doc = loadFixtureDocument('incompatible-type');
      const result = normalizeOpenApiSchema(doc, 'UpdateBookRequest');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('pageCount')).toEqual({
          name: 'pageCount',
          type: 'number',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('isbn')).toEqual({
          name: 'isbn',
          type: 'string',
          isArray: false,
          required: false,
        });
      }
    });

    it('should normalize the required-mismatch fixture schema', () => {
      const doc = loadFixtureDocument('required-mismatch');
      const result = normalizeOpenApiSchema(doc, 'UpdateBookRequest');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('category')?.required).toBe(true);
        expect(result.contract.properties.get('isbn')?.required).toBe(true);
      }
    });
  });
});
