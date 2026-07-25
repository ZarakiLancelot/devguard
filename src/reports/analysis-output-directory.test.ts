import { chmod, mkdir } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    chmod: vi.fn(actual.chmod),
    mkdir: vi.fn(actual.mkdir),
  };
});

import {
  AnalysisOutputError,
  prepareAnalysisOutputDirectory,
  type PrepareAnalysisOutputDirectoryInput,
} from './analysis-output-directory.js';
import type { AnalysisOutputPlan } from './analysis-output-plan.js';

const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
const chmodMock = vi.mocked(chmod);
const mkdirMock = vi.mocked(mkdir);

function createPlan(
  workspaceBase: string,
  options: {
    outputDirectory?: string;
    markdownFile?: string;
    jsonFile?: string;
  } = {},
): AnalysisOutputPlan {
  const outputDirectory = options.outputDirectory ?? path.join(workspaceBase, '.devguard');
  const markdownFile = options.markdownFile ?? 'devguard-report.md';
  const jsonFile = options.jsonFile ?? 'devguard-report.json';

  return {
    outputDirectory,
    markdownFile,
    jsonFile,
    markdownDisplayPath: `.devguard/${markdownFile}`,
    jsonDisplayPath: `.devguard/${jsonFile}`,
  };
}

function createInput(
  workspaceBase: string,
  plan = createPlan(workspaceBase),
): PrepareAnalysisOutputDirectoryInput {
  return { workspaceBase, plan };
}

