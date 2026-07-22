import { z } from 'zod';

/**
 * Repository role schema.
 */
export const repositoryRoleSchema = z.enum(['frontend', 'backend', 'fullstack']);

/**
 * Single repository configuration schema.
 */
export const repositoryConfigSchema = z.object({
  path: z.string().min(1, 'Repository path must not be empty'),
  baseRef: z.string().min(1, 'Base reference must not be empty'),
  role: repositoryRoleSchema,
});

/**
 * OpenAPI configuration schema.
 */
export const openapiConfigSchema = z.object({
  repository: z.string().min(1, 'OpenAPI repository reference must not be empty'),
  path: z.string().min(1, 'OpenAPI path must not be empty'),
});

/**
 * TypeScript contract target schema.
 */
export const typescriptTargetSchema = z.object({
  repository: z.string().min(1, 'TypeScript repository reference must not be empty'),
  file: z.string().min(1, 'TypeScript file path must not be empty'),
  type: z.string().min(1, 'TypeScript type name must not be empty'),
});

/**
 * Contract mapping schema.
 */
export const contractMappingSchema = z.object({
  name: z.string().min(1, 'Contract name must not be empty'),
  openapiSchema: z.string().min(1, 'OpenAPI schema name must not be empty'),
  typescript: typescriptTargetSchema,
});

/**
 * Risk configuration schema (optional section).
 */
export const riskConfigSchema = z.object({
  sensitivePatterns: z.array(z.string().min(1, 'Sensitive pattern must not be empty')).optional(),
  productionPatterns: z.array(z.string().min(1, 'Production pattern must not be empty')).optional(),
});

/**
 * Supported test framework schema.
 */
export const testFrameworkSchema = z.enum(['vitest', 'jest', 'scenario-only']);

/**
 * Testing configuration schema (optional section).
 */
export const testingConfigSchema = z.object({
  testPatterns: z.array(z.string().min(1, 'Test pattern must not be empty')).optional(),
  requirementsFile: z.string().min(1, 'Requirements file path must not be empty').optional(),
  framework: testFrameworkSchema.optional(),
});

/**
 * Output configuration schema (optional section).
 */
export const outputConfigSchema = z.object({
  directory: z.string().min(1, 'Output directory must not be empty').optional(),
  markdown: z.string().min(1, 'Markdown filename must not be empty').optional(),
  json: z.string().min(1, 'JSON filename must not be empty').optional(),
});

/**
 * Complete DevGuard configuration schema.
 * Enforces structural validity only. Relational validation (e.g., referenced
 * repositories exist, contract names are unique) is handled separately.
 */
export const devGuardConfigSchema = z.object({
  version: z.literal(1, {
    errorMap: () => ({ message: 'Configuration version must be 1' }),
  }),
  repositories: z
    .record(z.string(), repositoryConfigSchema)
    .refine((repos) => Object.keys(repos).length > 0, {
      message: 'At least one repository must be configured',
    }),
  openapi: openapiConfigSchema,
  contracts: z.array(contractMappingSchema),
  risk: riskConfigSchema.optional(),
  testing: testingConfigSchema.optional(),
  output: outputConfigSchema.optional(),
});

/**
 * Inferred TypeScript types from Zod schemas.
 */
export type RepositoryRole = z.infer<typeof repositoryRoleSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type OpenapiConfig = z.infer<typeof openapiConfigSchema>;
export type TypescriptTarget = z.infer<typeof typescriptTargetSchema>;
export type ContractMapping = z.infer<typeof contractMappingSchema>;
export type RiskConfig = z.infer<typeof riskConfigSchema>;
export type TestingConfig = z.infer<typeof testingConfigSchema>;
export type OutputConfig = z.infer<typeof outputConfigSchema>;
export type DevGuardConfig = z.infer<typeof devGuardConfigSchema>;
