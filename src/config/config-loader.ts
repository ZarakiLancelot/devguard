import * as fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { DevGuardConfig } from './config-schema.js';
import { devGuardConfigSchema } from './config-schema.js';
import { validateConfig } from './validate-config.js';

/** Maximum supported DevGuard configuration file size: 1 MiB. */
export const MAX_CONFIG_FILE_BYTES = 1_048_576;

const ERROR_MESSAGES: Readonly<Record<ConfigLoadErrorCode, string>> = {
  CONFIG_INVALID_INPUT: 'DevGuard configuration input is invalid.',
  CONFIG_FILE_NOT_FOUND: 'DevGuard configuration file was not found.',
  CONFIG_FILE_UNREADABLE: 'DevGuard configuration file could not be read.',
  CONFIG_FILE_NOT_REGULAR: 'DevGuard configuration path does not reference a regular file.',
  CONFIG_FILE_TOO_LARGE: 'DevGuard configuration file exceeds the supported size limit.',
  CONFIG_FILE_INVALID_UTF8: 'DevGuard configuration file is not valid UTF-8 text.',
  CONFIG_YAML_INVALID: 'DevGuard configuration YAML is invalid.',
  CONFIG_YAML_UNSUPPORTED: 'DevGuard configuration uses unsupported YAML features.',
  CONFIG_SCHEMA_INVALID: 'DevGuard configuration structure is invalid.',
  CONFIG_RELATION_INVALID: 'DevGuard configuration relationships are invalid.',
};

const IDENTIFIER_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** Input required to load one explicitly selected DevGuard configuration file. */
export interface LoadConfigInput {
  configPath: string;
  workingDirectory: string;
}

/** A complete, structurally and relationally validated configuration result. */
export interface LoadedConfig {
  config: DevGuardConfig;
  /** Canonical absolute real path of the selected configuration file. */
  configPath: string;
  /** Canonical absolute directory containing configPath. */
  workspaceBase: string;
}

/** Stable fatal configuration-loading failure codes. */
export type ConfigLoadErrorCode =
  | 'CONFIG_INVALID_INPUT'
  | 'CONFIG_FILE_NOT_FOUND'
  | 'CONFIG_FILE_UNREADABLE'
  | 'CONFIG_FILE_NOT_REGULAR'
  | 'CONFIG_FILE_TOO_LARGE'
  | 'CONFIG_FILE_INVALID_UTF8'
  | 'CONFIG_YAML_INVALID'
  | 'CONFIG_YAML_UNSUPPORTED'
  | 'CONFIG_SCHEMA_INVALID'
  | 'CONFIG_RELATION_INVALID';

/** A safe structural schema location with no received value or parser diagnostic. */
export interface ConfigIssueLocation {
  path: string;
}

/** A safe fatal error raised while loading DevGuard configuration. */
export class ConfigLoadError extends Error {
  readonly code: ConfigLoadErrorCode;
  readonly issues?: readonly ConfigIssueLocation[];

  constructor(code: ConfigLoadErrorCode, issues?: readonly ConfigIssueLocation[]) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ConfigLoadError';
    this.code = code;

    if (issues !== undefined) {
      this.issues = Object.freeze(issues.map((issue) => Object.freeze({ path: issue.path })));
    }
  }
}

type PlainData = null | boolean | number | string | PlainData[] | PlainObject;

interface PlainObject {
  [key: string]: PlainData;
}

class UnsupportedYamlFeatureError extends Error {
  constructor() {
    super('Unsupported YAML feature');
  }
}

class InvalidPlainDataError extends Error {
  constructor() {
    super('Invalid plain data');
  }
}

/**
 * Reads, validates, and parses one explicitly selected DevGuard YAML configuration.
 * The operation is read-only and returns no partial configuration on failure.
 */
