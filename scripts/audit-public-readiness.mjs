import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROCESS_TIMEOUT_MS = 10_000;
const MAX_CAPTURED_OUTPUT_BYTES = 10 * 1024 * 1024;
const APPROVED_PUBLIC_IDENTITIES = Object.freeze([
  'Edwin Einsen Vásquez Velásquez',
  '@edwineinsen/devguard',
  'ZarakiLancelot',
  'https://github.com/ZarakiLancelot/devguard',
]);
const ALLOWED_DEMO_EMAILS = new Set(['demo@devguard.invalid']);
const ALLOWED_TEST_SECRET_VALUES = new Set([
  'absolute-secret-path-and-content',
  'private-value-that-must-not-appear',
  'fictional-secret-value',
]);
const ALLOWED_PATH_USERS = new Set(['example-user', 'user']);
const GENERATED_ARTIFACT_PATH = /^(?:demo\/\.work\/|\.tmp\/package-verification\/|.*\.tgz$)/u;
const CREDENTIAL_FILENAME =
  /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa|.*credential.*\.json|\.npmrc|.*aws.*(?:credential|config).*)$/iu;
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const scriptRelativePath = path.relative(projectRoot, scriptPath).split(path.sep).join('/');

class AuditError extends Error {}

async function main() {
  const argumentsValue = process.argv.slice(2);
  if (argumentsValue.length === 1 && argumentsValue[0] === '--self-test') {
    runSelfTest();
    process.stdout.write('DevGuard public-readiness audit self-test passed.\n');
    return;
  }
  if (argumentsValue.length !== 0) {
    process.stderr.write('DevGuard public-readiness audit failed.\n');
    process.exitCode = 1;
    return;
  }

  try {
    const files = await listTrackedFiles();
    const findings = await auditTrackedFiles(files);
    printResult(files.length, findings);
    if (findings.length > 0) {
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write('DevGuard public-readiness audit failed.\n');
    process.exitCode = 1;
  }
}

async function listTrackedFiles() {
  const result = await runProcess('git', ['ls-files', '-z']);
  if (result.exitCode !== 0 || result.signal !== null || result.stderr !== '') {
    throw new AuditError();
  }
  return result.stdout
    .split('\0')
    .filter((file) => file.length > 0)
    .sort(compareText);
}

async function auditTrackedFiles(files) {
  const findings = [];
  for (const relativePath of files) {
    findings.push(...auditFilename(relativePath));
    const absolutePath = resolveTrackedPath(relativePath);
    const stats = await lstat(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      findings.push(
        createFinding('generated-artifact', relativePath, undefined, 'tracked non-regular file'),
      );
      continue;
    }

    const bytes = await readFile(absolutePath);
    const content = decodeTextOrUndefined(bytes);
    if (content !== undefined) {
      findings.push(...auditText(relativePath, content));
    }
  }
  return findings.sort(compareFindings);
}

function auditFilename(relativePath) {
  const findings = [];
  if (CREDENTIAL_FILENAME.test(relativePath)) {
    findings.push(
      createFinding('credential-file', relativePath, undefined, 'credential-like filename'),
    );
  }
  if (GENERATED_ARTIFACT_PATH.test(relativePath)) {
    findings.push(
      createFinding('generated-artifact', relativePath, undefined, 'generated artifact is tracked'),
    );
  }
  return findings;
}

function auditText(relativePath, content) {
  const lines = content.split(/\r?\n/u);
  const findings = [];
  const ignoredRange = matcherDefinitionRange(relativePath, lines);
  for (const [index, line] of lines.entries()) {
    if (ignoredRange !== undefined && index >= ignoredRange.start && index <= ignoredRange.end) {
      continue;
    }
    if (containsApprovedIdentity(line)) {
      continue;
    }

    const lineNumber = index + 1;
    const finding = classifyLine(relativePath, line, lineNumber);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }
  return findings;
}

function classifyLine(relativePath, line, lineNumber) {
  // audit-patterns-start
  const unixPath =
    /(?:^|["'`(\s])\/home\/([^/\s"'`]+)(?:\/|$)|(?:^|["'`(\s])\/Users\/([^/\s"'`]+)(?:\/|$)/u.exec(
      line,
    );
  const windowsPath = /(?:[A-Za-z]:\\Users\\|file:\/\/\/+(?:home|Users)\/)/iu.test(line);
  const currentHome = normalizePathForMatch(os.homedir());
  const currentUser = os.userInfo().username;
  const normalizedLine = normalizePathForMatch(line);
  if (
    (unixPath !== null && !ALLOWED_PATH_USERS.has(unixPath[1] ?? unixPath[2] ?? '')) ||
    windowsPath ||
    (currentHome.length > 1 && normalizedLine.includes(currentHome)) ||
    containsStandaloneIdentifier(line, currentUser)
  ) {
    return createFinding(
      'private-path',
      relativePath,
      lineNumber,
      'machine-specific path or identity',
    );
  }

  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.exec(line)?.[0];
  if (email !== undefined && !isAllowedEmail(email)) {
    return createFinding('private-identity', relativePath, lineNumber, 'email address');
  }

  if (
    /(?:git@|ssh:\/\/)/iu.test(line) ||
    /https?:\/\/[^\s"']+\.(?:internal|corp|local)(?:[/:]|$)/iu.test(line)
  ) {
    return createFinding(
      'private-url',
      relativePath,
      lineNumber,
      'private-style repository or host URL',
    );
  }

  if (
    /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----)/u.test(
      line,
    )
  ) {
    return createFinding(
      'secret-pattern',
      relativePath,
      lineNumber,
      'high-confidence credential pattern',
    );
  }

  const assignment =
    /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|credential)\s*[:=]\s*["']?([^\s"']{16,})/iu.exec(
      line,
    );
  if (assignment !== null && !ALLOWED_TEST_SECRET_VALUES.has(assignment[1])) {
    return createFinding('secret-pattern', relativePath, lineNumber, 'credential-like assignment');
  }

  if (/(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^/\s:@]+:[^/\s@]+@/iu.test(line)) {
    return createFinding(
      'secret-pattern',
      relativePath,
      lineNumber,
      'credentialed connection string',
    );
  }
  // audit-patterns-end

  return undefined;
}

