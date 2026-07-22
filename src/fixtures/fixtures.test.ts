import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../fixtures');

const REQUIRED_FIXTURES = [
  'valid-contract',
  'missing-property',
  'incompatible-type',
  'required-mismatch',
  'missing-tests',
  'unsupported-typescript',
  'malformed-openapi',
];

const SUPPORTED_SEVERITIES = ['info', 'warning', 'high', 'critical'];

interface ExpectedFinding {
  ruleId: string;
  severity: string;
  details?: string;
}

interface ExpectedJson {
  description: string;
  expectedFindings: ExpectedFinding[];
  expectedWarnings: string[];
}

function loadExpectedJson(fixtureName: string): ExpectedJson {
  const filePath = path.join(FIXTURES_DIR, fixtureName, 'expected.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as ExpectedJson;
}

describe('fixture validation', () => {
  describe('fixture directories exist', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture}/ exists`, () => {
        const dirPath = path.join(FIXTURES_DIR, fixture);
        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
      });
    }
  });

  describe('every fixture has .devguard.yml', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture}/.devguard.yml exists`, () => {
        const configPath = path.join(FIXTURES_DIR, fixture, '.devguard.yml');
        expect(fs.existsSync(configPath)).toBe(true);
      });
    }
  });

  describe('every fixture has valid expected.json', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture}/expected.json is valid JSON`, () => {
        const filePath = path.join(FIXTURES_DIR, fixture, 'expected.json');
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(() => JSON.parse(content)).not.toThrow();
      });
    }
  });

  describe('fixture descriptions are non-empty', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture} has a non-empty description`, () => {
        const expected = loadExpectedJson(fixture);
        expect(expected.description).toBeDefined();
        expect(expected.description.trim().length).toBeGreaterThan(0);
      });
    }
  });

  describe('expected findings have valid rule IDs and severities', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture} findings have non-empty ruleId and supported severity`, () => {
        const expected = loadExpectedJson(fixture);

        for (const finding of expected.expectedFindings) {
          expect(finding.ruleId).toBeDefined();
          expect(finding.ruleId.trim().length).toBeGreaterThan(0);
          expect(SUPPORTED_SEVERITIES).toContain(finding.severity);
        }
      });
    }
  });

  describe('expected.json structure', () => {
    for (const fixture of REQUIRED_FIXTURES) {
      it(`fixtures/${fixture} has expectedFindings array`, () => {
        const expected = loadExpectedJson(fixture);
        expect(Array.isArray(expected.expectedFindings)).toBe(true);
      });

      it(`fixtures/${fixture} has expectedWarnings array`, () => {
        const expected = loadExpectedJson(fixture);
        expect(Array.isArray(expected.expectedWarnings)).toBe(true);
      });
    }
  });
});
