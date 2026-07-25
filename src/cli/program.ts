import { Command, CommanderError } from 'commander';
import { analyzeRepository } from '../application/analyze-repository.js';
import { CliHandledFailure, presentCliError } from './cli-error-presenter.js';
import { runAnalyzeLocal } from './run-analyze-local.js';

export interface CliDependencies {
  analyzeRepository: typeof analyzeRepository;
  getWorkingDirectory: () => string;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

const DEFAULT_DEPENDENCIES: Readonly<CliDependencies> = Object.freeze({
  analyzeRepository,
  getWorkingDirectory: () => process.cwd(),
  writeStdout: (text: string) => process.stdout.write(text),
  writeStderr: (text: string) => process.stderr.write(text),
});

const COMPLETION_MESSAGE = 'DevGuard local analysis completed.\n';

/** Creates the Commander program without executing analysis or reading the working directory. */
export function createProgram(overrides: Partial<CliDependencies> = {}): Command {
  const dependencies: CliDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };
  const program = new Command();

  program
    .name('devguard')
    .description('Developer productivity CLI for preventive code-review analysis')
    .version('1.0.0')
    .exitOverride()
    .configureOutput({
      writeOut: dependencies.writeStdout,
      writeErr: dependencies.writeStderr,
    });

  const analyze = program
    .command('analyze')
    .description('Analyze repositories for risks and contract mismatches');

  analyze
    .command('local')
    .description('Analyze local Git repositories')
    .requiredOption('--config <path>', 'Path to .devguard.yml configuration file')
    .option('--requirements <path>', 'Path to explicit requirements file')
    .action(async (options: { config: string; requirements?: string }) => {
      try {
        await runAnalyzeLocal(
          {
            configPath: options.config,
            ...(options.requirements === undefined
              ? {}
              : { requirementsPath: options.requirements }),
          },
          {
            analyzeRepository: dependencies.analyzeRepository,
            getWorkingDirectory: dependencies.getWorkingDirectory,
          },
        );
        dependencies.writeStdout(COMPLETION_MESSAGE);
      } catch (error: unknown) {
        if (error instanceof CommanderError) {
          throw error;
        }

        const presentation = presentCliError(error);
        dependencies.writeStderr(
          `DevGuard error [${presentation.code}]: ${presentation.message}\n`,
        );
        throw new CliHandledFailure();
      }
    });

  return program;
}
