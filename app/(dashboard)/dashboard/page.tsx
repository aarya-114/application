import { cookies } from "next/headers";
import Link from "next/link";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import SignOutButton from "./sign-out-button";
import DashboardOverview from "./dashboard-overview";
import AdminDashboard from "./admin-dashboard";

export default async function DashboardPage() {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 sm:px-4 sm:py-10">
      <section className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Quarantine Facility</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{user?.role === "ADMIN" ? "ADMIN DASHBOARD" : `Welcome, ${user?.name}`}</h1>
            <p className="mt-2 text-slate-600">{user?.role === "ADMIN" ? `Virus Treatment Facility · Signed in as ${user?.role}.` : `Signed in as ${user?.role}.`}</p>
          </div>
          <SignOutButton />
        </div>
        {user?.role === "DOCTOR" && (
          <Link
            className="mt-6 inline-flex rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50"
            href="/settings/fever-threshold"
          >
            Fever threshold settings
          </Link>
        )}
        {user?.role === "NURSE" && (
          <Link
            className="mt-6 inline-flex rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 sm:ml-3"
            href="/temperatures"
          >
            Nurse temperature workflow
          </Link>
        )}
        {user?.role === "DOCTOR" && (
          <Link
            className="mt-6 inline-flex rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 sm:ml-3"
            href="/doctor"
          >
            Doctor patient review
          </Link>
        )}
        {user?.role === "ADMIN" ? <AdminDashboard /> : <DashboardOverview role={user?.role ?? null} />}
        {user?.role === "ADMIN" && <Link className="mt-6 inline-flex rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50" href="/settings/fever-threshold">Fever threshold settings</Link>}
      </section>
    </main>
  );
}
