import { describe, expect, it, vi } from 'vitest';
import { formatContractWarning } from './contract-warning-formatter.js';
import type { ContractAnalysisWarning } from '../modules/contract-checker/analyze-contract-mapping.js';

function createWarning(overrides: Partial<ContractAnalysisWarning> = {}): ContractAnalysisWarning {
  return {
    code: 'OPENAPI_PARSE_FAILED',
    message: 'private parser diagnostic',
    source: 'openapi',
    file: 'docs/openapi.yaml',
    line: 12,
    ...overrides,
  };
}

describe('formatContractWarning', () => {
  it('formats stable generic public text with encoded fields', () => {
    expect(formatContractWarning('UpdateBook', createWarning())).toBe(
      'CONTRACT_WARNING mapping="UpdateBook" source="openapi" file="docs/openapi.yaml" line=12 code="OPENAPI_PARSE_FAILED": Contract source could not be fully analyzed.',
    );
  });

  it('JSON-encodes mapping, source, file, and code without forwarding warning.message', () => {
    const warning = createWarning({
      code: 'CODE "quoted"\nnext',
      source: 'typescript',
      file: 'src/quoted" name.ts',
      message: 'parser diagnostic at /private/workspace/file.ts: const secret = "do-not-leak"',
    });
    const formatted = formatContractWarning('Map "quoted"\nnext', warning);

    expect(formatted).toContain('mapping="Map \\"quoted\\"\\nnext"');
    expect(formatted).toContain('source="typescript"');
    expect(formatted).toContain('file="src/quoted\\" name.ts"');
    expect(formatted).toContain('code="CODE \\"quoted\\"\\nnext"');
    expect(formatted).not.toContain(warning.message);
    expect(formatted).not.toContain('/private/workspace');
    expect(formatted).not.toContain('do-not-leak');
  });

  it('omits absent or unsafe files and invalid line values', () => {
    const warningWithoutFileOrLine = createWarning();
    delete warningWithoutFileOrLine.file;
    delete warningWithoutFileOrLine.line;
    const absent = formatContractWarning('Map', warningWithoutFileOrLine);
    const absoluteFile = formatContractWarning(
      'Map',
      createWarning({ file: '/private/openapi.yaml' }),
    );

    expect(absent).not.toContain(' file=');
    expect(absent).not.toContain(' line=');
    expect(absoluteFile).not.toContain('/private/openapi.yaml');

    for (const line of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const formatted = formatContractWarning(
        'Map',
        createWarning({ line } as unknown as Partial<ContractAnalysisWarning>),
      );
      expect(formatted).not.toContain(' line=');
    }
  });

  it('is deterministic, leaves inputs unchanged, and does not log', () => {
    const warning = createWarning({ message: 'raw diagnostics must remain private' });
    const input = { mappingName: 'UpdateBook', warning };
    const before = structuredClone(input);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    try {
      const first = formatContractWarning(input.mappingName, input.warning);
      const second = formatContractWarning(input.mappingName, input.warning);

      expect(second).toBe(first);
      expect(input).toEqual(before);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
