/**
 * Server-side checks for the sign-up form. The browser checks too, but a
 * direct POST skips the browser, so the server has the final word.
 */

/** A short list of passwords that show up first in every leaked-password list. */
const COMMON_PASSWORDS = new Set([
  'password', 'passw0rd', 'password123', '12345678', '123456789', '1234567890',
  '87654321', '11111111', '00000000', 'qwerty123', 'qwertyuiop', 'iloveyou',
  'abc12345', 'abcd1234', 'letmein1', 'welcome1', 'sunshine', 'football',
  'baseball', 'princess', 'trustno1', 'superman', 'whatever', 'changeme',
  'admin123', 'qwerty12', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'monkey123',
]);

// One @, something before it, a dotted domain after it, no spaces.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export interface SignupProblem {
  error: string;
  field: 'email' | 'password';
}

export function emailProblem(email: unknown): string | null {
  const value = typeof email === 'string' ? email.trim() : '';
  if (!value) return 'Enter your email address.';
  if (value.length > 254 || !EMAIL_SHAPE.test(value)) return 'Enter a valid email address, like name@company.com.';
  return null;
}

export function passwordProblem(password: unknown): string | null {
  const value = typeof password === 'string' ? password : '';
  if (value.length < 8) return 'Use a password of at least 8 characters.';
  if (value.length > 200) return 'Use a password of 200 characters or fewer.';
  if (new Set(value).size === 1) return 'That password is one character repeated. Pick something harder to guess.';
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return 'That password is one of the most common ones. Pick something harder to guess.';
  return null;
}

/** The first problem with a sign-up, with the field it belongs to, or null when both are fine. */
export function signupInputProblem(email: unknown, password: unknown): SignupProblem | null {
  const e = emailProblem(email);
  if (e) return { error: e, field: 'email' };
  const p = passwordProblem(password);
  if (p) return { error: p, field: 'password' };
  return null;
}
