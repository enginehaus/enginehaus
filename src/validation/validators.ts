/**
 * Input Validation Utilities for MCP Tools
 *
 * Provides validation and sanitization for MCP tool inputs to prevent:
 * - SQL injection (handled by prepared statements, but belt + suspenders)
 * - Path traversal attacks
 * - Excessive input lengths (DoS prevention)
 * - Type coercion issues
 */

// ============================================================================
// Constants
// ============================================================================

export const LIMITS = {
  // String length limits
  ID_MAX_LENGTH: 100,
  TITLE_MAX_LENGTH: 500,
  DESCRIPTION_MAX_LENGTH: 10000,
  FILE_PATH_MAX_LENGTH: 1000,
  RATIONALE_MAX_LENGTH: 5000,
  SLUG_MAX_LENGTH: 50,
  NAME_MAX_LENGTH: 200,

  // Array limits
  MAX_FILES_PER_TASK: 100,
  MAX_STAKEHOLDERS: 50,
  MAX_TECH_STACK_ITEMS: 50,

  // Numeric limits
  MAX_LIMIT_VALUE: 1000,
  MIN_PRIORITY_VALUE: 0,
  MAX_PRIORITY_VALUE: 100,
} as const;

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: Record<string, unknown>;
}

export interface FieldValidation {
  field: string;
  value: unknown;
  rules: ValidationRule[];
}

export type ValidationRule =
  | { type: 'required' }
  | { type: 'string'; maxLength?: number; minLength?: number }
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'array'; maxItems?: number; itemType?: 'string' }
  | { type: 'id' }
  | { type: 'slug' }
  | { type: 'filePath' };

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Sanitize a string by trimming and removing control characters
 */
export function sanitizeString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return String(value);

  // Trim whitespace and remove control characters (except newlines and tabs)
  return value
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize a file path to prevent path traversal
 */
export function sanitizeFilePath(value: unknown): string | undefined {
  const str = sanitizeString(value);
  if (!str) return undefined;

  // Remove path traversal patterns
  let sanitized = str
    .replace(/\.\.\//g, '')  // ../
    .replace(/\.\.\\/g, '')  // ..\
    .replace(/\.\.$/g, '')   // trailing ..
    .replace(/^\.\./, '');   // leading ..

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  return sanitized;
}

/**
 * Validate and sanitize an ID (UUID or custom format)
 */
export function sanitizeId(value: unknown): string | undefined {
  const str = sanitizeString(value);
  if (!str) return undefined;

  // Allow alphanumeric, hyphens, and underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(str)) {
    return undefined;
  }

  return str.slice(0, LIMITS.ID_MAX_LENGTH);
}

/**
 * Validate and sanitize a slug
 */
export function sanitizeSlug(value: unknown): string | undefined {
  const str = sanitizeString(value);
  if (!str) return undefined;

  // Slugs should be lowercase alphanumeric with hyphens
  const slug = str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug.slice(0, LIMITS.SLUG_MAX_LENGTH);
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a single field against rules
 */
export function validateField(field: string, value: unknown, rules: ValidationRule[]): string[] {
  const errors: string[] = [];

  for (const rule of rules) {
    switch (rule.type) {
      case 'required':
        if (value === undefined || value === null || value === '') {
          errors.push(`${field} is required`);
        }
        break;

      case 'string':
        if (value !== undefined && value !== null) {
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
          } else {
            if (rule.minLength !== undefined && value.length < rule.minLength) {
              errors.push(`${field} must be at least ${rule.minLength} characters`);
            }
            if (rule.maxLength !== undefined && value.length > rule.maxLength) {
              errors.push(`${field} must be at most ${rule.maxLength} characters`);
            }
          }
        }
        break;

      case 'number':
        if (value !== undefined && value !== null) {
          const num = Number(value);
          if (isNaN(num)) {
            errors.push(`${field} must be a number`);
          } else {
            if (rule.min !== undefined && num < rule.min) {
              errors.push(`${field} must be at least ${rule.min}`);
            }
            if (rule.max !== undefined && num > rule.max) {
              errors.push(`${field} must be at most ${rule.max}`);
            }
          }
        }
        break;

      case 'boolean':
        if (value !== undefined && value !== null && typeof value !== 'boolean') {
          errors.push(`${field} must be a boolean`);
        }
        break;

      case 'enum':
        if (value !== undefined && value !== null) {
          if (!rule.values.includes(String(value))) {
            errors.push(`${field} must be one of: ${rule.values.join(', ')}`);
          }
        }
        break;

      case 'array':
        if (value !== undefined && value !== null) {
          if (!Array.isArray(value)) {
            errors.push(`${field} must be an array`);
          } else {
            if (rule.maxItems !== undefined && value.length > rule.maxItems) {
              errors.push(`${field} must have at most ${rule.maxItems} items`);
            }
            if (rule.itemType === 'string') {
              for (let i = 0; i < value.length; i++) {
                if (typeof value[i] !== 'string') {
                  errors.push(`${field}[${i}] must be a string`);
                }
              }
            }
          }
        }
        break;

      case 'id':
        if (value !== undefined && value !== null) {
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
          } else if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            errors.push(`${field} contains invalid characters`);
          } else if (value.length > LIMITS.ID_MAX_LENGTH) {
            errors.push(`${field} is too long`);
          }
        }
        break;

      case 'slug':
        if (value !== undefined && value !== null) {
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
          } else if (!/^[a-z0-9-]+$/.test(value)) {
            errors.push(`${field} must contain only lowercase letters, numbers, and hyphens`);
          } else if (value.length > LIMITS.SLUG_MAX_LENGTH) {
            errors.push(`${field} is too long (max ${LIMITS.SLUG_MAX_LENGTH} characters)`);
          }
        }
        break;

      case 'filePath':
        if (value !== undefined && value !== null) {
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
          } else {
            // Check for path traversal
            if (value.includes('..')) {
              errors.push(`${field} cannot contain path traversal patterns`);
            }
            if (value.length > LIMITS.FILE_PATH_MAX_LENGTH) {
              errors.push(`${field} is too long`);
            }
          }
        }
        break;
    }
  }

  return errors;
}