async function withTemporaryWorkspace(
  callback: (workspaceBase: string, temporaryRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await actualFs.mkdtemp(
    path.join(os.tmpdir(), 'devguard-output-directory-'),
  );
  const workspaceBase = path.join(temporaryRoot, 'workspace');
  await actualFs.mkdir(workspaceBase, { mode: 0o700 });

  try {
    await callback(workspaceBase, temporaryRoot);
  } finally {
    await actualFs.chmod(temporaryRoot, 0o700).catch(() => undefined);
    await actualFs.rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function prepareFailure(
  input: PrepareAnalysisOutputDirectoryInput,
): Promise<AnalysisOutputError> {
  try {
    await prepareAnalysisOutputDirectory(input);
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisOutputError);
    return error as AnalysisOutputError;
  }

  throw new Error('Expected output directory preparation to fail');
}

async function createDirectorySymlink(target: string, symlinkPath: string): Promise<boolean> {
  try {
    await actualFs.symlink(target, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (hasUnsupportedSymlinkError(error)) {
      return false;
    }

    throw error;
  }
}

function hasUnsupportedSymlinkError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['EACCES', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(String(error.code))
  );
}

async function containedFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await actualFs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await containedFiles(path.join(directory, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

beforeEach(() => {
  chmodMock.mockReset();
  mkdirMock.mockReset();
  chmodMock.mockImplementation(actualFs.chmod);
  mkdirMock.mockImplementation(actualFs.mkdir);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('prepareAnalysisOutputDirectory', () => {
  it('creates a missing output root', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase);

      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared).toEqual({
        outputDirectory: await actualFs.realpath(plan.outputDirectory),
        markdownParentDirectory: await actualFs.realpath(plan.outputDirectory),
        jsonParentDirectory: await actualFs.realpath(plan.outputDirectory),
      });
    });
  });

  it('accepts an existing output root without chmodding it', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, 'reports');
      await actualFs.mkdir(outputDirectory, { mode: 0o755 });

      await prepareAnalysisOutputDirectory(
        createInput(workspaceBase, createPlan(workspaceBase, { outputDirectory })),
      );

      expect(chmodMock).not.toHaveBeenCalled();
    });
  });

  it('creates a nested output root', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, 'artifacts', 'daily');

      await prepareAnalysisOutputDirectory(
        createInput(workspaceBase, createPlan(workspaceBase, { outputDirectory })),
      );

      await expect(actualFs.stat(outputDirectory)).resolves.toMatchObject({});
    });
  });

  it('creates a nested Markdown parent', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase, { markdownFile: 'markdown/daily/report.md' });

      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared.markdownParentDirectory).toBe(
        await actualFs.realpath(path.join(plan.outputDirectory, 'markdown', 'daily')),
      );
    });
  });

  it('creates a nested JSON parent', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase, { jsonFile: 'json/daily/report.json' });

      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared.jsonParentDirectory).toBe(
        await actualFs.realpath(path.join(plan.outputDirectory, 'json', 'daily')),
      );
    });
  });

  it('creates both nested report parents', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase, {
        markdownFile: 'markdown/daily/report.md',
        jsonFile: 'json/daily/report.json',
      });

      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared.markdownParentDirectory).toBe(
        await actualFs.realpath(path.join(plan.outputDirectory, 'markdown', 'daily')),
      );
      expect(prepared.jsonParentDirectory).toBe(
        await actualFs.realpath(path.join(plan.outputDirectory, 'json', 'daily')),
      );
    });
  });

  it('requests mode 0o700 for every newly created directory', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase, {
        outputDirectory: path.join(workspaceBase, 'reports', 'daily'),
        markdownFile: 'markdown/nested/report.md',
        jsonFile: 'json/nested/report.json',
      });

      await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      for (const [, options] of mkdirMock.mock.calls) {
        expect(options).toEqual({ recursive: true, mode: 0o700 });
      }
    });
  });

  it('rejects a missing workspace base', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const missingWorkspace = path.join(workspaceBase, 'missing');
      const error = await prepareFailure(
        createInput(missingWorkspace, createPlan(missingWorkspace)),
      );

      expect(error.code).toBe('OUTPUT_DIRECTORY_PREPARE_FAILED');
    });
  });

  it('rejects a workspace base that is a file', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const workspaceFile = path.join(workspaceBase, 'workspace-file');
      await actualFs.writeFile(workspaceFile, 'not a directory', 'utf8');

      const error = await prepareFailure(createInput(workspaceFile, createPlan(workspaceFile)));

      expect(error.code).toBe('OUTPUT_DIRECTORY_PREPARE_FAILED');
    });
  });

  it('rejects an output path component that is a file', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const component = path.join(workspaceBase, 'reports');
      await actualFs.writeFile(component, 'not a directory', 'utf8');
      const plan = createPlan(workspaceBase, { outputDirectory: path.join(component, 'daily') });

      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('rejects a Markdown parent component that is a file', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      await actualFs.mkdir(outputDirectory);
      await actualFs.writeFile(path.join(outputDirectory, 'markdown'), 'not a directory', 'utf8');
      const plan = createPlan(workspaceBase, { markdownFile: 'markdown/report.md' });

      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('rejects a JSON parent component that is a file', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      await actualFs.mkdir(outputDirectory);
      await actualFs.writeFile(path.join(outputDirectory, 'json'), 'not a directory', 'utf8');
      const plan = createPlan(workspaceBase, { jsonFile: 'json/report.json' });

      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('allows an output-directory symlink contained inside the workspace', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const target = path.join(workspaceBase, 'real-output');
      const symlinkPath = path.join(workspaceBase, 'output-link');
      await actualFs.mkdir(target);
      if (!(await createDirectorySymlink(target, symlinkPath))) {
        context.skip();
        return;
      }

      const prepared = await prepareAnalysisOutputDirectory(
        createInput(workspaceBase, createPlan(workspaceBase, { outputDirectory: symlinkPath })),
      );

      expect(prepared.outputDirectory).toBe(await actualFs.realpath(target));
    });
  });

  it('allows a Markdown-parent symlink contained inside the output root', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      const target = path.join(outputDirectory, 'markdown-target');
      const symlinkPath = path.join(outputDirectory, 'markdown-link');
      await actualFs.mkdir(target, { recursive: true });
      if (!(await createDirectorySymlink(target, symlinkPath))) {
        context.skip();
        return;
      }

      const plan = createPlan(workspaceBase, { markdownFile: 'markdown-link/daily/report.md' });
      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared.markdownParentDirectory).toBe(
        await actualFs.realpath(path.join(target, 'daily')),
      );
    });
  });

  it('allows a JSON-parent symlink contained inside the output root', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      const target = path.join(outputDirectory, 'json-target');
      const symlinkPath = path.join(outputDirectory, 'json-link');
      await actualFs.mkdir(target, { recursive: true });
      if (!(await createDirectorySymlink(target, symlinkPath))) {
        context.skip();
        return;
      }

      const plan = createPlan(workspaceBase, { jsonFile: 'json-link/daily/report.json' });
      const prepared = await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      expect(prepared.jsonParentDirectory).toBe(
        await actualFs.realpath(path.join(target, 'daily')),
      );
    });
  });

  it('rejects an output-directory symlink escaping the workspace', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const outside = path.join(temporaryRoot, 'outside');
      const symlinkPath = path.join(workspaceBase, 'output-link');
      await actualFs.mkdir(outside);
      if (!(await createDirectorySymlink(outside, symlinkPath))) {
        context.skip();
        return;
      }

      const error = await prepareFailure(
        createInput(workspaceBase, createPlan(workspaceBase, { outputDirectory: symlinkPath })),
      );

      expect(error.message).not.toContain(outside);
    });
  });

  it('rejects a Markdown-parent symlink escaping the output root', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      const outside = path.join(temporaryRoot, 'outside');
      const symlinkPath = path.join(outputDirectory, 'markdown-link');
      await actualFs.mkdir(outputDirectory);
      await actualFs.mkdir(outside);
      if (!(await createDirectorySymlink(outside, symlinkPath))) {
        context.skip();
        return;
      }

      const plan = createPlan(workspaceBase, { markdownFile: 'markdown-link/report.md' });
      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('rejects a JSON-parent symlink escaping the output root', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const outputDirectory = path.join(workspaceBase, '.devguard');
      const outside = path.join(temporaryRoot, 'outside');
      const symlinkPath = path.join(outputDirectory, 'json-link');
      await actualFs.mkdir(outputDirectory);
      await actualFs.mkdir(outside);
      if (!(await createDirectorySymlink(outside, symlinkPath))) {
        context.skip();
        return;
      }

      const plan = createPlan(workspaceBase, { jsonFile: 'json-link/report.json' });
      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('rejects a sibling-prefix escape', async () => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const siblingPath = path.join(temporaryRoot, 'workspace-copy', 'reports');
      const plan = createPlan(workspaceBase, { outputDirectory: siblingPath });

      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
    });
  });

  it('rejects lexical escapes before creating the escaped path', async () => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const escapedPath = path.join(temporaryRoot, 'escaped-output');
      const plan = createPlan(workspaceBase, { outputDirectory: escapedPath });

      await expect(
        prepareAnalysisOutputDirectory(createInput(workspaceBase, plan)),
      ).rejects.toBeInstanceOf(AnalysisOutputError);
      await expect(actualFs.access(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('uses an exact safe error code and message', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const error = await prepareFailure(
        createInput(
          workspaceBase,
          createPlan(workspaceBase, { outputDirectory: path.dirname(workspaceBase) }),
        ),
      );

      expect(error.code).toBe('OUTPUT_DIRECTORY_PREPARE_FAILED');
      expect(error.message).toBe('Analysis output directory could not be prepared safely.');
    });
  });

  it('does not expose raw paths or symlink targets', async (context) => {
    await withTemporaryWorkspace(async (workspaceBase, temporaryRoot) => {
      const outside = path.join(temporaryRoot, 'private-symlink-target');
      const symlinkPath = path.join(workspaceBase, 'private-output-link');
      await actualFs.mkdir(outside);
      if (!(await createDirectorySymlink(outside, symlinkPath))) {
        context.skip();
        return;
      }

      const error = await prepareFailure(
        createInput(workspaceBase, createPlan(workspaceBase, { outputDirectory: symlinkPath })),
      );
      const publicError = `${error.message} ${JSON.stringify(error)}`;

      expect(publicError).not.toContain(workspaceBase);
      expect(publicError).not.toContain(symlinkPath);
      expect(publicError).not.toContain(outside);
    });
  });

  it('does not expose errno or filesystem messages', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const missingWorkspace = path.join(workspaceBase, 'missing-workspace');
      const error = await prepareFailure(
        createInput(missingWorkspace, createPlan(missingWorkspace)),
      );
      const publicError = `${error.message} ${JSON.stringify(error)}`;

      expect(publicError).not.toMatch(/ENOENT|no such file|mkdir|stat|realpath/iu);
    });
  });

  it('retains an original operational failure as a private cause', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const missingWorkspace = path.join(workspaceBase, 'missing-workspace');
      const error = await prepareFailure(
        createInput(missingWorkspace, createPlan(missingWorkspace)),
      );

      expect(error.cause).toBeInstanceOf(Error);
    });
  });

  it('does not mutate the input or its plan', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const input = createInput(
        workspaceBase,
        createPlan(workspaceBase, {
          markdownFile: 'markdown/daily/report.md',
          jsonFile: 'json/daily/report.json',
        }),
      );
      const before = structuredClone(input);

      await prepareAnalysisOutputDirectory(input);

      expect(input).toEqual(before);
      expect(input.plan).toEqual(before.plan);
    });
  });

  it('returns deterministic canonical directories for the same filesystem state', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const input = createInput(
        workspaceBase,
        createPlan(workspaceBase, {
          markdownFile: 'markdown/report.md',
          jsonFile: 'json/report.json',
        }),
      );

      expect(await prepareAnalysisOutputDirectory(input)).toEqual(
        await prepareAnalysisOutputDirectory(input),
      );
    });
  });

  it('does not log', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const log = vi.spyOn(console, 'log');

      await prepareAnalysisOutputDirectory(createInput(workspaceBase));

      expect(log).not.toHaveBeenCalled();
    });
  });

  it('does not write report files or temporary report files', async () => {
    await withTemporaryWorkspace(async (workspaceBase) => {
      const plan = createPlan(workspaceBase, {
        markdownFile: 'markdown/report.md',
        jsonFile: 'json/report.json',
      });

      await prepareAnalysisOutputDirectory(createInput(workspaceBase, plan));

      await expect(
        actualFs.access(path.join(plan.outputDirectory, plan.markdownFile)),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        actualFs.access(path.join(plan.outputDirectory, plan.jsonFile)),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await containedFiles(plan.outputDirectory)).toEqual([]);
    });
  });
});
