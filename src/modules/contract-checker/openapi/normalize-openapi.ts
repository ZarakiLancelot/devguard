/**
 * Normalized primitive types supported by the MVP.
 */
export type NormalizedPrimitive = 'string' | 'number' | 'boolean';

/**
 * A normalized property extracted from an OpenAPI schema or TypeScript declaration.
 */
export interface NormalizedProperty {
  name: string;
  type: NormalizedPrimitive;
  isArray: boolean;
  required: boolean;
}

/**
 * A normalized contract from an OpenAPI schema.
 */
export interface NormalizedContract {
  name: string;
  source: 'openapi';
  properties: Map<string, NormalizedProperty>;
}

/**
 * Warning produced during schema normalization.
 */
export interface NormalizeWarning {
  code: NormalizeWarningCode;
  message: string;
  property?: string;
}

/**
 * Stable warning/error codes for normalization.
 */
export type NormalizeWarningCode =
  | 'OPENAPI_PROPERTY_UNSUPPORTED'
  | 'OPENAPI_ARRAY_ITEMS_UNSUPPORTED'
  | 'OPENAPI_REF_UNSUPPORTED';

/**
 * Stable error codes for normalization failures.
 */
export type NormalizeErrorCode =
  | 'OPENAPI_SCHEMA_NOT_FOUND'
  | 'OPENAPI_SCHEMA_INVALID'
  | 'OPENAPI_PROPERTIES_INVALID'
  | 'OPENAPI_REQUIRED_INVALID'
  | 'OPENAPI_REF_UNSUPPORTED';

/**
 * Discriminated result of normalizing an OpenAPI schema.
 */
export type NormalizeOpenApiResult =
  | {
      success: true;
      contract: NormalizedContract;
      warnings: NormalizeWarning[];
    }
  | {
      success: false;
      error: {
        code: NormalizeErrorCode;
        message: string;
      };
      warnings: NormalizeWarning[];
    };

/**
 * Supported OpenAPI type strings that map to NormalizedPrimitive.
 */
const PRIMITIVE_TYPE_MAP: Record<string, NormalizedPrimitive> = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
};

/**
 * Looks up a schema by exact name in components.schemas and normalizes it
 * to the NormalizedContract model.
 *
 * Does not resolve $ref. Does not read files. Consumes an already loaded
 * OpenAPI document (the raw parsed object from loadOpenApiDocument).
 */
export function normalizeOpenApiSchema(
  document: Record<string, unknown>,
  schemaName: string,
): NormalizeOpenApiResult {
  const warnings: NormalizeWarning[] = [];

  // Navigate to components.schemas
  const components = document['components'];
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_SCHEMA_NOT_FOUND',
        message: `Schema "${schemaName}" not found: document has no valid components`,
      },
      warnings,
    };
  }

  const schemas = (components as Record<string, unknown>)['schemas'];
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_SCHEMA_NOT_FOUND',
        message: `Schema "${schemaName}" not found: document has no valid components.schemas`,
      },
      warnings,
    };
  }

  const schemasMap = schemas as Record<string, unknown>;
  const schema = schemasMap[schemaName];

  if (schema === undefined) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_SCHEMA_NOT_FOUND',
        message: `Schema "${schemaName}" not found in components.schemas`,
      },
      warnings,
    };
  }

  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_SCHEMA_INVALID',
        message: `Schema "${schemaName}" is not a valid object`,
      },
      warnings,
    };
  }

  const schemaObj = schema as Record<string, unknown>;

  // Check for $ref at schema level
  if ('$ref' in schemaObj) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_REF_UNSUPPORTED',
        message: `Schema "${schemaName}" uses $ref which is not supported in the MVP`,
      },
      warnings,
    };
  }

  // Extract required array
  const requiredSet = extractRequiredSet(schemaObj, schemaName, warnings);
  if (requiredSet === null) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_REQUIRED_INVALID',
        message: `Schema "${schemaName}" has an invalid "required" field (must be an array of strings)`,
      },
      warnings,
    };
  }

  // Extract properties
  const propertiesField = schemaObj['properties'];

  if (propertiesField === undefined) {
    // Schema with no properties — valid but empty
    return {
      success: true,
      contract: {
        name: schemaName,
        source: 'openapi',
        properties: new Map(),
      },
      warnings,
    };
  }

  if (
    propertiesField === null ||
    typeof propertiesField !== 'object' ||
    Array.isArray(propertiesField)
  ) {
    return {
      success: false,
      error: {
        code: 'OPENAPI_PROPERTIES_INVALID',
        message: `Schema "${schemaName}" has an invalid "properties" field (must be an object)`,
      },
      warnings,
    };
  }

  const propertiesObj = propertiesField as Record<string, unknown>;
  const normalizedProperties = new Map<string, NormalizedProperty>();

  for (const [propName, propDef] of Object.entries(propertiesObj)) {
    const normalized = normalizeProperty(propName, propDef, requiredSet, warnings);
    if (normalized) {
      normalizedProperties.set(propName, normalized);
    }
  }

  return {
    success: true,
    contract: {
      name: schemaName,
      source: 'openapi',
      properties: normalizedProperties,
    },
    warnings,
  };
}

