/**
 * Validates one repository-relative POSIX Git path without normalizing it.
 * Accepted text is returned exactly as supplied.
 */
export function validateGitRepositoryPath(repositoryPath: string): string {
  if (
    repositoryPath.length === 0 ||
    repositoryPath.includes('\u0000') ||
    repositoryPath.startsWith('/') ||
    repositoryPath.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/u.test(repositoryPath) ||
    (process.platform === 'win32' && repositoryPath.includes('\\'))
  ) {
    throw new Error('Git repository path is invalid.');
  }

  const segments = repositoryPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Git repository path is invalid.');
  }

  return repositoryPath;
}
