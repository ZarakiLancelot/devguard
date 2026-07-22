import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ContractComparisonResult, ContractDifference } from './compare-contracts.js';
import { compareNormalizedContracts } from './compare-contracts.js';
import { createContractFindings } from './create-contract-findings.js';
import type { ContractFindingInput } from './create-contract-findings.js';
import { loadOpenApiDocument } from './openapi/load-openapi.js';
import { normalizeOpenApiSchema } from './openapi/normalize-openapi.js';
import type { NormalizedProperty } from './shared/normalized-contract.js';
import { loadTypeScriptDeclaration } from './typescript/load-typescript.js';
import { normalizeTypeScriptDeclaration } from './typescript/normalize-typescript.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../fixtures');

function property(
  name: string,
  type: NormalizedProperty['type'],
  isArray = false,
  required = false,
): NormalizedProperty {
  return { name, type, isArray, required };
}

function inputFor(differences: ContractDifference[]): ContractFindingInput {
  const comparison: ContractComparisonResult = {
    openapiContract: 'UpdateBookRequest',
    typescriptContract: 'UpdateBookPayload',
    differences,
  };

  return {
    comparison,
    repository: { repositoryId: 'frontend' },
    typescriptFile: {
      path: 'src/types/book.ts',
      startLine: 4,
      endLine: 12,
    },
    mappingName: 'UpdateBook',
  };
}

function createFixtureFindings(fixtureName: string): ReturnType<typeof createContractFindings> {
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
  const openapi = normalizeOpenApiSchema(loadedOpenapi.document, 'UpdateBookRequest');
  if (!openapi.success) {
    throw new Error(`Unable to normalize ${fixtureName} OpenAPI fixture`);
  }

  const loadedTypeScript = loadTypeScriptDeclaration(
    { content: typescriptContent },
    'UpdateBookPayload',
  );
  if (!loadedTypeScript.success) {
    throw new Error(`Unable to load ${fixtureName} TypeScript fixture`);
  }
  const typescript = normalizeTypeScriptDeclaration(loadedTypeScript.declaration);
  if (!typescript.success) {
    throw new Error(`Unable to normalize ${fixtureName} TypeScript fixture`);
  }

  const comparison = compareNormalizedContracts(openapi.contract, typescript.contract);
  return createContractFindings({
    comparison,
    repository: { repositoryId: 'frontend' },
    typescriptFile: { path: 'src/types/book.ts' },
    mappingName: 'UpdateBook',
  });
}

