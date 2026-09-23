import Link from "next/link";
import PatientDetail from "./patient-detail";

export const dynamic = "force-dynamic";

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-4 sm:py-10">
      <section className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 lg:p-8">
        <Link href="/dashboard" className="text-sm font-medium text-teal-800 hover:underline">← Back to dashboard</Link>
        <PatientDetail patientId={params.id} />
      </section>
    </main>
  );
}
