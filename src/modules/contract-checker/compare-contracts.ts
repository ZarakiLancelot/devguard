import type { NormalizedContract, NormalizedProperty } from './shared/normalized-contract.js';

/**
 * The supported structural differences between an authoritative OpenAPI
 * contract and a TypeScript contract.
 */
export type ContractDifferenceKind = 'missing-property' | 'incompatible-type' | 'required-mismatch';

/**
 * A structural difference for one OpenAPI property.
 */
export interface ContractDifference {
  kind: ContractDifferenceKind;
  property: string;
  openapi?: NormalizedProperty;
  typescript?: NormalizedProperty;
}

/**
 * The deterministic comparison result for two normalized contracts.
 */
export interface ContractComparisonResult {
  openapiContract: string;
  typescriptContract: string;
  differences: ContractDifference[];
}

const DIFFERENCE_KIND_ORDER: Readonly<Record<ContractDifferenceKind, number>> = {
  'missing-property': 0,
  'incompatible-type': 1,
  'required-mismatch': 2,
};

/**
 * Compares an authoritative OpenAPI contract against a TypeScript contract.
 *
 * OpenAPI properties absent from TypeScript are reported as missing. TypeScript-
 * only properties are intentionally ignored for the MVP. A primitive mismatch
 * or scalar/array shape mismatch produces one incompatible-type difference;
 * required-state differences are reported independently.
 */
export function compareNormalizedContracts(
  openapiContract: NormalizedContract,
  typescriptContract: NormalizedContract,
): ContractComparisonResult {
  const differences: ContractDifference[] = [];
  const openapiProperties = [...openapiContract.properties.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [propertyName, openapiProperty] of openapiProperties) {
    const typescriptProperty = typescriptContract.properties.get(propertyName);

    if (!typescriptProperty) {
      differences.push({
        kind: 'missing-property',
        property: propertyName,
        openapi: openapiProperty,
      });
      continue;
    }

    if (!areTypesCompatible(openapiProperty, typescriptProperty)) {
      differences.push({
        kind: 'incompatible-type',
        property: propertyName,
        openapi: openapiProperty,
        typescript: typescriptProperty,
      });
    }

    if (openapiProperty.required !== typescriptProperty.required) {
      differences.push({
        kind: 'required-mismatch',
        property: propertyName,
        openapi: openapiProperty,
        typescript: typescriptProperty,
      });
    }
  }

  differences.sort(compareDifferences);

  return {
    openapiContract: openapiContract.name,
    typescriptContract: typescriptContract.name,
    differences,
  };
}

/**
 * Determines compatibility from normalized primitive type and array shape.
 */
function areTypesCompatible(
  openapiProperty: NormalizedProperty,
  typescriptProperty: NormalizedProperty,
): boolean {
  return (
    openapiProperty.type === typescriptProperty.type &&
    openapiProperty.isArray === typescriptProperty.isArray
  );
}

/**
 * Sorts differences by exact property name, then stable difference-kind order.
 */
function compareDifferences(a: ContractDifference, b: ContractDifference): number {
  const propertyOrder = a.property.localeCompare(b.property);
  if (propertyOrder !== 0) {
    return propertyOrder;
  }

  return DIFFERENCE_KIND_ORDER[a.kind] - DIFFERENCE_KIND_ORDER[b.kind];
}
