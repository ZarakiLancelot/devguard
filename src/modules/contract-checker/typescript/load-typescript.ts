import {
  Project,
  ScriptTarget,
  SyntaxKind,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
  type SourceFile,
  type PropertySignature,
  type TypeLiteralNode,
} from 'ts-morph';

/**
 * Input for loading TypeScript declarations from string content.
 */
export interface TypeScriptDocumentInput {
  /** Raw TypeScript source content. */
  content: string;
  /** Optional filename for the virtual source file. */
  fileName?: string;
  /** Label for error/warning messages. */
  sourceLabel?: string;
}

/**
 * Supported declaration kinds.
 */
export type TypeScriptDeclarationKind = 'interface' | 'type-alias';

/**
 * Descriptor for a single property in a loaded declaration.
 */
export interface TypeScriptPropertyDescriptor {
  name: string;
  optional: boolean;
  typeText: string;
  line?: number;
}

/**
 * A loaded TypeScript declaration with its properties.
 */
export interface LoadedTypeScriptDeclaration {
  name: string;
  kind: TypeScriptDeclarationKind;
  sourceLabel?: string;
  fileName?: string;
  declarationText: string;
  properties: TypeScriptPropertyDescriptor[];
}

/**
 * Warning produced during TypeScript declaration loading.
 */
export interface TypeScriptLoadWarning {
  code: TypeScriptWarningCode;
  message: string;
  member?: string;
}

export type TypeScriptWarningCode =
  | 'TYPESCRIPT_MEMBER_UNSUPPORTED'
  | 'TYPESCRIPT_PROPERTY_UNSUPPORTED';

/**
 * Stable error codes.
 */
export type TypeScriptLoadErrorCode =
  | 'TYPESCRIPT_PARSE_FAILED'
  | 'TYPESCRIPT_DECLARATION_NOT_FOUND'
  | 'TYPESCRIPT_DECLARATION_AMBIGUOUS'
  | 'TYPESCRIPT_DECLARATION_UNSUPPORTED';

/**
 * Discriminated result of loading a TypeScript declaration.
 */
export type TypeScriptLoadResult =
  | {
      success: true;
      declaration: LoadedTypeScriptDeclaration;
      warnings: TypeScriptLoadWarning[];
    }
  | {
      success: false;
      error: {
        code: TypeScriptLoadErrorCode;
        message: string;
      };
      warnings: TypeScriptLoadWarning[];
    };

/**
 * Loads a TypeScript declaration by exact name from source content.
 *
 * Supports interfaces and object-literal type aliases.
 * Does not read files, resolve imports, or use tsconfig.
 * Unsupported members produce warnings; unsupported declaration forms fail.
 *
 * Policy: If the declaration itself is supported (interface or object-literal
 * type alias), unsupported individual members produce warnings and are skipped.
 * Supported property signatures are preserved.
 */
export function loadTypeScriptDeclaration(
  input: TypeScriptDocumentInput,
  typeName: string,
): TypeScriptLoadResult {
  const warnings: TypeScriptLoadWarning[] = [];
  const fileName = input.fileName ?? 'input.ts';
  const sourceLabel = input.sourceLabel;

  let sourceFile: SourceFile;
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ScriptTarget.ES2022,
        strict: true,
      },
    });
    sourceFile = project.createSourceFile(fileName, input.content);

    const syntaxDiagnostics = project
      .getLanguageService()
      .compilerObject.getSyntacticDiagnostics(sourceFile.getFilePath());
    if (syntaxDiagnostics.length > 0) {
      return {
        success: false,
        error: {
          code: 'TYPESCRIPT_PARSE_FAILED',
          message: 'Failed to parse TypeScript source due to syntax errors',
        },
        warnings,
      };
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown parse error';
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_PARSE_FAILED',
        message: `Failed to parse TypeScript source: ${msg}`,
      },
      warnings,
    };
  }

  // Find matching declarations
  const interfaces = sourceFile.getInterfaces().filter((d) => d.getName() === typeName);
  const typeAliases = sourceFile.getTypeAliases().filter((d) => d.getName() === typeName);

  const supportedCount = interfaces.length + typeAliases.length;

  if (supportedCount === 0) {
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_DECLARATION_NOT_FOUND',
        message: `Declaration "${typeName}" not found in source`,
      },
      warnings,
    };
  }

  if (supportedCount > 1) {
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_DECLARATION_AMBIGUOUS',
        message: `Multiple declarations named "${typeName}" found (${interfaces.length} interface(s), ${typeAliases.length} type alias(es))`,
      },
      warnings,
    };
  }

  // Process interface
  if (interfaces.length === 1) {
    const iface = interfaces[0] as InterfaceDeclaration;

    // Check for extends — unsupported
    if (iface.getExtends().length > 0) {
      return {
        success: false,
        error: {
          code: 'TYPESCRIPT_DECLARATION_UNSUPPORTED',
          message: `Interface "${typeName}" extends another interface, which is not supported in the MVP`,
        },
        warnings,
      };
    }

    const properties = extractInterfaceProperties(iface, warnings);

    return {
      success: true,
      declaration: {
        name: typeName,
        kind: 'interface',
        declarationText: iface.getText(),
        properties,
        ...(sourceLabel ? { sourceLabel } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {}),
      },
      warnings,
    };
  }

  // Process type alias
  const alias = typeAliases[0] as TypeAliasDeclaration;
  return processTypeAlias(alias, typeName, input, sourceLabel, warnings);
}

