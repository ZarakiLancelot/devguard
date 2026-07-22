import { describe, it, expect } from 'vitest';
import type { Severity } from './findings.js';
import {
  severityRank,
  compareSeverity,
  maxSeverity,
  scoreToHealthLabel,
  SEVERITY_DEDUCTIONS,
  SEVERITIES_DESCENDING,
} from './scoring-helpers.js';

describe('severity ordering', () => {
  it('should rank critical > high > warning > info', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('high')).toBeGreaterThan(severityRank('warning'));
    expect(severityRank('warning')).toBeGreaterThan(severityRank('info'));
  });

  it('should return 0 when comparing equal severities', () => {
    expect(compareSeverity('critical', 'critical')).toBe(0);
    expect(compareSeverity('info', 'info')).toBe(0);
  });

  it('should return positive when first severity is higher', () => {
    expect(compareSeverity('critical', 'info')).toBeGreaterThan(0);
    expect(compareSeverity('high', 'warning')).toBeGreaterThan(0);
  });

  it('should return negative when first severity is lower', () => {
    expect(compareSeverity('info', 'critical')).toBeLessThan(0);
    expect(compareSeverity('warning', 'high')).toBeLessThan(0);
  });

  it('should select the higher severity with maxSeverity', () => {
    expect(maxSeverity('info', 'critical')).toBe('critical');
    expect(maxSeverity('critical', 'info')).toBe('critical');
    expect(maxSeverity('warning', 'high')).toBe('high');
    expect(maxSeverity('high', 'warning')).toBe('high');
    expect(maxSeverity('warning', 'warning')).toBe('warning');
  });

  it('should list severities in descending order', () => {
    expect(SEVERITIES_DESCENDING).toEqual(['critical', 'high', 'warning', 'info']);
  });

  it('should have correct deduction points per severity', () => {
    expect(SEVERITY_DEDUCTIONS.critical).toBe(20);
    expect(SEVERITY_DEDUCTIONS.high).toBe(10);
    expect(SEVERITY_DEDUCTIONS.warning).toBe(3);
    expect(SEVERITY_DEDUCTIONS.info).toBe(0);
  });

  it('should sort severities correctly using compareSeverity', () => {
    const unsorted: Severity[] = ['warning', 'critical', 'info', 'high'];
    const sorted = [...unsorted].sort(compareSeverity);
    expect(sorted).toEqual(['info', 'warning', 'high', 'critical']);
  });
});

describe('health-label mapping', () => {
  it('should return HEALTHY for scores 90-100', () => {
    expect(scoreToHealthLabel(100)).toBe('HEALTHY');
    expect(scoreToHealthLabel(95)).toBe('HEALTHY');
    expect(scoreToHealthLabel(90)).toBe('HEALTHY');
  });

  it('should return REVIEW for scores 75-89', () => {
    expect(scoreToHealthLabel(89)).toBe('REVIEW');
    expect(scoreToHealthLabel(80)).toBe('REVIEW');
    expect(scoreToHealthLabel(75)).toBe('REVIEW');
  });

  it('should return HIGH_RISK for scores 50-74', () => {
    expect(scoreToHealthLabel(74)).toBe('HIGH_RISK');
    expect(scoreToHealthLabel(60)).toBe('HIGH_RISK');
    expect(scoreToHealthLabel(50)).toBe('HIGH_RISK');
  });

  it('should return CRITICAL_RISK for scores 0-49', () => {
    expect(scoreToHealthLabel(49)).toBe('CRITICAL_RISK');
    expect(scoreToHealthLabel(25)).toBe('CRITICAL_RISK');
    expect(scoreToHealthLabel(0)).toBe('CRITICAL_RISK');
  });

  it('should handle boundary values correctly', () => {
    expect(scoreToHealthLabel(90)).toBe('HEALTHY');
    expect(scoreToHealthLabel(89)).toBe('REVIEW');
    expect(scoreToHealthLabel(75)).toBe('REVIEW');
    expect(scoreToHealthLabel(74)).toBe('HIGH_RISK');
    expect(scoreToHealthLabel(50)).toBe('HIGH_RISK');
    expect(scoreToHealthLabel(49)).toBe('CRITICAL_RISK');
  });
});
