/**
 * Account recovery — set a new password for an account from the server shell.
 *
 * Passwords are stored as salted scrypt hashes and cannot be read back, so a
 * lockout is recovered by proving you control the server (Render shell access)
 * rather than by retrieving a secret that does not exist.
 *
 *   npm run reset-password -- you@example.com
 *   npm run reset-password -- you@example.com 'a-password-you-chose'
 *
 * With no password argument a strong one is generated and printed once.
 * The reset is recorded in the account's approval log.
 */
import { randomBytes } from 'node:crypto';
import { makeStore } from '../src/db/index.js';
import { hashPassword } from '../src/auth.js';
import { appendApproval } from '../src/agents/approvallog.js';

function strongPassword(): string {
  // 18 chars, unambiguous alphabet (no O/0/I/l) so it can be read off a screen.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_';
  const bytes = randomBytes(18);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const supplied = process.argv[3];
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run reset-password -- <email> [new-password]');
    process.exit(1);
  }
  if (supplied !== undefined && supplied.length < 8) {
    console.error('Choose a password of at least 8 characters (or omit it to have one generated).');
    process.exit(1);
  }

  const store = makeStore();
  await store.init();
  const user = await store.getUserByEmail(email);
  if (!user) {
    const all = await store.listUsers();
    console.error(`No account found for ${email}.`);
    if (all.length) console.error('Accounts on this server:\n  ' + all.map((u) => u.email).join('\n  '));
    process.exit(1);
  }

  const password = supplied ?? strongPassword();
  await store.updateUser(user.id, { passwordHash: hashPassword(password) });

  // Leave a trace: a password reset is exactly the kind of event the log exists for.
  try {
    const data = await store.getUserData(user.id);
    appendApproval(data, {
      id: randomBytes(5).toString('hex'),
      ts: new Date().toISOString(),
      kind: 'action',
      actor: 'server-shell',
      source: 'reset-password',
      title: `Password reset from the server shell for ${email}`,
    });
    await store.setUserData(user.id, data);
  } catch {
    /* the reset itself succeeded — logging is best-effort */
  }

  console.log(`\n  Password reset for ${email}`);
  if (!supplied) console.log(`  New password: ${password}`);
  console.log('\n  Sign in, then change it in Settings. This is the only time it is shown.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('Reset failed:', (e as Error).message);
  process.exit(1);
});
