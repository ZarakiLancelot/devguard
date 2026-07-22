import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { LoadedTypeScriptDeclaration } from './load-typescript.js';
import { loadTypeScriptDeclaration } from './load-typescript.js';
import { normalizeTypeScriptDeclaration } from './normalize-typescript.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../fixtures');

function loadDeclaration(content: string, typeName = 'Payload'): LoadedTypeScriptDeclaration {
  const result = loadTypeScriptDeclaration({ content }, typeName);
  if (!result.success) {
    throw new Error(`Failed to load ${typeName}: ${result.error.code}`);
  }
  return result.declaration;
}

function normalizeSingleProperty(
  typeText: string,
): ReturnType<typeof normalizeTypeScriptDeclaration> {
  return normalizeTypeScriptDeclaration(
    loadDeclaration(`export type Payload = { value: ${typeText}; };`),
  );
}

describe('normalizeTypeScriptDeclaration', () => {
  describe('supported scalar primitives', () => {
    it.each([
      ['string', 'string'],
      ['number', 'number'],
      ['boolean', 'boolean'],
    ] as const)('should normalize %s', (typeText, expectedType) => {
      const result = normalizeSingleProperty(typeText);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('value')).toEqual({
          name: 'value',
          type: expectedType,
          isArray: false,
          required: true,
        });
      }
    });
  });

  describe('supported primitive arrays', () => {
    it.each([
      ['string[]', 'string'],
      ['number[]', 'number'],
      ['boolean[]', 'boolean'],
      ['Array<string>', 'string'],
      ['Array<number>', 'number'],
      ['Array<boolean>', 'boolean'],
      ['readonly string[]', 'string'],
      ['readonly number[]', 'number'],
      ['readonly boolean[]', 'boolean'],
      ['ReadonlyArray<string>', 'string'],
      ['ReadonlyArray<number>', 'number'],
      ['ReadonlyArray<boolean>', 'boolean'],
    ] as const)('should normalize %s', (typeText, expectedType) => {
      const result = normalizeSingleProperty(typeText);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('value')).toEqual({
          name: 'value',
          type: expectedType,
          isArray: true,
          required: true,
        });
      }
    });
  });

  describe('property metadata', () => {
    it('should mark required property descriptors as required', () => {
      const declaration = loadDeclaration(`export type Payload = { name: string; };`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('name')?.required).toBe(true);
      }
    });

    it('should mark optional property descriptors as not required', () => {
      const declaration = loadDeclaration(`export type Payload = { name?: string; };`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('name')?.required).toBe(false);
      }
    });

    it('should preserve exact property names', () => {
      const declaration = loadDeclaration(`
export type Payload = {
  book_Code: string;
  authorId: number;
};`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect([...result.contract.properties.keys()]).toEqual(['book_Code', 'authorId']);
      }
    });

    it('should normalize multiple supported properties', () => {
      const declaration = loadDeclaration(`
export type Payload = {
  name: string;
  count?: number;
  active: boolean;
  tags: ReadonlyArray<string>;
};`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.name).toBe('Payload');
        expect(result.contract.source).toBe('typescript');
        expect(result.contract.properties.size).toBe(4);
        expect(result.warnings).toHaveLength(0);
      }
    });
  });

  describe('unsupported property types', () => {
    it.each([
      ['custom named type', 'Book'],
      ['object literal type', '{ street: string }'],
      ['union type', 'string | number'],
      ['tuple type', '[string, number]'],
      ['literal type', "'active'"],
      ['null union', 'string | null'],
      ['Promise generic', 'Promise<string>'],
      ['Record generic', 'Record<string, number>'],
      ['function type', '() => void'],
      ['any', 'any'],
      ['unknown', 'unknown'],
    ])('should warn and omit unsupported %s', (_label, typeText) => {
      const result = normalizeSingleProperty(typeText);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_EMPTY');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]?.code).toBe('TYPESCRIPT_PROPERTY_TYPE_UNSUPPORTED');
      }
    });

    it.each([
      ['string[][]', 'TYPESCRIPT_NESTED_ARRAY_UNSUPPORTED'],
      ['Array<Array<string>>', 'TYPESCRIPT_NESTED_ARRAY_UNSUPPORTED'],
      ['Array<Book>', 'TYPESCRIPT_ARRAY_ELEMENT_UNSUPPORTED'],
      ['ReadonlyArray<Record<string, string>>', 'TYPESCRIPT_ARRAY_ELEMENT_UNSUPPORTED'],
    ] as const)('should warn for unsupported array form %s', (typeText, warningCode) => {
      const result = normalizeSingleProperty(typeText);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_EMPTY');
        expect(result.warnings[0]?.code).toBe(warningCode);
      }
    });

    it('should preserve supported properties when another is unsupported', () => {
      const declaration = loadDeclaration(`
export type Payload = {
  id: number;
  nested: { child: string };
  tags?: string[];
};`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect([...result.contract.properties.keys()]).toEqual(['id', 'tags']);
        expect(result.warnings).toEqual([
          expect.objectContaining({
            code: 'TYPESCRIPT_PROPERTY_TYPE_UNSUPPORTED',
            property: 'nested',
          }),
        ]);
      }
    });

    it('should return TYPESCRIPT_DECLARATION_EMPTY when no properties are supported', () => {
      const declaration = loadDeclaration(`
export type Payload = {
  response: Promise<string>;
  model: Book;
};`);
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_EMPTY');
        expect(result.warnings).toHaveLength(2);
      }
    });
  });

  describe('declaration validation', () => {
    it('should reject duplicate loaded property descriptors deterministically', () => {
      const declaration: LoadedTypeScriptDeclaration = {
        name: 'Payload',
        kind: 'type-alias',
        declarationText: 'type Payload = { value: string; value: number; };',
        properties: [
          { name: 'value', optional: false, typeText: 'string' },
          { name: 'value', optional: false, typeText: 'number' },
        ],
      };
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TYPESCRIPT_DECLARATION_INVALID');
      }
    });
  });

  describe('deterministic output', () => {
    it('should produce deterministic normalized contract output', () => {
      const declaration = loadDeclaration(`
export type Payload = {
  active: boolean;
  count?: number;
  tags: string[];
};`);
      const first = normalizeTypeScriptDeclaration(declaration);
      const second = normalizeTypeScriptDeclaration(declaration);
      expect(first).toEqual(second);
    });
  });

  describe('fixture scenarios', () => {
    it('should normalize the valid-contract fixture declaration', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'valid-contract/frontend/src/types/book.ts'),
        'utf-8',
      );
      const declaration = loadDeclaration(content, 'UpdateBookPayload');
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('isbn')).toEqual({
          name: 'isbn',
          type: 'string',
          isArray: false,
          required: true,
        });
        expect(result.contract.properties.get('active')?.required).toBe(true);
        expect(result.contract.properties.get('tags')).toEqual({
          name: 'tags',
          type: 'string',
          isArray: true,
          required: false,
        });
      }
    });

    it('should normalize the incompatible-type fixture declaration', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'incompatible-type/frontend/src/types/book.ts'),
        'utf-8',
      );
      const declaration = loadDeclaration(content, 'UpdateBookPayload');
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('pageCount')?.type).toBe('string');
      }
    });

    it('should normalize the required-mismatch fixture declaration', () => {
      const content = fs.readFileSync(
        path.join(FIXTURES_DIR, 'required-mismatch/frontend/src/types/book.ts'),
        'utf-8',
      );
      const declaration = loadDeclaration(content, 'UpdateBookPayload');
      const result = normalizeTypeScriptDeclaration(declaration);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.contract.properties.get('category')?.required).toBe(false);
      }
    });
  });
});