describe('createContractFindings', () => {
  it('should create one high missing-property finding', () => {
    const openapi = property('authorId', 'number', false, true);
    const findings = createContractFindings(
      inputFor([{ kind: 'missing-property', property: 'authorId', openapi }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'contract.missing-property',
      source: 'contract-checker',
      category: 'contract',
      severity: 'high',
      title: 'Missing TypeScript property: authorId',
    });
  });

  it('should create one critical incompatible-type finding', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'incompatible-type',
          property: 'pageCount',
          openapi: property('pageCount', 'number'),
          typescript: property('pageCount', 'string'),
        },
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'contract.incompatible-type',
      category: 'contract',
      severity: 'critical',
      title: 'Incompatible property type: pageCount',
    });
  });

  it('should create one high required-mismatch finding', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'required-mismatch',
          property: 'category',
          openapi: property('category', 'string', false, true),
          typescript: property('category', 'string', false, false),
        },
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'contract.required-mismatch',
      category: 'contract',
      severity: 'high',
      title: 'Required property mismatch: category',
    });
  });

  it('should generate deterministic finding and root-cause IDs', () => {
    const input = inputFor([
      {
        kind: 'missing-property',
        property: 'authorId',
        openapi: property('authorId', 'number', false, true),
      },
    ]);

    const first = createContractFindings(input)[0];
    const second = createContractFindings(input)[0];

    expect(first?.id).toBe(second?.id);
    expect(first?.rootCauseId).toBe(second?.rootCauseId);
    expect(first?.id).toMatch(/^finding-[a-f0-9]{16}$/);
    expect(first?.rootCauseId).toMatch(/^root-[a-f0-9]{16}$/);
  });

  it('should create different finding IDs for different rules on one property', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'incompatible-type',
          property: 'pageCount',
          openapi: property('pageCount', 'number', false, true),
          typescript: property('pageCount', 'string', false, false),
        },
        {
          kind: 'required-mismatch',
          property: 'pageCount',
          openapi: property('pageCount', 'number', false, true),
          typescript: property('pageCount', 'string', false, false),
        },
      ]),
    );

    expect(findings[0]?.id).not.toBe(findings[1]?.id);
  });

  it('should share rootCauseId for type and required differences on one property', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'incompatible-type',
          property: 'pageCount',
          openapi: property('pageCount', 'number', false, true),
          typescript: property('pageCount', 'string', false, false),
        },
        {
          kind: 'required-mismatch',
          property: 'pageCount',
          openapi: property('pageCount', 'number', false, true),
          typescript: property('pageCount', 'string', false, false),
        },
      ]),
    );

    expect(findings[0]?.rootCauseId).toBe(findings[1]?.rootCauseId);
  });

  it('should generate different rootCauseIds for different properties', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'missing-property',
          property: 'authorId',
          openapi: property('authorId', 'number', false, true),
        },
        {
          kind: 'missing-property',
          property: 'category',
          openapi: property('category', 'string', false, true),
        },
      ]),
    );

    expect(findings[0]?.rootCauseId).not.toBe(findings[1]?.rootCauseId);
  });

  it('should propagate file and repository metadata to location', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'missing-property',
          property: 'authorId',
          openapi: property('authorId', 'number', false, true),
        },
      ]),
    );

    expect(findings[0]?.location).toEqual({
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      startLine: 4,
      endLine: 12,
    });
    expect(findings[0]?.metadata).toMatchObject({
      contractMappingName: 'UpdateBook',
      property: 'authorId',
    });
  });

  it('should include normalized evidence for missing property', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'missing-property',
          property: 'authorId',
          openapi: property('authorId', 'number', false, true),
        },
      ]),
    );

    expect(findings[0]?.evidence).toEqual({
      expected: 'authorId: number (required)',
      actual: 'absent from TypeScript payload',
      details: {
        property: 'authorId',
        openapi: {
          name: 'authorId',
          type: 'number',
          isArray: false,
          required: true,
        },
        typescript: 'absent',
      },
    });
  });

  it('should include normalized scalar/array evidence for incompatible type', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'incompatible-type',
          property: 'categories',
          openapi: property('categories', 'string', true, true),
          typescript: property('categories', 'string', false, true),
        },
      ]),
    );

    expect(findings[0]?.evidence).toMatchObject({
      expected: 'categories: string[] (required)',
      actual: 'categories: string (required)',
      details: {
        openapi: { type: 'string', isArray: true },
        typescript: { type: 'string', isArray: false },
      },
    });
  });

  it('should include required-state evidence for required mismatch', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'required-mismatch',
          property: 'category',
          openapi: property('category', 'string', false, true),
          typescript: property('category', 'string', false, false),
        },
      ]),
    );

    expect(findings[0]?.evidence).toMatchObject({
      expected: 'required by OpenAPI',
      actual: 'optional in TypeScript',
      details: {
        property: 'category',
        openapiRequired: true,
        typescriptRequired: false,
      },
    });
  });

  it('should use deterministic recommendation templates', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'missing-property',
          property: 'authorId',
          openapi: property('authorId', 'number', false, true),
        },
        {
          kind: 'incompatible-type',
          property: 'pageCount',
          openapi: property('pageCount', 'number'),
          typescript: property('pageCount', 'string'),
        },
        {
          kind: 'required-mismatch',
          property: 'category',
          openapi: property('category', 'string', false, true),
          typescript: property('category', 'string'),
        },
      ]),
    );

    expect(findings.map((finding) => finding.recommendation)).toEqual([
      'Add property "authorId" to TypeScript payload "UpdateBookPayload" to match OpenAPI.',
      'Align TypeScript property "pageCount" type and array shape with OpenAPI.',
      'Align TypeScript property "category" optionality with the backend OpenAPI contract.',
    ]);
  });

  it('should not include raw source content in IDs or evidence', () => {
    const findings = createContractFindings(
      inputFor([
        {
          kind: 'missing-property',
          property: 'authorId',
          openapi: property('authorId', 'number', false, true),
        },
      ]),
    );
    const finding = findings[0];
    const rawSource = 'export type UpdateBookPayload = { secret: string; };';

    expect(finding?.id).not.toContain(rawSource);
    expect(finding?.rootCauseId).not.toContain(rawSource);
    expect(JSON.stringify(finding?.evidence)).not.toContain('export type');
    expect(JSON.stringify(finding?.evidence)).not.toContain('secret: string');
  });

  it('should produce no findings for an empty comparison', () => {
    expect(createContractFindings(inputFor([]))).toEqual([]);
  });

  it('should preserve the existing comparison difference order', () => {
    const orderedDifferences: ContractDifference[] = [
      {
        kind: 'missing-property',
        property: 'authorId',
        openapi: property('authorId', 'number', false, true),
      },
      {
        kind: 'incompatible-type',
        property: 'category',
        openapi: property('category', 'string'),
        typescript: property('category', 'number'),
      },
      {
        kind: 'required-mismatch',
        property: 'category',
        openapi: property('category', 'string', false, true),
        typescript: property('category', 'string', false, false),
      },
    ];

    const findings = createContractFindings(inputFor(orderedDifferences));

    expect(
      findings.map((finding) => `${finding.metadata?.['property']}:${finding.ruleId}`),
    ).toEqual([
      'authorId:contract.missing-property',
      'category:contract.incompatible-type',
      'category:contract.required-mismatch',
    ]);
  });

  describe('fixture scenarios', () => {
    it('should create the missing-property fixture finding', () => {
      const findings = createFixtureFindings('missing-property');
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'contract.missing-property',
        severity: 'high',
      });
    });

    it('should create the incompatible-type fixture finding', () => {
      const findings = createFixtureFindings('incompatible-type');
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'contract.incompatible-type',
        severity: 'critical',
      });
    });

    it('should create the required-mismatch fixture finding', () => {
      const findings = createFixtureFindings('required-mismatch');
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: 'contract.required-mismatch',
        severity: 'high',
      });
    });
  });
});
