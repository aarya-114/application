import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import TemperatureWorkflow from "./temperature-workflow";

export const dynamic = "force-dynamic";

export default async function TemperaturesPage() {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-4 sm:py-10">
      <section className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 lg:p-8">
        <Link href="/dashboard" className="text-sm font-medium text-teal-800 hover:underline">
          ← Back to dashboard
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Nurse workflow</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Daily temperatures</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Record the measured temperature. Readings are shown as recorded, without a clinical classification. Workflow dates use UTC; timestamps use your browser&apos;s local time zone.
        </p>
        {user?.role === "NURSE" ? (
          <TemperatureWorkflow />
        ) : (
          <p className="mt-8 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Temperature recording is available to Nurse users.
          </p>
        )}
      </section>
    </main>
  );
}
