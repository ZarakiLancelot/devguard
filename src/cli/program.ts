import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { analyzeRepository } from '../application/analyze-repository.js';
import { publishAnalysisResult } from '../application/publish-analysis-result.js';
import {
  evaluateFailBelow,
  FailBelowParseError,
  parseFailBelow,
  type ParsedFailBelow,
} from './fail-below.js';
import { CliHandledFailure, presentCliError } from './cli-error-presenter.js';
import { QualityThresholdFailure } from './quality-threshold-failure.js';
import { runAnalyzeLocal } from './run-analyze-local.js';

export interface CliDependencies {
  analyzeRepository: typeof analyzeRepository;
  publishAnalysisResult: typeof publishAnalysisResult;
  getWorkingDirectory: () => string;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  evaluateFailBelow: typeof evaluateFailBelow;
}

const DEFAULT_DEPENDENCIES: Readonly<CliDependencies> = Object.freeze({
  analyzeRepository,
  publishAnalysisResult,
  getWorkingDirectory: () => process.cwd(),
  writeStdout: (text: string) => process.stdout.write(text),
  writeStderr: (text: string) => process.stderr.write(text),
  evaluateFailBelow,
});

const COMPLETION_MESSAGE = 'DevGuard local analysis completed.\n';
const FAIL_BELOW_ARGUMENT_MESSAGE = 'Fail-below score must be a decimal value from 0 through 100.';

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
      writeErr: (text: string) => dependencies.writeStderr(sanitizeCommanderOutput(text)),
    });

  const analyze = program
    .command('analyze')
    .description('Analyze repositories for risks and contract mismatches');

  analyze
    .command('local')
    .description('Analyze local Git repositories')
    .requiredOption('--config <path>', 'Path to .devguard.yml configuration file')
    .option('--requirements <path>', 'Path to explicit requirements file')
    .option('--output <path>', 'Path to analysis output directory')
    .option('--fail-below <score>', 'Fail when health score is below score', parseFailBelowOption)
    .action(
      async (options: {
        config: string;
        requirements?: string;
        output?: string;
        failBelow?: ParsedFailBelow;
      }) => {
        try {
          const completion = await runAnalyzeLocal(
            {
              configPath: options.config,
              ...(options.requirements === undefined
                ? {}
                : { requirementsPath: options.requirements }),
              ...(options.output === undefined ? {} : { outputDirectoryPath: options.output }),
            },
            {
              analyzeRepository: dependencies.analyzeRepository,
              publishAnalysisResult: dependencies.publishAnalysisResult,
              getWorkingDirectory: dependencies.getWorkingDirectory,
            },
          );

          if (options.failBelow !== undefined) {
            const outcome = dependencies.evaluateFailBelow(
              completion.healthScore,
              options.failBelow,
            );
            if (outcome.kind === 'quality-threshold-not-met') {
              dependencies.writeStderr('DevGuard quality threshold not met.\n');
              throw new QualityThresholdFailure();
            }
          }

          dependencies.writeStdout(COMPLETION_MESSAGE);
        } catch (error: unknown) {
          if (error instanceof CommanderError || error instanceof QualityThresholdFailure) {
            throw error;
          }

          const presentation = presentCliError(error);
          dependencies.writeStderr(
            `DevGuard error [${presentation.code}]: ${presentation.message}\n`,
          );
          throw new CliHandledFailure();
        }
      },
    );

  return program;
}

function parseFailBelowOption(value: string): ParsedFailBelow {
  try {
    return parseFailBelow(value);
  } catch (error: unknown) {
    if (error instanceof FailBelowParseError) {
      throw new InvalidArgumentError(FAIL_BELOW_ARGUMENT_MESSAGE);
    }

    throw new InvalidArgumentError(FAIL_BELOW_ARGUMENT_MESSAGE);
  }
}

function sanitizeCommanderOutput(text: string): string {
  const prefix = "error: option '--fail-below <score>' argument '";
  const suffix = ` is invalid. ${FAIL_BELOW_ARGUMENT_MESSAGE}\n`;

  if (text.startsWith(prefix) && text.endsWith(suffix)) {
    return `${prefix.slice(0, -1)} is invalid. ${FAIL_BELOW_ARGUMENT_MESSAGE}\n`;
  }

  return text;
}
