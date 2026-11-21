/**
 * The persistence layer — the foundation that makes Miles a real product instead
 * of a demo that forgets on refresh (docs/VISION.md §8). Everything user-facing
 * (accounts, sessions, and per-user data) goes through this interface, so the
 * app doesn't care whether it's backed by memory (dev) or Postgres (production).
 */
import type { AggregateRow, DailyRow, Membership } from '../benchmarks/types.js';
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
  /** Update a user's name, password hash, or sign-in email. Throws if the email belongs to another account. */
  updateUser(id: string, patch: { name?: string; passwordHash?: string; email?: string }): Promise<void>;

  createSession(s: AuthSession): Promise<void>;
  getSession(token: string): Promise<AuthSession | null>;
  deleteSession(token: string): Promise<void>;
  /** Sign every device out of one account. Used after a password reset: when the
   *  reset happened because someone else got in, leaving their session alive
   *  would make the reset pointless. */
  deleteSessionsForUser(userId: string): Promise<void>;

  /** Per-user blob (their intake, connected apps, saved research, …). */
  getUserData(userId: string): Promise<Record<string, unknown>>;
  /** Persist the blob. Credit fields from a stale read are merged, not overwritten. Returns what was saved. */
  setUserData(userId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Read and write one account's blob under a lock so two credit edits cannot pass each other. */
  mutateUserData(userId: string, fn: (data: Record<string, unknown>) => void | Promise<void>): Promise<Record<string, unknown>>;
  /** First 100 accounts get the $0 launch offer. Returns false once the cap is full. */
  claimLaunchSlot(userId: string): Promise<boolean>;
  /**
   * The $100 launch credit is granted once per email address, for good. Records
   * the claim for this normalized email and returns true when it is new or
   * already belongs to this account; false when another account (even a
   * deleted one) claimed it. Survives deleteUser on purpose.
   */
  claimLaunchCredit(email: string, userId: string): Promise<boolean>;
  /** All user ids that have stored data — used by the scheduler to find due agents. */
  listUserIds(): Promise<string[]>;
  /** All accounts (for the owner's admin screen), oldest first. */
  listUsers(): Promise<Array<{ id: string; email: string; name?: string; createdAt: string }>>;
  /** Fully remove a user — their sessions, data, account, and benchmark rows. */
  deleteUser(id: string): Promise<void>;

  /** Per-account daily benchmark rows. Internal. Not returned by a public API. */
  upsertBenchmarkDaily(rows: DailyRow[]): Promise<void>;
  /** Drop one account's daily rows. Membership stays so N still counts them. */
  deleteBenchmarkDaily(accountId: string): Promise<void>;
  listBenchmarkDaily(): Promise<DailyRow[]>;
  upsertBenchmarkMembership(row: Membership): Promise<void>;
  listBenchmarkMembership(): Promise<Membership[]>;
  /** Replace the published aggregate table. Rows have no account id. */
  replaceBenchmarkAggregates(rows: AggregateRow[]): Promise<void>;
  listBenchmarkAggregates(): Promise<AggregateRow[]>;
}
