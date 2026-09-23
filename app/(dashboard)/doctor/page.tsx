import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import DoctorReviewWorkflow from "./doctor-review-workflow";

export const dynamic = "force-dynamic";

export default async function DoctorPage() {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);
  if (user?.role !== "DOCTOR") redirect("/dashboard");

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-4 sm:py-10">
      <section className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 lg:p-8">
        <Link href="/dashboard" className="text-sm font-medium text-teal-800 hover:underline">
          ← Back to dashboard
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Doctor workflow</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Patient review and visits</h1>
        <p className="mt-2 text-xs text-slate-500">Workflow dates use UTC; timestamps use your browser&apos;s local time zone.</p>
        <DoctorReviewWorkflow />
      </section>
    </main>
  );
}
