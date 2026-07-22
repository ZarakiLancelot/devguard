import type { LoadedTypeScriptDeclaration } from './load-typescript.js';
import type {
  NormalizedContract,
  NormalizedPrimitive,
  NormalizedProperty,
} from '../shared/normalized-contract.js';

/**
 * Stable warning codes emitted for unsupported TypeScript property types.
 */
export type TypeScriptNormalizationWarningCode =
  | 'TYPESCRIPT_PROPERTY_TYPE_UNSUPPORTED'
  | 'TYPESCRIPT_ARRAY_ELEMENT_UNSUPPORTED'
  | 'TYPESCRIPT_NESTED_ARRAY_UNSUPPORTED';

/**
 * A warning for an omitted unsupported TypeScript property.
 */
export interface TypeScriptNormalizationWarning {
  code: TypeScriptNormalizationWarningCode;
  message: string;
  property: string;
}

/**
 * Stable failure codes emitted for an unusable loaded declaration.
 */
export type TypeScriptNormalizationErrorCode =
  | 'TYPESCRIPT_DECLARATION_EMPTY'
  | 'TYPESCRIPT_DECLARATION_INVALID';

/**
 * Discriminated result of TypeScript declaration normalization.
 */
export type NormalizeTypeScriptResult =
  | {
      success: true;
      contract: NormalizedContract;
      warnings: TypeScriptNormalizationWarning[];
    }
  | {
      success: false;
      error: {
        code: TypeScriptNormalizationErrorCode;
        message: string;
      };
      warnings: TypeScriptNormalizationWarning[];
    };

const PRIMITIVES: ReadonlySet<NormalizedPrimitive> = new Set(['string', 'number', 'boolean']);

/**
 * Normalizes supported raw TypeScript property types from an already loaded
 * declaration. This function does not parse source, inspect a ts-morph Project,
 * resolve imports, or use a TypeChecker.
 *
 * Policy: unsupported property types produce warnings and are omitted. If no
 * properties can be normalized, the declaration fails with
 * TYPESCRIPT_DECLARATION_EMPTY and retains the accumulated warnings.
 */
export function normalizeTypeScriptDeclaration(
  declaration: LoadedTypeScriptDeclaration,
): NormalizeTypeScriptResult {
  const warnings: TypeScriptNormalizationWarning[] = [];

  const validationError = validateDeclaration(declaration);
  if (validationError) {
    return {
      success: false,
      error: validationError,
      warnings,
    };
  }

  const properties = new Map<string, NormalizedProperty>();

  for (const property of declaration.properties) {
    const normalized = normalizeProperty(
      property.name,
      property.typeText,
      property.optional,
      warnings,
    );
    if (normalized) {
      properties.set(property.name, normalized);
    }
  }

  if (properties.size === 0) {
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_DECLARATION_EMPTY',
        message: `Declaration "${declaration.name}" has no supported properties`,
      },
      warnings,
    };
  }

  return {
    success: true,
    contract: {
      name: declaration.name,
      source: 'typescript',
      properties,
    },
    warnings,
  };
}

/**
 * Checks invariants of a loaded declaration without inspecting source content.
 */
function validateDeclaration(
  declaration: LoadedTypeScriptDeclaration,
): { code: TypeScriptNormalizationErrorCode; message: string } | undefined {
  if (declaration.name.trim() === '') {
    return {
      code: 'TYPESCRIPT_DECLARATION_INVALID',
      message: 'Loaded TypeScript declaration name must not be empty',
    };
  }

  if (!Array.isArray(declaration.properties)) {
    return {
      code: 'TYPESCRIPT_DECLARATION_INVALID',
      message: `Declaration "${declaration.name}" properties must be an array`,
    };
  }

  const names = new Set<string>();
  for (const property of declaration.properties) {
    if (property.name.trim() === '' || property.typeText.trim() === '') {
      return {
        code: 'TYPESCRIPT_DECLARATION_INVALID',
        message: `Declaration "${declaration.name}" contains an invalid property descriptor`,
      };
    }

    if (names.has(property.name)) {
      return {
        code: 'TYPESCRIPT_DECLARATION_INVALID',
        message: `Declaration "${declaration.name}" contains duplicate property "${property.name}"`,
      };
    }

    names.add(property.name);
  }

  return undefined;
}

