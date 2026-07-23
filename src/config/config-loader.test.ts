import * as fs from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const filesystemMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises');
  filesystemMocks.readFile.mockImplementation(actual.readFile);
  filesystemMocks.realpath.mockImplementation(actual.realpath);

  return {
    ...actual,
    readFile: filesystemMocks.readFile,
    realpath: filesystemMocks.realpath,
  };
});

import {
  ConfigLoadError,
  loadConfig,
  MAX_CONFIG_FILE_BYTES,
  type ConfigLoadErrorCode,
  type LoadConfigInput,
} from './config-loader.js';

const VALID_CONFIG = `version: 1
repositories:
  app:
    path: .
    baseRef: main
    role: fullstack
openapi:
  repository: app
  path: docs/openapi.yaml
contracts: []
`;

const VALID_CONFIG_OBJECT = {
  version: 1,
  repositories: {
    app: {
      path: '.',
      baseRef: 'main',
      role: 'fullstack',
    },
  },
  openapi: {
    repository: 'app',
    path: 'docs/openapi.yaml',
  },
  contracts: [],
};

const SECRET_PATH = 'do-not-expose-private-path';
const canTestUnixPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;
const canTestUnixSocket = process.platform !== 'win32';

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-config-'));

  try {
    await callback(directory);
  } finally {
    await fs.chmod(directory, 0o700).catch(() => undefined);
    await fs.rm(directory, { force: true, recursive: true });
  }
}

async function writeConfig(
  directory: string,
  content: string | Uint8Array = VALID_CONFIG,
  filename = '.devguard.yml',
): Promise<string> {
  const configPath = path.join(directory, filename);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, content);
  return configPath;
}

function createInput(
  workingDirectory: string,
  configPath = '.devguard.yml',
  overrides: Partial<LoadConfigInput> = {},
): LoadConfigInput {
  return { configPath, workingDirectory, ...overrides };
}

async function captureConfigError(action: () => Promise<unknown>): Promise<ConfigLoadError> {
  try {
    await action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConfigLoadError);
    return error as ConfigLoadError;
  }

  throw new Error('Expected ConfigLoadError');
}

async function expectConfigError(
  action: () => Promise<unknown>,
  code: ConfigLoadErrorCode,
): Promise<ConfigLoadError> {
  const error = await captureConfigError(action);
  expect(error.code).toBe(code);
  return error;
}

