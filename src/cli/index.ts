#!/usr/bin/env node

import { createProgram } from './program.js';

const program = createProgram();

// Filter bare '--' separators injected by package managers (e.g., pnpm dev -- --help)
const argv = process.argv.filter((arg, index) => !(arg === '--' && index === 2));
program.parse(argv);
