import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisOutputPlan } from './analysis-output-plan.js';
import {
  AnalysisOutputError as AnalysisOutputDirectoryError,
  type PreparedAnalysisOutputDirectory,
} from './analysis-output-directory.js';
import {
  coordinateAnalysisOutput,
  createCoordinateAnalysisOutput,
  type AnalysisOutputCoordinatorDependencies,
  type CoordinateAnalysisOutputInput,
} from './analysis-output-coordinator.js';
import { formatJson } from './json-formatter.js';
import { formatMarkdown } from './markdown-formatter.js';
import type { PRHealthReport } from '../types/reports.js';

const WORKSPACE_BASE = '/private/workspace-base';
const OUTPUT_DIRECTORY = '/canonical/workspace-base/.devguard';
const MARKDOWN_PARENT = path.join(OUTPUT_DIRECTORY, 'markdown');
const JSON_PARENT = path.join(OUTPUT_DIRECTORY, 'json');
const REPORT_SENTINEL = 'private report sentinel';

function createReport(): PRHealthReport {
  return {
    version: '1.0',
    analysisId: 'analysis-0123456789abcdef',
    generatedAt: '2026-07-24T00:00:00.000Z',
    source: { type: 'local', label: REPORT_SENTINEL },
    repositories: [],
    healthScore: 100,
    healthLabel: 'HEALTHY',
    scoreBreakdown: { initialScore: 100, finalScore: 100, deductions: [] },
    summary: {
      totalCount: 0,
      criticalCount: 0,
      highCount: 0,
      warningCount: 0,
      infoCount: 0,
      riskCount: 0,
      contractCount: 0,
      testingCount: 0,
    },
    findings: [],
    generatedTests: [],
    warnings: [],
  };
}

function createPlan(overrides: Partial<AnalysisOutputPlan> = {}): AnalysisOutputPlan {
  return {
    outputDirectory: '/private/workspace-base/.devguard',
    markdownFile: 'markdown/devguard-report.md',
    jsonFile: 'json/devguard-report.json',
    markdownDisplayPath: '.devguard/markdown/devguard-report.md',
    jsonDisplayPath: '.devguard/json/devguard-report.json',
    ...overrides,
  };
}

function createPreparedDirectory(
  overrides: Partial<PreparedAnalysisOutputDirectory> = {},
): PreparedAnalysisOutputDirectory {
  return {
    outputDirectory: OUTPUT_DIRECTORY,
    markdownParentDirectory: MARKDOWN_PARENT,
    jsonParentDirectory: JSON_PARENT,
    ...overrides,
  };
}

function createInput(
  overrides: Partial<CoordinateAnalysisOutputInput> = {},
): CoordinateAnalysisOutputInput {
  return {
    workspaceBase: WORKSPACE_BASE,
    plan: createPlan(),
    report: createReport(),
    ...overrides,
  };
}

function createDependencies(overrides: Partial<AnalysisOutputCoordinatorDependencies> = {}): {
  dependencies: AnalysisOutputCoordinatorDependencies;
  calls: string[];
  preparedDirectory: PreparedAnalysisOutputDirectory;
} {
  const calls: string[] = [];
  const preparedDirectory = createPreparedDirectory();

  const dependencies: AnalysisOutputCoordinatorDependencies = {
    formatMarkdown: vi.fn((report: PRHealthReport) => {
      calls.push('format-markdown');
      return `markdown:${report.analysisId}`;
    }),
    formatJson: vi.fn((report: PRHealthReport) => {
      calls.push('format-json');
      return `json:${report.analysisId}`;
    }),
    prepareAnalysisOutputDirectory: vi.fn(async () => {
      calls.push('prepare');
      return preparedDirectory;
    }),
    writeFileAtomically: vi.fn(async (writeInput) => {
      calls.push(`write:${writeInput.content.startsWith('markdown:') ? 'markdown' : 'json'}`);
    }),
    ...overrides,
  };

  return { dependencies, calls, preparedDirectory };
}

async function captureFailure(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error('Expected output coordination to fail');
}