/**
 * Validate multiple fields
 */
export function validateFields(fields: FieldValidation[]): ValidationResult {
  const errors: string[] = [];

  for (const { field, value, rules } of fields) {
    const fieldErrors = validateField(field, value, rules);
    errors.push(...fieldErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Schema-based Validation
// ============================================================================

export interface ValidationSchema {
  [field: string]: readonly ValidationRule[];
}

/**
 * Validate an object against a schema
 */
export function validateSchema(data: Record<string, unknown>, schema: ValidationSchema): ValidationResult {
  const fields: FieldValidation[] = Object.entries(schema).map(([field, rules]) => ({
    field,
    value: data[field],
    rules: [...rules],  // Convert readonly to mutable
  }));

  return validateFields(fields);
}

// ============================================================================
// Common Schemas for MCP Tools
// ============================================================================

export const SCHEMAS = {
  createTask: {
    title: [
      { type: 'required' } as const,
      { type: 'string', maxLength: LIMITS.TITLE_MAX_LENGTH } as const,
    ],
    description: [
      { type: 'string', maxLength: LIMITS.DESCRIPTION_MAX_LENGTH } as const,
    ],
    priority: [
      { type: 'required' } as const,
      { type: 'enum', values: ['critical', 'high', 'medium', 'low'] as const } as const,
    ],
    projectId: [
      { type: 'id' } as const,
    ],
    files: [
      { type: 'array', maxItems: LIMITS.MAX_FILES_PER_TASK, itemType: 'string' as const } as const,
    ],
  },

  updateTask: {
    taskId: [
      { type: 'required' } as const,
      { type: 'id' } as const,
    ],
    title: [
      { type: 'string', maxLength: LIMITS.TITLE_MAX_LENGTH } as const,
    ],
    description: [
      { type: 'string', maxLength: LIMITS.DESCRIPTION_MAX_LENGTH } as const,
    ],
    priority: [
      { type: 'enum', values: ['critical', 'high', 'medium', 'low'] as const } as const,
    ],
    status: [
      { type: 'enum', values: ['ready', 'in-progress', 'blocked', 'completed'] as const } as const,
    ],
  },

  updateInitiative: {
    initiativeId: [
      { type: 'required' } as const,
      { type: 'id' } as const,
    ],
    title: [
      { type: 'string', maxLength: LIMITS.TITLE_MAX_LENGTH } as const,
    ],
    description: [
      { type: 'string', maxLength: LIMITS.DESCRIPTION_MAX_LENGTH } as const,
    ],
    successCriteria: [
      { type: 'string', maxLength: LIMITS.DESCRIPTION_MAX_LENGTH } as const,
    ],
    status: [
      { type: 'enum', values: ['active', 'succeeded', 'failed', 'pivoted', 'abandoned'] as const } as const,
    ],
    outcomeNotes: [
      { type: 'string', maxLength: LIMITS.DESCRIPTION_MAX_LENGTH } as const,
    ],
    projectId: [
      { type: 'id' } as const,
    ],
  },

  createProject: {
    name: [
      { type: 'required' } as const,
      { type: 'string', maxLength: LIMITS.NAME_MAX_LENGTH } as const,
    ],
    slug: [
      { type: 'required' } as const,
      { type: 'slug' } as const,
    ],
    rootPath: [
      { type: 'required' } as const,
      { type: 'filePath' } as const,
    ],
    domain: [
      { type: 'enum', values: ['web', 'mobile', 'api', 'infrastructure', 'ml', 'other'] as const } as const,
    ],
    techStack: [
      { type: 'array', maxItems: LIMITS.MAX_TECH_STACK_ITEMS, itemType: 'string' as const } as const,
    ],
  },

  logDecision: {
    decision: [
      { type: 'required' } as const,
      { type: 'string', maxLength: LIMITS.TITLE_MAX_LENGTH } as const,
    ],
    rationale: [
      { type: 'string', maxLength: LIMITS.RATIONALE_MAX_LENGTH } as const,
    ],
    impact: [
      { type: 'string', maxLength: LIMITS.RATIONALE_MAX_LENGTH } as const,
    ],
    category: [
      { type: 'enum', values: ['architecture', 'tradeoff', 'dependency', 'pattern', 'other'] as const } as const,
    ],
  },

  queryParams: {
    limit: [
      { type: 'number', min: 1, max: LIMITS.MAX_LIMIT_VALUE } as const,
    ],
    projectId: [
      { type: 'id' } as const,
    ],
    taskId: [
      { type: 'id' } as const,
    ],
  },
} as const;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Quick validation helper that throws on invalid input
 */
export function assertValid(data: Record<string, unknown>, schema: ValidationSchema): void {
  const result = validateSchema(data, schema);
  if (!result.valid) {
    throw new Error(`Validation failed: ${result.errors.join(', ')}`);
  }
}

/**
 * Validate and return sanitized data, or throw
 */
export function validateAndSanitize<T extends Record<string, unknown>>(
  data: T,
  schema: ValidationSchema
): T {
  const result = validateSchema(data, schema);
  if (!result.valid) {
    throw new Error(`Validation failed: ${result.errors.join(', ')}`);
  }

  // Sanitize string fields
  const sanitized: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    }
  }

  return sanitized as T;
}