/**
 * Extracts the required property names from a schema object.
 * Returns null if the required field is present but invalid.
 */
function extractRequiredSet(
  schemaObj: Record<string, unknown>,
  _schemaName: string,
  _warnings: NormalizeWarning[],
): Set<string> | null {
  const requiredField = schemaObj['required'];

  if (requiredField === undefined) {
    return new Set();
  }

  if (!Array.isArray(requiredField)) {
    return null;
  }

  // Validate all entries are strings
  for (const entry of requiredField) {
    if (typeof entry !== 'string') {
      return null;
    }
  }

  return new Set(requiredField as string[]);
}

/**
 * Normalizes a single property definition.
 * Returns null (and adds a warning) if the property is unsupported.
 */
function normalizeProperty(
  propName: string,
  propDef: unknown,
  requiredSet: Set<string>,
  warnings: NormalizeWarning[],
): NormalizedProperty | null {
  if (propDef === null || typeof propDef !== 'object' || Array.isArray(propDef)) {
    warnings.push({
      code: 'OPENAPI_PROPERTY_UNSUPPORTED',
      message: `Property "${propName}" has an invalid definition`,
      property: propName,
    });
    return null;
  }

  const def = propDef as Record<string, unknown>;

  // Check for $ref
  if ('$ref' in def) {
    warnings.push({
      code: 'OPENAPI_REF_UNSUPPORTED',
      message: `Property "${propName}" uses $ref which is not supported in the MVP`,
      property: propName,
    });
    return null;
  }

  const typeField = def['type'];

  if (typeof typeField !== 'string') {
    warnings.push({
      code: 'OPENAPI_PROPERTY_UNSUPPORTED',
      message: `Property "${propName}" has no valid "type" field`,
      property: propName,
    });
    return null;
  }

  const isRequired = requiredSet.has(propName);

  // Handle array type
  if (typeField === 'array') {
    return normalizeArrayProperty(propName, def, isRequired, warnings);
  }

  // Handle primitive types
  const normalizedType = PRIMITIVE_TYPE_MAP[typeField];
  if (normalizedType) {
    return {
      name: propName,
      type: normalizedType,
      isArray: false,
      required: isRequired,
    };
  }

  // Unsupported type (e.g., "object")
  warnings.push({
    code: 'OPENAPI_PROPERTY_UNSUPPORTED',
    message: `Property "${propName}" has unsupported type "${typeField}"`,
    property: propName,
  });
  return null;
}

/**
 * Normalizes an array property. Only primitive item types are supported.
 */
function normalizeArrayProperty(
  propName: string,
  def: Record<string, unknown>,
  isRequired: boolean,
  warnings: NormalizeWarning[],
): NormalizedProperty | null {
  const items = def['items'];

  if (items === null || items === undefined || typeof items !== 'object' || Array.isArray(items)) {
    warnings.push({
      code: 'OPENAPI_ARRAY_ITEMS_UNSUPPORTED',
      message: `Property "${propName}" is an array with invalid or missing items definition`,
      property: propName,
    });
    return null;
  }

  const itemsDef = items as Record<string, unknown>;

  // Check for $ref in items
  if ('$ref' in itemsDef) {
    warnings.push({
      code: 'OPENAPI_REF_UNSUPPORTED',
      message: `Property "${propName}" array items use $ref which is not supported in the MVP`,
      property: propName,
    });
    return null;
  }

  const itemType = itemsDef['type'];

  if (typeof itemType !== 'string') {
    warnings.push({
      code: 'OPENAPI_ARRAY_ITEMS_UNSUPPORTED',
      message: `Property "${propName}" array items have no valid "type" field`,
      property: propName,
    });
    return null;
  }

  const normalizedItemType = PRIMITIVE_TYPE_MAP[itemType];

  if (!normalizedItemType) {
    warnings.push({
      code: 'OPENAPI_ARRAY_ITEMS_UNSUPPORTED',
      message: `Property "${propName}" array items have unsupported type "${itemType}"`,
      property: propName,
    });
    return null;
  }

  return {
    name: propName,
    type: normalizedItemType,
    isArray: true,
    required: isRequired,
  };
}
