import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import FeverThresholdSettings from "./settings-panel";

export const dynamic = "force-dynamic";

export default async function FeverThresholdSettingsPage() {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-4 sm:py-10">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 lg:p-8">
        <Link href="/dashboard" className="text-sm font-medium text-teal-800 hover:underline">
          ← Back to dashboard
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Clinical settings</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Fever threshold</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          The assessment does not specify a numeric fever threshold. This prototype uses a configurable default of 38.0°C as an implementation assumption.
        </p>
        <FeverThresholdSettings canEdit={user?.role === "DOCTOR"} />
      </section>
    </main>
  );
}