async function withTemporaryWorkspace(
  callback: (workspaceBase: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-output-coordinator-'));
  const workspaceBase = path.join(temporaryRoot, 'workspace');
  await fs.mkdir(workspaceBase);

  try {
    await callback(workspaceBase);
  } finally {
    await fs.chmod(temporaryRoot, 0o700).catch(() => undefined);
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('coordinateAnalysisOutput', () => {
  it('formats the exact report once per format before preparing directories', async () => {
    const { calls, dependencies } = createDependencies();
    const input = createInput();

    await createCoordinateAnalysisOutput(dependencies)(input);

    expect(dependencies.formatMarkdown).toHaveBeenCalledOnce();
    expect(dependencies.formatJson).toHaveBeenCalledOnce();
    expect(dependencies.formatMarkdown).toHaveBeenCalledWith(input.report);
    expect(dependencies.formatJson).toHaveBeenCalledWith(input.report);
    expect(calls.slice(0, 3)).toEqual(['format-markdown', 'format-json', 'prepare']);
  });

  it('short-circuits after a Markdown formatter failure without preparing or writing', async () => {
    const formatterError = new Error(`formatter failed: ${REPORT_SENTINEL}`);
    const { dependencies } = createDependencies({
      formatMarkdown: vi.fn(() => {
        throw formatterError;
      }),
    });

    const error = await captureFailure(() =>
      createCoordinateAnalysisOutput(dependencies)(createInput()),
    );

    expect(dependencies.formatJson).not.toHaveBeenCalled();
    expect(dependencies.prepareAnalysisOutputDirectory).not.toHaveBeenCalled();
    expect(dependencies.writeFileAtomically).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      code: 'OUTPUT_FORMAT_FAILED',
      message: 'Analysis reports could not be formatted.',
      cause: formatterError,
    });
  });

  it('does not prepare or write when the JSON formatter fails', async () => {
    const formatterError = new Error(`json stack private ${REPORT_SENTINEL}`);
    const { dependencies } = createDependencies({
      formatJson: vi.fn(() => {
        throw formatterError;
      }),
    });

    const error = await captureFailure(() =>
      createCoordinateAnalysisOutput(dependencies)(createInput()),
    );
    const publicError = `${String(error)} ${JSON.stringify(error)}`;

    expect(dependencies.prepareAnalysisOutputDirectory).not.toHaveBeenCalled();
    expect(dependencies.writeFileAtomically).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      code: 'OUTPUT_FORMAT_FAILED',
      message: 'Analysis reports could not be formatted.',
      cause: formatterError,
    });
    expect(publicError).not.toContain(REPORT_SENTINEL);
    expect(publicError).not.toContain(WORKSPACE_BASE);
    expect(error.stack).not.toContain(REPORT_SENTINEL);
  });

  it('prepares directories exactly once with the private workspace base and exact plan', async () => {
    const { dependencies } = createDependencies();
    const input = createInput({ workspaceBase: '/private/trusted-workspace' });

    await createCoordinateAnalysisOutput(dependencies)(input);

    expect(dependencies.prepareAnalysisOutputDirectory).toHaveBeenCalledOnce();
    expect(dependencies.prepareAnalysisOutputDirectory).toHaveBeenCalledWith({
      workspaceBase: input.workspaceBase,
      plan: input.plan,
    });
    expect(dependencies.prepareAnalysisOutputDirectory).not.toHaveBeenCalledWith({
      workspaceBase: input.plan.outputDirectory,
      plan: input.plan,
    });
  });

  it('propagates a directory preparation error unchanged by identity', async () => {
    const preparationError = new AnalysisOutputDirectoryError();
    const { dependencies } = createDependencies({
      prepareAnalysisOutputDirectory: vi.fn(async () => {
        throw preparationError;
      }),
    });

    await expect(createCoordinateAnalysisOutput(dependencies)(createInput())).rejects.toBe(
      preparationError,
    );
    expect(dependencies.writeFileAtomically).not.toHaveBeenCalled();
  });

  it('writes Markdown then JSON once with prepared roots, targets, and exact formatted content', async () => {
    const { calls, dependencies, preparedDirectory } = createDependencies();
    const input = createInput();

    await createCoordinateAnalysisOutput(dependencies)(input);

    expect(calls).toEqual([
      'format-markdown',
      'format-json',
      'prepare',
      'write:markdown',
      'write:json',
    ]);
    expect(dependencies.writeFileAtomically).toHaveBeenCalledTimes(2);
    expect(dependencies.writeFileAtomically).toHaveBeenNthCalledWith(1, {
      allowedRoot: preparedDirectory.outputDirectory,
      filePath: path.join(preparedDirectory.markdownParentDirectory, 'devguard-report.md'),
      content: `markdown:${input.report.analysisId}`,
    });
    expect(dependencies.writeFileAtomically).toHaveBeenNthCalledWith(2, {
      allowedRoot: preparedDirectory.outputDirectory,
      filePath: path.join(preparedDirectory.jsonParentDirectory, 'devguard-report.json'),
      content: `json:${input.report.analysisId}`,
    });
  });

  it('uses safe targets under shared and distinct prepared parents', async () => {
    const sharedParent = path.join(OUTPUT_DIRECTORY, 'shared');
    const shared = createDependencies({
      prepareAnalysisOutputDirectory: vi.fn(async () =>
        createPreparedDirectory({
          markdownParentDirectory: sharedParent,
          jsonParentDirectory: sharedParent,
        }),
      ),
    });
    const sharedInput = createInput({
      plan: createPlan({ markdownFile: 'shared/one.md', jsonFile: 'shared/two.json' }),
    });

    await createCoordinateAnalysisOutput(shared.dependencies)(sharedInput);

    const sharedWrites = vi.mocked(shared.dependencies.writeFileAtomically).mock.calls;
    expect(sharedWrites[0]?.[0]?.filePath).toBe(path.join(sharedParent, 'one.md'));
    expect(sharedWrites[1]?.[0]?.filePath).toBe(path.join(sharedParent, 'two.json'));

    const nested = createDependencies();
    await createCoordinateAnalysisOutput(nested.dependencies)(createInput());
    const nestedWrites = vi.mocked(nested.dependencies.writeFileAtomically).mock.calls;

    for (const write of nestedWrites) {
      const writeInput = write[0];
      expect(writeInput).toBeDefined();
      const relativeTarget = path.relative(OUTPUT_DIRECTORY, writeInput?.filePath ?? '');
      expect(relativeTarget).not.toBe('');
      expect(relativeTarget.split(path.sep)).not.toContain('..');
    }
  });

  it('does not write JSON when the Markdown write fails and wraps the private cause safely', async () => {
    const writerError = new Error('EACCES temporary-file content private');
    const { dependencies } = createDependencies({
      writeFileAtomically: vi.fn(async () => {
        throw writerError;
      }),
    });

    const error = await captureFailure(() =>
      createCoordinateAnalysisOutput(dependencies)(createInput()),
    );
    const publicError = `${String(error)} ${JSON.stringify(error)}`;

    expect(dependencies.writeFileAtomically).toHaveBeenCalledOnce();
    expect(error).toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      message: 'Analysis report output could not be written safely.',
      cause: writerError,
    });
    expect(publicError).not.toMatch(/EACCES|temporary-file|content/iu);
  });

  it('keeps the Markdown publication when JSON writing fails without rollback', async () => {
    const writerError = new Error('json write failed');
    const successfulWrites: string[] = [];
    const { dependencies } = createDependencies({
      writeFileAtomically: vi.fn(async (writeInput) => {
        if (writeInput.content.startsWith('json:')) {
          throw writerError;
        }

        successfulWrites.push(writeInput.filePath);
      }),
    });

    const error = await captureFailure(() =>
      createCoordinateAnalysisOutput(dependencies)(createInput()),
    );

    expect(dependencies.writeFileAtomically).toHaveBeenCalledTimes(2);
    expect(successfulWrites).toEqual([path.join(MARKDOWN_PARENT, 'devguard-report.md')]);
    expect(error).toMatchObject({ code: 'OUTPUT_WRITE_FAILED', cause: writerError });
  });

  it('returns only the exact safe display paths on success', async () => {
    const { dependencies } = createDependencies();
    const input = createInput({ workspaceBase: '/private/workspace-sentinel' });

    const summary = await createCoordinateAnalysisOutput(dependencies)(input);

    expect(summary).toEqual({
      markdownPath: input.plan.markdownDisplayPath,
      jsonPath: input.plan.jsonDisplayPath,
    });
    expect(JSON.stringify(summary)).not.toContain(input.workspaceBase);
    expect(JSON.stringify(summary)).not.toContain(OUTPUT_DIRECTORY);
    expect(summary.markdownPath).not.toMatch(/^\//);
    expect(summary.jsonPath).not.toMatch(/^\//);
  });

  it('does not mutate inputs, plans, reports, or dependency objects', async () => {
    const { dependencies } = createDependencies();
    const input = createInput();
    const inputBefore = structuredClone(input);
    const dependenciesBefore = { ...dependencies };

    await createCoordinateAnalysisOutput(dependencies)(input);

    expect(input).toEqual(inputBefore);
    expect(input.plan).toEqual(inputBefore.plan);
    expect(input.report).toEqual(inputBefore.report);
    expect(dependencies).toEqual(dependenciesBefore);
  });

  it('does not log or touch stdout or stderr', async () => {
    const { dependencies } = createDependencies();
    const log = vi.spyOn(console, 'log');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');

    await createCoordinateAnalysisOutput(dependencies)(createInput());

    expect(log).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('imports no CLI, LoadedConfig, AnalyzeRepositoryResult, or config-path state', async () => {
    const source = await fs.readFile(
      new URL('./analysis-output-coordinator.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('LoadedConfig');
    expect(source).not.toContain('AnalyzeRepositoryResult');
    expect(source).not.toContain('configPath');
    expect(source).not.toContain("'../cli");
    expect(source).not.toContain('process.cwd');
    expect(source).not.toContain('process.env');
  });

  it('integrates once with the real preparer and atomic writer', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      const plan = createPlan({
        outputDirectory,
        markdownFile: 'nested/devguard-report.md',
        jsonFile: 'nested/devguard-report.json',
        markdownDisplayPath: '.devguard/nested/devguard-report.md',
        jsonDisplayPath: '.devguard/nested/devguard-report.json',
      });
      const report = createReport();

      const summary = await coordinateAnalysisOutput({ workspaceBase, plan, report });

      expect(summary).toEqual({
        markdownPath: plan.markdownDisplayPath,
        jsonPath: plan.jsonDisplayPath,
      });
      await expect(
        fs.readFile(path.join(outputDirectory, plan.markdownFile), 'utf8'),
      ).resolves.toBe(formatMarkdown(report));
      await expect(fs.readFile(path.join(outputDirectory, plan.jsonFile), 'utf8')).resolves.toBe(
        formatJson(report),
      );
    });
  });
});
