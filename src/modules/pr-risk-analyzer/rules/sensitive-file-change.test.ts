import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../types/repository.js';
import { detectSensitiveFileChanges } from './sensitive-file-change.js';

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    repositoryId: 'frontend',
    path: 'src/auth/book-token.ts',
    status: 'modified',
    ...overrides,
  };
}

describe('detectSensitiveFileChanges', () => {
  it('creates exactly one high finding for a matching changed file', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'config/secrets.yml' })],
      sensitivePatterns: ['config/secrets.*'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'risk.sensitive-file-change',
      source: 'pr-risk-analyzer',
      category: 'risk',
      severity: 'high',
      location: {
        repositoryId: 'frontend',
        file: 'config/secrets.yml',
      },
      metadata: {
        matchingPattern: 'config/secrets.*',
        changeStatus: 'modified',
      },
    });
  });

  it('returns no finding for a non-matching changed file', () => {
    expect(
      detectSensitiveFileChanges({
        changedFiles: [changedFile({ path: 'src/types/book.ts' })],
        sensitivePatterns: ['**/auth/**'],
      }),
    ).toEqual([]);
  });

  it('records the selected matching pattern in evidence', () => {
    const finding = detectSensitiveFileChanges({
      changedFiles: [changedFile()],
      sensitivePatterns: ['**/auth/**'],
    })[0];

    expect(finding?.evidence).toEqual({
      expected: 'a changed path outside configured sensitive-file patterns',
      actual:
        'changed path "src/auth/book-token.ts" matches configured sensitive-file pattern "**/auth/**"',
      details: {
        matchingPattern: '**/auth/**',
        changeStatus: 'modified',
      },
    });
  });

  it('reports elevated review risk without claiming an actual secret or vulnerability', () => {
    const finding = detectSensitiveFileChanges({
      changedFiles: [changedFile()],
      sensitivePatterns: ['**/auth/**'],
    })[0];
    const publicText =
      `${finding?.description ?? ''} ${finding?.recommendation ?? ''}`.toLowerCase();

    expect(publicText).toContain('elevated review');
    expect(publicText).not.toContain('contains a secret');
    expect(publicText).not.toContain('credentials');
    expect(publicText).not.toContain('vulnerability');
  });

  it('uses the first configured matching pattern when multiple patterns match', () => {
    const finding = detectSensitiveFileChanges({
      changedFiles: [changedFile()],
      sensitivePatterns: ['**/auth/**', '**/*.ts'],
    })[0];

    expect(finding?.metadata?.['matchingPattern']).toBe('**/auth/**');
    expect(finding?.evidence?.details?.['matchingPattern']).toBe('**/auth/**');
  });

  it('does not emit duplicate findings when multiple patterns match one file', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile()],
      sensitivePatterns: ['**/auth/**', '**/*.ts', 'src/**'],
    });

    expect(findings).toHaveLength(1);
  });

  it('creates distinct findings for multiple distinct matching files', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [
        changedFile({ path: 'src/auth/book-token.ts' }),
        changedFile({ path: 'config/secrets.yml' }),
      ],
      sensitivePatterns: ['**/auth/**', 'config/secrets.*'],
    });

    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(2);
    expect(new Set(findings.map((finding) => finding.rootCauseId)).size).toBe(2);
  });

  it('keeps identical paths in different repositories independent', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [
        changedFile({ repositoryId: 'backend', path: 'config/secrets.yml' }),
        changedFile({ repositoryId: 'frontend', path: 'config/secrets.yml' }),
      ],
      sensitivePatterns: ['config/secrets.*'],
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.location?.repositoryId).toBe('backend');
    expect(findings[1]?.location?.repositoryId).toBe('frontend');
    expect(findings[0]?.id).not.toBe(findings[1]?.id);
    expect(findings[0]?.rootCauseId).not.toBe(findings[1]?.rootCauseId);
  });

  it('matches forward-slash paths', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'src/auth/book-token.ts' })],
      sensitivePatterns: ['**/auth/**'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location?.file).toBe('src/auth/book-token.ts');
  });

  it('normalizes backslash paths before matching and reporting', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'src\\auth\\book-token.ts' })],
      sensitivePatterns: ['**/auth/**'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location?.file).toBe('src/auth/book-token.ts');
  });

  it('removes leading current-directory notation before matching and reporting', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: './config/secrets.yml' })],
      sensitivePatterns: ['config/secrets.*'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location?.file).toBe('config/secrets.yml');
  });

  it('matches dotfiles', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'services/library/.env.production' })],
      sensitivePatterns: ['**/.env.*'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata?.['matchingPattern']).toBe('**/.env.*');
  });

  it('allows globstar to cross nested directories', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'packages/digital-library/auth/token.ts' })],
      sensitivePatterns: ['**/auth/**'],
    });

    expect(findings).toHaveLength(1);
  });

  it('uses case-sensitive matching', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ path: 'src/Auth/book-token.ts' })],
      sensitivePatterns: ['**/auth/**'],
    });

    expect(findings).toEqual([]);
  });

  it('returns no findings when patterns are empty', () => {
    expect(
      detectSensitiveFileChanges({
        changedFiles: [changedFile()],
        sensitivePatterns: [],
      }),
    ).toEqual([]);
  });

  it('returns no findings when changed files are empty', () => {
    expect(
      detectSensitiveFileChanges({
        changedFiles: [],
        sensitivePatterns: ['**/auth/**'],
      }),
    ).toEqual([]);
  });

  it('treats deleted files as eligible changed files', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [changedFile({ status: 'deleted' })],
      sensitivePatterns: ['**/auth/**'],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata?.['changeStatus']).toBe('deleted');
  });

  it('sorts findings by repository, normalized path, and selected pattern', () => {
    const findings = detectSensitiveFileChanges({
      changedFiles: [
        changedFile({ repositoryId: 'frontend', path: 'src/auth/zeta.ts' }),
        changedFile({ repositoryId: 'backend', path: 'config/secrets.yml' }),
        changedFile({ repositoryId: 'frontend', path: 'config/secrets.yml' }),
      ],
      sensitivePatterns: ['**/auth/**', 'config/secrets.*'],
    });

    expect(
      findings.map(
        (finding) =>
          `${finding.location?.repositoryId}:${finding.location?.file}:${finding.metadata?.['matchingPattern']}`,
      ),
    ).toEqual([
      'backend:config/secrets.yml:config/secrets.*',
      'frontend:config/secrets.yml:config/secrets.*',
      'frontend:src/auth/zeta.ts:**/auth/**',
    ]);
  });

  it.each(['added', 'modified', 'deleted', 'renamed', 'unknown'] as const)(
    'treats %s files as eligible changed files',
    (status) => {
      const findings = detectSensitiveFileChanges({
        changedFiles: [changedFile({ status })],
        sensitivePatterns: ['**/auth/**'],
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.metadata?.['changeStatus']).toBe(status);
    },
  );

  it('returns identical ordering for differently ordered input files', () => {
    const changedFiles = [
      changedFile({ repositoryId: 'frontend', path: 'src/auth/zeta.ts' }),
      changedFile({ repositoryId: 'backend', path: 'config/secrets.yml' }),
      changedFile({ repositoryId: 'frontend', path: 'config/secrets.yml' }),
    ];
    const sensitivePatterns = ['**/auth/**', 'config/secrets.*'];

    const first = detectSensitiveFileChanges({ changedFiles, sensitivePatterns });
    const second = detectSensitiveFileChanges({
      changedFiles: changedFiles.toReversed(),
      sensitivePatterns,
    });

    expect(second).toEqual(first);
  });

  it('returns stable deep-equal output and IDs across repeated calls', () => {
    const input = {
      changedFiles: [
        changedFile({ repositoryId: 'backend', path: 'config/secrets.yml' }),
        changedFile({ path: 'src/auth/book-token.ts' }),
      ],
      sensitivePatterns: ['**/auth/**', 'config/secrets.*'],
    };

    const first = detectSensitiveFileChanges(input);
    const second = detectSensitiveFileChanges(input);

    expect(second).toEqual(first);
    expect(second.map((finding) => finding.id)).toEqual(first.map((finding) => finding.id));
    expect(second.map((finding) => finding.rootCauseId)).toEqual(
      first.map((finding) => finding.rootCauseId),
    );
  });

  it('does not mutate input arrays or ChangedFile objects', () => {
    const files = [changedFile({ path: 'src\\auth\\book-token.ts' })];
    const patterns = ['**/auth/**'];
    const beforeFiles = structuredClone(files);
    const beforePatterns = structuredClone(patterns);

    detectSensitiveFileChanges({ changedFiles: files, sensitivePatterns: patterns });

    expect(files).toEqual(beforeFiles);
    expect(patterns).toEqual(beforePatterns);
  });

  it('does not expose patch bodies, source content, or absolute local paths', () => {
    const patchContent = '+BOOK_LIBRARY_TOKEN=fictional-secret-value';
    const findings = detectSensitiveFileChanges({
      changedFiles: [
        changedFile({
          path: 'config/secrets.yml',
          patch: patchContent,
        }),
      ],
      sensitivePatterns: ['config/secrets.*'],
    });
    const serialized = JSON.stringify(findings);

    expect(serialized).not.toContain(patchContent);
    expect(serialized).not.toContain('fictional-secret-value');
    expect(serialized).not.toContain('/home/');
  });
});
