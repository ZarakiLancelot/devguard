import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyzeRepositoryResult } from './analyze-repository.js';
import {
  createPublishAnalysisResult,
  type PublishAnalysisResultDependencies,
  type PublishAnalysisResultInput,
} from './publish-analysis-result.js';
import type { AnalysisOutputPlan } from '../reports/analysis-output-plan.js';
import type { AnalysisOutputSummary } from '../reports/analysis-output-coordinator.js';
import type { OutputConfig } from '../config/config-schema.js';
import type { PRHealthReport } from '../types/reports.js';

const WORKSPACE_BASE = '/private/workspace-base';
const CONFIG_PATH = '/private/workspace-base/.devguard.yml';
const OUTPUT_CONFIG: OutputConfig = {
  directory: 'private-reports',
  markdown: 'private-report.md',
  json: 'private-report.json',
};

function createReport(): PRHealthReport {
  return {
    version: '1.0',
    analysisId: 'analysis-0123456789abcdef',
    generatedAt: '2026-07-24T00:00:00.000Z',
    source: { type: 'local', label: 'private source label' },
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

function createPlan(): AnalysisOutputPlan {
  return {
    outputDirectory: '/private/workspace-base/private-reports',
    markdownFile: 'private-report.md',
    jsonFile: 'private-report.json',
    markdownDisplayPath: 'private-reports/private-report.md',
    jsonDisplayPath: 'private-reports/private-report.json',
  };
}

function createSummary(): AnalysisOutputSummary {
  return {
    markdownPath: 'private-reports/private-report.md',
    jsonPath: 'private-reports/private-report.json',
  };
}

function createResult(
  output: OutputConfig = OUTPUT_CONFIG,
  report: PRHealthReport = createReport(),
): AnalyzeRepositoryResult {
  const config = Object.defineProperties(
    { output } as { output: OutputConfig; repositories?: never },
    {
      repositories: {
        get() {
          throw new Error('Publisher must not inspect unrelated config');
        },
      },
    },
  );
  const loadedConfig = Object.defineProperties(
    { workspaceBase: WORKSPACE_BASE, config } as unknown as AnalyzeRepositoryResult['loadedConfig'],
    {
      configPath: {
        get() {
          throw new Error('Publisher must not inspect configPath');
        },
      },
    },
  );

  return { loadedConfig, report };
}

function createInput(
  overrides: Partial<PublishAnalysisResultInput> = {},
): PublishAnalysisResultInput {
  return {
    result: createResult(),
    ...overrides,
  };
}

function createDependencies(overrides: Partial<PublishAnalysisResultDependencies> = {}): {
  dependencies: PublishAnalysisResultDependencies;
  plan: AnalysisOutputPlan;
  summary: AnalysisOutputSummary;
  calls: string[];
} {
  const calls: string[] = [];
  const plan = createPlan();
  const summary = createSummary();
  const dependencies: PublishAnalysisResultDependencies = {
    planAnalysisOutput: vi.fn(() => {
      calls.push('plan');
      return plan;
    }),
    coordinateAnalysisOutput: vi.fn(async () => {
      calls.push('coordinate');
      return summary;
    }),
    ...overrides,
  };

  return { dependencies, plan, summary, calls };
}

async function captureFailure(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }

  throw new Error('Expected publishing to fail');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishAnalysisResult', () => {
  it('plans once with the exact private workspace, configured output, and override', async () => {
    const { dependencies, plan } = createDependencies();
    const outputDirectoryOverride = '  future internal override  ';
    const input = createInput({ outputDirectoryOverride });

    await createPublishAnalysisResult(dependencies)(input);

    expect(dependencies.planAnalysisOutput).toHaveBeenCalledOnce();
    expect(dependencies.planAnalysisOutput).toHaveBeenCalledWith({
      workspaceBase: WORKSPACE_BASE,
      configuredOutput: OUTPUT_CONFIG,
      outputDirectoryOverride,
    });
    const plannerInput = vi.mocked(dependencies.planAnalysisOutput).mock.calls[0]?.[0];
    expect(plannerInput?.configuredOutput).toBe(OUTPUT_CONFIG);
    expect(plannerInput).not.toHaveProperty('configPath');
    expect(plannerInput).not.toHaveProperty('repositories');
    expect(plan.outputDirectory).toContain('private-reports');
  });

  it('forwards an absent override as undefined without inspecting it', async () => {
    const { dependencies } = createDependencies();

    await createPublishAnalysisResult(dependencies)(createInput());

    expect(dependencies.planAnalysisOutput).toHaveBeenCalledWith(
      expect.objectContaining({ outputDirectoryOverride: undefined }),
    );
  });

  it('coordinates once after planning with exact workspace, plan, and report identities', async () => {
    const { dependencies, calls, plan } = createDependencies();
    const report = createReport();
    const input = createInput({ result: createResult(OUTPUT_CONFIG, report) });

    await createPublishAnalysisResult(dependencies)(input);

    expect(calls).toEqual(['plan', 'coordinate']);
    expect(dependencies.coordinateAnalysisOutput).toHaveBeenCalledOnce();
    expect(dependencies.coordinateAnalysisOutput).toHaveBeenCalledWith({
      workspaceBase: WORKSPACE_BASE,
      plan,
      report,
    });
    const coordinatorInput = vi.mocked(dependencies.coordinateAnalysisOutput).mock.calls[0]?.[0];
    expect(coordinatorInput?.plan).toBe(plan);
    expect(coordinatorInput?.report).toBe(report);
    expect(coordinatorInput).not.toHaveProperty('loadedConfig');
  });

  it('returns the exact safe coordinator summary by identity', async () => {
    const { dependencies, summary } = createDependencies();
    const input = createInput();

    const result = await createPublishAnalysisResult(dependencies)(input);

    expect(result).toBe(summary);
    expect(result).toEqual({
      markdownPath: 'private-reports/private-report.md',
      jsonPath: 'private-reports/private-report.json',
    });
    expect(JSON.stringify(result)).not.toContain(WORKSPACE_BASE);
    expect(JSON.stringify(result)).not.toContain(CONFIG_PATH);
    expect(result.markdownPath).not.toMatch(/^\//);
    expect(result.jsonPath).not.toMatch(/^\//);
  });

  it('does not call coordination and propagates planning failures unchanged', async () => {
    const failure = Object.assign(new Error('private planning failure'), {
      code: 'OUTPUT_PLAN_INVALID',
    });
    const { dependencies } = createDependencies({
      planAnalysisOutput: vi.fn(() => {
        throw failure;
      }),
    });

    const thrown = await captureFailure(() =>
      createPublishAnalysisResult(dependencies)(createInput()),
    );

    expect(thrown).toBe(failure);
    expect(dependencies.coordinateAnalysisOutput).not.toHaveBeenCalled();
  });

  it('propagates coordinator and unknown thrown values unchanged', async () => {
    const coordinatorFailure = Object.assign(new Error('private writer failure'), {
      code: 'OUTPUT_WRITE_FAILED',
    });
    const coordinatorDependencies = createDependencies({
      coordinateAnalysisOutput: vi.fn(async () => {
        throw coordinatorFailure;
      }),
    }).dependencies;

    await expect(createPublishAnalysisResult(coordinatorDependencies)(createInput())).rejects.toBe(
      coordinatorFailure,
    );

    const unknownFailure = { hostile: 'private unknown output failure' };
    const unknownDependencies = createDependencies({
      planAnalysisOutput: vi.fn(() => {
        throw unknownFailure;
      }),
    }).dependencies;

    await expect(createPublishAnalysisResult(unknownDependencies)(createInput())).rejects.toBe(
      unknownFailure,
    );
  });

  it('does not mutate input composition state or dependency objects', async () => {
    const output = { ...OUTPUT_CONFIG };
    const report = createReport();
    const input = createInput({
      result: createResult(output, report),
      outputDirectoryOverride: 'override',
    });
    const inputBefore = structuredClone({
      outputDirectoryOverride: input.outputDirectoryOverride,
      workspaceBase: input.result.loadedConfig.workspaceBase,
      output,
      report,
    });
    const { dependencies } = createDependencies();
    const dependenciesBefore = { ...dependencies };
    const overrides = Object.freeze({
      coordinateAnalysisOutput: dependencies.coordinateAnalysisOutput,
    });

    await createPublishAnalysisResult({ ...dependencies, ...overrides })(input);

    expect(input.outputDirectoryOverride).toBe(inputBefore.outputDirectoryOverride);
    expect(input.result.loadedConfig.workspaceBase).toBe(inputBefore.workspaceBase);
    expect(output).toEqual(inputBefore.output);
    expect(report).toEqual(inputBefore.report);
    expect(dependencies).toEqual(dependenciesBefore);
    expect(overrides.coordinateAnalysisOutput).toBe(dependencies.coordinateAnalysisOutput);
  });

  it('does not log, touch stdout/stderr, or read process.cwd', async () => {
    const { dependencies } = createDependencies();
    const log = vi.spyOn(console, 'log');
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const cwd = vi.spyOn(process, 'cwd');

    await createPublishAnalysisResult(dependencies)(createInput());

    expect(log).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(cwd).not.toHaveBeenCalled();
  });
});
