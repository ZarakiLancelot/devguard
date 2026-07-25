import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(),
  stat: vi.fn(),
}));

import {
  AnalysisOutputError,
  DEFAULT_JSON_REPORT_FILE,
  DEFAULT_MARKDOWN_REPORT_FILE,
  DEFAULT_OUTPUT_DIRECTORY,
  planAnalysisOutput,
  type PlanAnalysisOutputInput,
} from './analysis-output-plan.js';

const WORKSPACE = '/workspace/devguard';

function createInput(overrides: Partial<PlanAnalysisOutputInput> = {}): PlanAnalysisOutputInput {
  return {
    workspaceBase: WORKSPACE,
    ...overrides,
  };
}

function planInvalid(input: PlanAnalysisOutputInput): AnalysisOutputError {
  try {
    planAnalysisOutput(input);
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisOutputError);
    return error as AnalysisOutputError;
  }

  throw new Error('Expected analysis output planning to fail');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('planAnalysisOutput', () => {
  it('plans both default report targets', () => {
    expect(planAnalysisOutput(createInput())).toEqual({
      outputDirectory: path.join(WORKSPACE, DEFAULT_OUTPUT_DIRECTORY),
      markdownFile: DEFAULT_MARKDOWN_REPORT_FILE,
      jsonFile: DEFAULT_JSON_REPORT_FILE,
      markdownDisplayPath: `${DEFAULT_OUTPUT_DIRECTORY}/${DEFAULT_MARKDOWN_REPORT_FILE}`,
      jsonDisplayPath: `${DEFAULT_OUTPUT_DIRECTORY}/${DEFAULT_JSON_REPORT_FILE}`,
    });
  });

  it('uses a configured directory', () => {
    const plan = planAnalysisOutput(createInput({ configuredOutput: { directory: 'artifacts' } }));

    expect(plan.outputDirectory).toBe(path.join(WORKSPACE, 'artifacts'));
  });

  it('uses a configured Markdown filename', () => {
    const plan = planAnalysisOutput(createInput({ configuredOutput: { markdown: 'review.txt' } }));

    expect(plan.markdownFile).toBe('review.txt');
    expect(plan.jsonFile).toBe(DEFAULT_JSON_REPORT_FILE);
  });

  it('uses a configured JSON filename', () => {
    const plan = planAnalysisOutput(createInput({ configuredOutput: { json: 'review.txt' } }));

    expect(plan.markdownFile).toBe(DEFAULT_MARKDOWN_REPORT_FILE);
    expect(plan.jsonFile).toBe('review.txt');
  });

  it('uses all configured values', () => {
    expect(
      planAnalysisOutput(
        createInput({
          configuredOutput: {
            directory: 'reports',
            markdown: 'summary.txt',
            json: 'details.txt',
          },
        }),
      ),
    ).toMatchObject({
      outputDirectory: path.join(WORKSPACE, 'reports'),
      markdownFile: 'summary.txt',
      jsonFile: 'details.txt',
    });
  });

  it('gives the output directory override precedence over configured output', () => {
    const plan = planAnalysisOutput(
      createInput({
        configuredOutput: { directory: 'configured' },
        outputDirectoryOverride: 'overridden',
      }),
    );

    expect(plan.outputDirectory).toBe(path.join(WORKSPACE, 'overridden'));
  });

  it('retains configured filenames when the directory is overridden', () => {
    const plan = planAnalysisOutput(
      createInput({
        configuredOutput: { directory: 'configured', markdown: 'custom.md', json: 'custom.json' },
        outputDirectoryOverride: 'overridden',
      }),
    );

    expect(plan).toMatchObject({
      outputDirectory: path.join(WORKSPACE, 'overridden'),
      markdownFile: 'custom.md',
      jsonFile: 'custom.json',
    });
  });

  it('falls back to the default Markdown filename when it is omitted', () => {
    const plan = planAnalysisOutput(createInput({ configuredOutput: { json: 'custom.json' } }));

    expect(plan.markdownFile).toBe(DEFAULT_MARKDOWN_REPORT_FILE);
  });

  it('falls back to the default JSON filename when it is omitted', () => {
    const plan = planAnalysisOutput(createInput({ configuredOutput: { markdown: 'custom.md' } }));

    expect(plan.jsonFile).toBe(DEFAULT_JSON_REPORT_FILE);
  });

  it('allows nested report targets', () => {
    const plan = planAnalysisOutput(
      createInput({
        configuredOutput: {
          directory: 'artifacts',
          markdown: 'markdown/daily/report.md',
          json: 'json/daily/report.json',
        },
      }),
    );

    expect(plan).toMatchObject({
      markdownFile: 'markdown/daily/report.md',
      jsonFile: 'json/daily/report.json',
      markdownDisplayPath: 'artifacts/markdown/daily/report.md',
      jsonDisplayPath: 'artifacts/json/daily/report.json',
    });
  });

  it('preserves legal Unicode in planned paths', () => {
    const plan = planAnalysisOutput(
      createInput({
        configuredOutput: { directory: 'resultados', markdown: 'revisión.md', json: '分析.json' },
      }),
    );

    expect(plan).toMatchObject({ markdownFile: 'revisión.md', jsonFile: '分析.json' });
  });

  it('preserves legal spaces and quotes in planned paths', () => {
    const plan = planAnalysisOutput(
      createInput({
        configuredOutput: {
          directory: 'report files',
          markdown: 'daily "review".md',
          json: "daily O'Connor.json",
        },
      }),
    );

    expect(plan).toMatchObject({
      markdownFile: 'daily "review".md',
      jsonFile: "daily O'Connor.json",
    });
  });

  it('normalizes safe dot segments in every planned path', () => {
    expect(
      planAnalysisOutput(
        createInput({
          configuredOutput: {
            directory: './reports/../reports',
            markdown: 'markdown/../report.md',
            json: './json/../report.json',
          },
        }),
      ),
    ).toMatchObject({
      outputDirectory: path.join(WORKSPACE, 'reports'),
      markdownFile: 'report.md',
      jsonFile: 'report.json',
      markdownDisplayPath: 'reports/report.md',
      jsonDisplayPath: 'reports/report.json',
    });
  });

  it.each([
    ['configured directory', createInput({ configuredOutput: { directory: '  ' } })],
    ['directory override', createInput({ outputDirectoryOverride: '\t' })],
  ])('rejects a blank %s', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('rejects a blank Markdown filename', () => {
    expect(planInvalid(createInput({ configuredOutput: { markdown: ' ' } }))).toMatchObject({
      code: 'OUTPUT_PLAN_INVALID',
    });
  });

  it('rejects a blank JSON filename', () => {
    expect(planInvalid(createInput({ configuredOutput: { json: '\t' } }))).toMatchObject({
      code: 'OUTPUT_PLAN_INVALID',
    });
  });

  it.each([
    ['workspace base', createInput({ workspaceBase: `${WORKSPACE}\u0000` })],
    ['configured directory', createInput({ configuredOutput: { directory: 'reports\u0000' } })],
    ['directory override', createInput({ outputDirectoryOverride: 'reports\u0000' })],
    ['Markdown filename', createInput({ configuredOutput: { markdown: 'report\u0000.md' } })],
    ['JSON filename', createInput({ configuredOutput: { json: 'report\u0000.json' } })],
  ])('rejects NUL in the %s', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('rejects a POSIX absolute directory', () => {
    expect(
      planInvalid(createInput({ configuredOutput: { directory: '/tmp/reports' } })),
    ).toMatchObject({
      code: 'OUTPUT_PLAN_INVALID',
    });
  });

  it('rejects a Windows absolute directory', () => {
    expect(
      planInvalid(createInput({ configuredOutput: { directory: 'C:\\reports' } })),
    ).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it.each([
    ['Markdown', createInput({ configuredOutput: { markdown: '/tmp/report.md' } })],
    ['JSON', createInput({ configuredOutput: { json: '/tmp/report.json' } })],
  ])('rejects a POSIX absolute %s filename', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it.each([
    ['Markdown', createInput({ configuredOutput: { markdown: 'C:\\reports\\report.md' } })],
    ['JSON', createInput({ configuredOutput: { json: 'C:\\reports\\report.json' } })],
  ])('rejects a Windows absolute %s filename', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it.each([
    ['directory', createInput({ configuredOutput: { directory: '\\\\server\\share' } })],
    ['Markdown', createInput({ configuredOutput: { markdown: '\\\\server\\share\\report.md' } })],
    ['JSON', createInput({ configuredOutput: { json: '\\\\server\\share\\report.json' } })],
  ])('rejects a UNC %s value', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('rejects output directory traversal outside the workspace', () => {
    expect(
      planInvalid(createInput({ configuredOutput: { directory: '../reports' } })),
    ).toMatchObject({
      code: 'OUTPUT_PLAN_INVALID',
    });
  });

  it('rejects Markdown traversal outside the output directory', () => {
    expect(
      planInvalid(createInput({ configuredOutput: { markdown: '../report.md' } })),
    ).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('rejects JSON traversal outside the output directory', () => {
    expect(
      planInvalid(createInput({ configuredOutput: { json: '../report.json' } })),
    ).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it.each([
    ['Markdown', createInput({ configuredOutput: { markdown: '.' } })],
    ['JSON', createInput({ configuredOutput: { json: 'nested/..' } })],
  ])('rejects a %s target resolving to the output root', (_description, input) => {
    expect(planInvalid(input)).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('rejects duplicate normalized report targets', () => {
    expect(
      planInvalid(
        createInput({
          configuredOutput: { markdown: 'nested/../report.txt', json: './report.txt' },
        }),
      ),
    ).toMatchObject({ code: 'OUTPUT_PLAN_INVALID' });
  });

  it('uses forward slashes for display paths', () => {
    const plan = planAnalysisOutput(
      createInput({ configuredOutput: { directory: 'reports', markdown: 'daily/report.md' } }),
    );

    expect(plan.markdownDisplayPath).toBe('reports/daily/report.md');
    expect(plan.markdownDisplayPath).not.toContain(path.sep === '/' ? '\\' : path.sep);
  });

  it('keeps display paths workspace-relative without workspace text', () => {
    const plan = planAnalysisOutput(
      createInput({ configuredOutput: { directory: 'reports', json: 'daily/report.json' } }),
    );

    for (const displayPath of [plan.markdownDisplayPath, plan.jsonDisplayPath]) {
      expect(displayPath).not.toMatch(/^\//);
      expect(displayPath.split('/')).not.toContain('..');
      expect(displayPath).not.toContain(WORKSPACE);
    }
  });

  it('uses the exact safe error code and message', () => {
    const error = planInvalid(createInput({ configuredOutput: { directory: '../private' } }));

    expect(error.code).toBe('OUTPUT_PLAN_INVALID');
    expect(error.message).toBe('Analysis output configuration is invalid.');
    expect(
      new AnalysisOutputError('OUTPUT_PLAN_INVALID', 'Analysis output configuration is invalid.')
        .message,
    ).toBe('Analysis output configuration is invalid.');
  });

  it('hides underlying path diagnostics', () => {
    const unsafeDirectory = '../private-output';
    const error = planInvalid(createInput({ configuredOutput: { directory: unsafeDirectory } }));
    const publicError = `${error.message} ${JSON.stringify(error)}`;

    expect(publicError).not.toContain(unsafeDirectory);
    expect(publicError).not.toContain(WORKSPACE);
    expect(publicError).not.toContain('OUTPUT_PATH_OUTSIDE_DIRECTORY');
    expect(error).not.toHaveProperty('cause');
  });

  it('hides invalid configuration values', () => {
    const unsafeFilename = '/private/credentials-report.md';
    const error = planInvalid(createInput({ configuredOutput: { markdown: unsafeFilename } }));
    const publicError = `${error.message} ${JSON.stringify(error)}`;

    expect(publicError).not.toContain(unsafeFilename);
    expect(publicError).not.toContain('/private');
  });

  it('does not mutate the input', () => {
    const input = createInput({
      configuredOutput: { directory: './reports', markdown: 'daily/../report.md' },
      outputDirectoryOverride: 'override',
    });
    const before = structuredClone(input);

    planAnalysisOutput(input);

    expect(input).toEqual(before);
  });

  it('returns deterministic repeated results', () => {
    const input = createInput({
      configuredOutput: {
        directory: 'reports',
        markdown: 'daily/report.md',
        json: 'daily/report.json',
      },
    });

    expect(planAnalysisOutput(input)).toEqual(planAnalysisOutput(input));
  });

  it('does not access the filesystem', () => {
    planAnalysisOutput(createInput());

    expect(stat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });

  it('does not log', () => {
    const log = vi.spyOn(console, 'log');

    planAnalysisOutput(createInput());

    expect(log).not.toHaveBeenCalled();
  });
});
