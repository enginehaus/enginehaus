# CI/CD Integration Guide

Enginehaus provides powerful quality validation capabilities that can be integrated into any CI/CD pipeline. This guide shows you how to integrate Enginehaus quality gates into your continuous integration workflow.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [GitHub Actions](#github-actions)
- [GitLab CI](#gitlab-ci)
- [Jenkins](#jenkins)
- [CircleCI](#circleci)
- [Custom CI Systems](#custom-ci-systems)
- [Output Formats](#output-formats)
- [Configuration](#configuration)

---

## Overview

Enginehaus quality validation can:

- **Validate quality gates** for your codebase
- **Output results** in multiple formats (GitHub Annotations, JUnit XML, JSON)
- **Block merges** on critical issues
- **Generate quality reports** for team visibility
- **Track quality metrics** over time

### Key Features

- ✅ Multiple output formats for different CI systems
- ✅ Configurable failure thresholds
- ✅ Built-in health checks (compilation, linting, tests, documentation)
- ✅ SQLite storage for audit trail
- ✅ Easy integration with existing workflows

---

## Quick Start

### 1. Install Enginehaus

```bash
npm install enginehaus
```

### 2. Add to your CI pipeline

```bash
npm run validate-ci
```

### 3. Configure environment

```bash
export ENGINEHAUS_STORAGE=sqlite
```

---

## GitHub Actions

### Basic Setup

Create `.github/workflows/enginehaus-ci.yml`:

```yaml
name: Enginehaus Quality Gates

on:
  push:
    branches: [main, develop, 'feature/**']
  pull_request:
    branches: [main, develop]

jobs:
  quality-validation:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build project
        run: npm run build

      - name: Run Enginehaus Quality Validation
        run: npm run validate-ci
        env:
          ENGINEHAUS_STORAGE: sqlite

      - name: Upload validation results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: quality-validation-results
          path: .enginehaus/validation-results.json
          retention-days: 30
```

### Advanced: Block on Critical Issues

```yaml
      - name: Run Enginehaus Quality Validation
        run: |
          npm run validate-ci -- --fail-on-critical
        env:
          ENGINEHAUS_STORAGE: sqlite
```

### Advanced: PR Comments

```yaml
      - name: Run Quality Validation
        id: validation
        run: npm run validate-ci
        continue-on-error: true

      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('.enginehaus/validation-results.json', 'utf8'));

            const body = `
            ## Enginehaus Quality Validation

            **Status**: ${results.passed ? '✅ Passed' : '❌ Failed'}
            **Critical Issues**: ${results.metrics.critical}
            **Errors**: ${results.metrics.errors}
            **Warnings**: ${results.metrics.warnings}

            ${results.summary}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

---

## GitLab CI

### Basic Setup

Create `.gitlab-ci.yml`:

```yaml
stages:
  - build
  - test
  - quality

build:
  stage: build
  image: node:20
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - build/
      - node_modules/
    expire_in: 1 hour

quality-validation:
  stage: quality
  image: node:20
  dependencies:
    - build
  script:
    - npm run validate-ci -- --output-format junit-xml > validation-results.xml
  artifacts:
    reports:
      junit: validation-results.xml
    paths:
      - .enginehaus/validation-results.json
    expire_in: 30 days
  environment:
    name: quality-validation
  variables:
    ENGINEHAUS_STORAGE: sqlite
  allow_failure: false
```

### Advanced: Merge Request Integration

```yaml
quality-validation:
  stage: quality
  image: node:20
  script:
    - npm run validate-ci -- --output-format json > validation-results.json
    - cat validation-results.json
  only:
    - merge_requests
  artifacts:
    reports:
      codequality: validation-results.json
```

---

## Jenkins

### Basic Setup

Create `Jenkinsfile`:

```groovy
pipeline {
    agent any

    environment {
        ENGINEHAUS_STORAGE = 'sqlite'
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Quality Validation') {
            steps {
                sh 'npm run validate-ci -- --output-format junit-xml > validation-results.xml'
            }
            post {
                always {
                    junit 'validation-results.xml'
                    archiveArtifacts artifacts: '.enginehaus/validation-results.json', fingerprint: true
                }
            }
        }
    }

    post {
        failure {
            echo 'Quality validation failed!'
        }
        success {
            echo 'Quality validation passed!'
        }
    }
}
```

### Advanced: Quality Gates

```groovy
stage('Quality Validation') {
    steps {
        script {
            def result = sh(
                script: 'npm run validate-ci -- --output-format json',
                returnStdout: true
            )
            def validation = readJSON text: result

            if (validation.metrics.critical > 0) {
                error("Quality validation failed: ${validation.metrics.critical} critical issues")
            }

            if (validation.metrics.errors > 5) {
                unstable("Quality validation unstable: ${validation.metrics.errors} errors")
            }
        }
    }
}
```

---

## CircleCI

### Basic Setup

Create `.circleci/config.yml`:

```yaml
version: 2.1

jobs:
  build:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - restore_cache:
          keys:
            - v1-dependencies-{{ checksum "package-lock.json" }}
            - v1-dependencies-
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          paths:
            - node_modules
          key: v1-dependencies-{{ checksum "package-lock.json" }}
      - run:
          name: Build project
          command: npm run build
      - persist_to_workspace:
          root: .
          paths:
            - build
            - node_modules

  quality-validation:
    docker:
      - image: cimg/node:20.0
    environment:
      ENGINEHAUS_STORAGE: sqlite
    steps:
      - checkout
      - attach_workspace:
          at: .
      - run:
          name: Run quality validation
          command: npm run validate-ci -- --output-format junit-xml
      - store_test_results:
          path: validation-results.xml
      - store_artifacts:
          path: .enginehaus/validation-results.json
          destination: quality-validation

workflows:
  version: 2
  build-and-validate:
    jobs:
      - build
      - quality-validation:
          requires:
            - build
```

---

## Custom CI Systems

### Using Enginehaus MCP Tools Directly

If you're using a custom CI system or want more control, you can use the Enginehaus MCP tools directly:

```javascript
// validate-ci.js
const { exec } = require('child_process');
const fs = require('fs');

async function runValidation() {
  // Call Enginehaus MCP tool
  const result = await callMCPTool('validate_for_ci', {
    outputFormat: 'json',
    failOnCritical: true
  });

  // Write results to file
  fs.writeFileSync(
    '.enginehaus/validation-results.json',
    JSON.stringify(result, null, 2)
  );

  // Exit with appropriate code
  process.exit(result.exitCode);
}

runValidation().catch(console.error);
```

### Using Shell Scripts

```bash
#!/bin/bash
# validate.sh

set -e

echo "Running Enginehaus quality validation..."

# Set environment
export ENGINEHAUS_STORAGE=sqlite

# Run validation via MCP
npm run validate-ci

# Check results
if [ -f .enginehaus/validation-results.json ]; then
  cat .enginehaus/validation-results.json
  exit 0
else
  echo "Validation failed - no results file"
  exit 1
fi
```

---

## Output Formats

Enginehaus supports three output formats for maximum compatibility:

### 1. GitHub Annotations

Perfect for GitHub Actions:

```bash
npm run validate-ci -- --output-format github-annotations
```

Output:
```
::error file=src/index.ts line=42::Compilation failed: Type error
::warning file=src/utils.ts::Missing documentation
```

### 2. JUnit XML

Compatible with Jenkins, GitLab CI, CircleCI:

```bash
npm run validate-ci -- --output-format junit-xml > results.xml
```

Output:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Enginehaus Quality Validation" tests="3" failures="1" errors="0">
  <testsuite name="Quality Gates" tests="3" failures="1">
    <testcase name="compilation" classname="QualityValidation" time="0">
      <failure message="Compilation failed" type="error">
        Details: Type errors found
      </failure>
    </testcase>
  </testsuite>
</testsuites>
```

### 3. JSON

For custom integrations:

```bash
npm run validate-ci -- --output-format json > results.json
```

Output:
```json
{
  "passed": false,
  "exitCode": 1,
  "summary": "Quality validation failed - 1 critical issues",
  "timestamp": "2025-01-15T12:00:00Z",
  "issues": [
    {
      "file": "src/index.ts",
      "line": 42,
      "severity": "error",
      "message": "Compilation failed",
      "rule": "health-check:compilation"
    }
  ],
  "metrics": {
    "total": 1,
    "critical": 1,
    "errors": 1,
    "warnings": 0
  }
}
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINEHAUS_STORAGE` | `sqlite` | Storage backend (`sqlite` or `json`) |
| `PROJECT_ROOT` | `process.cwd()` | Project root directory |

### Command-Line Options

```bash
npm run validate-ci -- [options]

Options:
  --output-format <format>    Output format (github-annotations, junit-xml, json)
  --fail-on-critical          Exit with error if critical issues found (default: true)
  --task-id <id>              Optional task ID for context-specific validation
```

### Custom Quality Gates

You can define custom quality gates in your Enginehaus configuration:

```javascript
// .enginehaus/config.js
module.exports = {
  quality: {
    requiredGates: [
      'compilation',
      'linting',
      'tests',
      'documentation'
    ],
    healthCheckInterval: 60, // minutes
    failOnHealthCheckFailure: true
  }
};
```

---

## Best Practices

1. **Run on every commit**: Enable quality validation on push and pull requests
2. **Block merges on critical issues**: Use `--fail-on-critical` flag
3. **Archive results**: Keep validation results as artifacts for audit trail
4. **Track metrics over time**: Monitor quality trends across commits
5. **Customize for your workflow**: Adjust thresholds and gates to match your team's needs

---

## Troubleshooting

### Validation fails with "no results file"

Make sure you've built the project first:
```bash
npm run build
npm run validate-ci
```

### Exit code always 0

Ensure you're using the `--fail-on-critical` flag:
```bash
npm run validate-ci -- --fail-on-critical
```

### Database locked errors

If using SQLite with concurrent jobs, ensure each job uses a separate database:
```bash
export ENGINEHAUS_STORAGE=sqlite
export DB_PATH=.enginehaus/data/job-${CI_JOB_ID}.db
```

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/enginehaus/enginehaus/issues
- Documentation: https://enginehaus.dev/docs

---

## License

MIT License - See LICENSE file for details
