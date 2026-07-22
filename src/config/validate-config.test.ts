import { describe, it, expect } from 'vitest';
import type { DevGuardConfig } from './config-schema.js';
import { validateConfig } from './validate-config.js';

/** Helper to create a minimal valid config. */
function makeConfig(overrides: Partial<DevGuardConfig> = {}): DevGuardConfig {
  return {
    version: 1,
    repositories: {
      app: { path: '.', baseRef: 'main', role: 'fullstack' },
    },
    openapi: { repository: 'app', path: 'openapi.yaml' },
    contracts: [],
    ...overrides,
  };
}

describe('validate-config', () => {
  describe('valid configurations', () => {
    it('should accept a single fullstack repository', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'app', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept one frontend plus one backend repository', () => {
      const config = makeConfig({
        repositories: {
          frontend: { path: '../web', baseRef: 'main', role: 'frontend' },
          backend: { path: '../api', baseRef: 'main', role: 'backend' },
        },
        openapi: { repository: 'backend', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept a single frontend repository', () => {
      const config = makeConfig({
        repositories: {
          web: { path: '../web', baseRef: 'main', role: 'frontend' },
        },
        openapi: { repository: 'web', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept a single backend repository', () => {
      const config = makeConfig({
        repositories: {
          api: { path: '../api', baseRef: 'main', role: 'backend' },
        },
        openapi: { repository: 'api', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept contracts referencing configured repositories', () => {
      const config = makeConfig({
        repositories: {
          frontend: { path: '../web', baseRef: 'main', role: 'frontend' },
          backend: { path: '../api', baseRef: 'main', role: 'backend' },
        },
        openapi: { repository: 'backend', path: 'openapi.yaml' },
        contracts: [
          {
            name: 'UserContract',
            openapiSchema: 'UserRequest',
            typescript: { repository: 'frontend', file: 'types.ts', type: 'User' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('repository count validation', () => {
    it('should reject more than two repositories', () => {
      const config = makeConfig({
        repositories: {
          a: { path: './a', baseRef: 'main', role: 'frontend' },
          b: { path: './b', baseRef: 'main', role: 'backend' },
          c: { path: './c', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'a', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'MAX_REPOSITORIES_EXCEEDED')).toBe(true);
    });
  });

  describe('repository role combination validation', () => {
    it('should reject fullstack combined with another repository', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
          extra: { path: '../extra', baseRef: 'main', role: 'frontend' },
        },
        openapi: { repository: 'app', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) => i.code === 'INVALID_ROLE_COMBINATION' && i.message.includes('fullstack'),
        ),
      ).toBe(true);
    });

    it('should reject two frontend repositories', () => {
      const config = makeConfig({
        repositories: {
          web1: { path: './web1', baseRef: 'main', role: 'frontend' },
          web2: { path: './web2', baseRef: 'main', role: 'frontend' },
        },
        openapi: { repository: 'web1', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) => i.code === 'INVALID_ROLE_COMBINATION' && i.message.includes('frontend'),
        ),
      ).toBe(true);
    });

    it('should reject two backend repositories', () => {
      const config = makeConfig({
        repositories: {
          api1: { path: './api1', baseRef: 'main', role: 'backend' },
          api2: { path: './api2', baseRef: 'main', role: 'backend' },
        },
        openapi: { repository: 'api1', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) => i.code === 'INVALID_ROLE_COMBINATION' && i.message.includes('backend'),
        ),
      ).toBe(true);
    });
  });

  describe('openapi repository reference validation', () => {
    it('should reject openapi.repository referencing a non-existent repository', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'nonexistent', path: 'openapi.yaml' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) =>
            i.code === 'OPENAPI_REPOSITORY_NOT_FOUND' &&
            i.path === 'openapi.repository' &&
            i.message.includes('nonexistent'),
        ),
      ).toBe(true);
    });
  });

  describe('contract repository reference validation', () => {
    it('should reject contracts referencing non-existent repositories', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'app', path: 'openapi.yaml' },
        contracts: [
          {
            name: 'MyContract',
            openapiSchema: 'Schema',
            typescript: { repository: 'missing', file: 'types.ts', type: 'Type' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) =>
            i.code === 'CONTRACT_REPOSITORY_NOT_FOUND' &&
            i.path === 'contracts[0].typescript.repository' &&
            i.message.includes('missing'),
        ),
      ).toBe(true);
    });

    it('should report each invalid contract reference individually', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'app', path: 'openapi.yaml' },
        contracts: [
          {
            name: 'A',
            openapiSchema: 'SchemaA',
            typescript: { repository: 'bad1', file: 'a.ts', type: 'A' },
          },
          {
            name: 'B',
            openapiSchema: 'SchemaB',
            typescript: { repository: 'bad2', file: 'b.ts', type: 'B' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      const refIssues = result.issues.filter((i) => i.code === 'CONTRACT_REPOSITORY_NOT_FOUND');
      expect(refIssues).toHaveLength(2);
      expect(refIssues[0]?.path).toBe('contracts[0].typescript.repository');
      expect(refIssues[1]?.path).toBe('contracts[1].typescript.repository');
    });
  });

  describe('unique contract names validation', () => {
    it('should reject duplicate contract names', () => {
      const config = makeConfig({
        contracts: [
          {
            name: 'SameName',
            openapiSchema: 'Schema1',
            typescript: { repository: 'app', file: 'a.ts', type: 'A' },
          },
          {
            name: 'SameName',
            openapiSchema: 'Schema2',
            typescript: { repository: 'app', file: 'b.ts', type: 'B' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) =>
            i.code === 'DUPLICATE_CONTRACT_NAME' &&
            i.path === 'contracts[1].name' &&
            i.message.includes('SameName'),
        ),
      ).toBe(true);
    });

    it('should accept unique contract names', () => {
      const config = makeConfig({
        contracts: [
          {
            name: 'ContractA',
            openapiSchema: 'Schema1',
            typescript: { repository: 'app', file: 'a.ts', type: 'A' },
          },
          {
            name: 'ContractB',
            openapiSchema: 'Schema2',
            typescript: { repository: 'app', file: 'b.ts', type: 'B' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('multiple issues', () => {
    it('should collect all issues rather than stopping at the first', () => {
      const config = makeConfig({
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'fullstack' },
        },
        openapi: { repository: 'nonexistent', path: 'openapi.yaml' },
        contracts: [
          {
            name: 'Dup',
            openapiSchema: 'S1',
            typescript: { repository: 'missing', file: 'a.ts', type: 'A' },
          },
          {
            name: 'Dup',
            openapiSchema: 'S2',
            typescript: { repository: 'app', file: 'b.ts', type: 'B' },
          },
        ],
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      // Should have: openapi ref, contract ref, duplicate name
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });
});