export async function loadConfig(input: LoadConfigInput): Promise<LoadedConfig> {
  validateInput(input);

  const lexicalConfigPath = resolveLexicalConfigPath(input);
  const configPath = await resolveCanonicalConfigPath(lexicalConfigPath);
  await assertRegularFileWithinLimit(configPath);

  const bytes = await readConfigBytes(configPath);
  if (bytes.byteLength > MAX_CONFIG_FILE_BYTES) {
    throw new ConfigLoadError('CONFIG_FILE_TOO_LARGE');
  }

  const content = decodeConfigText(bytes);
  const plainConfig = parseRestrictedYaml(content);
  assertPlainDataTree(plainConfig);

  const structuralResult = devGuardConfigSchema.safeParse(plainConfig);
  if (!structuralResult.success) {
    const issues = formatSchemaIssueLocations(
      structuralResult.error.issues.map((issue) => issue.path),
    );
    throw new ConfigLoadError('CONFIG_SCHEMA_INVALID', issues);
  }

  const config = structuralResult.data;
  const relationalResult = validateConfig(config);
  if (!relationalResult.valid) {
    throw new ConfigLoadError('CONFIG_RELATION_INVALID');
  }

  return {
    config,
    configPath,
    workspaceBase: path.dirname(configPath),
  };
}

function validateInput(input: LoadConfigInput): void {
  if (
    input === null ||
    typeof input !== 'object' ||
    !isUsablePathText(input.configPath) ||
    !isUsablePathText(input.workingDirectory)
  ) {
    throw new ConfigLoadError('CONFIG_INVALID_INPUT');
  }
}

function isUsablePathText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim().length > 0 &&
    !value.includes('\u0000')
  );
}

function resolveLexicalConfigPath(input: LoadConfigInput): string {
  try {
    return path.resolve(input.workingDirectory, input.configPath);
  } catch {
    throw new ConfigLoadError('CONFIG_INVALID_INPUT');
  }
}

async function resolveCanonicalConfigPath(lexicalConfigPath: string): Promise<string> {
  try {
    return await fs.realpath(lexicalConfigPath);
  } catch (error: unknown) {
    throw new ConfigLoadError(classifyFilesystemFailure(error));
  }
}

async function assertRegularFileWithinLimit(configPath: string): Promise<void> {
  let fileStats: Awaited<ReturnType<typeof fs.stat>>;

  try {
    fileStats = await fs.stat(configPath);
  } catch (error: unknown) {
    throw new ConfigLoadError(classifyFilesystemFailure(error));
  }

  if (!fileStats.isFile()) {
    throw new ConfigLoadError('CONFIG_FILE_NOT_REGULAR');
  }

  if (fileStats.size > MAX_CONFIG_FILE_BYTES) {
    throw new ConfigLoadError('CONFIG_FILE_TOO_LARGE');
  }
}

async function readConfigBytes(configPath: string): Promise<Buffer> {
  try {
    return await fs.readFile(configPath);
  } catch (error: unknown) {
    throw new ConfigLoadError(classifyFilesystemFailure(error));
  }
}

function decodeConfigText(bytes: Buffer): string {
  let content: string;

  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ConfigLoadError('CONFIG_FILE_INVALID_UTF8');
  }

  if (content.includes('\u0000')) {
    throw new ConfigLoadError('CONFIG_FILE_INVALID_UTF8');
  }

  return content;
}

function parseRestrictedYaml(content: string): PlainData {
  let documents: ReturnType<typeof parseAllDocuments>;

  try {
    documents = parseAllDocuments(content, {
      strict: true,
      uniqueKeys: true,
      version: '1.2',
      schema: 'core',
      merge: false,
      resolveKnownTags: false,
    });
  } catch {
    throw new ConfigLoadError('CONFIG_YAML_INVALID');
  }

  if (documents.length !== 1) {
    throw new ConfigLoadError('CONFIG_YAML_INVALID');
  }

  const document = documents[0];
  if (document === undefined || document.errors.length > 0) {
    throw new ConfigLoadError('CONFIG_YAML_INVALID');
  }

  if (document.warnings.length > 0 || hasUnsupportedDirectives(document.directives)) {
    throw new ConfigLoadError('CONFIG_YAML_UNSUPPORTED');
  }

  try {
    return convertYamlNode(document.contents);
  } catch (error: unknown) {
    if (error instanceof UnsupportedYamlFeatureError || error instanceof InvalidPlainDataError) {
      throw new ConfigLoadError('CONFIG_YAML_UNSUPPORTED');
    }

    throw new ConfigLoadError('CONFIG_YAML_INVALID');
  }
}

