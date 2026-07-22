import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadOpenApiDocument } from './load-openapi.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../fixtures');

const VALID_YAML_30 = `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths: {}
components:
  schemas:
    TestSchema:
      type: object
      properties:
        name:
          type: string
`;

const VALID_YAML_31 = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths: {}
components:
  schemas:
    TestSchema:
      type: object
      properties:
        name:
          type: string
`;

const VALID_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      TestSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
    },
  },
});

describe('loadOpenApiDocument', () => {
  describe('valid documents', () => {
    it('should load a valid YAML OpenAPI 3.0 document', () => {
      const result = loadOpenApiDocument({ content: VALID_YAML_30 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document['openapi']).toBe('3.0.3');
        expect(result.warnings).toHaveLength(0);
      }
    });

    it('should load a valid YAML OpenAPI 3.1 document', () => {
      const result = loadOpenApiDocument({ content: VALID_YAML_31 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document['openapi']).toBe('3.1.0');
      }
    });

    it('should load a valid JSON document', () => {
      const result = loadOpenApiDocument({ content: VALID_JSON, format: 'json' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document['openapi']).toBe('3.0.3');
      }
    });

    it('should auto-detect YAML format', () => {
      const result = loadOpenApiDocument({ content: VALID_YAML_30, format: 'auto' });
      expect(result.success).toBe(true);
    });

    it('should auto-detect JSON format', () => {
      const result = loadOpenApiDocument({ content: VALID_JSON, format: 'auto' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document['openapi']).toBe('3.0.3');
      }
    });

    it('should load the valid-contract fixture', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'valid-contract/backend/docs/openapi.yaml'),
        'utf-8',
      );
      const result = loadOpenApiDocument({ content, sourceLabel: 'valid-contract' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document['openapi']).toBe('3.0.3');
      }
    });

    it('should accept a document without components', () => {
      const content = `
openapi: 3.0.3
info:
  title: Minimal
  version: 1.0.0
paths: {}
`;
      const result = loadOpenApiDocument({ content });
      expect(result.success).toBe(true);
    });

    it('should accept components without schemas', () => {
      const content = `
openapi: 3.0.3
info:
  title: Minimal
  version: 1.0.0
paths: {}
components:
  securitySchemes: {}
`;
      const result = loadOpenApiDocument({ content });
      expect(result.success).toBe(true);
    });
  });

  describe('parse failures', () => {
    it('should return OPENAPI_PARSE_FAILED for malformed YAML', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'malformed-openapi/backend/docs/openapi.yaml'),
        'utf-8',
      );
      const result = loadOpenApiDocument({
        content,
        format: 'yaml',
        sourceLabel: 'malformed.yaml',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_PARSE_FAILED');
        expect(result.error.sourceLabel).toBe('malformed.yaml');
      }
    });

    it('should return OPENAPI_PARSE_FAILED for malformed JSON', () => {
      const result = loadOpenApiDocument({
        content: '{ "openapi": "3.0.3", invalid }',
        format: 'json',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_PARSE_FAILED');
      }
    });

    it('should not throw uncaught exceptions for malformed content', () => {
      const badInputs = [':::invalid:::yaml:::', '{ broken json', '', '   ', '\x00\x01\x02'];

      for (const content of badInputs) {
        expect(() => loadOpenApiDocument({ content })).not.toThrow();
      }
    });
  });

  describe('root validation', () => {
    it('should return OPENAPI_ROOT_INVALID for a parsed array', () => {
      const result = loadOpenApiDocument({ content: '[1, 2, 3]', format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_ROOT_INVALID');
      }
    });

    it('should return OPENAPI_ROOT_INVALID for null root', () => {
      const result = loadOpenApiDocument({ content: 'null', format: 'yaml' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_ROOT_INVALID');
      }
    });

    it('should return OPENAPI_ROOT_INVALID for a scalar root', () => {
      const result = loadOpenApiDocument({ content: '"just a string"', format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_ROOT_INVALID');
      }
    });
  });

  describe('version validation', () => {
    it('should return OPENAPI_VERSION_MISSING when openapi field is absent', () => {
      const content = JSON.stringify({ info: { title: 'No version' }, paths: {} });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_VERSION_MISSING');
      }
    });

    it('should return OPENAPI_VERSION_MISSING when openapi field is empty', () => {
      const content = JSON.stringify({ openapi: '', paths: {} });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_VERSION_MISSING');
      }
    });

    it('should return OPENAPI_VERSION_UNSUPPORTED for OpenAPI 2.0 (Swagger)', () => {
      const content = JSON.stringify({ openapi: '2.0.0', paths: {} });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_VERSION_UNSUPPORTED');
        expect(result.error.message).toContain('2.0.0');
      }
    });

    it('should return OPENAPI_VERSION_UNSUPPORTED for OpenAPI 4.x', () => {
      const content = JSON.stringify({ openapi: '4.0.0', paths: {} });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_VERSION_UNSUPPORTED');
      }
    });
  });

  describe('components validation', () => {
    it('should return OPENAPI_COMPONENTS_INVALID when components is an array', () => {
      const content = JSON.stringify({
        openapi: '3.0.3',
        paths: {},
        components: [],
      });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_COMPONENTS_INVALID');
      }
    });

    it('should return OPENAPI_COMPONENTS_INVALID when components is null', () => {
      const content = JSON.stringify({
        openapi: '3.0.3',
        paths: {},
        components: null,
      });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_COMPONENTS_INVALID');
      }
    });

    it('should return OPENAPI_SCHEMAS_INVALID when schemas is an array', () => {
      const content = JSON.stringify({
        openapi: '3.0.3',
        paths: {},
        components: { schemas: [] },
      });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMAS_INVALID');
      }
    });

    it('should return OPENAPI_SCHEMAS_INVALID when schemas is a string', () => {
      const content = JSON.stringify({
        openapi: '3.0.3',
        paths: {},
        components: { schemas: 'invalid' },
      });
      const result = loadOpenApiDocument({ content, format: 'json' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPENAPI_SCHEMAS_INVALID');
      }
    });
  });

  describe('source label propagation', () => {
    it('should include sourceLabel in success result warnings', () => {
      const result = loadOpenApiDocument({
        content: VALID_YAML_30,
        sourceLabel: 'backend/docs/openapi.yaml',
      });
      expect(result.success).toBe(true);
    });

    it('should include sourceLabel in error results', () => {
      const result = loadOpenApiDocument({
        content: 'not valid yaml: [[[',
        sourceLabel: 'broken-file.yaml',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.sourceLabel).toBe('broken-file.yaml');
      }
    });

    it('should include sourceLabel in version errors', () => {
      const content = JSON.stringify({ openapi: '2.0.0', paths: {} });
      const result = loadOpenApiDocument({
        content,
        format: 'json',
        sourceLabel: 'old-spec.json',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.sourceLabel).toBe('old-spec.json');
      }
    });
  });
});
