import { describe, expect, it, vi } from 'vitest';
import { evaluateFailBelow, FailBelowParseError, parseFailBelow } from './fail-below.js';

const INVALID_MESSAGE = 'Fail-below score must be a decimal value from 0 through 100.';

function expectNoOutput(operation: () => void): void {
  const log = vi.spyOn(console, 'log');
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  const stdout = vi.spyOn(process.stdout, 'write');
  const stderr = vi.spyOn(process.stderr, 'write');

  try {
    operation();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe('parseFailBelow', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['80', 80],
    ['100', 100],
    ['0.1', 0.1],
    ['80.5', 80.5],
    ['99.999', 99.999],
    [' 75.25 ', 75.25],
  ])(
    'parses %j as the exact threshold %d without changing the lexical input',
    (value, threshold) => {
      const before = value;

      const parsed = parseFailBelow(value);

      expect(parsed).toEqual({ threshold });
      expect(Object.keys(parsed)).toEqual(['threshold']);
      expect(value).toBe(before);
    },
  );

  it.each([
    '',
    '   ',
    '.5',
    '80.',
    '+80',
    '-1',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e2',
    '0x50',
    '0b1010',
    '0o100',
    '80,5',
    '1_000',
    '80.5.1',
    'eighty',
    '100.001',
    '101',
  ])('rejects invalid lexical value %j without output or input leakage', (value) => {
    const before = value;
    let failure: FailBelowParseError | undefined;

    expectNoOutput(() => {
      try {
        parseFailBelow(value);
      } catch (error: unknown) {
        if (error instanceof FailBelowParseError) {
          failure = error;
          return;
        }

        throw error;
      }
    });

    if (failure === undefined) {
      throw new Error('Expected FailBelowParseError');
    }

    expect(failure).toBeInstanceOf(FailBelowParseError);
    expect(failure.code).toBe('FAIL_BELOW_INVALID');
    expect(failure.message).toBe(INVALID_MESSAGE);
    if (value.length > 0) {
      expect(failure.message).not.toContain(value);
    }
    expect(value).toBe(before);
  });

  it('recognizes only real FailBelowParseError instances', () => {
    const imitation = Object.assign(new Error(INVALID_MESSAGE), {
      code: 'FAIL_BELOW_INVALID',
      name: 'FailBelowParseError',
    });

    expect(imitation).not.toBeInstanceOf(FailBelowParseError);
  });
});

describe('evaluateFailBelow', () => {
  it.each([
    [79, 80, 'quality-threshold-not-met'],
    [80, 80, 'passed'],
    [81, 80, 'passed'],
    [80, 80.5, 'quality-threshold-not-met'],
    [81, 80.5, 'passed'],
    [0, 0, 'passed'],
    [100, 100, 'passed'],
  ] as const)('evaluates score %d against threshold %d as %s', (healthScore, threshold, kind) => {
    const parsed = Object.freeze({ threshold });
    const before = structuredClone(parsed);
    let outcome: ReturnType<typeof evaluateFailBelow> | undefined;

    expectNoOutput(() => {
      outcome = evaluateFailBelow(healthScore, parsed);
    });

    expect(outcome).toEqual({ kind });
    expect(parsed).toEqual(before);
  });
});
