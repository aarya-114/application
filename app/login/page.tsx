import { prisma } from "@/lib/prisma";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const users = await prisma.user.findMany({
    where: { id: { in: ["demo-nurse", "demo-doctor", "demo-admin"] } },
    select: { id: true, name: true, role: true },
    orderBy: { id: "asc" },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Quarantine Facility</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">Choose a demo identity</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Demo sign-in uses a seeded role identity and does not require a password.
        </p>
        <LoginForm users={users} />
        {users.length === 0 && (
          <p className="mt-4 text-sm text-amber-800">No demo users found. Run <code>npx prisma db seed</code>.</p>
        )}
      </section>
    </main>
  );
}
