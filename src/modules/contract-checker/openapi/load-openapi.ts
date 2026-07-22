import { parse as parseYaml } from 'yaml';

/**
 * Input for loading an OpenAPI document from string content.
 */
export interface OpenApiDocumentInput {
  /** Raw document content (YAML or JSON string). */
  content: string;
  /** Explicit format or auto-detect. Defaults to 'auto'. */
  format?: 'yaml' | 'json' | 'auto';
  /** Label for error/warning messages (e.g., file path). */
  sourceLabel?: string;
}

/**
 * Warning produced during OpenAPI document loading.
 */
export interface OpenApiLoadWarning {
  code: string;
  message: string;
  sourceLabel?: string;
}

/**
 * Stable error codes for OpenAPI loading failures.
 */
export type OpenApiLoadErrorCode =
  | 'OPENAPI_PARSE_FAILED'
  | 'OPENAPI_ROOT_INVALID'
  | 'OPENAPI_VERSION_MISSING'
  | 'OPENAPI_VERSION_UNSUPPORTED'
  | 'OPENAPI_COMPONENTS_INVALID'
  | 'OPENAPI_SCHEMAS_INVALID';

/**
 * Discriminated result of loading an OpenAPI document.
 */
export type OpenApiLoadResult =
  | {
      success: true;
      document: Record<string, unknown>;
      warnings: OpenApiLoadWarning[];
    }
  | {
      success: false;
      error: {
        code: OpenApiLoadErrorCode;
        message: string;
        sourceLabel?: string;
      };
    };

/**
 * Loads and performs basic validation on an OpenAPI document from string content.
 *
 * Supports YAML and JSON formats with automatic detection.
 * Validates document-level structure only — does not resolve $ref,
 * normalize schemas, or perform filesystem operations.
 */
export function loadOpenApiDocument(input: OpenApiDocumentInput): OpenApiLoadResult {
  const format = input.format ?? 'auto';
  const sourceLabel = input.sourceLabel;

  const makeError = (code: OpenApiLoadErrorCode, message: string): OpenApiLoadResult => ({
    success: false,
    error: sourceLabel ? { code, message, sourceLabel } : { code, message },
  });

  // Parse content
  let parsed: unknown;
  try {
    parsed = parseContent(input.content, format);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown parse error';
    return makeError('OPENAPI_PARSE_FAILED', `Failed to parse OpenAPI document: ${msg}`);
  }

  // Validate root is a non-null object
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return makeError('OPENAPI_ROOT_INVALID', 'OpenAPI document root must be a non-null object');
  }

  const doc = parsed as Record<string, unknown>;

  // Validate openapi version field exists
  const openapiVersion = doc['openapi'];
  if (openapiVersion === undefined || openapiVersion === null || openapiVersion === '') {
    return makeError(
      'OPENAPI_VERSION_MISSING',
      'OpenAPI document must contain a non-empty "openapi" version field',
    );
  }

  if (typeof openapiVersion !== 'string') {
    return makeError('OPENAPI_VERSION_MISSING', 'OpenAPI "openapi" field must be a string');
  }

  // Validate version starts with 3.0. or 3.1.
  if (!openapiVersion.startsWith('3.0.') && !openapiVersion.startsWith('3.1.')) {
    return makeError(
      'OPENAPI_VERSION_UNSUPPORTED',
      `Unsupported OpenAPI version "${openapiVersion}". Only 3.0.x and 3.1.x are supported.`,
    );
  }

  const warnings: OpenApiLoadWarning[] = [];

  // Validate components (when present)
  if ('components' in doc && doc['components'] !== undefined) {
    if (
      doc['components'] === null ||
      typeof doc['components'] !== 'object' ||
      Array.isArray(doc['components'])
    ) {
      return makeError('OPENAPI_COMPONENTS_INVALID', '"components" must be an object when present');
    }

    const components = doc['components'] as Record<string, unknown>;

    // Validate components.schemas (when present)
    if ('schemas' in components && components['schemas'] !== undefined) {
      if (
        components['schemas'] === null ||
        typeof components['schemas'] !== 'object' ||
        Array.isArray(components['schemas'])
      ) {
        return makeError(
          'OPENAPI_SCHEMAS_INVALID',
          '"components.schemas" must be an object when present',
        );
      }
    }
  }

  return {
    success: true,
    document: doc,
    warnings,
  };
}

/**
 * Parses content based on the specified format.
 * 'auto' attempts JSON first, then YAML.
 */
function parseContent(content: string, format: 'yaml' | 'json' | 'auto'): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(content) as unknown;
    case 'yaml':
      return parseYaml(content) as unknown;
    case 'auto':
      return parseAuto(content);
  }
}

/**
 * Auto-detects format: tries JSON first (if content starts with { or [),
 * otherwise falls back to YAML.
 */
function parseAuto(content: string): unknown {
  const trimmed = content.trimStart();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(content) as unknown;
    } catch {
      // Fall through to YAML
    }
  }

  return parseYaml(content) as unknown;
}
