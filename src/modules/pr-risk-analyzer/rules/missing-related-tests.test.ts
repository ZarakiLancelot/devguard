import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../types/repository.js';
import { detectMissingRelatedTests } from './missing-related-tests.js';

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    repositoryId: 'frontend',
    path: 'src/domain/book.ts',
    status: 'modified',
    ...overrides,
  };
}

function detect(
  changedFiles: readonly ChangedFile[],
): ReturnType<typeof detectMissingRelatedTests> {
  return detectMissingRelatedTests({ changedFiles });
}

describe('detectMissingRelatedTests', () => {
  it('creates one warning for a changed .ts production file without a changed related test', () => {
    const findings = detect([changedFile()]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'risk.missing-related-tests',
      severity: 'warning',
      source: 'pr-risk-analyzer',
      category: 'risk',
      location: {
        repositoryId: 'frontend',
        file: 'src/domain/book.ts',
      },
      metadata: {
        productionFile: 'src/domain/book.ts',
        changeStatus: 'modified',
        candidateTestPaths: [
          'src/domain/book.test.ts',
          'src/domain/book.spec.ts',
          'src/domain/__tests__/book.test.ts',
          'src/domain/__tests__/book.spec.ts',
        ],
        heuristic: 'related-test-filename-v1',
      },
    });
  });

  it('creates one warning for a changed .tsx production file without a changed related test', () => {
    const findings = detect([changedFile({ path: 'src/components/book-card.tsx' })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location?.file).toBe('src/components/book-card.tsx');
    expect(findings[0]?.metadata?.['candidateTestPaths']).toEqual([
      'src/components/book-card.test.tsx',
      'src/components/book-card.spec.tsx',
      'src/components/__tests__/book-card.test.tsx',
      'src/components/__tests__/book-card.spec.tsx',
    ]);
  });

  it.each([
    ['.ts same-directory .test', 'src/domain/book.ts', 'src/domain/book.test.ts'],
    ['.ts same-directory .spec', 'src/domain/book.ts', 'src/domain/book.spec.ts'],
    ['.ts sibling __tests__ .test', 'src/domain/book.ts', 'src/domain/__tests__/book.test.ts'],
    ['.ts sibling __tests__ .spec', 'src/domain/book.ts', 'src/domain/__tests__/book.spec.ts'],
    [
      '.tsx same-directory .test',
      'src/components/book-card.tsx',
      'src/components/book-card.test.tsx',
    ],
    [
      '.tsx same-directory .spec',
      'src/components/book-card.tsx',
      'src/components/book-card.spec.tsx',
    ],
    [
      '.tsx sibling __tests__ .test',
      'src/components/book-card.tsx',
      'src/components/__tests__/book-card.test.tsx',
    ],
    [
      '.tsx sibling __tests__ .spec',
      'src/components/book-card.tsx',
      'src/components/__tests__/book-card.spec.tsx',
    ],
  ] as const)(
    'suppresses when an exact %s candidate is changed',
    (_label, productionPath, testPath) => {
      expect(
        detect([changedFile({ path: productionPath }), changedFile({ path: testPath })]),
      ).toEqual([]);
    },
  );

  it('suppresses when one matching candidate is sufficient', () => {
    expect(
      detect([
        changedFile(),
        changedFile({ path: 'src/domain/__tests__/book.spec.ts', status: 'added' }),
      ]),
    ).toEqual([]);
  });

  it('does not change the result when multiple candidate tests are changed', () => {
    const oneCandidate = detect([changedFile(), changedFile({ path: 'src/domain/book.test.ts' })]);
    const manyCandidates = detect([
      changedFile(),
      changedFile({ path: 'src/domain/book.test.ts' }),
      changedFile({ path: 'src/domain/book.spec.ts' }),
      changedFile({ path: 'src/domain/__tests__/book.test.ts' }),
    ]);

    expect(oneCandidate).toEqual([]);
    expect(manyCandidates).toEqual(oneCandidate);
  });

  it('does not allow .test.tsx to suppress a .ts production file', () => {
    const findings = detect([
      changedFile({ path: 'src/domain/book.ts' }),
      changedFile({ path: 'src/domain/book.test.tsx' }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('does not allow .test.ts to suppress a .tsx production file', () => {
    const findings = detect([
      changedFile({ path: 'src/components/book-card.tsx' }),
      changedFile({ path: 'src/components/book-card.test.ts' }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('does not suppress from a related test in another repository', () => {
    const findings = detect([
      changedFile({ repositoryId: 'frontend', path: 'src/domain/book.ts' }),
      changedFile({ repositoryId: 'backend', path: 'src/domain/book.test.ts' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location?.repositoryId).toBe('frontend');
  });

  it('suppresses from an exact candidate in the same repository', () => {
    expect(
      detect([
        changedFile({ repositoryId: 'frontend', path: 'src/domain/book.ts' }),
        changedFile({ repositoryId: 'frontend', path: 'src/domain/book.test.ts' }),
      ]),
    ).toEqual([]);
  });

  it('does not assume an unchanged test exists on disk', () => {
    expect(detect([changedFile({ path: 'src/domain/book.ts' })])).toHaveLength(1);
  });

  it.each(['deleted', 'unknown'] as const)(
    'does not suppress from a related test with %s status',
    (status) => {
      const findings = detect([
        changedFile({ path: 'src/domain/book.ts' }),
        changedFile({ path: 'src/domain/book.test.ts', status }),
      ]);

      expect(findings).toHaveLength(1);
    },
  );

  it.each(['deleted', 'unknown'] as const)(
    'does not analyze a production file with %s status',
    (status) => {
      expect(detect([changedFile({ status })])).toEqual([]);
    },
  );

  it.each(['added', 'modified', 'renamed'] as const)(
    'analyzes a production file with %s status',
    (status) => {
      const findings = detect([changedFile({ status })]);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.metadata?.['changeStatus']).toBe(status);
    },
  );

  it.each([
    'src/domain/book.test.ts',
    'src/domain/book.spec.ts',
    'src/domain/book.test.tsx',
    'src/domain/book.spec.tsx',
  ])('excludes test file %s as a production candidate', (path) => {
    expect(detect([changedFile({ path })])).toEqual([]);
  });

  it('excludes files located inside any __tests__ directory', () => {
    expect(detect([changedFile({ path: 'src/domain/__tests__/book.ts' })])).toEqual([]);
    expect(detect([changedFile({ path: '__tests__/book.ts' })])).toEqual([]);
  });

  it('excludes declaration files', () => {
    expect(detect([changedFile({ path: 'src/domain/book.d.ts' })])).toEqual([]);
  });

  it.each(['src/domain/book.config.ts', 'src/domain/book.config.tsx'])(
    'excludes configuration file %s',
    (path) => {
      expect(detect([changedFile({ path })])).toEqual([]);
    },
  );

  it.each(['src/domain/book.js', 'src/domain/book.jsx'])('ignores JavaScript file %s', (path) => {
    expect(detect([changedFile({ path })])).toEqual([]);
  });

  it.each(['src/domain/book.json', 'styles/book.css', 'styles/book.scss', 'Book.java', 'book.py'])(
    'ignores unrelated extension %s',
    (path) => {
      expect(detect([changedFile({ path })])).toEqual([]);
    },
  );

  it('does not invent exclusions for types.ts, constants.ts, models.ts, or index.ts', () => {
    const findings = detect([
      changedFile({ path: 'src/domain/types.ts' }),
      changedFile({ path: 'src/domain/constants.ts' }),
      changedFile({ path: 'src/domain/models.ts' }),
      changedFile({ path: 'src/domain/index.ts' }),
    ]);

    expect(findings).toHaveLength(4);
  });

  it('normalizes Windows backslash paths before candidate matching', () => {
    const findings = detect([
      changedFile({ path: 'src\\domain\\book.ts' }),
      changedFile({ path: 'src\\domain\\__tests__\\book.spec.ts' }),
    ]);

    expect(findings).toEqual([]);
  });

  it('removes leading current-directory notation before candidate matching', () => {
    const findings = detect([
      changedFile({ path: './src/domain/book.ts' }),
      changedFile({ path: './src/domain/book.test.ts' }),
    ]);

    expect(findings).toEqual([]);
  });

  it('preserves parent segments without resolving them', () => {
    const finding = detect([changedFile({ path: 'src/../domain/book.ts' })])[0];

    expect(finding?.location?.file).toBe('src/../domain/book.ts');
    expect(finding?.metadata?.['candidateTestPaths']).toEqual([
      'src/../domain/book.test.ts',
      'src/../domain/book.spec.ts',
      'src/../domain/__tests__/book.test.ts',
      'src/../domain/__tests__/book.spec.ts',
    ]);
  });

  it('skips absolute-looking paths so they cannot enter findings', () => {
    expect(detect([changedFile({ path: '/home/example-user/book.ts' })])).toEqual([]);
    expect(detect([changedFile({ path: 'C:\\workspace\\book.ts' })])).toEqual([]);
  });

  it('checks only the direct sibling __tests__ directory', () => {
    const findings = detect([
      changedFile({ path: 'src/domain/book.ts' }),
      changedFile({ path: 'src/domain/nested/__tests__/book.test.ts' }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('does not search a parent-level __tests__ directory', () => {
    const findings = detect([
      changedFile({ path: 'src/domain/book.ts' }),
      changedFile({ path: 'src/__tests__/book.test.ts' }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('does not search arbitrary nested test paths', () => {
    const findings = detect([
      changedFile({ path: 'src/domain/book.ts' }),
      changedFile({ path: 'src/domain/tests/book.test.ts' }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('includes all four candidate paths in exact deterministic order', () => {
    const finding = detect([changedFile({ path: 'src/domain/book.ts' })])[0];

    expect(finding?.evidence?.details?.['candidateTestPaths']).toEqual([
      'src/domain/book.test.ts',
      'src/domain/book.spec.ts',
      'src/domain/__tests__/book.test.ts',
      'src/domain/__tests__/book.spec.ts',
    ]);
  });

  it('uses wording limited to the current changed-file set', () => {
    const finding = detect([changedFile()])[0];
    const wording = `${finding?.description ?? ''} ${finding?.recommendation ?? ''}`.toLowerCase();

    expect(wording).toContain('related changed test');
    expect(wording).not.toContain('tests do not exist');
    expect(wording).not.toContain('repository has no tests');
    expect(wording).not.toContain('code is untested');
    expect(wording).not.toContain('defect');
    expect(wording).not.toContain('coverage');
  });

  it('deduplicates repeated production entries using canonical lexical status order', () => {
    const findings = detect([
      changedFile({ status: 'renamed' }),
      changedFile({ status: 'added' }),
      changedFile({ status: 'modified' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata?.['changeStatus']).toBe('added');
  });

  it('does not change output when related test entries are duplicated', () => {
    const oneTest = detect([
      changedFile(),
      changedFile({ path: 'src/domain/book.test.ts', status: 'added' }),
    ]);
    const duplicateTests = detect([
      changedFile(),
      changedFile({ path: 'src/domain/book.test.ts', status: 'added' }),
      changedFile({ path: 'src/domain/book.test.ts', status: 'added' }),
    ]);

    expect(oneTest).toEqual([]);
    expect(duplicateTests).toEqual(oneTest);
  });

  it('returns the same result for reversed input order', () => {
    const changedFiles = [
      changedFile({ repositoryId: 'frontend', path: 'src/domain/zeta.ts' }),
      changedFile({ repositoryId: 'backend', path: 'src/domain/book.ts' }),
      changedFile({ repositoryId: 'frontend', path: 'src/domain/alpha.ts' }),
    ];

    const first = detect(changedFiles);
    const second = detect(changedFiles.toReversed());

    expect(second).toEqual(first);
  });

  it('returns stable deep-equal results, finding IDs, and root causes across repeated calls', () => {
    const changedFiles = [
      changedFile({ repositoryId: 'backend', path: 'src/domain/book.ts' }),
      changedFile({ repositoryId: 'frontend', path: 'src/domain/alpha.ts' }),
    ];

    const first = detect(changedFiles);
    const second = detect(changedFiles);

    expect(second).toEqual(first);
    expect(second.map((finding) => finding.id)).toEqual(first.map((finding) => finding.id));
    expect(second.map((finding) => finding.rootCauseId)).toEqual(
      first.map((finding) => finding.rootCauseId),
    );
  });

  it('orders findings by repositoryId and normalized production path', () => {
    const findings = detect([
      changedFile({ repositoryId: 'frontend', path: 'src/domain/zeta.ts' }),
      changedFile({ repositoryId: 'backend', path: 'src/domain/book.ts' }),
      changedFile({ repositoryId: 'frontend', path: 'src/domain/alpha.ts' }),
    ]);

    expect(
      findings.map((finding) => `${finding.location?.repositoryId}:${finding.location?.file}`),
    ).toEqual([
      'backend:src/domain/book.ts',
      'frontend:src/domain/alpha.ts',
      'frontend:src/domain/zeta.ts',
    ]);
  });

  it('does not mutate input arrays or ChangedFile objects', () => {
    const changedFiles = [
      changedFile({ path: 'src\\domain\\book.ts' }),
      changedFile({ path: 'src\\domain\\book.test.ts' }),
    ];
    const before = structuredClone(changedFiles);

    detect(changedFiles);

    expect(changedFiles).toEqual(before);
  });

  it('does not expose patch bodies, source content, absolute paths, or environment data', () => {
    const patchContent = '+BOOK_LIBRARY_TOKEN=fictional-secret-value';
    const findings = detect([
      changedFile({
        path: 'src/domain/book.ts',
        patch: `${patchContent}\n/home/example-user/private`,
      }),
    ]);
    const serialized = JSON.stringify(findings);

    expect(serialized).not.toContain(patchContent);
    expect(serialized).not.toContain('fictional-secret-value');
    expect(serialized).not.toContain('/home/example-user');
    expect(serialized).not.toContain('NODE_ENV');
  });

  it('keeps identical production paths in separate repositories independent', () => {
    const findings = detect([
      changedFile({ repositoryId: 'backend', path: 'src/domain/book.ts' }),
      changedFile({ repositoryId: 'frontend', path: 'src/domain/book.ts' }),
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.id).not.toBe(findings[1]?.id);
    expect(findings[0]?.rootCauseId).not.toBe(findings[1]?.rootCauseId);
  });

  it('returns an empty result for no changed files', () => {
    expect(detect([])).toEqual([]);
  });

  it('does not create a finding for a changed test file alone', () => {
    expect(detect([changedFile({ path: 'src/domain/book.test.ts' })])).toEqual([]);
  });
});
