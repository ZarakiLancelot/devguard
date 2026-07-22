import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AnalyzeContractMappingInput } from '../modules/contract-checker/analyze-contract-mapping.js';

/** All project-owned fixture directories validated by the fixture suite. */
export const FIXTURE_NAMES = [
  'valid-contract',
  'missing-property',
  'incompatible-type',
  'required-mismatch',
  'missing-tests',
  'unsupported-typescript',
  'malformed-openapi',
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface FixtureExpectedFinding {
  ruleId: string;
  severity: string;
  property?: string;
  logicalSubject?: string;
  repositoryId?: string;
  file?: string;
  line?: number;
}

export interface FixtureExpectedWarning {
  code: string;
  source: 'openapi' | 'typescript';
  file?: string;
  line?: number;
}

export interface FixtureExpectedResult {
  description: string;
  expectedFindings: FixtureExpectedFinding[];
  expectedWarnings: FixtureExpectedWarning[];
  compared?: boolean;
}

interface FixtureRepositoryConfig {
  path: string;
}

interface FixtureContractConfig {
  name: string;
  openapiSchema: string;
  typescript: {
    repository: string;
    file: string;
    type: string;
  };
}

interface FixtureConfig {
  repositories: Record<string, FixtureRepositoryConfig>;
  openapi: {
    repository: string;
    path: string;
  };
  contracts: FixtureContractConfig[];
}

/**
 * A loaded fixture mapping with all source content held in memory.
 */
export interface LoadedContractFixture {
  name: FixtureName;
  input: AnalyzeContractMappingInput;
  expected: FixtureExpectedResult;
}

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, '../../fixtures');

/**
 * Resolves a fixture directory using a repository-relative fixture name.
 */
export function getFixtureDirectory(fixtureName: FixtureName): string {
  return path.join(FIXTURES_DIRECTORY, fixtureName);
}

/**
 * Reads and validates stable expected fixture metadata.
 */
export function loadFixtureExpected(fixtureName: FixtureName): FixtureExpectedResult {
  const filePath = path.join(getFixtureDirectory(fixtureName), 'expected.json');
  const parsed = parseJsonObject(fs.readFileSync(filePath, 'utf-8'), filePath);
  const description = readRequiredString(parsed, 'description', filePath);
  const expectedFindings = readExpectedFindings(parsed['expectedFindings'], filePath);
  const expectedWarnings = readExpectedWarnings(parsed['expectedWarnings'], filePath);
  const compared = readOptionalBoolean(parsed['compared'], filePath);

  return {
    description,
    expectedFindings,
    expectedWarnings,
    ...(compared === undefined ? {} : { compared }),
  };
}

/**
 * Reads the configured sources and derives an explicit in-memory mapping input.
 */
export function loadContractFixture(fixtureName: FixtureName): LoadedContractFixture {
  const fixtureDirectory = getFixtureDirectory(fixtureName);
  const configPath = path.join(fixtureDirectory, '.devguard.yml');
  const config = parseFixtureConfig(fs.readFileSync(configPath, 'utf-8'), configPath);

  if (config.contracts.length !== 1) {
    throw new Error(`Fixture "${fixtureName}" must define exactly one contract mapping`);
  }

  const contract = config.contracts[0];
  if (contract === undefined) {
    throw new Error(`Fixture "${fixtureName}" is missing its contract mapping`);
  }

  const openapiRepository = getRepository(config, config.openapi.repository, configPath);
  const typeScriptRepository = getRepository(config, contract.typescript.repository, configPath);
  const openapiFile = normalizeFixturePath(config.openapi.path);
  const typeScriptFile = normalizeFixturePath(contract.typescript.file);

  return {
    name: fixtureName,
    input: {
      mappingName: contract.name,
      openapi: {
        repositoryId: config.openapi.repository,
        file: openapiFile,
        content: readRepositoryFile(fixtureDirectory, openapiRepository.path, openapiFile),
        schemaName: contract.openapiSchema,
      },
      typescript: {
        repositoryId: contract.typescript.repository,
        file: typeScriptFile,
        content: readRepositoryFile(fixtureDirectory, typeScriptRepository.path, typeScriptFile),
        declarationName: contract.typescript.type,
      },
    },
    expected: loadFixtureExpected(fixtureName),
  };
}

/**
 * Normalizes fixture-owned relative paths for portable assertions and IDs.
 */
export function normalizeFixturePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/**
 * Reads a configured fixture file without allowing an absolute fixture path.
 */
function readRepositoryFile(
  fixtureDirectory: string,
  repositoryPath: string,
  configuredFile: string,
): string {
  const normalizedRepositoryPath = normalizeFixturePath(repositoryPath);
  const absolutePath = path.resolve(fixtureDirectory, normalizedRepositoryPath, configuredFile);
  const repositoryDirectory = path.resolve(fixtureDirectory, normalizedRepositoryPath);

  if (!absolutePath.startsWith(`${repositoryDirectory}${path.sep}`)) {
    throw new Error(`Configured fixture path "${configuredFile}" escapes its repository directory`);
  }

  return fs.readFileSync(absolutePath, 'utf-8');
}

/**
 * Parses the minimal fixture config shape needed to construct one contract input.
 */
