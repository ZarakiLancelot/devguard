import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, getFixtureDirectory, loadFixtureExpected } from './fixture-loader.js';

const SUPPORTED_SEVERITIES = ['info', 'warning', 'high', 'critical'];

describe('fixture validation', () => {
  describe('fixture directories exist', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture}/ exists`, () => {
        const directory = getFixtureDirectory(fixture);
        expect(fs.existsSync(directory)).toBe(true);
        expect(fs.statSync(directory).isDirectory()).toBe(true);
      });
    }
  });

  describe('every fixture has .devguard.yml', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture}/.devguard.yml exists`, () => {
        expect(fs.existsSync(`${getFixtureDirectory(fixture)}/.devguard.yml`)).toBe(true);
      });
    }
  });

  describe('every fixture has valid expected.json', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture}/expected.json has valid stable data`, () => {
        expect(() => loadFixtureExpected(fixture)).not.toThrow();
      });
    }
  });

  describe('fixture descriptions are non-empty', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture} has a non-empty description`, () => {
        const expected = loadFixtureExpected(fixture);
        expect(expected.description.trim().length).toBeGreaterThan(0);
      });
    }
  });

  describe('expected findings have valid rule IDs and severities', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture} findings have non-empty ruleId and supported severity`, () => {
        const expected = loadFixtureExpected(fixture);

        for (const finding of expected.expectedFindings) {
          expect(finding.ruleId.trim().length).toBeGreaterThan(0);
          expect(SUPPORTED_SEVERITIES).toContain(finding.severity);
        }
      });
    }
  });

  describe('expected.json structure', () => {
    for (const fixture of FIXTURE_NAMES) {
      it(`fixtures/${fixture} has expectedFindings array`, () => {
        expect(Array.isArray(loadFixtureExpected(fixture).expectedFindings)).toBe(true);
      });

      it(`fixtures/${fixture} has expectedWarnings array`, () => {
        const expected = loadFixtureExpected(fixture);
        expect(Array.isArray(expected.expectedWarnings)).toBe(true);

        for (const warning of expected.expectedWarnings) {
          expect(['openapi', 'typescript']).toContain(warning.source);
        }
      });
    }
  });
});
