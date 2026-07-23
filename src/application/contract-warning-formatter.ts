import type { ContractAnalysisWarning } from '../modules/contract-checker/analyze-contract-mapping.js';

const GENERIC_WARNING_MESSAGE = 'Contract source could not be fully analyzed.';

/**
 * Produces one public contract warning without exposing diagnostic text or
 * source content. Fields that may originate outside application ownership are
 * JSON-encoded to retain stable, unambiguous output.
 */
export function formatContractWarning(
  mappingName: string,
  warning: ContractAnalysisWarning,
): string {
  const file = getRepositoryRelativeFile(warning.file);
  const line = getPositiveSafeLine(warning.line);

  return (
    [
      'CONTRACT_WARNING',
      `mapping=${JSON.stringify(mappingName)}`,
      `source=${JSON.stringify(warning.source)}`,
      ...(file === undefined ? [] : [`file=${JSON.stringify(file)}`]),
      ...(line === undefined ? [] : [`line=${line}`]),
      `code=${JSON.stringify(warning.code)}`,
    ].join(' ') + `: ${GENERIC_WARNING_MESSAGE}`
  );
}

function getRepositoryRelativeFile(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.length === 0 ||
    value.includes('\u0000') ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value)
  ) {
    return undefined;
  }

  return value;
}

function getPositiveSafeLine(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
