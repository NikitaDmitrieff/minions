/**
 * Shared sanitization utilities for branch names and token redaction.
 */

const SAFE_REF_RE = /^[a-zA-Z0-9._\/-]+$/

/**
 * Validate that a git ref name contains only safe characters.
 * Rejects shell metacharacters that could enable command injection.
 */
export function validateRef(name: string): void {
  if (!name || !SAFE_REF_RE.test(name)) {
    throw new Error(
      `Invalid ref name: "${name}". Only [a-zA-Z0-9._/-] are allowed.`
    )
  }
}

const TOKEN_RE = /x-access-token:[^@]+@/g

/**
 * Redact access tokens from strings before logging or error messages.
 * Replaces `x-access-token:<token>@` patterns.
 */
export function redactToken(str: string): string {
  return str.replace(TOKEN_RE, 'x-access-token:[REDACTED]@')
}
