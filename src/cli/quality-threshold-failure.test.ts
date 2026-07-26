import { describe, expect, it } from 'vitest';
import { QualityThresholdFailure } from './quality-threshold-failure.js';

describe('QualityThresholdFailure', () => {
  it('is nominal and carries no quality, report, path, cause, or arbitrary message data', () => {
    const failure = new QualityThresholdFailure();
    const imitation = { name: 'QualityThresholdFailure' };

    expect(failure).toBeInstanceOf(QualityThresholdFailure);
    expect(imitation).not.toBeInstanceOf(QualityThresholdFailure);
    expect(failure.message).toBe('');
    expect(failure.cause).toBeUndefined();
    expect(Object.keys(failure)).toEqual(['name']);
    expect(failure).not.toHaveProperty('healthScore');
    expect(failure).not.toHaveProperty('threshold');
    expect(failure).not.toHaveProperty('report');
    expect(failure).not.toHaveProperty('paths');
  });
});
