/**
 * Safe JSON parsing utilities.
 *
 * Prevents runtime crashes from corrupted/null database fields
 * or unexpected input to deserialization paths.
 */

/**
 * Safely parse a JSON string, returning a fallback value on failure.
 *
 * Handles: null, undefined, empty string, and malformed JSON.
 *
 * @param text - The string to parse (may be null/undefined)
 * @param fallback - Value to return if parsing fails
 * @returns Parsed value or fallback
 */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
