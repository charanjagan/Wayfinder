import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, verifyLogin, SESSION_COOKIE } from '@/lib/adminAuth';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { username?: string; password?: string };
  if (!body.username || !body.password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }

  const creds = await verifyLogin(body.username, body.password);
  if (!creds) {
    return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
  }

  const token = await createSessionToken(creds.username);
  const res = NextResponse.json({ ok: true, mustChangePassword: creds.mustChangePassword });
  // No maxAge -- browser-session cookie only. Closing the browser (or the token's own
  // short server-side expiry) always requires the password again, per explicit request:
  // admin should never stay silently logged in.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
