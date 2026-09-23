"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LoadError, Skeleton, StatusBadge } from "@/components/ui";

type Visit = {
  id: string;
  visitedAt: string;
  doctor: { id: string; name: string };
};

type ReviewPatient = {
  id: string;
  name: string;
  room: { number: number } | null;
  todayTemperature: { value: number; recordedAt: string } | null;
  feverClassification: "FEVER" | "NO_FEVER" | "NOT_RECORDED" | "THRESHOLD_NOT_CONFIGURED";
  feverFreeStreakDays: number | null;
  visitStatus: "VISIT_PENDING" | "VISITED_TODAY";
  todayVisits: Visit[];
};

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function DoctorReviewWorkflow() {
  const [pending, setPending] = useState<ReviewPatient[]>([]);
  const [visited, setVisited] = useState<ReviewPatient[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [calendarDate, setCalendarDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeIsWarning, setNoticeIsWarning] = useState(false);

  const refresh = useCallback(async () => {
    const [pendingResponse, visitedResponse] = await Promise.all([
      fetch("/api/patients?filter=needsVisitToday", { cache: "no-store" }),
      fetch("/api/patients?filter=completedVisitToday", { cache: "no-store" }),
    ]);
    const [pendingBody, visitedBody] = await Promise.all([
      pendingResponse.json(),
      visitedResponse.json(),
    ]);
    if (!pendingResponse.ok) throw new Error(pendingBody.error ?? "Could not load patients.");
    if (!visitedResponse.ok) throw new Error(visitedBody.error ?? "Could not load visit status.");
    setPending(pendingBody.patients);
    setVisited(visitedBody.patients);
    setThreshold(pendingBody.currentThreshold?.value ?? null);
    setCalendarDate(pendingBody.calendarDate);
    setError("");
  }, []);

  useEffect(() => {
    refresh()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load patients."))
      .finally(() => setLoading(false));
  }, [refresh]);

  const afterVisit = useCallback(async (message: string, warning: boolean) => {
    setNotice(message);
    setNoticeIsWarning(warning);
    await refresh();
  }, [refresh]);

  return (
    <div className="mt-8 space-y-9">
      <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
        <span>Server calendar date: {calendarDate || "Loading…"} (UTC)</span>
        <span>Current fever threshold: {threshold === null ? "Not configured" : `${threshold}°C`}</span>
      </div>
      {error && <LoadError message={error} onRetry={() => { setLoading(true); void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load doctor workflow.")).finally(() => setLoading(false)); }} />}
      {notice && (
        <p role={noticeIsWarning ? "alert" : "status"} className={`rounded-lg border-2 p-4 font-medium ${noticeIsWarning ? "border-amber-500 bg-amber-50 text-amber-950" : "border-emerald-500 bg-emerald-50 text-emerald-900"}`}>
          {notice}
        </p>
      )}

      <PatientReviewList
        heading="Visits pending today"
        description="Active patients without a doctor visit recorded today."
        patients={pending}
        emptyMessage="No doctor visits are pending today."
        loading={loading}
        onVisit={afterVisit}
      />
      <PatientReviewList
        heading="Visited today"
        description="Today's visits are retained here; another visit can also be recorded."
        patients={visited}
        emptyMessage="No visits have been recorded today."
        loading={loading}
        onVisit={afterVisit}
      />
    </div>
  );
}

function PatientReviewList({
  heading,
  description,
  patients,
  emptyMessage,
  loading,
  onVisit,
}: {
  heading: string;
  description: string;
  patients: ReviewPatient[];
  emptyMessage: string;
  loading: boolean;
  onVisit: (message: string, warning: boolean) => Promise<void>;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{heading}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">{patients.length}</span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {loading && Array.from({ length: 2 }, (_, index) => <article key={index} className="rounded-xl border border-slate-200 p-5" role="status" aria-label="Loading patient"><Skeleton className="h-5 w-2/5" /><Skeleton className="mt-3 h-4 w-1/3" /><Skeleton className="mt-5 h-16 w-full" /><Skeleton className="mt-4 h-10 w-full" /></article>)}
        {!loading && patients.map((patient) => (
          <PatientReviewCard key={patient.id} patient={patient} onVisit={onVisit} />
        ))}
        {!loading && patients.length === 0 && (
          <p className="col-span-full rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
}

function PatientReviewCard({
  patient,
  onVisit,
}: {
  patient: ReviewPatient;
  onVisit: (message: string, warning: boolean) => Promise<void>;
}) {
  const missingTemperature = patient.todayTemperature === null;
  const classificationLabel = {
    FEVER: "Fever",
    NO_FEVER: "No fever",
    NOT_RECORDED: "Not yet recorded",
    THRESHOLD_NOT_CONFIGURED: "Threshold not configured",
  }[patient.feverClassification];

  return (
    <article className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900"><Link href={`/patients/${patient.id}`} className="hover:text-teal-800 hover:underline">{patient.name}</Link></h3>
          <p className="text-sm text-slate-600">ID {patient.id} · {patient.room ? `Room ${patient.room.number}` : "No room assigned"}</p>
        </div>
        <StatusBadge value={patient.visitStatus}>
          {patient.visitStatus === "VISITED_TODAY" ? "Visited today" : "Visit pending"}
        </StatusBadge>
      </div>

      {missingTemperature ? (
        <p role="status" className="mt-4 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 font-semibold text-amber-950">
          Temperature not yet recorded today. The visit is still allowed; follow up on the missing measurement.
        </p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-slate-500">Today&apos;s latest temperature</dt>
            <dd className="mt-1 font-semibold text-slate-900">{patient.todayTemperature?.value}°C</dd>
            <dd className="text-xs text-slate-500">{formatLocalTime(patient.todayTemperature!.recordedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Classification</dt>
            <dd className="mt-1"><StatusBadge value={patient.feverClassification}>{classificationLabel}</StatusBadge></dd>
            <dd className="text-xs text-slate-500">Based on current threshold</dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-sm text-slate-700">
        Current fever-free streak: {patient.feverFreeStreakDays === null
          ? "unavailable until a threshold is configured"
          : `${patient.feverFreeStreakDays} day${patient.feverFreeStreakDays === 1 ? "" : "s"}`}
      </p>

      {patient.todayVisits.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {patient.todayVisits.map((visit) => (
            <li key={visit.id}>Visited {formatLocalTime(visit.visitedAt)} by {visit.doctor.name}</li>
          ))}
        </ul>
      )}

      <VisitForm patient={patient} duplicateAllowed={patient.visitStatus === "VISITED_TODAY"} onVisit={onVisit} />
    </article>
  );
}

function VisitForm({
  patient,
  duplicateAllowed,
  onVisit,
}: {
  patient: ReviewPatient;
  duplicateAllowed: boolean;
  onVisit: (message: string, warning: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not record the visit.");
      const messages = ["Doctor visit recorded."];
      if (body.duplicateToday) messages.push("Another visit was already recorded today; both visits are kept.");
      if (body.warning) messages.push(body.warning);
      await onVisit(messages.join(" "), Boolean(body.warning));
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the visit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4 border-t border-slate-100 pt-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-800" htmlFor={`visit-note-${patient.id}`}>
        Optional visit note
        <textarea
          id={`visit-note-${patient.id}`}
          className="mt-2 block min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={saving}
        />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <button
        className="mt-3 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={saving}
      >
        {saving ? "Saving…" : duplicateAllowed ? "Record another visit" : "Record doctor visit"}
      </button>
    </form>
  );
}
