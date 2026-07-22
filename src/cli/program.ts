import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('devguard')
    .description('Developer productivity CLI for preventive code-review analysis')
    .version('1.0.0');

  const analyze = program
    .command('analyze')
    .description('Analyze repositories for risks and contract mismatches');

  analyze
    .command('local')
    .description('Analyze local Git repositories')
    .requiredOption('--config <path>', 'Path to .devguard.yml configuration file')
    .option('--requirements <path>', 'Path to requirements file')
    .option('--output <directory>', 'Output directory for reports')
    .option('--verbose', 'Enable verbose output')
    .option('--fail-below <score>', 'Exit with non-zero code if score is below threshold', parseInt)
    .action((_options: unknown) => {
      console.log('DevGuard analyze local — not yet implemented.');
    });

  return program;
}
