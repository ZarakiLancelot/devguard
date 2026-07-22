import { describe, expect, it } from 'vitest';
import { selectRequirementsSource } from './select-requirements-source.js';

describe('selectRequirementsSource', () => {
  it('selects a present CLI path before a config path', () => {
    expect(
      selectRequirementsSource({
        cliPath: 'cli-requirements.md',
        configPath: 'config-requirements.md',
      }),
    ).toEqual({ source: 'cli', path: 'cli-requirements.md' });
  });

  it('selects a config path when the CLI path is absent', () => {
    expect(selectRequirementsSource({ configPath: 'requirements.md' })).toEqual({
      source: 'config',
      path: 'requirements.md',
    });
  });

  it('returns no source when both paths are absent', () => {
    expect(selectRequirementsSource({})).toEqual({ source: 'none' });
  });

  it('does not inspect path existence while selecting a source', () => {
    expect(selectRequirementsSource({ cliPath: '/path/that/does/not/exist' })).toEqual({
      source: 'cli',
      path: '/path/that/does/not/exist',
    });
  });

  it('treats an invalid-looking CLI path as present until loader validation', () => {
    expect(
      selectRequirementsSource({ cliPath: '\u0000invalid', configPath: 'requirements.md' }),
    ).toEqual({
      source: 'cli',
      path: '\u0000invalid',
    });
  });

  it('treats an empty CLI path as absent and selects config', () => {
    expect(selectRequirementsSource({ cliPath: '', configPath: 'requirements.md' })).toEqual({
      source: 'config',
      path: 'requirements.md',
    });
  });

  it('treats a whitespace-only CLI path as absent and selects config', () => {
    expect(selectRequirementsSource({ cliPath: '   ', configPath: 'requirements.md' })).toEqual({
      source: 'config',
      path: 'requirements.md',
    });
  });

  it('returns no source for empty or whitespace-only config paths', () => {
    expect(selectRequirementsSource({ configPath: '' })).toEqual({ source: 'none' });
    expect(selectRequirementsSource({ configPath: ' \t ' })).toEqual({ source: 'none' });
  });

  it('preserves a selected non-empty path without trimming or normalization', () => {
    expect(
      selectRequirementsSource({
        cliPath: ' ./requirements.md ',
        configPath: 'config.md',
      }),
    ).toEqual({ source: 'cli', path: ' ./requirements.md ' });
  });

  it('is deterministic and does not mutate its input', () => {
    const input = {
      cliPath: '  cli-requirements.md  ',
      configPath: 'config-requirements.md',
    };
    const before = structuredClone(input);
    const first = selectRequirementsSource(input);

    expect(selectRequirementsSource(input)).toEqual(first);
    expect(input).toEqual(before);
  });
});
