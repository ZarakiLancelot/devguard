import { describe, it, expect } from 'vitest';
import { generateFindingId, generateRootCauseId, generateAnalysisId } from './ids.js';
import type { FindingIdInput, RootCauseIdInput, AnalysisIdInput } from './ids.js';

describe('generateFindingId', () => {
  const baseInput: FindingIdInput = {
    ruleId: 'contract.missing-property',
    repositoryId: 'frontend',
    file: 'src/types/book.ts',
    subject: 'authorId',
  };

  it('should produce identical IDs for identical inputs', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId(baseInput);
    expect(id1).toBe(id2);
  });

  it('should match finding-<16 hex chars> format', () => {
    const id = generateFindingId(baseInput);
    expect(id).toMatch(/^finding-[a-f0-9]{16}$/);
  });

  it('should change when ruleId changes', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId({ ...baseInput, ruleId: 'contract.incompatible-type' });
    expect(id1).not.toBe(id2);
  });

  it('should change when repositoryId changes', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId({ ...baseInput, repositoryId: 'backend' });
    expect(id1).not.toBe(id2);
  });

  it('should change when file changes', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId({ ...baseInput, file: 'src/types/other.ts' });
    expect(id1).not.toBe(id2);
  });

  it('should change when subject (property) changes', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId({ ...baseInput, subject: 'pageCount' });
    expect(id1).not.toBe(id2);
  });

  it('should change when discriminator changes', () => {
    const id1 = generateFindingId(baseInput);
    const id2 = generateFindingId({ ...baseInput, discriminator: 'extra-context' });
    expect(id1).not.toBe(id2);
  });

  it('should handle missing optional fields consistently', () => {
    const minimal: FindingIdInput = {
      ruleId: 'risk.sensitive-file-change',
      repositoryId: 'backend',
    };
    const id1 = generateFindingId(minimal);
    const id2 = generateFindingId(minimal);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^finding-[a-f0-9]{16}$/);
  });

  it('should produce different IDs when file is present vs absent', () => {
    const withFile = generateFindingId({ ...baseInput, file: 'src/types/book.ts' });
    const withoutFile = generateFindingId({
      ruleId: baseInput.ruleId,
      repositoryId: baseInput.repositoryId,
    });
    expect(withFile).not.toBe(withoutFile);
  });

  it('should not collide for different input combinations', () => {
    const ids = new Set<string>();

    const inputs: FindingIdInput[] = [
      { ruleId: 'a', repositoryId: 'x', file: 'f1' },
      { ruleId: 'a', repositoryId: 'x', file: 'f2' },
      { ruleId: 'a', repositoryId: 'y', file: 'f1' },
      { ruleId: 'b', repositoryId: 'x', file: 'f1' },
      { ruleId: 'a', repositoryId: 'x', file: 'f1', subject: 's1' },
      { ruleId: 'a', repositoryId: 'x', file: 'f1', subject: 's2' },
    ];

    for (const input of inputs) {
      ids.add(generateFindingId(input));
    }

    expect(ids.size).toBe(inputs.length);
  });

  it('should not contain raw input values in the generated ID', () => {
    const id = generateFindingId(baseInput);
    expect(id).not.toContain('contract');
    expect(id).not.toContain('frontend');
    expect(id).not.toContain('book');
    expect(id).not.toContain('authorId');
  });
});

