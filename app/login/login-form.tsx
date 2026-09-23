"use client";

import type { UserRole } from "@prisma/client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type DemoUser = { id: string; name: string; role: UserRole };

export default function LoginForm({ users }: { users: DemoUser[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Unable to sign in.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-slate-800" htmlFor="demo-user">
        Demo user
        <select
          id="demo-user"
          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          disabled={users.length === 0 || submitting}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.name} — {user.role}</option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={users.length === 0 || submitting}
      >
        {submitting ? "Signing in…" : "Continue"}
      </button>
      <p className="text-xs leading-5 text-slate-500">This password-free sign-in is intentional for local demo use.</p>
    </form>
  );
}
