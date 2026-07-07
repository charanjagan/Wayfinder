import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { DATA_DIR } from './storage';

const CREDENTIALS_PATH = path.join(DATA_DIR, 'admin-credentials.json');
export const SESSION_COOKIE = 'wf_admin_session';
// Deliberately short + a browser-session cookie (no persistent Max-Age, see login route):
// admin should have to re-enter the password every time, not stay logged in for days.
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export interface AdminCredentials {
  username: string;
  passwordHash: string;
  mustChangePassword: boolean;
  sessionSecret: string;
}

function generatePassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export async function ensureAdminCredentials(): Promise<AdminCredentials> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(raw) as AdminCredentials;
  } catch {
    const password = generatePassword();
    const creds: AdminCredentials = {
      username: 'admin',
      passwordHash: bcrypt.hashSync(password, 10),
      mustChangePassword: true,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
    };
    await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
    // eslint-disable-next-line no-console
    console.log('\n========================================');
    console.log(' Admin account created');
    console.log(` Username: ${creds.username}`);
    console.log(` Password: ${password}`);
    console.log(' You will be required to change this password on first login.');
    console.log('========================================\n');
    return creds;
  }
}

export async function verifyLogin(username: string, password: string): Promise<AdminCredentials | null> {
  const creds = await ensureAdminCredentials();
  if (username !== creds.username) return null;
  return bcrypt.compareSync(password, creds.passwordHash) ? creds : null;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const creds = await ensureAdminCredentials();
  creds.passwordHash = bcrypt.hashSync(newPassword, 10);
  creds.mustChangePassword = false;
  await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

export interface SessionPayload {
  username: string;
  exp: number;
}

export function signSession(secret: string, payload: SessionPayload): string {
  const payloadStr = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(crypto.createHmac('sha256', secret).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

export function verifySession(secret: string, token: string): SessionPayload | null {
  const [payloadStr, sig] = token.split('.');
  if (!payloadStr || !sig) return null;

  const expectedSig = base64url(crypto.createHmac('sha256', secret).update(payloadStr).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSessionToken(username: string): Promise<string> {
  const creds = await ensureAdminCredentials();
  return signSession(creds.sessionSecret, { username, exp: Date.now() + SESSION_MAX_AGE_MS });
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const creds = await ensureAdminCredentials();
  return verifySession(creds.sessionSecret, token);
}
