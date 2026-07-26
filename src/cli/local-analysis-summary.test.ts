import { describe, expect, it, vi } from 'vitest';
import { formatLocalAnalysisSummary } from './local-analysis-summary.js';

const DEFAULT_OUTPUT = 'DevGuard local analysis completed.\nReports published.\n';

const PRIVATE_SENTINELS = [
  '/private/config/.devguard.yml',
  '/private/working-directory',
  '/private/repository',
  '/private/requirements.md',
  '/private/output',
  'private-report.md',
  'private report content',
  'private finding text',
  'private warning text',
  'private cause',
  'private stack',
  'analysis-id-sentinel',
  '2026-07-26T00:00:00.000Z',
];

describe('formatLocalAnalysisSummary', () => {
  it('returns the exact two-line default summary with no score, blank lines, or extra whitespace', () => {
    const output = formatLocalAnalysisSummary({ healthScore: 80, verbose: false });

    expect(output).toBe(DEFAULT_OUTPUT);
    expect(output.split('\n')).toEqual([
      'DevGuard local analysis completed.',
      'Reports published.',
      '',
    ]);
    expect(output).not.toContain('80');
    expect(output).not.toMatch(/\n\n|[ \t]+\n/u);
  });

  it.each([
    [80, 'DevGuard local analysis completed.\nReports published.\nHealth score: 80/100\n'],
    [0, 'DevGuard local analysis completed.\nReports published.\nHealth score: 0/100\n'],
    [100, 'DevGuard local analysis completed.\nReports published.\nHealth score: 100/100\n'],
    [80.5, 'DevGuard local analysis completed.\nReports published.\nHealth score: 80.5/100\n'],
  ])('uses the supplied verbose score directly for %s', (healthScore, expected) => {
    const output = formatLocalAnalysisSummary({ healthScore, verbose: true });

    expect(output).toBe(expected);
    expect(output.split('\n')).toHaveLength(4);
    expect(output.match(/Health score:/gu)).toHaveLength(1);
    expect(output).not.toContain('%');
    expect(output).not.toContain(String.fromCharCode(27));
  });

  it('interpolates verbose scores directly without locale formatting', () => {
    const toLocaleString = vi.spyOn(Number.prototype, 'toLocaleString');

    try {
      const output = formatLocalAnalysisSummary({ healthScore: 80.5, verbose: true });

      expect(toLocaleString).not.toHaveBeenCalled();
      expect(output).toBe(
        'DevGuard local analysis completed.\nReports published.\nHealth score: 80.5/100\n',
      );
      expect(output.endsWith('\n')).toBe(true);
      expect(output).not.toContain(',');
      expect(output).not.toContain('%');
    } finally {
      toLocaleString.mockRestore();
    }
  });

  it('is deterministic and leaves mutable and frozen caller inputs unchanged', () => {
    const input = { healthScore: 80, verbose: true };
    const before = structuredClone(input);
    const frozenInput = Object.freeze({ healthScore: 0, verbose: false });

    expect(formatLocalAnalysisSummary(input)).toBe(formatLocalAnalysisSummary(input));
    expect(input).toEqual(before);
    expect(formatLocalAnalysisSummary(frozenInput)).toBe(DEFAULT_OUTPUT);
    expect(frozenInput).toEqual({ healthScore: 0, verbose: false });
  });

  it('performs no console logging, stream writes, clock, or random access', () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const info = vi.spyOn(console, 'info');
    const debug = vi.spyOn(console, 'debug');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');

    try {
      formatLocalAnalysisSummary({ healthScore: 80, verbose: true });

      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      info.mockRestore();
      debug.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
      now.mockRestore();
      random.mockRestore();
    }
  });

  it('never exposes private configuration, repository, report, or error sentinel text', () => {
    const output = formatLocalAnalysisSummary({ healthScore: 80, verbose: true });

    for (const sentinel of PRIVATE_SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
  });
});