/**
 * Normalizes one raw TypeScript property type, or records a warning when it is
 * outside the restricted MVP subset.
 */
function normalizeProperty(
  name: string,
  typeText: string,
  optional: boolean,
  warnings: TypeScriptNormalizationWarning[],
): NormalizedProperty | undefined {
  const normalizedText = typeText.trim();
  const required = !optional;

  if (isPrimitive(normalizedText)) {
    return {
      name,
      type: normalizedText,
      isArray: false,
      required,
    };
  }

  const arrayResult = normalizeArrayType(normalizedText);
  if (arrayResult.kind === 'supported') {
    return {
      name,
      type: arrayResult.type,
      isArray: true,
      required,
    };
  }

  const warning = createUnsupportedWarning(name, typeText, arrayResult.kind);
  warnings.push(warning);
  return undefined;
}

/**
 * Parses supported primitive array forms from raw property type text.
 */
function normalizeArrayType(
  typeText: string,
):
  | { kind: 'supported'; type: NormalizedPrimitive }
  | { kind: 'nested-array' }
  | { kind: 'array-element' }
  | { kind: 'not-array' } {
  const arraySuffix = /^(?:readonly\s+)?(.+?)\s*(\[\s*\])+$/u.exec(typeText);
  if (arraySuffix) {
    const element = (arraySuffix[1] ?? '').trim();
    const dimensions = (typeText.match(/\[\s*\]/gu) ?? []).length;

    if (dimensions > 1) {
      return { kind: 'nested-array' };
    }

    return isPrimitive(element) ? { kind: 'supported', type: element } : { kind: 'array-element' };
  }

  const genericArray = /^(Array|ReadonlyArray)\s*<\s*(.+)\s*>$/u.exec(typeText);
  if (genericArray) {
    const element = (genericArray[2] ?? '').trim();

    if (isNestedArraySyntax(element)) {
      return { kind: 'nested-array' };
    }

    return isPrimitive(element) ? { kind: 'supported', type: element } : { kind: 'array-element' };
  }

  return { kind: 'not-array' };
}

/**
 * Determines whether a generic array element is itself an array form.
 */
function isNestedArraySyntax(typeText: string): boolean {
  return (
    /\[\s*\]/u.test(typeText) ||
    /^(?:Array|ReadonlyArray)\s*</u.test(typeText) ||
    /^readonly\s+/u.test(typeText)
  );
}

/**
 * Creates the appropriate stable warning for an unsupported raw type.
 */
function createUnsupportedWarning(
  property: string,
  typeText: string,
  kind: 'nested-array' | 'array-element' | 'not-array',
): TypeScriptNormalizationWarning {
  if (kind === 'nested-array') {
    return {
      code: 'TYPESCRIPT_NESTED_ARRAY_UNSUPPORTED',
      message: `Property "${property}" uses unsupported nested array type "${typeText}"`,
      property,
    };
  }

  if (kind === 'array-element') {
    return {
      code: 'TYPESCRIPT_ARRAY_ELEMENT_UNSUPPORTED',
      message: `Property "${property}" has unsupported array element type in "${typeText}"`,
      property,
    };
  }

  return {
    code: 'TYPESCRIPT_PROPERTY_TYPE_UNSUPPORTED',
    message: `Property "${property}" has unsupported type "${typeText}"`,
    property,
  };
}

/**
 * Narrows a raw string to the supported primitive union.
 */
function isPrimitive(value: string): value is NormalizedPrimitive {
  return PRIMITIVES.has(value as NormalizedPrimitive);
}
