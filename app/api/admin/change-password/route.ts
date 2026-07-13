import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminCredentials, updatePassword, verifyLogin, verifySessionToken, SESSION_COOKIE } from '@/lib/adminAuth';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
  }

  const creds = await ensureAdminCredentials();
  const valid = await verifyLogin(creds.username, body.currentPassword);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  await updatePassword(body.newPassword);
  return NextResponse.json({ ok: true });
}
