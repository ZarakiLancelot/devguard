import { Buffer } from 'node:buffer';
import type { PRHealthReport } from '../types/reports.js';
import { prHealthReportSchema } from './report-schema.js';

const SIMPLE_PATH_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * Formats one validated PR health report as readable JSON without reading
 * external state, mutating the report, or transforming approved report data.
 */
export function formatJson(report: PRHealthReport): string {
  const validatedReport = prHealthReportSchema.parse(report);

  assertJsonSafeValue(validatedReport, '$', new Set<object>(), false);

  const serialized = JSON.stringify(validatedReport, null, 2);
  if (serialized === undefined) {
    throw nonJsonSafeValueError('$', 'undefined root value');
  }

  return `${serialized}\n`;
}

function assertJsonSafeValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  isArrayElement: boolean,
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw nonJsonSafeValueError(path, 'non-finite number');
    }

    return;
  }

  if (value === undefined) {
    throw nonJsonSafeValueError(
      path,
      isArrayElement ? 'undefined array element' : 'undefined value',
    );
  }

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw nonJsonSafeValueError(path, typeof value);
  }

  if (Buffer.isBuffer(value)) {
    throw nonJsonSafeValueError(path, 'Buffer');
  }

  if (ArrayBuffer.isView(value)) {
    throw nonJsonSafeValueError(path, 'typed array');
  }

  if (value instanceof Date) {
    throw nonJsonSafeValueError(path, 'Date');
  }

  if (value instanceof Map) {
    throw nonJsonSafeValueError(path, 'Map');
  }

  if (value instanceof Set) {
    throw nonJsonSafeValueError(path, 'Set');
  }

  if (value instanceof RegExp) {
    throw nonJsonSafeValueError(path, 'RegExp');
  }

  if (typeof value !== 'object') {
    throw nonJsonSafeValueError(path, 'unsupported value');
  }

  if (ancestors.has(value)) {
    throw nonJsonSafeValueError(path, 'circular reference');
  }

  ancestors.add(value);
  try {
    assertNoEnumerableSymbolKeys(value, path);
    assertNoCustomSerializationHook(value, path);

    if (Array.isArray(value)) {
      assertJsonSafeArray(value, path, ancestors);
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw nonJsonSafeValueError(path, objectPrototypeCategory(prototype));
    }

    assertJsonSafeObject(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function assertJsonSafeArray(value: unknown[], path: string, ancestors: Set<object>): void {
  for (const key of Object.keys(value)) {
    if (!isArrayIndex(key, value.length)) {
      throw nonJsonSafeValueError(formatObjectPath(path, key), 'array property');
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const itemPath = `${path}[${index}]`;

    if (descriptor === undefined) {
      throw nonJsonSafeValueError(itemPath, 'array hole');
    }

    if (!('value' in descriptor)) {
      throw nonJsonSafeValueError(itemPath, 'accessor property');
    }

    assertJsonSafeValue(descriptor.value, itemPath, ancestors, true);
  }
}

function assertJsonSafeObject(value: object, path: string, ancestors: Set<object>): void {
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const propertyPath = formatObjectPath(path, key);

    if (descriptor === undefined) {
      throw nonJsonSafeValueError(propertyPath, 'unstable object property');
    }

    if (!('value' in descriptor)) {
      throw nonJsonSafeValueError(propertyPath, 'accessor property');
    }

    if (descriptor.value !== undefined) {
      assertJsonSafeValue(descriptor.value, propertyPath, ancestors, false);
    }
  }
}

function assertNoEnumerableSymbolKeys(value: object, path: string): void {
  for (const key of Object.getOwnPropertySymbols(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (descriptor?.enumerable === true) {
      throw nonJsonSafeValueError(path, 'symbol-keyed property');
    }
  }
}

function assertNoCustomSerializationHook(value: object, path: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'toJSON');

  if (
    descriptor !== undefined &&
    (!('value' in descriptor) || typeof descriptor.value === 'function')
  ) {
    throw nonJsonSafeValueError(path, 'custom serialization hook');
  }
}

function objectPrototypeCategory(prototype: object): string {
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;

  return typeof constructor === 'function' ? 'class instance' : 'unsupported object prototype';
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);

  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function formatObjectPath(path: string, key: string): string {
  return SIMPLE_PATH_KEY.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function nonJsonSafeValueError(path: string, category: string): Error {
  return new Error(`Report contains a non-JSON-safe value at ${path}: ${category}.`);
}
