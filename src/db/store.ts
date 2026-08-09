/**
 * The persistence layer — the foundation that makes Miles a real product instead
 * of a demo that forgets on refresh (docs/VISION.md §8). Everything user-facing
 * (accounts, sessions, and per-user data) goes through this interface, so the
 * app doesn't care whether it's backed by memory (dev) or Postgres (production).
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  passwordHash: string; // scrypt: salt:hash
  createdAt: string;
}

export interface AuthSession {
  token: string;
  userId: string;
  expiresAt: number; // epoch ms
}

export interface Store {
  readonly name: string;
  init(): Promise<void>;

  createUser(u: User): Promise<void>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;

  createSession(s: AuthSession): Promise<void>;
  getSession(token: string): Promise<AuthSession | null>;
  deleteSession(token: string): Promise<void>;

  /** Per-user blob (their intake, connected apps, saved research, …). */
  getUserData(userId: string): Promise<Record<string, unknown>>;
  setUserData(userId: string, data: Record<string, unknown>): Promise<void>;
}
