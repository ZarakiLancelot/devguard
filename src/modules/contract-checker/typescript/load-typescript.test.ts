import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadTypeScriptDeclaration } from './load-typescript.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../fixtures');

function loadFixtureTs(fixtureName: string, filePath: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, fixtureName, filePath), 'utf-8');
}

describe('loadTypeScriptDeclaration', () => {
  describe('interface loading', () => {
    it('should load an exported interface', () => {
      const content = `
export interface Book {
  id: number;
  name: string;
}`;
      const result = loadTypeScriptDeclaration({ content }, 'Book');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.name).toBe('Book');
        expect(result.declaration.kind).toBe('interface');
        expect(result.declaration.properties).toHaveLength(2);
      }
    });

    it('should load a non-exported interface', () => {
      const content = `
interface InternalType {
  value: string;
}`;
      const result = loadTypeScriptDeclaration({ content }, 'InternalType');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.kind).toBe('interface');
        expect(result.declaration.properties).toHaveLength(1);
      }
    });
    it('should load a local declaration despite an unresolved type-only import', () => {
      const content = `
import type { ExternalType } from './missing';

export interface Book {
  title: string;
}`;
      const result = loadTypeScriptDeclaration({ content }, 'Book');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.name).toBe('Book');
        expect(result.declaration.properties).toEqual([
          {
            name: 'title',
            optional: false,
            typeText: 'string',
            line: 5,
          },
        ]);
      }
    });
  });

  describe('type alias loading', () => {
    it('should load an object-literal type alias', () => {
      const content = `
export type UpdatePayload = {
  authorId: number;
  pageCount?: number;
};`;
      const result = loadTypeScriptDeclaration({ content }, 'UpdatePayload');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.kind).toBe('type-alias');
        expect(result.declaration.properties).toHaveLength(2);
      }
    });
  });

  describe('lookup rules', () => {
    it('should perform case-sensitive lookup', () => {
      const content = `export interface MyType { x: number; }`;
      const result = loadTypeScriptDeclaration({ content }, 'mytype');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_NOT_FOUND');
      }
    });

    it('should return TYPESCRIPT_DECLARATION_NOT_FOUND for missing type', () => {
      const content = `export interface Other { x: number; }`;
      const result = loadTypeScriptDeclaration({ content }, 'NonExistent');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_NOT_FOUND');
      }
    });

    it('should return TYPESCRIPT_DECLARATION_AMBIGUOUS for duplicate names', () => {
      const content = `
interface Duplicate { a: string; }
interface Duplicate { b: number; }`;
      const result = loadTypeScriptDeclaration({ content }, 'Duplicate');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_AMBIGUOUS');
      }
    });

    it('should not conflict between interface and type alias with different names', () => {
      const content = `
export interface Alpha { x: number; }
export type Beta = { y: string; };`;
      const resultA = loadTypeScriptDeclaration({ content }, 'Alpha');
      const resultB = loadTypeScriptDeclaration({ content }, 'Beta');
      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(true);
    });

    it('should load both exported and non-exported declarations', () => {
      const content = `
export interface Exported { a: number; }
interface Internal { b: string; }`;
      const r1 = loadTypeScriptDeclaration({ content }, 'Exported');
      const r2 = loadTypeScriptDeclaration({ content }, 'Internal');
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  describe('property detection', () => {
    it('should detect optional properties', () => {
      const content = `export type T = { name?: string; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.optional).toBe(true);
      }
    });

    it('should detect required properties', () => {
      const content = `export type T = { name: string; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.optional).toBe(false);
      }
    });

    it('should capture raw type text for string', () => {
      const content = `export type T = { value: string; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.typeText).toBe('string');
      }
    });

    it('should capture raw type text for number', () => {
      const content = `export type T = { count: number; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.typeText).toBe('number');
      }
    });

    it('should capture raw type text for boolean', () => {
      const content = `export type T = { active: boolean; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.typeText).toBe('boolean');
      }
    });

    it('should capture raw type text for primitive arrays', () => {
      const content = `export type T = { tags: string[]; ids: number[]; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.typeText).toBe('string[]');
        expect(result.declaration.properties[1]?.typeText).toBe('number[]');
      }
    });

    it('should provide line numbers', () => {
      const content = `export interface T {\n  name: string;\n  value: number;\n}`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties[0]?.line).toBeDefined();
        expect(typeof result.declaration.properties[0]?.line).toBe('number');
      }
    });
  });

  describe('unsupported members', () => {
    it('should warn and skip method members in interface', () => {
      const content = `
export interface WithMethod {
  name: string;
  greet(): void;
}`;
      const result = loadTypeScriptDeclaration({ content }, 'WithMethod');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties).toHaveLength(1);
        expect(result.declaration.properties[0]?.name).toBe('name');
        expect(result.warnings.some((w) => w.code === 'TYPESCRIPT_MEMBER_UNSUPPORTED')).toBe(true);
      }
    });

    it('should warn and skip index signatures', () => {
      const content = `
export interface WithIndex {
  name: string;
  [key: string]: unknown;
}`;
      const result = loadTypeScriptDeclaration({ content }, 'WithIndex');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.properties).toHaveLength(1);
        expect(result.warnings.some((w) => w.code === 'TYPESCRIPT_MEMBER_UNSUPPORTED')).toBe(true);
      }
    });

    it('should fail for interface extending another interface', () => {
      const content = `
interface Base { id: number; }
export interface Extended extends Base { name: string; }`;
      const result = loadTypeScriptDeclaration({ content }, 'Extended');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_UNSUPPORTED');
        expect(result.error.message).toContain('extends');
      }
    });
  });

  describe('unsupported type aliases', () => {
    it('should fail for Pick alias', () => {
      const content = `
type Fields = 'a' | 'b';
export type PickAlias = Pick<{ a: number; b: string; c: boolean }, Fields>;`;
      const result = loadTypeScriptDeclaration({ content }, 'PickAlias');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_UNSUPPORTED');
      }
    });

    it('should fail for union type alias', () => {
      const content = `export type Union = string | number;`;
      const result = loadTypeScriptDeclaration({ content }, 'Union');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_UNSUPPORTED');
      }
    });

    it('should fail for intersection type alias', () => {
      const content = `
type A = { x: number; };
type B = { y: string; };
export type Inter = A & B;`;
      const result = loadTypeScriptDeclaration({ content }, 'Inter');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_UNSUPPORTED');
      }
    });
  });

  describe('error handling', () => {
    it('should not throw uncaught exceptions for malformed content', () => {
      const badInputs = [
        'export interface {{{',
        ':::not-typescript:::',
        '',
        'function notAType() {}',
      ];
      for (const content of badInputs) {
        expect(() => loadTypeScriptDeclaration({ content }, 'Any')).not.toThrow();
      }
    });

    it('should return TYPESCRIPT_DECLARATION_NOT_FOUND for empty content', () => {
      const result = loadTypeScriptDeclaration({ content: '' }, 'Missing');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_NOT_FOUND');
      }
    });
  });

  describe('fixture scenarios', () => {
    it('should load the valid-contract fixture', () => {
      const content = loadFixtureTs('valid-contract', 'frontend/src/types/book.ts');
      const result = loadTypeScriptDeclaration({ content }, 'UpdateBookPayload');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.kind).toBe('type-alias');
        expect(result.declaration.properties.length).toBeGreaterThan(0);
      }
    });

    it('should load the incompatible-type fixture', () => {
      const content = loadFixtureTs('incompatible-type', 'frontend/src/types/book.ts');
      const result = loadTypeScriptDeclaration({ content }, 'UpdateBookPayload');
      expect(result.success).toBe(true);
      if (result.success) {
        const pageCount = result.declaration.properties.find((p) => p.name === 'pageCount');
        expect(pageCount?.typeText).toBe('string');
      }
    });

    it('should load the required-mismatch fixture', () => {
      const content = loadFixtureTs('required-mismatch', 'frontend/src/types/book.ts');
      const result = loadTypeScriptDeclaration({ content }, 'UpdateBookPayload');
      expect(result.success).toBe(true);
      if (result.success) {
        const category = result.declaration.properties.find((p) => p.name === 'category');
        expect(category?.optional).toBe(true);
      }
    });

    it('should return controlled result for unsupported-typescript fixture', () => {
      const content = loadFixtureTs('unsupported-typescript', 'frontend/src/types/book.ts');
      const result = loadTypeScriptDeclaration({ content }, 'UpdateBookPayload');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_UNSUPPORTED');
      }
    });
  });

  describe('metadata propagation', () => {
    it('should propagate sourceLabel', () => {
      const content = `export type T = { x: number; };`;
      const result = loadTypeScriptDeclaration({ content, sourceLabel: 'frontend/types.ts' }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.sourceLabel).toBe('frontend/types.ts');
      }
    });

    it('should propagate fileName', () => {
      const content = `export type T = { x: number; };`;
      const result = loadTypeScriptDeclaration({ content, fileName: 'book.ts' }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.fileName).toBe('book.ts');
      }
    });

    it('should not include sourceLabel when not provided', () => {
      const content = `export type T = { x: number; };`;
      const result = loadTypeScriptDeclaration({ content }, 'T');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.declaration.sourceLabel).toBeUndefined();
      }
    });
  });
});