function matcherDefinitionRange(relativePath, lines) {
  if (relativePath !== scriptRelativePath) {
    return undefined;
  }
  const start = lines.findIndex((line) => line.includes('audit-patterns-start'));
  const end = lines.findIndex((line) => line.includes('audit-patterns-end'));
  return start >= 0 && end >= start ? { start, end } : undefined;
}

function containsApprovedIdentity(line) {
  return APPROVED_PUBLIC_IDENTITIES.some((identity) => line.includes(identity));
}

function isAllowedEmail(email) {
  const normalized = email.toLowerCase();
  return ALLOWED_DEMO_EMAILS.has(normalized) || normalized.endsWith('@example.invalid');
}

function containsStandaloneIdentifier(line, identifier) {
  if (identifier.length === 0) {
    return false;
  }
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'u').test(line);
}

function normalizePathForMatch(value) {
  return value.replace(/\\/gu, '/');
}

function resolveTrackedPath(relativePath) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new AuditError();
  }
  return absolutePath;
}

function decodeTextOrUndefined(bytes) {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function createFinding(category, file, line, reason) {
  return { category, file, ...(line === undefined ? {} : { line }), reason };
}

function printResult(fileCount, findings) {
  if (findings.length === 0) {
    process.stdout.write(
      [
        'DevGuard public-readiness audit passed.',
        `Tracked files inspected: ${fileCount}`,
        'Blocking findings: 0',
        `Approved public identities: ${APPROVED_PUBLIC_IDENTITIES.length}`,
        'Git history: inspect separately before publication.',
      ].join('\n') + '\n',
    );
    return;
  }

  process.stdout.write(
    [
      'DevGuard public-readiness audit failed.',
      `Tracked files inspected: ${fileCount}`,
      `Blocking findings: ${findings.length}`,
      'Review sanitized findings before public publication.',
      ...findings.map(
        (finding) =>
          `- ${finding.category}: ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`} — ${finding.reason}`,
      ),
    ].join('\n') + '\n',
  );
}

function runSelfTest() {
  const privatePath = `/${['home', 'audit-user', 'project'].join('/')}`;
  const secret = `gh${'p_'}${'a'.repeat(36)}`;
  const integrity = `sha512-${'a'.repeat(88)}`;
  const privatePathFinding = classifyLine('controlled.txt', privatePath, 1);
  const secretFinding = classifyLine('controlled.txt', secret, 1);
  const integrityFinding = classifyLine('pnpm-lock.yaml', integrity, 1);
  const approvedFinding = classifyLine(
    'package.json',
    '@edwineinsen/devguard https://github.com/ZarakiLancelot/devguard',
    1,
  );
  if (
    privatePathFinding?.category !== 'private-path' ||
    secretFinding?.category !== 'secret-pattern' ||
    integrityFinding !== undefined ||
    approvedFinding !== undefined
  ) {
    throw new AuditError();
  }
}

function compareFindings(left, right) {
  return (
    compareText(left.file, right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.category, right.category) ||
    compareText(left.reason, right.reason)
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: projectRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new AuditError());
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AuditError());
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail();
    }, PROCESS_TIMEOUT_MS);
    const append = (stream, chunk) => {
      if (settled) return;
      if (stream === 'stdout') {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_CAPTURED_OUTPUT_BYTES) return fail();
        stdout += chunk.toString('utf8');
      } else {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_CAPTURED_OUTPUT_BYTES) return fail();
        stderr += chunk.toString('utf8');
      }
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.once('error', fail);
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

void main();
