"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeletons, LoadError, Skeleton, StatusBadge } from "@/components/ui";

type Threshold = { id: string; value: number; effectiveFrom: string } | null;
type Reading = {
  id: string;
  value: number;
  recordedAt: string;
  note: string | null;
  recordedBy: { id: string; name: string; role: string };
  applicableThreshold: Threshold;
  feverClassification: "FEVER" | "NO_FEVER" | "THRESHOLD_NOT_CONFIGURED";
};
type StreakReading = {
  id: string;
  value: number;
  recordedAt: string;
  applicableThreshold: Threshold;
  feverClassification?: "FEVER" | "NO_FEVER" | "THRESHOLD_NOT_CONFIGURED";
};
type PatientDetailData = {
  patient: {
    id: string;
    name: string;
    room: { id: string; number: number } | null;
    admittedAt: string;
    status: string;
    outcome: string;
    dischargedAt: string | null;
  };
  temperatureHistory: Reading[];
  feverFreeStreak: {
    streak: number;
    eligible: boolean;
    days: Array<{ date: string; hasReadings: boolean; readings: StreakReading[]; feverFree: boolean; reason: string; streakLength: number }>;
  };
  today: {
    temperature: { recorded: boolean; readings: Reading[] };
    visit: { completed: boolean; visits: Visit[] };
  };
  dischargeEligibility: { eligible: boolean; streak: number; reason: string };
  doctorVisits: Visit[];
  auditHistory: Array<{
    id: string;
    action: string;
    details: string;
    createdAt: string;
    actor: { id: string; name: string; role: string };
  }>;
};
type Visit = {
  id: string;
  visitedAt: string;
  note: string | null;
  doctor: { id: string; name: string; role: string };
};

function formatPatientTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function PatientDetail({ patientId }: { patientId: string }) {
  const [data, setData] = useState<PatientDetailData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load patient details.");
      setData(body as PatientDetailData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load patient details."); }
    finally { setLoading(false); }
  }, [patientId]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (error) return <div className="mt-6"><LoadError message={error} onRetry={() => void refresh()} /></div>;
  if (loading || !data) return <div className="mt-6 space-y-6" role="status" aria-label="Loading patient record"><div className="rounded-xl border border-slate-200 p-5"><Skeleton className="h-7 w-2/5" /><Skeleton className="mt-3 h-4 w-1/3" /></div><CardSkeletons count={2} /><Skeleton className="h-48 w-full" /><span className="sr-only">Loading patient details…</span></div>;

  const { patient, feverFreeStreak, dischargeEligibility } = data;
  const dayInfo = new Map(feverFreeStreak.days.map((day) => [day.date, day]));
  const readingsByDay = new Map<string, Reading[]>();
  for (const reading of data.temperatureHistory) {
    const key = new Date(reading.recordedAt).toISOString().slice(0, 10);
    const entries = readingsByDay.get(key) ?? [];
    entries.push(reading);
    readingsByDay.set(key, entries);
  }
  const visitsByDay = new Map<string, Visit[]>();
  for (const visit of data.doctorVisits) {
    const key = new Date(visit.visitedAt).toISOString().slice(0, 10);
    const entries = visitsByDay.get(key) ?? [];
    entries.push(visit);
    visitsByDay.set(key, entries);
  }
  const start = new Date(patient.admittedAt);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const today = new Date();
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const calendar: string[] = [];
  while (cursor <= lastDay) {
    calendar.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const journeyDays = calendar.map((date, index) => ({
    date,
    dayNumber: index + 1,
    details: dayInfo.get(date) ?? { date, hasReadings: false, readings: [], feverFree: false, reason: "No temperature readings were recorded on this day.", streakLength: 0 },
    readings: readingsByDay.get(date) ?? [],
    visits: visitsByDay.get(date) ?? [],
  }));

  return <div className="mt-7 space-y-7">
    <header className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Patient Journey</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">{patient.name}</h1><p className="mt-1 text-sm text-slate-600">{patient.room ? `Room ${patient.room.number}` : "No room assigned"} · Admitted {formatPatientTime(patient.admittedAt)}</p></div><StatusBadge value={patient.status}>{patient.status.replaceAll("_", " ")}</StatusBadge></div>
      <p className="mt-3 text-sm text-slate-700">Current fever-free streak: <strong>{feverFreeStreak.streak} days</strong> · <StatusBadge value={dischargeEligibility.eligible ? "DISCHARGE_ELIGIBLE" : "PENDING"}>{dischargeEligibility.eligible ? "Eligible for discharge review" : "Not eligible"}</StatusBadge></p>
      <p className="mt-1 text-xs text-slate-500">Days follow UTC. Recorded times are shown in your browser&apos;s local time zone.</p>
    </header>

    <section aria-labelledby="journey-days-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><h2 id="journey-days-heading" className="text-lg font-semibold text-slate-900">Day-by-day journey</h2><p className="text-xs text-slate-500">Historical threshold and classification are shown for each reading.</p></div>
      {journeyDays.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No calendar days in the patient journey yet.</p> : <ol className="relative space-y-4 border-l-2 border-slate-200 pl-4 sm:pl-6">
        {journeyDays.map(({ date, dayNumber, details, readings, visits }) => {
          const hasFever = details.readings.some((reading) => reading.feverClassification === "FEVER");
          const noThreshold = details.readings.some((reading) => reading.feverClassification === "THRESHOLD_NOT_CONFIGURED");
          return <li key={date} className="relative">
            <span aria-hidden="true" className="absolute -left-[1.43rem] top-5 size-3 rounded-full border-2 border-white bg-teal-700 sm:-left-[1.93rem]" />
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3"><div><h3 className="font-semibold text-slate-900">{formatUtcDate(date)}</h3><p className="text-xs text-slate-500">Day {dayNumber}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{readings.length} temperature reading{readings.length === 1 ? "" : "s"} · {visits.length} doctor visit{visits.length === 1 ? "" : "s"}</span></div>
              <section className="pt-3" aria-label="Temperature readings"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">🌡 Temperature</h4>
                {readings.length === 0 ? <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-medium text-slate-700">— No temperature recorded. This is missing data, not fever.</p> : <ul className="mt-2 space-y-2">{readings.map((reading) => {
                  const classification = reading.feverClassification;
                  const comparison = reading.applicableThreshold && classification !== "THRESHOLD_NOT_CONFIGURED" ? `${reading.value} ${classification === "FEVER" ? "≥" : "<"} ${reading.applicableThreshold.value} °C` : "Threshold not configured at reading time";
                  return <li key={reading.id} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-base text-slate-900">{reading.value}°C</strong><StatusBadge value={classification}>{classification === "NO_FEVER" ? "✓ No fever" : classification === "FEVER" ? "✕ Fever" : "Classification unavailable"}</StatusBadge></div><dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2"><div><dt className="inline">Applicable threshold: </dt><dd className="inline">{reading.applicableThreshold ? `${reading.applicableThreshold.value}°C` : "Not configured"}</dd></div><div><dt className="inline">Comparison: </dt><dd className="inline">{comparison}</dd></div><div><dt className="inline">Recorded by: </dt><dd className="inline">{reading.recordedBy.name} · {reading.recordedBy.role}</dd></div><div><dt className="inline">Recorded: </dt><dd className="inline">{formatPatientTime(reading.recordedAt)}</dd></div></dl>{reading.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">Note: {reading.note}</p>}</li>;
                })}</ul>}
              </section>
              <section className="mt-4 border-t border-slate-100 pt-3" aria-label="Doctor visits"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">🩺 Doctor visit</h4>
                {visits.length === 0 ? <p className="mt-2 text-sm text-slate-600">⚠ Not visited</p> : <ul className="mt-2 space-y-2">{visits.map((visit) => <li key={visit.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium text-slate-900">✓ Visited · {visit.doctor.name} · {formatPatientTime(visit.visitedAt)}</p>{visit.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{visit.note}</p>}</li>)}</ul>}
                {visits.length > 0 && readings.length === 0 && <p className="mt-2 text-xs text-amber-800">Visit recorded without a temperature reading.</p>}
              </section>
              <section className="mt-4 border-t border-slate-100 pt-3" aria-label="Fever-free streak result"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">🔥 Fever-free streak</h4>
                {details.feverFree ? <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span>✓ Fever-free · Streak: {details.streakLength} day{details.streakLength === 1 ? "" : "s"}</span>{details.streakLength >= 3 && <StatusBadge value="DISCHARGE_ELIGIBLE">✓ DISCHARGE ELIGIBLE</StatusBadge>}</div> : <p className="mt-2 text-sm font-medium text-slate-700">{readings.length === 0 ? "— Missing temperature · streak broken" : noThreshold ? "Classification unavailable (threshold not configured) · streak broken" : hasFever ? "✕ Fever detected · streak broken" : "— Day does not qualify · streak broken"}</p>}
              </section>
            </article>
          </li>;
        })}
      </ol>}
    </section>

    <section aria-labelledby="audit-heading"><h2 id="audit-heading" className="mb-3 text-lg font-semibold text-slate-900">Audit history</h2>
      {data.auditHistory.length ? <ol className="space-y-3">{data.auditHistory.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span aria-hidden="true" className="text-xl">{auditAction(event.action).icon}</span><div><h3 className="font-semibold text-slate-900">{auditAction(event.action).label}</h3><p className="mt-1 text-sm text-slate-600">{auditActorLabel(event.action)} {event.actor.name} <span className="text-slate-500">({event.actor.role})</span></p></div></div><time className="text-sm text-slate-500" dateTime={event.createdAt}>{formatPatientTime(event.createdAt)}</time></div><AuditEventDetails action={event.action} details={event.details} /></li>)}</ol> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No audit activity available.</p>}
    </section>
  </div>;
}

function formatUtcDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}
function auditAction(action: string) {
  const known: Record<string, { icon: string; label: string }> = {
    PATIENT_ADMITTED: { icon: "ðŸ¥", label: "Patient admitted" },
    TEMPERATURE_RECORDED: { icon: "ðŸŒ¡ï¸", label: "Temperature recorded" },
    DOCTOR_VISIT_RECORDED: { icon: "ðŸ©º", label: "Doctor visit recorded" },
    FEVER_THRESHOLD_CHANGED: { icon: "ðŸŒ¡ï¸", label: "Fever threshold changed" },
    PATIENT_DISCHARGED: { icon: "ðŸ“‹", label: "Patient discharged" },
    ROOM_CHANGED: { icon: "ðŸ›ï¸", label: "Room changed" },
  };
  return known[action] ?? { icon: "â€¢", label: action.replaceAll("_", " ") };
}

function auditActorLabel(action: string) {
  if (action === "TEMPERATURE_RECORDED") return "Recorded by";
  if (action === "DOCTOR_VISIT_RECORDED") return "Visited by";
  if (action === "FEVER_THRESHOLD_CHANGED") return "Changed by";
  return "By";
}

function auditFields(action: string, details: string): Array<[string, string]> {
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    const fields: Array<[string, string]> = [];
    const number = (key: string) => typeof parsed[key] === "number" ? parsed[key] as number : null;
    if (action === "TEMPERATURE_RECORDED") {
      const value = number("value");
      if (value !== null) fields.push(["Value", `${value}Â°C`]);
    } else if (action === "FEVER_THRESHOLD_CHANGED") {
      const previous = number("oldValue");
      const next = number("newValue");
      fields.push(["Previous", previous === null ? "No previous threshold" : `${previous}Â°C`]);
      if (next !== null) fields.push(["New", `${next}Â°C`]);
    } else if (action === "PATIENT_ADMITTED") {
      const roomNumber = number("roomNumber");
      if (roomNumber !== null) fields.push(["Room", `Room ${roomNumber}`]);
    } else if (action === "PATIENT_DISCHARGED") {
      if (typeof parsed.outcome === "string") fields.push(["Outcome", parsed.outcome]);
      const streak = number("feverFreeStreakDays");
      if (streak !== null) fields.push(["Fever-free streak", `${streak} day(s)`]);
      if (typeof parsed.releasedRoomId === "string") fields.push(["Released room", parsed.releasedRoomId]);
    } else if (action === "ROOM_CHANGED") {
      if (typeof parsed.previousRoomId === "string") fields.push(["Previous room", parsed.previousRoomId]);
      if (typeof parsed.newRoomId === "string") fields.push(["New room", parsed.newRoomId]);
    }
    return fields;
  } catch {
    return [];
  }
}

function AuditEventDetails({ action, details }: { action: string; details: string }) {
  const fields = auditFields(action, details);
  if (!fields.length) return null;
  return <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 font-medium text-slate-800">{value}</dd></div>)}</dl>;
}

