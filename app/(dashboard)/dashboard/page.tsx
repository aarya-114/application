import { cookies } from "next/headers";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import SignOutButton from "./sign-out-button";
import RoomManagement from "./room-management";

export default async function DashboardPage() {
  const user = await getSessionUserFromToken(cookies().get(SESSION_COOKIE)?.value);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Quarantine Facility</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Welcome, {user?.name}</h1>
            <p className="mt-2 text-slate-600">Signed in as {user?.role}.</p>
          </div>
          <SignOutButton />
        </div>
        {user?.role === "ADMIN" ? (
          <RoomManagement />
        ) : (
          <p className="mt-8 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            Room management is available to Admin users.
          </p>
        )}
      </section>
    </main>
  );
}
