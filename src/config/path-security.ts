import path from 'node:path';

/**
 * Stable error codes for path security violations.
 */
export type PathSecurityCode =
  | 'PATH_OUTSIDE_REPOSITORY'
  | 'PATH_OUTSIDE_ALLOWED_ROOT'
  | 'OUTPUT_PATH_OUTSIDE_DIRECTORY'
  | 'ABSOLUTE_PATH_NOT_ALLOWED'
  | 'INVALID_PATH';

export interface PathSecurityError {
  code: PathSecurityCode;
  message: string;
}

export type PathResolutionResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: PathSecurityError };

/**
 * Symlink Policy (MVP):
 *
 * Path containment is validated lexically using normalized paths only.
 * Filesystem symlinks are NOT resolved during this validation step because
 * file existence and filesystem loading are not part of configuration validation.
 *
 * Filesystem adapters (e.g., the local repository source) MUST revalidate
 * real paths using `fs.realpath` before reading file contents to prevent
 * symlink-based escapes at runtime.
 */

/**
 * Checks whether a normalized child path is contained within a normalized root path.
 * Uses path-separator-aware comparison to prevent prefix traps.
 *
 * Example: `/project/api` does NOT contain `/project/api-copy/file.ts`.
 */
export function isPathContainedInRoot(childPath: string, rootPath: string): boolean {
  const normalizedRoot = path.normalize(rootPath) + path.sep;
  const normalizedChild = path.normalize(childPath) + path.sep;
  return normalizedChild.startsWith(normalizedRoot);
}

/**
 * Returns true if the given path string looks like an absolute path
 * on either Unix or Windows systems.
 */
function isAbsolutePath(filePath: string): boolean {
  // Unix absolute
  if (filePath.startsWith('/')) return true;
  // Windows absolute (e.g., C:\, D:/)
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return true;
  return false;
}

/**
 * Resolves a configured repository path relative to a workspace base directory.
 * The repository path must be relative and must resolve within or as a peer
 * of the workspace. This function does NOT check filesystem existence.
 *
 * @param workspaceBase - Absolute path to the directory containing `.devguard.yml`
 * @param repositoryPath - The configured `repositories[id].path` value
 */
export function resolveRepositoryPath(
  workspaceBase: string,
  repositoryPath: string,
): PathResolutionResult {
  if (repositoryPath.trim() === '') {
    return {
      valid: false,
      error: { code: 'INVALID_PATH', message: 'Repository path must not be empty' },
    };
  }

  if (isAbsolutePath(repositoryPath)) {
    return {
      valid: false,
      error: {
        code: 'ABSOLUTE_PATH_NOT_ALLOWED',
        message: `Repository path must be relative, got absolute path: "${repositoryPath}"`,
      },
    };
  }

  const resolved = path.resolve(workspaceBase, repositoryPath);
  return { valid: true, resolvedPath: resolved };
}

/**
 * Resolves a file path inside a repository root and verifies containment.
 * The file path must be relative and the resolved result must remain inside
 * the repository root.
 *
 * @param repositoryRoot - Absolute path to the repository root directory
 * @param filePath - Relative file path configured in a contract or openapi mapping
 */
export function resolveFileInRepository(
  repositoryRoot: string,
  filePath: string,
): PathResolutionResult {
  if (filePath.trim() === '') {
    return {
      valid: false,
      error: { code: 'INVALID_PATH', message: 'File path must not be empty' },
    };
  }

  if (isAbsolutePath(filePath)) {
    return {
      valid: false,
      error: {
        code: 'ABSOLUTE_PATH_NOT_ALLOWED',
        message: `File path must be relative to the repository root, got absolute path: "${filePath}"`,
      },
    };
  }

  const resolved = path.resolve(repositoryRoot, filePath);

  if (!isPathContainedInRoot(resolved, repositoryRoot)) {
    return {
      valid: false,
      error: {
        code: 'PATH_OUTSIDE_REPOSITORY',
        message: `File path "${filePath}" resolves outside repository root "${repositoryRoot}"`,
      },
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Resolves a relative or absolute file path against a base directory and
 * verifies that its lexical resolved location remains inside an allowed root.
 * It does not inspect filesystem entries or resolve symlinks.
 */
export function resolveFileWithinRoot(
  baseDirectory: string,
  allowedRoot: string,
  filePath: string,
): PathResolutionResult {
  if (
    baseDirectory.trim() === '' ||
    allowedRoot.trim() === '' ||
    filePath.trim() === '' ||
    filePath.includes('\u0000')
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PATH', message: 'File path must be a non-empty valid path' },
    };
  }

  const normalizedRoot = path.resolve(allowedRoot);
  const resolved = path.resolve(baseDirectory, filePath);

  if (!isPathContainedInRoot(resolved, normalizedRoot)) {
    return {
      valid: false,
      error: {
        code: 'PATH_OUTSIDE_ALLOWED_ROOT',
        message: 'File path resolves outside the allowed root',
      },
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Resolves an output file path inside the output directory and verifies containment.
 * The filename must be relative and must not escape the output directory.
 *
 * @param outputDirectory - Absolute path to the configured output directory
 * @param filename - The output filename (e.g., `devguard-report.md`)
 */
export function resolveOutputFile(outputDirectory: string, filename: string): PathResolutionResult {
  if (filename.trim() === '') {
    return {
      valid: false,
      error: { code: 'INVALID_PATH', message: 'Output filename must not be empty' },
    };
  }

  if (isAbsolutePath(filename)) {
    return {
      valid: false,
      error: {
        code: 'ABSOLUTE_PATH_NOT_ALLOWED',
        message: `Output filename must be relative to the output directory, got absolute path: "${filename}"`,
      },
    };
  }

  const resolved = path.resolve(outputDirectory, filename);

  if (!isPathContainedInRoot(resolved, outputDirectory)) {
    return {
      valid: false,
      error: {
        code: 'OUTPUT_PATH_OUTSIDE_DIRECTORY',
        message: `Output file "${filename}" resolves outside output directory "${outputDirectory}"`,
      },
    };
  }

  return { valid: true, resolvedPath: resolved };
}
