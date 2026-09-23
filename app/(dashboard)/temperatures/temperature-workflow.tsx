"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LoadError, Skeleton } from "@/components/ui";

type Reading = {
  id: string;
  value: number;
  recordedAt: string;
  recordedBy: { id: string; name: string };
};

type Patient = {
  id: string;
  name: string;
  room: { number: number } | null;
  readings: Reading[];
};

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TemperatureWorkflow() {
  const [needsTemperature, setNeedsTemperature] = useState<Patient[]>([]);
  const [completedToday, setCompletedToday] = useState<Patient[]>([]);
  const [calendarDate, setCalendarDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [needsResponse, completedResponse] = await Promise.all([
      fetch("/api/patients?filter=needsTemperatureToday", { cache: "no-store" }),
      fetch("/api/patients?filter=completedTemperatureToday", { cache: "no-store" }),
    ]);
    const [needsBody, completedBody] = await Promise.all([
      needsResponse.json(),
      completedResponse.json(),
    ]);
    if (!needsResponse.ok) throw new Error(needsBody.error ?? "Could not load patients.");
    if (!completedResponse.ok) throw new Error(completedBody.error ?? "Could not load today's readings.");
    setNeedsTemperature(needsBody.patients);
    setCompletedToday(completedBody.patients);
    setCalendarDate(needsBody.calendarDate);
    setError("");
  }, []);

  const afterRecorded = useCallback(async (message: string) => {
    setNotice(message);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load patients."))
      .finally(() => setLoading(false));
  }, [refresh]);

  return (
    <div className="mt-8 space-y-9">
      <p className="text-sm text-slate-500">Server calendar date: {calendarDate || "Loading…"} (UTC)</p>
      {error && <LoadError message={error} onRetry={() => { setLoading(true); void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load temperature workflow.")).finally(() => setLoading(false)); }} />}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section aria-labelledby="needs-temperature-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="needs-temperature-heading" className="text-xl font-semibold text-slate-900">Needs today&apos;s temperature</h2>
            <p className="mt-1 text-sm text-slate-600">Active patients without a reading recorded today.</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">{needsTemperature.length}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {loading && Array.from({ length: 2 }, (_, index) => <article key={index} className="rounded-xl border border-slate-200 p-4" role="status" aria-label="Loading patient"><Skeleton className="h-5 w-2/5" /><Skeleton className="mt-3 h-4 w-1/3" /><Skeleton className="mt-5 h-10 w-full" /></article>)}
          {!loading && needsTemperature.map((patient) => (
            <PatientTemperatureCard key={patient.id} patient={patient} onRecorded={afterRecorded} />
          ))}
          {!loading && needsTemperature.length === 0 && (
            <p className="col-span-full rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No patients need a temperature reading today.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="completed-temperature-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="completed-temperature-heading" className="text-xl font-semibold text-slate-900">Completed today</h2>
            <p className="mt-1 text-sm text-slate-600">Patients with one or more readings today. Additional readings are allowed.</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900">{completedToday.length}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {loading && Array.from({ length: 2 }, (_, index) => <article key={index} className="rounded-xl border border-slate-200 p-4" role="status" aria-label="Loading patient"><Skeleton className="h-5 w-2/5" /><Skeleton className="mt-3 h-16 w-full" /><Skeleton className="mt-4 h-10 w-full" /></article>)}
          {!loading && completedToday.map((patient) => (
            <PatientTemperatureCard key={patient.id} patient={patient} onRecorded={afterRecorded} completed />
          ))}
          {!loading && completedToday.length === 0 && (
            <p className="col-span-full rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No patients have completed a temperature reading today.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function PatientTemperatureCard({
  patient,
  onRecorded,
  completed = false,
}: {
  patient: Patient;
  onRecorded: (message: string) => Promise<void>;
  completed?: boolean;
}) {
  const [history, setHistory] = useState<Reading[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (history || historyLoading) return;

    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}/temperature`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load temperature history.");
      setHistory(body.readings);
      setHistoryError("");
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Could not load temperature history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900"><Link href={`/patients/${patient.id}`} className="hover:text-teal-800 hover:underline">{patient.name}</Link></h3>
          <p className="text-sm text-slate-600">{patient.room ? `Room ${patient.room.number}` : "No room assigned"}</p>
        </div>
        {completed && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">{patient.readings.length} reading{patient.readings.length === 1 ? "" : "s"} today</span>}
      </div>

      {completed && (
        <ul className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
          {patient.readings.map((reading) => (
            <li key={reading.id} className="text-sm text-slate-700">
              <span className="font-semibold">{reading.value}°C</span>
              <span> · recorded {formatLocalTime(reading.recordedAt)} by {reading.recordedBy.name}</span>
            </li>
          ))}
        </ul>
      )}

      <TemperatureEntryForm patient={patient} onRecorded={onRecorded} completed={completed} />

      <div className="mt-3 border-t border-slate-100 pt-3">
        <button className="text-sm font-medium text-teal-800 hover:underline" onClick={toggleHistory} type="button">
          {historyLoading ? "Loading history…" : showHistory ? "Hide temperature history" : "Show temperature history"}
        </button>
        {showHistory && historyError && <div className="mt-2"><LoadError message="Unable to load temperature history." onRetry={() => { setHistoryError(""); setHistoryLoading(true); void fetch(`/api/patients/${patient.id}/temperature`, { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load temperature history."); setHistory(body.readings); }).catch((cause: unknown) => setHistoryError(cause instanceof Error ? cause.message : "Unable to load temperature history.")).finally(() => setHistoryLoading(false)); }} /></div>}
        {showHistory && history && !historyError && (
          history.length ? (
            <ol className="mt-3 space-y-2">
              {history.map((reading) => (
                <li key={reading.id} className="text-sm text-slate-600">
                  {reading.value}°C · {formatLocalTime(reading.recordedAt)} · {reading.recordedBy.name}
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 text-sm text-slate-500">No saved temperature readings.</p>
        )}
      </div>
    </article>
  );
}

function TemperatureEntryForm({
  patient,
  onRecorded,
  completed,
}: {
  patient: Patient;
  onRecorded: (message: string) => Promise<void>;
  completed: boolean;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const parsedValue = value.trim() === "" ? null : Number(value);
  const validationError = parsedValue === null
    ? ""
    : !Number.isFinite(parsedValue)
      ? "Temperature must be a finite number."
      : parsedValue < 30 || parsedValue > 45
        ? "Temperature must be between 30 and 45°C."
        : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (parsedValue === null || validationError) {
      setMessage(parsedValue === null ? "Temperature value is required." : validationError);
      setIsError(true);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}/temperature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parsedValue }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not record the temperature.");
      setValue("");
      const successMessage = body.duplicateToday
        ? "Reading saved. Another reading was already recorded today; both readings are kept."
        : "Reading saved.";
      setMessage(successMessage);
      setIsError(false);
      await onRecorded(successMessage);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not record the temperature.");
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-800" htmlFor={`temperature-${patient.id}`}>
        {completed ? "Record another temperature" : "Measured temperature (°C)"}
        <span className="mt-2 flex gap-2">
          <input
            id={`temperature-${patient.id}`}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            type="number"
            min="30"
            max="45"
            step="any"
            value={value}
            onChange={(event) => { setValue(event.target.value); setMessage(""); }}
            required
            disabled={saving}
          />
          <button
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={saving || !value}
          >
            {saving ? "Saving…" : "Record"}
          </button>
        </span>
      </label>
      {message && <p role={isError ? "alert" : "status"} className={`mt-2 text-sm ${isError ? "text-red-700" : "text-emerald-800"}`}>{message}</p>}
      <p className="mt-1 text-xs text-slate-600">Allowed range: 30–45°C</p>
      {validationError && <p className="mt-1 text-sm text-red-700" role="alert">{validationError}</p>}
    </form>
  );
}
