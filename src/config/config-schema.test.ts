import { describe, it, expect } from 'vitest';
import { devGuardConfigSchema } from './config-schema.js';

/** A complete valid configuration matching the requirements.md example. */
const COMPLETE_VALID_CONFIG = {
  version: 1,
  repositories: {
    backend: {
      path: '../customer-store-api',
      baseRef: 'main',
      role: 'backend',
    },
    frontend: {
      path: '../customer-store-web',
      baseRef: 'develop',
      role: 'frontend',
    },
  },
  openapi: {
    repository: 'backend',
    path: 'docs/openapi.yaml',
  },
  contracts: [
    {
      name: 'UpdateCustomerStore',
      openapiSchema: 'UpdateCustomerStoreRequest',
      typescript: {
        repository: 'frontend',
        file: 'src/api/customer-store.types.ts',
        type: 'UpdateCustomerStorePayload',
      },
    },
  ],
  risk: {
    sensitivePatterns: ['**/.env*', '**/auth/**', '**/migrations/**'],
    productionPatterns: ['src/**/*.ts'],
  },
  testing: {
    testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
    requirementsFile: 'requirements.md',
    framework: 'vitest',
  },
  output: {
    directory: '.devguard',
    markdown: 'devguard-report.md',
    json: 'devguard-report.json',
  },
};

/** The smallest valid configuration with all required fields only. */
const MINIMAL_VALID_CONFIG = {
  version: 1,
  repositories: {
    app: {
      path: '.',
      baseRef: 'main',
      role: 'fullstack',
    },
  },
  openapi: {
    repository: 'app',
    path: 'openapi.yaml',
  },
  contracts: [],
};

describe('config-schema', () => {
  describe('valid configurations', () => {
    it('should parse a complete valid configuration', () => {
      const result = devGuardConfigSchema.safeParse(COMPLETE_VALID_CONFIG);
      expect(result.success).toBe(true);
    });

    it('should parse the smallest valid configuration', () => {
      const result = devGuardConfigSchema.safeParse(MINIMAL_VALID_CONFIG);
      expect(result.success).toBe(true);
    });

    it('should allow contracts to be an empty array', () => {
      const config = { ...MINIMAL_VALID_CONFIG, contracts: [] };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should allow omitting all optional sections', () => {
      const { risk: _, testing: __, output: ___, ...required } = COMPLETE_VALID_CONFIG;
      const result = devGuardConfigSchema.safeParse(required);
      expect(result.success).toBe(true);
    });
  });

  describe('version validation', () => {
    it('should reject unsupported version number', () => {
      const config = { ...MINIMAL_VALID_CONFIG, version: 2 };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes('version must be 1'))).toBe(true);
      }
    });

    it('should reject version 0', () => {
      const config = { ...MINIMAL_VALID_CONFIG, version: 0 };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject string version', () => {
      const config = { ...MINIMAL_VALID_CONFIG, version: '1' };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('repository validation', () => {
    it('should reject empty repository map', () => {
      const config = { ...MINIMAL_VALID_CONFIG, repositories: {} };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes('At least one repository'))).toBe(true);
      }
    });

    it('should reject invalid repository role', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        repositories: {
          app: { path: '.', baseRef: 'main', role: 'database' },
        },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty repository path', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        repositories: {
          app: { path: '', baseRef: 'main', role: 'fullstack' },
        },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty baseRef', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        repositories: {
          app: { path: '.', baseRef: '', role: 'fullstack' },
        },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('openapi validation', () => {
    it('should reject missing openapi repository field', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        openapi: { path: 'openapi.yaml' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing openapi path field', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        openapi: { repository: 'app' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty openapi repository string', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        openapi: { repository: '', path: 'openapi.yaml' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty openapi path string', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        openapi: { repository: 'app', path: '' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('contract validation', () => {
    it('should reject empty contract name', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        contracts: [
          {
            name: '',
            openapiSchema: 'Schema',
            typescript: { repository: 'app', file: 'types.ts', type: 'MyType' },
          },
        ],
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty openapiSchema name', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        contracts: [
          {
            name: 'Contract',
            openapiSchema: '',
            typescript: { repository: 'app', file: 'types.ts', type: 'MyType' },
          },
        ],
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty typescript repository', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        contracts: [
          {
            name: 'Contract',
            openapiSchema: 'Schema',
            typescript: { repository: '', file: 'types.ts', type: 'MyType' },
          },
        ],
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty typescript file path', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        contracts: [
          {
            name: 'Contract',
            openapiSchema: 'Schema',
            typescript: { repository: 'app', file: '', type: 'MyType' },
          },
        ],
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty typescript type name', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        contracts: [
          {
            name: 'Contract',
            openapiSchema: 'Schema',
            typescript: { repository: 'app', file: 'types.ts', type: '' },
          },
        ],
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('testing configuration validation', () => {
    it('should reject invalid testing framework', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        testing: { framework: 'mocha' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept valid framework values', () => {
      for (const framework of ['vitest', 'jest', 'scenario-only']) {
        const config = {
          ...MINIMAL_VALID_CONFIG,
          testing: { framework },
        };
        const result = devGuardConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should reject empty strings in test patterns', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        testing: { testPatterns: ['**/*.test.ts', ''] },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('risk configuration validation', () => {
    it('should reject empty strings in sensitive patterns', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        risk: { sensitivePatterns: ['**/.env*', ''] },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty strings in production patterns', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        risk: { productionPatterns: [''] },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('output configuration validation', () => {
    it('should reject empty output directory', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        output: { directory: '' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty markdown filename', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        output: { markdown: '' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty json filename', () => {
      const config = {
        ...MINIMAL_VALID_CONFIG,
        output: { json: '' },
      };
      const result = devGuardConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});
