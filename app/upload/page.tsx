import { redirect } from 'next/navigation';
import UploadCard from '@/components/UploadCard';
import { getCurrentFloorplanId } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const id = await getCurrentFloorplanId();
  if (id) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-800">Office Wayfinder</h1>
        <UploadCard />
      </div>
    </main>
  );
}