describe('generateRootCauseId', () => {
  const baseInput: RootCauseIdInput = {
    repositoryId: 'frontend',
    file: 'src/types/book.ts',
    mappingName: 'UpdateBook',
    subject: 'authorId',
  };

  it('should match root-<16 hex chars> format', () => {
    const id = generateRootCauseId(baseInput);
    expect(id).toMatch(/^root-[a-f0-9]{16}$/);
  });

  it('should produce identical IDs for identical inputs', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId(baseInput);
    expect(id1).toBe(id2);
  });

  it('should allow two findings with different ruleIds to share one root-cause ID', () => {
    // Root-cause ID does not include ruleId, so two findings about the same
    // property in the same file/mapping share the root cause.
    const rootCause = generateRootCauseId(baseInput);

    const findingA = generateFindingId({
      ruleId: 'contract.missing-property',
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      subject: 'authorId',
    });

    const findingB = generateFindingId({
      ruleId: 'contract.required-mismatch',
      repositoryId: 'frontend',
      file: 'src/types/book.ts',
      subject: 'authorId',
    });

    // Findings differ because ruleId differs
    expect(findingA).not.toBe(findingB);
    // Root cause is the same for both (ruleId excluded)
    expect(rootCause).toBe(generateRootCauseId(baseInput));
  });

  it('should change when repositoryId changes', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId({ ...baseInput, repositoryId: 'backend' });
    expect(id1).not.toBe(id2);
  });

  it('should change when file changes', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId({ ...baseInput, file: 'src/other.ts' });
    expect(id1).not.toBe(id2);
  });

  it('should change when mappingName changes', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId({ ...baseInput, mappingName: 'OtherMapping' });
    expect(id1).not.toBe(id2);
  });

  it('should change when subject changes', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId({ ...baseInput, subject: 'pageCount' });
    expect(id1).not.toBe(id2);
  });

  it('should change when discriminator changes', () => {
    const id1 = generateRootCauseId(baseInput);
    const id2 = generateRootCauseId({ ...baseInput, discriminator: 'extra' });
    expect(id1).not.toBe(id2);
  });

  it('should normalize Windows and Unix paths identically', () => {
    const unix = generateRootCauseId({
      ...baseInput,
      file: 'src/types/book.ts',
    });
    const windows = generateRootCauseId({
      ...baseInput,
      file: 'src\\types\\book.ts',
    });
    expect(unix).toBe(windows);
  });

  it('should not contain raw input values in the generated ID', () => {
    const id = generateRootCauseId(baseInput);
    expect(id).not.toContain('frontend');
    expect(id).not.toContain('book');
    expect(id).not.toContain('UpdateBook');
    expect(id).not.toContain('authorId');
  });
});

describe('generateAnalysisId', () => {
  const baseInput: AnalysisIdInput = {
    configPath: '.devguard.yml',
    repositories: [
      { repositoryId: 'backend', baseRef: 'main', headRef: 'abc123' },
      { repositoryId: 'frontend', baseRef: 'develop', headRef: 'def456' },
    ],
  };

  it('should match analysis-<16 hex chars> format', () => {
    const id = generateAnalysisId(baseInput);
    expect(id).toMatch(/^analysis-[a-f0-9]{16}$/);
  });

  it('should produce identical IDs for identical inputs', () => {
    const id1 = generateAnalysisId(baseInput);
    const id2 = generateAnalysisId(baseInput);
    expect(id1).toBe(id2);
  });

  it('should be order-independent for repositories', () => {
    const reversed: AnalysisIdInput = {
      configPath: baseInput.configPath,
      repositories: [...baseInput.repositories].reverse(),
    };
    const id1 = generateAnalysisId(baseInput);
    const id2 = generateAnalysisId(reversed);
    expect(id1).toBe(id2);
  });

  it('should change when configPath changes', () => {
    const id1 = generateAnalysisId(baseInput);
    const id2 = generateAnalysisId({ ...baseInput, configPath: 'other.yml' });
    expect(id1).not.toBe(id2);
  });

  it('should change when a headRef changes', () => {
    const id1 = generateAnalysisId(baseInput);
    const modified: AnalysisIdInput = {
      configPath: baseInput.configPath,
      repositories: [
        { repositoryId: 'backend', baseRef: 'main', headRef: 'new-sha' },
        { repositoryId: 'frontend', baseRef: 'develop', headRef: 'def456' },
      ],
    };
    const id2 = generateAnalysisId(modified);
    expect(id1).not.toBe(id2);
  });

  it('should change when a repositoryId changes', () => {
    const id1 = generateAnalysisId(baseInput);
    const modified: AnalysisIdInput = {
      configPath: baseInput.configPath,
      repositories: [
        { repositoryId: 'api', baseRef: 'main', headRef: 'abc123' },
        { repositoryId: 'frontend', baseRef: 'develop', headRef: 'def456' },
      ],
    };
    const id2 = generateAnalysisId(modified);
    expect(id1).not.toBe(id2);
  });

  it('should not contain raw input values in the generated ID', () => {
    const id = generateAnalysisId(baseInput);
    expect(id).not.toContain('devguard');
    expect(id).not.toContain('backend');
    expect(id).not.toContain('abc123');
  });
});