function startSocket(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function closeSocket(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

describe('loadConfig', () => {
  describe('successful loading and canonical paths', () => {
    it('loads a valid basic YAML configuration from a relative selected path', async () => {
      await withTemporaryDirectory(async (directory) => {
        const configPath = await writeConfig(directory);

        const result = await loadConfig(createInput(directory));

        expect(result.config).toEqual(VALID_CONFIG_OBJECT);
        expect(result.configPath).toBe(await fs.realpath(configPath));
        expect(result.workspaceBase).toBe(await fs.realpath(directory));
      });
    });

    it('loads an explicitly selected absolute configuration path', async () => {
      await withTemporaryDirectory(async (directory) => {
        const configPath = await writeConfig(directory);

        const result = await loadConfig(createInput(directory, configPath));

        expect(result.configPath).toBe(await fs.realpath(configPath));
        expect(result.workspaceBase).toBe(await fs.realpath(directory));
      });
    });

    it('accepts a selected configuration outside the supplied working directory', async () => {
      await withTemporaryDirectory(async (workingDirectory) => {
        await withTemporaryDirectory(async (configDirectory) => {
          const configPath = await writeConfig(configDirectory);

          const result = await loadConfig(createInput(workingDirectory, configPath));

          expect(result.configPath).toBe(await fs.realpath(configPath));
          expect(result.workspaceBase).toBe(await fs.realpath(configDirectory));
        });
      });
    });

    it('preserves nonempty selected path text rather than trimming it before resolution', async () => {
      await withTemporaryDirectory(async (directory) => {
        const filename = ' .devguard.yml ';
        const configPath = await writeConfig(directory, VALID_CONFIG, filename);

        const result = await loadConfig(createInput(directory, filename));

        expect(result.configPath).toBe(await fs.realpath(configPath));
      });
    });

    it('accepts a configuration symlink and derives workspaceBase from its canonical target', async () => {
      await withTemporaryDirectory(async (directory) => {
        const targetDirectory = path.join(directory, 'canonical-config');
        const targetConfig = await writeConfig(targetDirectory);
        const selectedLink = path.join(directory, 'selected-config.yml');
        await fs.symlink(targetConfig, selectedLink);

        const result = await loadConfig(createInput(directory, 'selected-config.yml'));

        expect(result.configPath).toBe(await fs.realpath(targetConfig));
        expect(result.workspaceBase).toBe(await fs.realpath(targetDirectory));
        expect(result.workspaceBase).not.toBe(await fs.realpath(directory));
      });
    });

    it('accepts JSON-form YAML, CRLF YAML, and a UTF-8 BOM', async () => {
      await withTemporaryDirectory(async (directory) => {
        const jsonConfig = JSON.stringify(VALID_CONFIG_OBJECT);
        await writeConfig(directory, `\uFEFF${jsonConfig.replace(/\n/gu, '\r\n')}`);

        const result = await loadConfig(createInput(directory));

        expect(result.config).toEqual(VALID_CONFIG_OBJECT);
      });
    });

    it('does not mutate its caller input', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory);
        const input = createInput(directory);
        const before = structuredClone(input);

        await loadConfig(input);

        expect(input).toEqual(before);
      });
    });
  });

  describe('filesystem boundaries', () => {
    it('reports a missing selected path and dangling symlink as not found', async () => {
      expect.assertions(4);
      await withTemporaryDirectory(async (directory) => {
        await expectConfigError(
          () => loadConfig(createInput(directory, 'missing.yml')),
          'CONFIG_FILE_NOT_FOUND',
        );

        await fs.symlink(
          path.join(directory, 'missing-target.yml'),
          path.join(directory, 'dangling.yml'),
        );
        await expectConfigError(
          () => loadConfig(createInput(directory, 'dangling.yml')),
          'CONFIG_FILE_NOT_FOUND',
        );
      });
    });

    it('rejects a directory as a nonregular configuration target', async () => {
      expect.assertions(2);
      await withTemporaryDirectory(async (directory) => {
        await fs.mkdir(path.join(directory, 'config-directory'));

        await expectConfigError(
          () => loadConfig(createInput(directory, 'config-directory')),
          'CONFIG_FILE_NOT_REGULAR',
        );
      });
    });

    it.skipIf(!canTestUnixSocket)(
      'rejects a Unix socket as a nonregular configuration target',
      async () => {
        expect.assertions(2);
        await withTemporaryDirectory(async (directory) => {
          const socketPath = path.join(directory, 'config.sock');
          const server = await startSocket(socketPath);

          try {
            await expectConfigError(
              () => loadConfig(createInput(directory, 'config.sock')),
              'CONFIG_FILE_NOT_REGULAR',
            );
          } finally {
            await closeSocket(server);
          }
        });
      },
    );

    it.skipIf(!canTestUnixPermissions)(
      'maps unreadable regular files to a safe unreadable error',
      async () => {
        await withTemporaryDirectory(async (directory) => {
          const configPath = await writeConfig(directory);
          await fs.chmod(configPath, 0o000);

          try {
            const error = await expectConfigError(
              () => loadConfig(createInput(directory)),
              'CONFIG_FILE_UNREADABLE',
            );
            expect(error.message).not.toMatch(/EACCES|permission denied/iu);
          } finally {
            await fs.chmod(configPath, 0o600);
          }
        });
      },
    );

    it('maps an access failure from the filesystem to CONFIG_FILE_UNREADABLE without raw diagnostics', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory);
        const accessError = Object.assign(new Error('raw private EACCES detail'), {
          code: 'EACCES',
        });
        filesystemMocks.realpath.mockRejectedValueOnce(accessError);

        const error = await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_FILE_UNREADABLE',
        );
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(
          'raw private EACCES detail',
        );
      });
    });
  });

  describe('size and encoding', () => {
    it('accepts a valid configuration exactly at the 1 MiB byte limit', async () => {
      await withTemporaryDirectory(async (directory) => {
        const paddingLength = MAX_CONFIG_FILE_BYTES - Buffer.byteLength(VALID_CONFIG, 'utf8');
        const content = `${VALID_CONFIG}${'#'.repeat(paddingLength)}`;
        expect(Buffer.byteLength(content, 'utf8')).toBe(MAX_CONFIG_FILE_BYTES);
        await writeConfig(directory, content);

        const result = await loadConfig(createInput(directory));

        expect(result.config).toEqual(VALID_CONFIG_OBJECT);
      });
    });

    it('rejects a file one byte over the 1 MiB limit', async () => {
      expect.assertions(2);
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, Buffer.alloc(MAX_CONFIG_FILE_BYTES + 1, 0x61));

        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_FILE_TOO_LARGE');
      });
    });

    it('rejects growth after the stat size check using the actual bytes read', async () => {
      expect.assertions(2);
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory);
        filesystemMocks.readFile.mockResolvedValueOnce(
          Buffer.alloc(MAX_CONFIG_FILE_BYTES + 1, 0x61),
        );

        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_FILE_TOO_LARGE');
      });
    });

    it('accepts valid UTF-8 and rejects malformed UTF-8 and NUL content', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, VALID_CONFIG);
        await expect(loadConfig(createInput(directory))).resolves.toMatchObject({
          config: VALID_CONFIG_OBJECT,
        });

        await writeConfig(directory, new Uint8Array([0xc3, 0x28]));
        await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_FILE_INVALID_UTF8',
        );

        await writeConfig(directory, `${VALID_CONFIG}\u0000`);
        await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_FILE_INVALID_UTF8',
        );
      });
    });
  });

  describe('restricted YAML parsing', () => {
    it('accepts exactly one ordinary YAML document', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, `---\n${VALID_CONFIG}`);

        await expect(loadConfig(createInput(directory))).resolves.toMatchObject({
          config: VALID_CONFIG_OBJECT,
        });
      });
    });

    it('rejects empty, multiple-document, and malformed YAML', async () => {
      expect.assertions(6);
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, '');
        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_YAML_INVALID');

        await writeConfig(directory, `${VALID_CONFIG}---\n${VALID_CONFIG}`);
        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_YAML_INVALID');

        await writeConfig(directory, 'version: [');
        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_YAML_INVALID');
      });
    });

    it('rejects duplicate root and nested mapping keys', async () => {
      expect.assertions(4);
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, `${VALID_CONFIG}version: 1\n`);
        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_YAML_INVALID');

        await writeConfig(
          directory,
          `version: 1\nrepositories:\n  app:\n    path: .\n    path: duplicate\n    baseRef: main\n    role: fullstack\nopenapi:\n  repository: app\n  path: docs/openapi.yaml\ncontracts: []\n`,
        );
        await expectConfigError(() => loadConfig(createInput(directory)), 'CONFIG_YAML_INVALID');
      });
    });

    it.each([
      ['anchor', `defaults: &defaults\n  path: .\n${VALID_CONFIG}`],
      ['alias', `copy: *missing\n${VALID_CONFIG}`],
      [
        'merge key',
        `defaults: &defaults\n  path: .\nrepositories:\n  app:\n    <<: *defaults\n    baseRef: main\n    role: fullstack\nopenapi:\n  repository: app\n  path: docs/openapi.yaml\ncontracts: []\n`,
      ],
      ['custom tag', `version: !custom 1\n${VALID_CONFIG.replace('version: 1\n', '')}`],
      [
        'timestamp tag',
        `version: !!timestamp 2020-01-01\n${VALID_CONFIG.replace('version: 1\n', '')}`,
      ],
      ['binary tag', `version: !!binary MQ==\n${VALID_CONFIG.replace('version: 1\n', '')}`],
      ['cyclic alias graph', `loop: &loop\n  self: *loop\n${VALID_CONFIG}`],
    ])('rejects unsupported YAML feature: %s', async (_name, content) => {
      expect.assertions(2);
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(directory, content);

        await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_YAML_UNSUPPORTED',
        );
      });
    });

    it('accepts ordinary quoted strings containing YAML feature characters', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(
          directory,
          `version: 1\nrepositories:\n  app:\n    path: "."\n    baseRef: "main & * << ! ordinary text"\n    role: fullstack\nopenapi:\n  repository: app\n  path: "docs/quoted & * << !.yaml"\ncontracts: []\n`,
        );

        const result = await loadConfig(createInput(directory));

        expect(result.config.repositories.app?.baseRef).toBe('main & * << ! ordinary text');
        expect(result.config.openapi.path).toBe('docs/quoted & * << !.yaml');
      });
    });
  });

  describe('structural and relational validation', () => {
    it('returns schema errors before relational validation and exposes only safe structural locations', async () => {
      await withTemporaryDirectory(async (directory) => {
        const unusualRepositoryId = 'strange\nrepository';
        await writeConfig(
          directory,
          `version: 2\nrepositories:\n  "${unusualRepositoryId.replace('\n', '\\n')}":\n    path: .\n    baseRef: main\n    role: fullstack\n    ${SECRET_PATH}: private-value\nopenapi:\n  repository: missing\n  path: docs/openapi.yaml\ncontracts: []\n${SECRET_PATH}: private-root-value\n`,
        );

        const error = await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_SCHEMA_INVALID',
        );
        const locations = error.issues?.map((issue) => issue.path) ?? [];

        expect(locations).toEqual([...new Set(locations)].sort());
        expect(locations).toContain('$');
        expect(locations.some((location) => location.includes('repositories['))).toBe(true);
        expect(locations.some((location) => location.includes('strange\\nrepository'))).toBe(true);
        expect(locations.some((location) => location.includes(SECRET_PATH))).toBe(false);
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('private-value');
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('private-root-value');
        expect(Object.isFrozen(error.issues)).toBe(true);
        expect(error.issues === undefined || Object.isFrozen(error.issues[0])).toBe(true);
      });
    });

    it('rejects relationally invalid repository combinations only after structural success', async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeConfig(
          directory,
          `version: 1\nrepositories:\n  app:\n    path: .\n    baseRef: main\n    role: fullstack\n  web:\n    path: ../web\n    baseRef: main\n    role: frontend\nopenapi:\n  repository: missing\n  path: docs/openapi.yaml\ncontracts:\n  - name: Duplicate\n    openapiSchema: Request\n    typescript:\n      repository: missing\n      file: types.ts\n      type: Request\n  - name: Duplicate\n    openapiSchema: AnotherRequest\n    typescript:\n      repository: app\n      file: types.ts\n      type: Request\n`,
        );

        const error = await expectConfigError(
          () => loadConfig(createInput(directory)),
          'CONFIG_RELATION_INVALID',
        );

        expect(error.issues).toBeUndefined();
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('missing');
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('Duplicate');
      });
    });
  });

  describe('input and public-error safety', () => {
    it('rejects empty, whitespace-only, and NUL-containing input text without altering it', async () => {
      expect.assertions(10);
      await withTemporaryDirectory(async (directory) => {
        const invalidInputs: LoadConfigInput[] = [
          createInput(directory, ''),
          createInput(directory, '   '),
          createInput('', '.devguard.yml'),
          createInput('   ', '.devguard.yml'),
          createInput(directory, 'bad\u0000path'),
        ];

        for (const input of invalidInputs) {
          await expectConfigError(() => loadConfig(input), 'CONFIG_INVALID_INPUT');
        }
      });
    });

    it('does not log or leak absolute paths, source content, or raw filesystem diagnostics', async () => {
      await withTemporaryDirectory(async (directory) => {
        const outsidePath = path.join(directory, SECRET_PATH, '.devguard.yml');
        const consoleLog = vi.spyOn(console, 'log');
        const consoleWarn = vi.spyOn(console, 'warn');
        const consoleError = vi.spyOn(console, 'error');

        try {
          const error = await expectConfigError(
            () => loadConfig(createInput(directory, outsidePath)),
            'CONFIG_FILE_NOT_FOUND',
          );
          const publicDetails = `${error.message} ${JSON.stringify(error)}`;

          expect(publicDetails).not.toContain(directory);
          expect(publicDetails).not.toContain(SECRET_PATH);
          expect(publicDetails).not.toMatch(
            /ENOENT|EACCES|ENOTDIR|no such file|permission denied/iu,
          );
          expect(consoleLog).not.toHaveBeenCalled();
          expect(consoleWarn).not.toHaveBeenCalled();
          expect(consoleError).not.toHaveBeenCalled();
        } finally {
          consoleLog.mockRestore();
          consoleWarn.mockRestore();
          consoleError.mockRestore();
        }
      });
    });
  });
});
