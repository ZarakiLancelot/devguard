import { describe, it, expect } from 'vitest';
import { createProgram } from './program.js';

describe('DevGuard CLI', () => {
  it('should create a program with the correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('devguard');
  });

  it('should have an analyze command', () => {
    const program = createProgram();
    const analyze = program.commands.find((cmd) => cmd.name() === 'analyze');
    expect(analyze).toBeDefined();
  });

  it('should have a local subcommand under analyze', () => {
    const program = createProgram();
    const analyze = program.commands.find((cmd) => cmd.name() === 'analyze');
    const local = analyze?.commands.find((cmd) => cmd.name() === 'local');
    expect(local).toBeDefined();
  });

  it('should require --config option for analyze local', () => {
    const program = createProgram();
    const analyze = program.commands.find((cmd) => cmd.name() === 'analyze');
    const local = analyze?.commands.find((cmd) => cmd.name() === 'local');
    const configOption = local?.options.find((opt) => opt.long === '--config');
    expect(configOption).toBeDefined();
    expect(configOption?.required).toBe(true);
  });
});