/**
 * Processes a type alias declaration.
 */
function processTypeAlias(
  alias: TypeAliasDeclaration,
  typeName: string,
  input: TypeScriptDocumentInput,
  sourceLabel: string | undefined,
  warnings: TypeScriptLoadWarning[],
): TypeScriptLoadResult {
  const typeNode = alias.getTypeNode();

  if (!typeNode) {
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_DECLARATION_UNSUPPORTED',
        message: `Type alias "${typeName}" has no type node`,
      },
      warnings,
    };
  }

  // Only support TypeLiteral (object literal type)
  if (typeNode.getKind() !== SyntaxKind.TypeLiteral) {
    return {
      success: false,
      error: {
        code: 'TYPESCRIPT_DECLARATION_UNSUPPORTED',
        message: `Type alias "${typeName}" is not an object literal type (found ${typeNode.getKindName()})`,
      },
      warnings,
    };
  }

  const typeLiteral = typeNode as TypeLiteralNode;
  const properties = extractTypeLiteralProperties(typeLiteral, warnings);

  return {
    success: true,
    declaration: {
      name: typeName,
      kind: 'type-alias',
      declarationText: alias.getText(),
      properties,
      ...(sourceLabel ? { sourceLabel } : {}),
      ...(input.fileName ? { fileName: input.fileName } : {}),
    },
    warnings,
  };
}

/**
 * Extracts property descriptors from an interface declaration.
 */
function extractInterfaceProperties(
  iface: InterfaceDeclaration,
  warnings: TypeScriptLoadWarning[],
): TypeScriptPropertyDescriptor[] {
  const properties: TypeScriptPropertyDescriptor[] = [];

  for (const member of iface.getMembers()) {
    if (member.getKind() === SyntaxKind.PropertySignature) {
      const prop = member as PropertySignature;
      properties.push(extractPropertyDescriptor(prop));
    } else {
      // Unsupported member kind
      const memberName =
        'getName' in member ? (member as { getName(): string }).getName() : undefined;
      warnings.push({
        code: 'TYPESCRIPT_MEMBER_UNSUPPORTED',
        message: `Unsupported member kind "${member.getKindName()}" in interface`,
        member: memberName ?? member.getKindName(),
      });
    }
  }

  return properties;
}

/**
 * Extracts property descriptors from a type literal.
 */
function extractTypeLiteralProperties(
  typeLiteral: TypeLiteralNode,
  warnings: TypeScriptLoadWarning[],
): TypeScriptPropertyDescriptor[] {
  const properties: TypeScriptPropertyDescriptor[] = [];

  for (const member of typeLiteral.getMembers()) {
    if (member.getKind() === SyntaxKind.PropertySignature) {
      const prop = member as PropertySignature;
      properties.push(extractPropertyDescriptor(prop));
    } else {
      const memberName =
        'getName' in member ? (member as { getName(): string }).getName() : undefined;
      warnings.push({
        code: 'TYPESCRIPT_MEMBER_UNSUPPORTED',
        message: `Unsupported member kind "${member.getKindName()}" in type literal`,
        member: memberName ?? member.getKindName(),
      });
    }
  }

  return properties;
}

/**
 * Extracts a property descriptor from a PropertySignature node.
 */
function extractPropertyDescriptor(prop: PropertySignature): TypeScriptPropertyDescriptor {
  return {
    name: prop.getName(),
    optional: prop.hasQuestionToken(),
    typeText: prop.getTypeNode()?.getText() ?? 'unknown',
    line: prop.getStartLineNumber(),
  };
}
