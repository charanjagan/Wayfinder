import PlanPicker from '@/components/PlanPicker';
import UploadCard from '@/components/UploadCard';
import { listFloorPlans } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const plans = await listFloorPlans();

  if (plans.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <h1 className="mb-6 text-center text-2xl font-semibold text-slate-800">Office Wayfinder</h1>
          <UploadCard />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">Office Wayfinder</h1>
      <PlanPicker plans={plans} />
      <div className="mt-8 max-w-lg">
        <UploadCard compact />
      </div>
    </main>
  );
}
