import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken, ensureAdminCredentials } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect('/admin/login');

  const creds = await ensureAdminCredentials();
  if (creds.mustChangePassword) redirect('/admin/change-password');

  return <>{children}</>;
}
