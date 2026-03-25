import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { CustomQualityGate } from '../config/types.js';
import type { CustomGateDefinition } from '../coordination/types.js';

const execAsync = promisify(exec);

/** Extract error details from child process errors (which have stderr/stdout) or regular errors */
function getExecErrorDetails(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.stderr === 'string' && e.stderr) return e.stderr;
    if (typeof e.stdout === 'string' && e.stdout) return e.stdout;
    if (error instanceof Error) return error.message;
  }
  return String(error);
}

/**
 * Security-sensitive pattern definitions for the security scan validator.
 * These are DETECTION patterns — they flag code for review, not execute anything.
 */
function getSecurityPatterns(): Array<{ pattern: RegExp; label: string; category: string }> {
  return [
    // A03: Injection — XSS
    { pattern: /innerHTML\s*=/, label: 'Unsafe DOM assignment (XSS)', category: 'A03-injection' },
    { pattern: /dangerouslySetInnerHTML/, label: 'React unsafe HTML injection', category: 'A03-injection' },
    { pattern: /document\.write\s*\(/, label: 'document.write (XSS risk)', category: 'A03-injection' },
    // A03: Injection — Command/Shell
    { pattern: /\beval\s*\(/, label: 'Dynamic code execution', category: 'A03-injection' },
    { pattern: /child_process.*exec\s*\(\s*[`'"].*\$\{/, label: 'Shell injection risk', category: 'A03-injection' },
    { pattern: /execSync\s*\(\s*[`'"].*\$\{/, label: 'Shell injection risk (sync)', category: 'A03-injection' },
    // A03: Injection — SQL
    { pattern: /sql\s*[`'"]\s*(?:SELECT|INSERT|UPDATE|DELETE).*\$\{/i, label: 'SQL injection risk', category: 'A03-injection' },
    { pattern: /query\s*\(\s*[`'"].*\$\{/i, label: 'Parameterized query missing', category: 'A03-injection' },
    // A03: Injection — Path traversal
    { pattern: /\.\.\/.*\$\{/, label: 'Path traversal risk', category: 'A03-injection' },
    { pattern: /path\.join\s*\([^)]*(?:req\.|params\.|query\.|body\.)/, label: 'Unsanitized path from user input', category: 'A03-injection' },

    // A02: Cryptographic Failures
    { pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/, label: 'Weak hash: MD5', category: 'A02-crypto' },
    { pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/, label: 'Weak hash: SHA1', category: 'A02-crypto' },
    { pattern: /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/, label: 'AWS access key detected', category: 'A02-crypto' },
    { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, label: 'Private key in source', category: 'A02-crypto' },
    { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, label: 'GitHub token detected', category: 'A02-crypto' },
    { pattern: /(?:sk-|pk_live_|sk_live_)[a-zA-Z0-9]{20,}/, label: 'Third-party API key detected', category: 'A02-crypto' },
    { pattern: /https?:\/\/[^@\s]+:[^@\s]+@/, label: 'Credentials embedded in URL', category: 'A02-crypto' },

    // A05: Security Misconfiguration
    { pattern: /cors\s*\(\s*\{[^}]*origin\s*:\s*(?:true|['"]?\*['"]?)/, label: 'CORS allows all origins', category: 'A05-misconfig' },
    { pattern: /(?:debug|DEBUG)\s*[:=]\s*true/, label: 'Debug mode enabled', category: 'A05-misconfig' },
    { pattern: /(?:allowInsecure|rejectUnauthorized)\s*[:=]\s*false/, label: 'TLS verification disabled', category: 'A05-misconfig' },
    { pattern: /helmet\s*\(\s*\{[^}]*contentSecurityPolicy\s*:\s*false/, label: 'CSP disabled', category: 'A05-misconfig' },

    // A07: Auth Failures
    { pattern: /===?\s*['"](?:password|admin|root|test)['"]/, label: 'Hardcoded password comparison', category: 'A07-auth' },
    { pattern: /jwt\.sign\s*\([^)]*expiresIn\s*:\s*['"]?\d{4,}/, label: 'JWT with very long expiry', category: 'A07-auth' },

    // A08: Data Integrity
    { pattern: /JSON\.parse\s*\(\s*(?:req\.|params\.|query\.|body\.)/, label: 'Unvalidated JSON deserialization', category: 'A08-integrity' },
    { pattern: /pickle\.loads?\s*\(/, label: 'Unsafe pickle deserialization', category: 'A08-integrity' },
    { pattern: /yaml\.load\s*\([^)]*$/, label: 'Unsafe YAML load (use safe_load)', category: 'A08-integrity' },

    // A10: SSRF
    { pattern: /fetch\s*\(\s*(?:req\.|params\.|query\.|body\.|userInput|url)/, label: 'Potential SSRF — user-controlled URL', category: 'A10-ssrf' },
    { pattern: /axios\s*\.\s*(?:get|post|put|delete)\s*\(\s*(?:req\.|params\.|query\.)/, label: 'Potential SSRF — user-controlled URL', category: 'A10-ssrf' },
  ];
}

/**
 * QualityService
 *
 * Validates quality gates for tasks:
 * - Compilation checks
 * - Linting
 * - Tests
 * - File existence
 * - Privacy impact scanning
 * - Security scanning
 * - Doc-change detection
 * - Custom quality requirements
 */
export class QualityService {
  private projectRoot: string;
  private _customGates: Map<string, CustomQualityGate | CustomGateDefinition> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Register custom gates so validateSingleGate can look them up by name.
   */
  setCustomGates(gates: Array<CustomQualityGate | CustomGateDefinition>): void {
    this._customGates.clear();
    for (const gate of gates) {
      this._customGates.set(gate.name.toLowerCase(), gate);
    }
  }

  // ========================================================================
  // Quality Gate Validation
  // ========================================================================

  async validateQualityGates(
    requirements: string[],
    files: string[]
  ): Promise<{
    passed: boolean;
    results: Array<{ gate: string; passed: boolean; details: string }>;
  }> {
    const results: Array<{ gate: string; passed: boolean; details: string }> = [];

    for (const requirement of requirements) {
      const result = await this.validateSingleGate(requirement, files);
      results.push(result);
    }

    const allPassed = results.every(r => r.passed);

    return {
      passed: allPassed,
      results,
    };
  }

  private async validateSingleGate(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const req = requirement.toLowerCase();

    try {
      // File existence checks
      if (req.includes('file exists') || req.includes('file created')) {
        return await this.validateFileExistence(requirement, files);
      }

      // Compilation checks
      if (req.includes('compil') || req.includes('build')) {
        return await this.validateCompilation(requirement);
      }

      // Linting checks
      if (req.includes('lint') || req.includes('eslint')) {
        return await this.validateLinting(requirement, files);
      }

      // Test checks
      if (req.includes('test') && !req.includes('no test')) {
        return await this.validateTests(requirement, files);
      }

      // Type checks
      if (req.includes('type check') || req.includes('typescript')) {
        return await this.validateTypeScript(requirement);
      }

      // Documentation checks
      if (req.includes('document') || req.includes('readme') || req.includes('comment')) {
        return await this.validateDocumentation(requirement, files);
      }

      // Privacy impact checks
      if (req.includes('privacy')) {
        return await this.validatePrivacyImpact(requirement, files);
      }

      // Security scan checks
      if (req.includes('security') || req.includes('secret') || req.includes('credential')) {
        return await this.validateSecurityScan(requirement, files);
      }

      // Doc-change detection
      if (req.includes('doc-change') || req.includes('docs updated') || req.includes('documentation updated')) {
        return await this.validateDocChangeDetection(requirement, files);
      }

      // Check custom gates by name
      const customGate = this._customGates.get(req);
      if (customGate) {
        const result = await this.validateCustomGate(customGate);
        return { gate: result.gate, passed: result.passed, details: result.details };
      }

      // Default: mark as passed with note
      return {
        gate: requirement,
        passed: true,
        details: 'Requirement noted but not automatically validated',
      };
    } catch (error) {
      return {
        gate: requirement,
        passed: false,
        details: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ========================================================================
  // Specific Validators
  // ========================================================================

  private async validateFileExistence(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const missingFiles: string[] = [];

    for (const file of files) {
      const fullPath = path.join(this.projectRoot, file);
      try {
        await fs.access(fullPath);
      } catch {
        missingFiles.push(file);
      }
    }

    return {
      gate: requirement,
      passed: missingFiles.length === 0,
      details:
        missingFiles.length === 0
          ? `All ${files.length} files exist`
          : `Missing files: ${missingFiles.join(', ')}`,
    };
  }

  private async validateCompilation(
    requirement: string
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    try {
      // Try TypeScript compilation
      await execAsync('npm run build', {
        cwd: this.projectRoot,
        timeout: 60000, // 1 minute timeout
      });

      return {
        gate: requirement,
        passed: true,
        details: 'Compilation successful',
      };
    } catch (error) {
      return {
        gate: requirement,
        passed: false,
        details: `Compilation failed: ${getExecErrorDetails(error)}`,
      };
    }
  }

  private async validateLinting(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    try {
      // Run ESLint on specified files
      const fileArgs = files.length > 0 ? files.join(' ') : '.';
      await execAsync(`npm run lint ${fileArgs}`, {
        cwd: this.projectRoot,
        timeout: 30000, // 30 second timeout
      });

      return {
        gate: requirement,
        passed: true,
        details: 'Linting passed',
      };
    } catch (error) {
      // ESLint exits with non-zero on warnings/errors
      return {
        gate: requirement,
        passed: false,
        details: `Linting issues found: ${getExecErrorDetails(error)}`,
      };
    }
  }

  private async validateTests(
    requirement: string,
    _files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    try {
      // Run tests - try multiple common test commands
      let testCommand = 'npm test';

      // Check if package.json has a test script
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        if (packageJson.scripts?.test) {
          testCommand = 'npm test';
        } else if (packageJson.scripts?.['test:unit']) {
          testCommand = 'npm run test:unit';
        }
      } catch {
        // If can't read package.json, use default
      }

      await execAsync(testCommand, {
        cwd: this.projectRoot,
        timeout: 120000, // 2 minute timeout for tests
      });

      return {
        gate: requirement,
        passed: true,
        details: 'Tests passed',
      };
    } catch (error) {
      return {
        gate: requirement,
        passed: false,
        details: `Tests failed: ${getExecErrorDetails(error)}`,
      };
    }
  }

  private async validateTypeScript(
    requirement: string
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    try {
      await execAsync('npm run type-check || tsc --noEmit', {
        cwd: this.projectRoot,
        timeout: 60000,
      });

      return {
        gate: requirement,
        passed: true,
        details: 'Type checking passed',
      };
    } catch (error) {
      return {
        gate: requirement,
        passed: false,
        details: `Type errors found: ${getExecErrorDetails(error)}`,
      };
    }
  }

  private async validateDocumentation(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const issues: string[] = [];

    for (const file of files) {
      const fullPath = path.join(this.projectRoot, file);

      try {
        const content = await fs.readFile(fullPath, 'utf-8');

        // Check for basic documentation markers
        if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
          // Check for JSDoc comments
          const hasJSDoc = content.includes('/**') && content.includes('*/');
          const hasComments = content.includes('//');

          if (!hasJSDoc && !hasComments) {
            issues.push(`${file}: No documentation comments found`);
          }
        }
      } catch {
        issues.push(`${file}: Could not read file`);
      }
    }

    // Also check for README
    const readmePath = path.join(this.projectRoot, 'README.md');
    try {
      await fs.access(readmePath);
    } catch {
      issues.push('No README.md found in project root');
    }

    return {
      gate: requirement,
      passed: issues.length === 0,
      details:
        issues.length === 0
          ? 'Documentation requirements met'
          : `Issues: ${issues.join('; ')}`,
    };
  }

  // ========================================================================
  // Privacy Impact Validator
  // ========================================================================

  private async validatePrivacyImpact(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const privacyPatterns = [
      { pattern: /(?:email|phone|ssn|social.?security|passport|driver.?licen[sc]e)\s*[:=]/i, label: 'PII field assignment' },
      { pattern: /(?:password|secret|token|api.?key|private.?key)\s*[:=]\s*['"`][^'"`]+['"`]/i, label: 'Hardcoded credential' },
      { pattern: /localStorage\.setItem\s*\(\s*['"`](?:token|auth|session|user)/i, label: 'Sensitive data in localStorage' },
      { pattern: /console\.log\s*\([^)]*(?:password|token|secret|key|credential)/i, label: 'Logging sensitive data' },
      { pattern: /(?:tracking|analytics|telemetry)\.(?:send|track|log)\s*\(/i, label: 'Tracking/analytics call' },
      { pattern: /document\.cookie\s*=/i, label: 'Direct cookie manipulation' },
      { pattern: /(?:ip.?address|geolocation|navigator\.geolocation)/i, label: 'Location/IP tracking' },
    ];

    // Lines matching these patterns are known false positives — skip them
    const allowlistPatterns = [
      /^\s*(?:export\s+)?(?:interface|type)\s/,           // Type/interface declarations
      /\?\s*:\s*(?:string|number|boolean)/,               // Optional property type annotations (email?: string)
      /:\s*(?:string|number|boolean|Record|Array)\b/,     // Type annotations
      /['"`]\$\{/,                                        // Template variable references (${GITHUB_TOKEN})
      /^\s*description\s*:/,                              // Schema description fields
      /^\s*(?:flags|example)/,                            // CLI help text definitions
      /['"`](?:Category|Filter by|Associated|Decision)/i, // Schema description strings
      /locale\s*:/,                                       // Locale config (not IP tracking)
      /(?:option_key|configResult|configPath)/,           // Logging of non-sensitive config data
    ];

    const findings: Array<{ file: string; line: number; label: string }> = [];

    for (const file of files) {
      // Skip test files, the scanner itself, type declarations, lock files, and JSON configs
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file)) continue;
      if (/quality-service\.(ts|js)$/.test(file)) continue;
      if (/\.d\.ts$/.test(file)) continue;
      if (/package-lock\.json$/.test(file)) continue;
      if (/\.json$/.test(file)) continue;
      const fullPath = path.join(this.projectRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          // Check allowlist — skip known false positive patterns
          if (allowlistPatterns.some(ap => ap.test(line))) continue;
          for (const { pattern, label } of privacyPatterns) {
            if (pattern.test(line)) {
              findings.push({ file, line: i + 1, label });
            }
          }
        }
      } catch {
        // File not readable — skip
      }
    }

    return {
      gate: requirement,
      passed: findings.length === 0,
      details: findings.length === 0
        ? `Privacy scan passed — ${files.length} file(s) checked`
        : `${findings.length} privacy concern(s): ${findings.map(f => `${f.file}:${f.line} (${f.label})`).join('; ')}`,
    };
  }

  // ========================================================================
  // Security Scan Validator
  // ========================================================================

  private async validateSecurityScan(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const securityPatterns = getSecurityPatterns();
    const findings: Array<{ file: string; line: number; label: string }> = [];

    for (const file of files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|rs|sh|bash)$/.test(file)) continue;
      // Skip test files (test payloads aren't vulnerabilities) and the scanner itself (pattern definitions)
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file)) continue;
      if (/quality-service\.(ts|js)$/.test(file)) continue;
      const fullPath = path.join(this.projectRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          for (const { pattern, label } of securityPatterns) {
            if (pattern.test(line)) {
              findings.push({ file, line: i + 1, label });
            }
          }
        }
      } catch {
        // File not readable — skip
      }
    }

    return {
      gate: requirement,
      passed: findings.length === 0,
      details: findings.length === 0
        ? `Security scan passed — ${files.length} file(s) checked`
        : `${findings.length} security concern(s): ${findings.map(f => `${f.file}:${f.line} (${f.label})`).join('; ')}`,
    };
  }

  // ========================================================================
  // Dependency Vulnerability Check (A06: Vulnerable Components)
  // ========================================================================

  async checkDependencyVulnerabilities(): Promise<{
    gate: string;
    passed: boolean;
    details: string;
    severity: 'error' | 'warning';
    criticalCount: number;
    highCount: number;
  }> {
    try {
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      await fs.access(packageJsonPath);
    } catch {
      return {
        gate: 'dependency-vulnerabilities',
        passed: true,
        details: 'No package.json found — skipping dependency check',
        severity: 'warning',
        criticalCount: 0,
        highCount: 0,
      };
    }

    try {
      const { stdout } = await execAsync('npm audit --json 2>/dev/null || true', {
        cwd: this.projectRoot,
        timeout: 30000,
      });

      const audit = JSON.parse(stdout);
      const vulnerabilities = audit.metadata?.vulnerabilities || {};
      const critical = vulnerabilities.critical || 0;
      const high = vulnerabilities.high || 0;
      const total = (vulnerabilities.total || 0);

      if (critical > 0 || high > 0) {
        return {
          gate: 'dependency-vulnerabilities',
          passed: false,
          details: `npm audit: ${critical} critical, ${high} high severity vulnerabilities (${total} total). Run \`npm audit\` for details.`,
          severity: critical > 0 ? 'error' : 'warning',
          criticalCount: critical,
          highCount: high,
        };
      }

      return {
        gate: 'dependency-vulnerabilities',
        passed: true,
        details: total > 0
          ? `npm audit: ${total} low/moderate vulnerabilities (no critical or high)`
          : 'npm audit: no known vulnerabilities',
        severity: 'warning',
        criticalCount: 0,
        highCount: 0,
      };
    } catch {
      return {
        gate: 'dependency-vulnerabilities',
        passed: true,
        details: 'npm audit could not run — skipping',
        severity: 'warning',
        criticalCount: 0,
        highCount: 0,
      };
    }
  }

  // ========================================================================
  // Combined Security + Privacy Scan (for completeTaskSmart integration)
  // ========================================================================

  async runDefaultSecurityScan(files: string[]): Promise<{
    findings: Array<{ file: string; line: number; label: string; type: 'security' | 'privacy' }>;
    dependencyIssues: string | null;
    passed: boolean;
    summary: string;
  }> {
    // Run both security and privacy scans
    const securityResult = await this.validateSecurityScan('security', files);
    const privacyResult = await this.validatePrivacyImpact('privacy', files);

    // Run dependency check
    const depResult = await this.checkDependencyVulnerabilities();

    const allFindings: Array<{ file: string; line: number; label: string; type: 'security' | 'privacy' }> = [];

    // Parse findings from details strings (they contain file:line info)
    if (!securityResult.passed) {
      // Extract individual findings from the details
      const securityCount = parseInt(securityResult.details.match(/^(\d+)/)?.[1] || '0');
      if (securityCount > 0) {
        allFindings.push({ file: '', line: 0, label: securityResult.details, type: 'security' });
      }
    }
    if (!privacyResult.passed) {
      const privacyCount = parseInt(privacyResult.details.match(/^(\d+)/)?.[1] || '0');
      if (privacyCount > 0) {
        allFindings.push({ file: '', line: 0, label: privacyResult.details, type: 'privacy' });
      }
    }

    const parts: string[] = [];
    if (!securityResult.passed) parts.push(securityResult.details);
    if (!privacyResult.passed) parts.push(privacyResult.details);
    if (!depResult.passed) parts.push(depResult.details);

    const passed = securityResult.passed && privacyResult.passed && depResult.passed;

    return {
      findings: allFindings,
      dependencyIssues: depResult.passed ? null : depResult.details,
      passed,
      summary: passed
        ? `Security scan passed — ${files.length} file(s) checked, dependencies clean`
        : parts.join('; '),
    };
  }

  // ========================================================================
  // Doc-Change Detection Validator
  // ========================================================================

  private async validateDocChangeDetection(
    requirement: string,
    files: string[]
  ): Promise<{ gate: string; passed: boolean; details: string }> {
    const sourceExtensions = /\.(ts|tsx|js|jsx|py|rb|go|java|rs)$/;
    const docExtensions = /\.(md|mdx|rst|txt|adoc)$/;
    const docDirs = ['docs', 'doc', 'documentation', 'wiki'];

    const sourceFiles = files.filter(f => sourceExtensions.test(f));
    const docFiles = files.filter(f => docExtensions.test(f) || docDirs.some(d => f.startsWith(d + '/')));

    if (sourceFiles.length === 0) {
      return { gate: requirement, passed: true, details: 'No source files changed — doc check not applicable' };
    }

    const significantPatterns = [
      /export\s+(?:default\s+)?(?:class|function|interface|type|enum|const)\s+/,
      /(?:app|router|server)\.(get|post|put|patch|delete)\s*\(/,
      /\.(?:command|option|argument)\s*\(/,
    ];

    let hasSignificantChanges = false;
    for (const file of sourceFiles) {
      const fullPath = path.join(this.projectRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        if (significantPatterns.some(p => p.test(content))) {
          hasSignificantChanges = true;
          break;
        }
      } catch { /* skip */ }
    }

    if (!hasSignificantChanges) {
      return { gate: requirement, passed: true, details: `${sourceFiles.length} source file(s) changed — no significant API changes detected` };
    }

    const hasReadmeUpdate = files.some(f => /readme\.md$/i.test(f));
    if (docFiles.length > 0 || hasReadmeUpdate) {
      return { gate: requirement, passed: true, details: `Source changes accompanied by doc updates: ${docFiles.join(', ')}` };
    }

    return {
      gate: requirement,
      passed: false,
      details: `${sourceFiles.length} source file(s) with significant changes but no documentation updates. Consider updating README.md or docs/.`,
    };
  }

  // ========================================================================
  // Custom Validators
  // ========================================================================

  async runCustomValidator(
    command: string,
    timeout: number = 30000
  ): Promise<{ passed: boolean; details: string }> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: this.projectRoot,
        timeout,
      });

      return {
        passed: true,
        details: stdout || 'Command executed successfully',
      };
    } catch (error) {
      return {
        passed: false,
        details: `Command failed: ${getExecErrorDetails(error)}`,
      };
    }
  }

  // ========================================================================
  // Custom Gate Validation
  // ========================================================================

  /**
   * Check if a file path matches a glob-style pattern.
   * Supports ** (any depth) and * (single level) wildcards.
   */
  static matchesGlob(filePath: string, pattern: string): boolean {
    const normalized = filePath.replace(/^\.\//, '');
    const normalizedPattern = pattern.replace(/^\.\//, '');

    // Convert glob pattern to regex
    // Handle **/ specially: it matches zero or more path segments
    const regexStr = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*\//g, '(?:.*/)?')   // **/ matches zero or more directories
      .replace(/\*\*/g, '.*')           // ** at end matches everything
      .replace(/\*/g, '[^/]*');          // * matches within single segment

    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normalized);
  }

  /**
   * Check if any changed files match the gate's file patterns.
   * If no file patterns are specified, the gate applies to all files.
   */
  private gateAppliesToFiles(gate: CustomQualityGate | CustomGateDefinition, changedFiles: string[]): boolean {
    const patterns = gate.files;
    if (!patterns || patterns.length === 0) return true;
    if (changedFiles.length === 0) return true;

    return changedFiles.some(file =>
      patterns.some((pattern: string) => QualityService.matchesGlob(file, pattern))
    );
  }

  /**
   * Validate a single custom gate by running its command and checking
   * the result based on the failOn strategy.
   */
  async validateCustomGate(
    gate: CustomQualityGate | CustomGateDefinition
  ): Promise<{
    gate: string;
    passed: boolean;
    details: string;
    severity: 'error' | 'warning';
  }> {
    const failOn = gate.failOn ?? 'exit-code';
    const timeout = ('timeoutSeconds' in gate && gate.timeoutSeconds)
      ? gate.timeoutSeconds * 1000
      : ('timeout' in gate && (gate as CustomGateDefinition).timeout)
        ? (gate as CustomGateDefinition).timeout!
        : 30000;
    const severity = gate.severity ?? 'error';

    try {
      const { stdout, stderr } = await execAsync(gate.command, {
        cwd: this.projectRoot,
        timeout,
      });

      // For exit-code strategy, a successful exit means pass
      if (failOn === 'exit-code') {
        return { gate: gate.name, passed: true, details: stdout || 'Command succeeded', severity };
      }

      // For stdout-match, check if stdout matches the pattern
      if (failOn === 'stdout-match' && gate.pattern) {
        const regex = new RegExp(gate.pattern);
        const matches = regex.test(stdout);
        return {
          gate: gate.name,
          passed: !matches,
          details: matches
            ? `stdout matched forbidden pattern /${gate.pattern}/: ${stdout.trim().substring(0, 200)}`
            : 'No forbidden pattern found in stdout',
          severity,
        };
      }

      // For stderr-match, check if stderr matches the pattern
      if (failOn === 'stderr-match' && gate.pattern) {
        const regex = new RegExp(gate.pattern);
        const matches = regex.test(stderr);
        return {
          gate: gate.name,
          passed: !matches,
          details: matches
            ? `stderr matched forbidden pattern /${gate.pattern}/: ${stderr.trim().substring(0, 200)}`
            : 'No forbidden pattern found in stderr',
          severity,
        };
      }

      return { gate: gate.name, passed: true, details: 'Command succeeded', severity };
    } catch (error) {
      // Command exited with non-zero
      if (failOn === 'exit-code') {
        return {
          gate: gate.name,
          passed: false,
          details: `Command failed: ${getExecErrorDetails(error)}`,
          severity,
        };
      }

      // For stdout/stderr match on failed commands, extract output from error
      const execError = error as Record<string, unknown>;
      const stdout = typeof execError.stdout === 'string' ? execError.stdout : '';
      const stderr = typeof execError.stderr === 'string' ? execError.stderr : '';

      if (failOn === 'stdout-match' && gate.pattern) {
        const regex = new RegExp(gate.pattern);
        const matches = regex.test(stdout);
        return {
          gate: gate.name,
          passed: !matches,
          details: matches
            ? `stdout matched forbidden pattern /${gate.pattern}/: ${stdout.trim().substring(0, 200)}`
            : `Command exited non-zero but no forbidden pattern found in stdout`,
          severity,
        };
      }

      if (failOn === 'stderr-match' && gate.pattern) {
        const regex = new RegExp(gate.pattern);
        const matches = regex.test(stderr);
        return {
          gate: gate.name,
          passed: !matches,
          details: matches
            ? `stderr matched forbidden pattern /${gate.pattern}/: ${stderr.trim().substring(0, 200)}`
            : `Command exited non-zero but no forbidden pattern found in stderr`,
          severity,
        };
      }

      return {
        gate: gate.name,
        passed: false,
        details: `Command failed: ${getExecErrorDetails(error)}`,
        severity,
      };
    }
  }

  /**
   * Validate all custom gates, filtering by changed files.
   */
  async validateCustomGates(
    gates: Array<CustomQualityGate | CustomGateDefinition>,
    changedFiles: string[]
  ): Promise<Array<{
    gate: string;
    passed: boolean;
    details: string;
    severity: 'error' | 'warning';
  }>> {
    const results: Array<{
      gate: string;
      passed: boolean;
      details: string;
      severity: 'error' | 'warning';
    }> = [];

    for (const gate of gates) {
      if (!this.gateAppliesToFiles(gate, changedFiles)) {
        results.push({
          gate: gate.name,
          passed: true,
          details: 'Skipped — no matching files changed',
          severity: gate.severity ?? 'error',
        });
        continue;
      }

      const result = await this.validateCustomGate(gate);
      results.push(result);
    }

    return results;
  }

  /**
   * Run both built-in required gates AND custom gates together.
   * Returns combined results.
   */
  async validateWithConfig(
    config: { requiredGates?: string[]; customGates?: Array<CustomQualityGate | CustomGateDefinition> },
    files: string[]
  ): Promise<{
    passed: boolean;
    results: Array<{ gate: string; passed: boolean; details: string; severity?: 'error' | 'warning' }>;
    errors: number;
    warnings: number;
  }> {
    const allResults: Array<{ gate: string; passed: boolean; details: string; severity?: 'error' | 'warning' }> = [];

    // Run built-in gates
    if (config.requiredGates && config.requiredGates.length > 0) {
      const builtInResults = await this.validateQualityGates(config.requiredGates, files);
      for (const r of builtInResults.results) {
        allResults.push({ ...r, severity: 'error' });
      }
    }

    // Run custom gates
    if (config.customGates && config.customGates.length > 0) {
      const customResults = await this.validateCustomGates(config.customGates, files);
      allResults.push(...customResults);
    }

    const errors = allResults.filter(r => !r.passed && r.severity === 'error').length;
    const warnings = allResults.filter(r => !r.passed && r.severity === 'warning').length;

    return {
      passed: errors === 0,
      results: allResults,
      errors,
      warnings,
    };
  }

  // ========================================================================
  // CI/CD Integration
  // ========================================================================

  async validateForCI(options: {
    outputFormat: 'github-annotations' | 'junit-xml' | 'json';
    failOnCritical?: boolean;
    taskId?: string;
    changedFiles?: string[];
  }): Promise<{
    passed: boolean;
    exitCode: number;
    summary: string;
    timestamp: string;
    issues: Array<{
      file: string;
      line?: number;
      severity: 'error' | 'warning' | 'info';
      message: string;
      rule?: string;
    }>;
    metrics: {
      total: number;
      critical: number;
      errors: number;
      warnings: number;
    };
    formatted: string;
  }> {
    const timestamp = new Date().toISOString();
    const issues: Array<{
      file: string;
      line?: number;
      severity: 'error' | 'warning' | 'info';
      message: string;
      rule?: string;
    }> = [];

    // Run health check
    const healthCheck = await this.runProjectHealthCheck();

    // Convert health check results to issues
    for (const check of healthCheck.checks) {
      if (!check.passed) {
        issues.push({
          file: this.projectRoot,
          severity: 'error',
          message: `${check.name}: ${check.message}`,
          rule: `health-check:${check.name}`,
        });
      }
    }

    // Run security/privacy scan on changed files (or all source files)
    const filesToScan = options.changedFiles || [];
    if (filesToScan.length > 0) {
      const scanFindings = await this.scanFilesForCI(filesToScan);
      issues.push(...scanFindings);
    }

    // Run dependency vulnerability check
    const depResult = await this.checkDependencyVulnerabilities();
    if (!depResult.passed) {
      issues.push({
        file: 'package.json',
        severity: depResult.severity,
        message: depResult.details,
        rule: 'dependency:vulnerabilities',
      });
    }

    // Calculate metrics
    const metrics = {
      total: issues.length,
      critical: issues.filter(i => i.severity === 'error').length,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
    };

    // Determine if passed
    const passed = options.failOnCritical
      ? metrics.critical === 0
      : issues.length === 0;

    const exitCode = passed ? 0 : 1;

    const summary = passed
      ? `Quality validation passed - ${healthCheck.checks.length} checks completed`
      : `Quality validation failed - ${metrics.critical} critical issues, ${metrics.errors} errors, ${metrics.warnings} warnings`;

    // Format output based on requested format
    let formatted = '';
    switch (options.outputFormat) {
      case 'github-annotations':
        formatted = this.formatGitHubAnnotations(issues);
        break;
      case 'junit-xml':
        formatted = this.formatJUnitXML(issues, metrics, timestamp);
        break;
      case 'json':
        formatted = JSON.stringify({
          passed,
          exitCode,
          summary,
          timestamp,
          issues,
          metrics,
        }, null, 2);
        break;
    }

    return {
      passed,
      exitCode,
      summary,
      timestamp,
      issues,
      metrics,
      formatted,
    };
  }

  private formatGitHubAnnotations(issues: Array<{
    file: string;
    line?: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
    rule?: string;
  }>): string {
    const annotations = issues.map(issue => {
      const level = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'notice';
      const lineInfo = issue.line ? ` line=${issue.line}` : '';
      return `::${level} file=${issue.file}${lineInfo}::${issue.message}${issue.rule ? ` [${issue.rule}]` : ''}`;
    });

    return annotations.join('\n');
  }

  private formatJUnitXML(
    issues: Array<{
      file: string;
      line?: number;
      severity: 'error' | 'warning' | 'info';
      message: string;
      rule?: string;
    }>,
    metrics: {
      total: number;
      critical: number;
      errors: number;
      warnings: number;
    },
    timestamp: string
  ): string {
    const testcases = issues.map((issue, index) => {
      const failure = `
        <failure message="${this.escapeXml(issue.message)}" type="${issue.severity}">
          File: ${this.escapeXml(issue.file)}
          ${issue.line ? `Line: ${issue.line}` : ''}
          ${issue.rule ? `Rule: ${this.escapeXml(issue.rule)}` : ''}
        </failure>`;

      return `
      <testcase name="${this.escapeXml(issue.rule || `Issue ${index + 1}`)}" classname="QualityValidation" time="0">
        ${failure}
      </testcase>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Enginehaus Quality Validation" tests="${metrics.total}" failures="${metrics.errors}" errors="${metrics.critical}" time="0" timestamp="${timestamp}">
  <testsuite name="Quality Gates" tests="${metrics.total}" failures="${metrics.errors}" errors="${metrics.critical}" time="0">
    ${testcases}
  </testsuite>
</testsuites>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ========================================================================
  // CI Security/Privacy Scan (structured findings for annotations)
  // ========================================================================

  async scanFilesForCI(files: string[]): Promise<Array<{
    file: string;
    line: number;
    severity: 'error' | 'warning';
    message: string;
    rule: string;
  }>> {
    const issues: Array<{
      file: string;
      line: number;
      severity: 'error' | 'warning';
      message: string;
      rule: string;
    }> = [];

    const securityPatterns = getSecurityPatterns();
    const privacyPatterns = [
      { pattern: /(?:email|phone|ssn|social.?security|passport|driver.?licen[sc]e)\s*[:=]/i, label: 'PII field assignment', rule: 'privacy:pii' },
      { pattern: /(?:password|secret|token|api.?key|private.?key)\s*[:=]\s*['"`][^'"`]+['"`]/i, label: 'Hardcoded credential', rule: 'privacy:credential' },
      { pattern: /localStorage\.setItem\s*\(\s*['"`](?:token|auth|session|user)/i, label: 'Sensitive data in localStorage', rule: 'privacy:storage' },
      { pattern: /console\.log\s*\([^)]*(?:password|token|secret|key|credential)/i, label: 'Logging sensitive data', rule: 'privacy:logging' },
      { pattern: /document\.cookie\s*=/i, label: 'Direct cookie manipulation', rule: 'privacy:cookies' },
    ];

    // Lines matching these patterns are known false positives — skip them
    const privacyAllowlist = [
      /^\s*(?:export\s+)?(?:interface|type)\s/,
      /\?\s*:\s*(?:string|number|boolean)/,
      /:\s*(?:string|number|boolean|Record|Array)\b/,
      /['"`]\$\{/,
      /^\s*description\s*:/,
      /locale\s*:/,
      /(?:option_key|configResult|configPath)/,
    ];

    for (const file of files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|rs|sh|bash)$/.test(file)) continue;
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file)) continue;
      if (/quality-service\.(ts|js)$/.test(file)) continue;
      if (/\.d\.ts$/.test(file)) continue;

      const fullPath = path.join(this.projectRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

          for (const { pattern, label, category } of securityPatterns) {
            if (pattern.test(line)) {
              issues.push({
                file,
                line: i + 1,
                severity: 'warning',
                message: `${label}`,
                rule: `security:${category}`,
              });
            }
          }
          // Apply allowlist before privacy patterns to reduce false positives
          const isAllowlisted = privacyAllowlist.some(ap => ap.test(line));
          if (!isAllowlisted) {
            for (const { pattern, label, rule } of privacyPatterns) {
              if (pattern.test(line)) {
                issues.push({
                  file,
                  line: i + 1,
                  severity: 'warning',
                  message: label,
                  rule,
                });
              }
            }
          }
        }
      } catch {
        // File not readable — skip
      }
    }

    return issues;
  }

  // ========================================================================
  // Health Checks
  // ========================================================================

  async runProjectHealthCheck(): Promise<{
    healthy: boolean;
    checks: Array<{ name: string; passed: boolean; message: string }>;
  }> {
    const checks: Array<{ name: string; passed: boolean; message: string }> = [];

    // Check if package.json exists
    try {
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      await fs.access(packageJsonPath);
      checks.push({
        name: 'package.json',
        passed: true,
        message: 'Found',
      });
    } catch {
      checks.push({
        name: 'package.json',
        passed: false,
        message: 'Not found',
      });
    }

    // Check if node_modules exists
    try {
      const nodeModulesPath = path.join(this.projectRoot, 'node_modules');
      await fs.access(nodeModulesPath);
      checks.push({
        name: 'node_modules',
        passed: true,
        message: 'Dependencies installed',
      });
    } catch {
      checks.push({
        name: 'node_modules',
        passed: false,
        message: 'Dependencies not installed',
      });
    }

    // Try compilation
    const compilationResult = await this.validateCompilation('health-check');
    checks.push({
      name: 'compilation',
      passed: compilationResult.passed,
      message: compilationResult.details,
    });

    // Try linting
    const lintingResult = await this.validateLinting('health-check', []);
    checks.push({
      name: 'linting',
      passed: lintingResult.passed,
      message: lintingResult.details,
    });

    const allPassed = checks.every(c => c.passed);

    return {
      healthy: allPassed,
      checks,
    };
  }
}