function hasUnsupportedDirectives(directives: unknown): boolean {
  if (directives === null || typeof directives !== 'object') {
    return true;
  }

  const yamlDirective = (directives as { yaml?: unknown }).yaml;
  if (
    yamlDirective !== null &&
    typeof yamlDirective === 'object' &&
    (yamlDirective as { explicit?: unknown }).explicit === true &&
    (yamlDirective as { version?: unknown }).version !== '1.2'
  ) {
    return true;
  }

  const tags = (directives as { tags?: unknown }).tags;
  if (tags === null || typeof tags !== 'object') {
    return true;
  }

  return Object.keys(tags).some((handle) => handle !== '!!');
}

function convertYamlNode(node: unknown): PlainData {
  if (node === null) {
    return null;
  }

  if (isAlias(node)) {
    throw new UnsupportedYamlFeatureError();
  }

  if (!isScalar(node) && !isMap(node) && !isSeq(node)) {
    throw new UnsupportedYamlFeatureError();
  }

  if (node.anchor !== undefined || node.tag !== undefined) {
    throw new UnsupportedYamlFeatureError();
  }

  if (isScalar(node)) {
    return convertYamlScalar(node.value);
  }

  if (isSeq(node)) {
    return node.items.map((item) => convertYamlNode(item));
  }

  const objectValue = Object.create(null) as Record<string, PlainData>;
  for (const pair of node.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
      throw new UnsupportedYamlFeatureError();
    }

    if (pair.key.anchor !== undefined || pair.key.tag !== undefined || pair.key.value === '<<') {
      throw new UnsupportedYamlFeatureError();
    }

    const key = pair.key.value;
    if (Object.hasOwn(objectValue, key)) {
      throw new UnsupportedYamlFeatureError();
    }

    Object.defineProperty(objectValue, key, {
      configurable: true,
      enumerable: true,
      value: convertYamlNode(pair.value),
      writable: true,
    });
  }

  return objectValue;
}

function convertYamlScalar(value: unknown): PlainData {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }

  throw new UnsupportedYamlFeatureError();
}

function assertPlainDataTree(value: unknown, ancestors: Set<object> = new Set<object>()): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== 'object') {
    throw new InvalidPlainDataError();
  }

  if (ancestors.has(value)) {
    throw new InvalidPlainDataError();
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertPlainArray(value, ancestors);
    } else {
      assertPlainObject(value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertPlainArray(value: unknown[], ancestors: Set<object>): void {
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new InvalidPlainDataError();
  }

  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new InvalidPlainDataError();
    }

    assertPlainDataTree(value[index], ancestors);
  }

  for (const key of Object.keys(value)) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      throw new InvalidPlainDataError();
    }
  }
}

function assertPlainObject(value: object, ancestors: Set<object>): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new InvalidPlainDataError();
  }

  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new InvalidPlainDataError();
    }

    assertPlainDataTree(descriptor.value, ancestors);
  }
}

function formatSchemaIssueLocations(
  issuePaths: readonly (readonly (string | number)[])[],
): readonly ConfigIssueLocation[] {
  const paths = new Set<string>();

  for (const issuePath of issuePaths) {
    paths.add(formatSchemaIssuePath(issuePath));
  }

  return Object.freeze(
    [...paths].sort(compareCodePoints).map((issuePath) => Object.freeze({ path: issuePath })),
  );
}

function formatSchemaIssuePath(issuePath: readonly (string | number)[]): string {
  if (issuePath.length === 0) {
    return '$';
  }

  let formatted = '';
  for (const segment of issuePath) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
      continue;
    }

    if (IDENTIFIER_KEY_PATTERN.test(segment)) {
      formatted += formatted.length === 0 ? segment : `.${segment}`;
      continue;
    }

    formatted += `[${JSON.stringify(segment)}]`;
  }

  return formatted;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index++) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }

  return leftPoints.length - rightPoints.length;
}

function classifyFilesystemFailure(error: unknown): ConfigLoadErrorCode {
  const code = getFilesystemErrorCode(error);

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return 'CONFIG_FILE_NOT_FOUND';
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return 'CONFIG_FILE_UNREADABLE';
  }

  if (code === 'EISDIR') {
    return 'CONFIG_FILE_NOT_REGULAR';
  }

  if (code === 'ERR_INVALID_ARG_TYPE' || code === 'ERR_INVALID_ARG_VALUE' || code === 'EINVAL') {
    return 'CONFIG_INVALID_INPUT';
  }

  return 'CONFIG_FILE_UNREADABLE';
}

function getFilesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