function parseFixtureConfig(content: string, sourcePath: string): FixtureConfig {
  const parsed = parseYaml(content) as unknown;
  const root = readRecord(parsed, sourcePath);
  const repositoriesValue = readRecord(root['repositories'], sourcePath);
  const repositories: Record<string, FixtureRepositoryConfig> = {};

  for (const [repositoryId, value] of Object.entries(repositoriesValue)) {
    const repository = readRecord(value, sourcePath);
    repositories[repositoryId] = {
      path: readRequiredString(repository, 'path', sourcePath),
    };
  }

  const openapiValue = readRecord(root['openapi'], sourcePath);
  const contractsValue = root['contracts'];
  if (!Array.isArray(contractsValue)) {
    throw new Error(`Fixture config "${sourcePath}" must contain a contracts array`);
  }

  return {
    repositories,
    openapi: {
      repository: readRequiredString(openapiValue, 'repository', sourcePath),
      path: readRequiredString(openapiValue, 'path', sourcePath),
    },
    contracts: contractsValue.map((value) => parseFixtureContract(value, sourcePath)),
  };
}

/**
 * Parses one configured contract mapping without using the production config loader.
 */
function parseFixtureContract(value: unknown, sourcePath: string): FixtureContractConfig {
  const contract = readRecord(value, sourcePath);
  const typeScript = readRecord(contract['typescript'], sourcePath);

  return {
    name: readRequiredString(contract, 'name', sourcePath),
    openapiSchema: readRequiredString(contract, 'openapiSchema', sourcePath),
    typescript: {
      repository: readRequiredString(typeScript, 'repository', sourcePath),
      file: readRequiredString(typeScript, 'file', sourcePath),
      type: readRequiredString(typeScript, 'type', sourcePath),
    },
  };
}

/**
 * Gets a configured repository or raises a fixture-data error.
 */
function getRepository(
  config: FixtureConfig,
  repositoryId: string,
  sourcePath: string,
): FixtureRepositoryConfig {
  const repository = config.repositories[repositoryId];
  if (repository === undefined) {
    throw new Error(
      `Fixture config "${sourcePath}" references unknown repository "${repositoryId}"`,
    );
  }

  return repository;
}

/**
 * Parses expected.json while keeping all data validation local to test support.
 */
function parseJsonObject(content: string, sourcePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Fixture expected data "${sourcePath}" must be valid JSON`);
  }

  return readRecord(parsed, sourcePath);
}

/**
 * Reads complete expected finding metadata.
 */
function readExpectedFindings(value: unknown, sourcePath: string): FixtureExpectedFinding[] {
  if (!Array.isArray(value)) {
    throw new Error(`Fixture expected data "${sourcePath}" must contain expectedFindings`);
  }

  return value.map((item) => {
    const finding = readRecord(item, sourcePath);
    const property = readOptionalString(finding['property'], sourcePath);
    const logicalSubject = readOptionalString(finding['logicalSubject'], sourcePath);
    const repositoryId = readOptionalString(finding['repositoryId'], sourcePath);
    const file = readOptionalString(finding['file'], sourcePath);
    const line = readOptionalNumber(finding['line'], sourcePath);

    return {
      ruleId: readRequiredString(finding, 'ruleId', sourcePath),
      severity: readRequiredString(finding, 'severity', sourcePath),
      ...(property === undefined ? {} : { property }),
      ...(logicalSubject === undefined ? {} : { logicalSubject }),
      ...(repositoryId === undefined ? {} : { repositoryId }),
      ...(file === undefined ? {} : { file: normalizeFixturePath(file) }),
      ...(line === undefined ? {} : { line }),
    };
  });
}

/**
 * Reads deterministic internal warning expectations.
 */
function readExpectedWarnings(value: unknown, sourcePath: string): FixtureExpectedWarning[] {
  if (!Array.isArray(value)) {
    throw new Error(`Fixture expected data "${sourcePath}" must contain expectedWarnings`);
  }

  return value.map((item) => {
    const warning = readRecord(item, sourcePath);
    const source = readRequiredString(warning, 'source', sourcePath);
    if (source !== 'openapi' && source !== 'typescript') {
      throw new Error(`Fixture expected data "${sourcePath}" has an invalid warning source`);
    }

    const file = readOptionalString(warning['file'], sourcePath);
    const line = readOptionalNumber(warning['line'], sourcePath);
    return {
      code: readRequiredString(warning, 'code', sourcePath),
      source,
      ...(file === undefined ? {} : { file: normalizeFixturePath(file) }),
      ...(line === undefined ? {} : { line }),
    };
  });
}

/**
 * Reads a non-empty string field from a record.
 */
function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  sourcePath: string,
): string {
  const value = readOptionalString(record[key], sourcePath);
  if (value === undefined || value.trim() === '') {
    throw new Error(`Fixture data "${sourcePath}" must contain non-empty string "${key}"`);
  }

  return value;
}

/**
 * Reads an optional string field from untrusted fixture data.
 */
function readOptionalString(value: unknown, sourcePath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Fixture data "${sourcePath}" contains a non-string field`);
  }

  return value;
}

/**
 * Reads an optional finite numeric field from fixture metadata.
 */
function readOptionalNumber(value: unknown, sourcePath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Fixture data "${sourcePath}" contains a non-numeric field`);
  }

  return value;
}

/**
 * Reads an optional boolean field from fixture metadata.
 */
function readOptionalBoolean(value: unknown, sourcePath: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`Fixture data "${sourcePath}" contains a non-boolean field`);
  }

  return value;
}

/**
 * Narrows a parsed JSON or YAML value to a non-array object record.
 */
function readRecord(value: unknown, sourcePath: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Fixture data "${sourcePath}" must contain an object`);
  }

  return value as Record<string, unknown>;
}
