import { z } from 'zod';
import type { PRHealthReport } from '../types/reports.js';

const SAFE_ANALYSIS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

const severitySchema = z.enum(['info', 'warning', 'high', 'critical']);
const categorySchema = z.enum(['risk', 'contract', 'testing']);
const findingSourceSchema = z.enum(['pr-risk-analyzer', 'contract-checker', 'test-generator']);
const repositoryRoleSchema = z.enum(['frontend', 'backend', 'fullstack']);
const healthLabelSchema = z.enum(['HEALTHY', 'REVIEW', 'HIGH_RISK', 'CRITICAL_RISK']);
const supportedTestFrameworkSchema = z.enum(['vitest', 'jest', 'scenario-only']);

const sourceLocationSchema = z
  .object({
    repositoryId: z.string().min(1),
    file: z.string().min(1),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .strict();

const findingEvidenceSchema = z
  .object({
    expected: z.string().optional(),
    actual: z.string().optional(),
    codeSnippet: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

const analysisFindingSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
    rootCauseId: z.string().optional(),
    source: findingSourceSchema,
    category: categorySchema,
    severity: severitySchema,
    title: z.string().min(1),
    description: z.string().min(1),
    location: sourceLocationSchema.optional(),
    evidence: findingEvidenceSchema.optional(),
    recommendation: z.string().optional(),
    relatedFindingIds: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const scoreDeductionSchema = z
  .object({
    findingId: z.string().min(1),
    rootCauseId: z.string().optional(),
    severity: severitySchema,
    points: z.number().finite(),
    reason: z.string().min(1),
  })
  .strict();

const scoreBreakdownSchema = z
  .object({
    initialScore: z.literal(100),
    finalScore: z.number().finite(),
    deductions: z.array(scoreDeductionSchema),
  })
  .strict();

const findingSummarySchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    criticalCount: z.number().int().nonnegative(),
    highCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    infoCount: z.number().int().nonnegative(),
    riskCount: z.number().int().nonnegative(),
    contractCount: z.number().int().nonnegative(),
    testingCount: z.number().int().nonnegative(),
  })
  .strict();

const generatedTestSchema = z
  .object({
    id: z.string().min(1),
    framework: supportedTestFrameworkSchema,
    title: z.string().min(1),
    rationale: z.string().min(1),
    filePath: z.string().optional(),
    code: z.string().optional(),
    relatedFindingIds: z.array(z.string()),
  })
  .strict();

/**
 * Runtime validation for the public PRHealthReport model. Structural report
 * objects are strict; the existing evidence details and finding metadata maps
 * intentionally retain their documented arbitrary key/value support.
 */
export const prHealthReportSchema = z
  .object({
    version: z.literal('1.0'),
    analysisId: z.string().regex(SAFE_ANALYSIS_ID),
    generatedAt: z.string().datetime({ offset: true }),
    source: z
      .object({
        type: z.enum(['local', 'github']),
        label: z.string().min(1),
      })
      .strict(),
    repositories: z.array(
      z
        .object({
          repositoryId: z.string().min(1),
          role: repositoryRoleSchema,
          baseRef: z.string().min(1),
          headRef: z.string().min(1),
        })
        .strict(),
    ),
    healthScore: z.number().finite(),
    healthLabel: healthLabelSchema,
    scoreBreakdown: scoreBreakdownSchema,
    summary: findingSummarySchema,
    findings: z.array(analysisFindingSchema),
    generatedTests: z.array(generatedTestSchema),
    warnings: z.array(z.string().min(1)),
  })
  .strict();

/**
 * Zod optional fields include undefined in their inferred output under
 * exactOptionalPropertyTypes. This one-way assertion ensures every existing
 * PRHealthReport remains structurally acceptable to the runtime schema.
 */
const _prHealthReportSchemaAcceptsReport: PRHealthReport extends z.output<
  typeof prHealthReportSchema
>
  ? true
  : never = true;
