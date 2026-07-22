/**
 * Normalized primitive types supported by the MVP contract checker.
 */
export type NormalizedPrimitive = 'string' | 'number' | 'boolean';

/**
 * A normalized property from a supported contract declaration.
 */
export interface NormalizedProperty {
  name: string;
  type: NormalizedPrimitive;
  isArray: boolean;
  required: boolean;
}

/**
 * A normalized OpenAPI schema or TypeScript declaration.
 */
export interface NormalizedContract {
  name: string;
  source: 'openapi' | 'typescript';
  properties: Map<string, NormalizedProperty>;
}
