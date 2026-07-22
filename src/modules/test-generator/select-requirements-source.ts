/**
 * Inputs used to select the optional requirements source without filesystem access.
 */
export interface SelectRequirementsSourceInput {
  cliPath?: string;
  configPath?: string;
}

/**
 * Deterministic source selection for optional requirements text.
 */
export type RequirementsSourceSelection =
  | {
      source: 'cli';
      path: string;
    }
  | {
      source: 'config';
      path: string;
    }
  | {
      source: 'none';
    };

/**
 * Selects the CLI path first, then the configuration path, or no source.
 * Whitespace is used only to determine path presence; selected paths retain
 * their original value for the secure loader to validate.
 */
export function selectRequirementsSource(
  input: SelectRequirementsSourceInput,
): RequirementsSourceSelection {
  if (isPresentPath(input.cliPath)) {
    return { source: 'cli', path: input.cliPath };
  }

  if (isPresentPath(input.configPath)) {
    return { source: 'config', path: input.configPath };
  }

  return { source: 'none' };
}

function isPresentPath(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
