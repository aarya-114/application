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

type TimelineEvent =
  | { kind: "temperature"; at: string; reading: Reading }
  | { kind: "visit"; at: string; visit: Visit }
  | { kind: "shared"; at: string; label: string; detail?: string };

const TIMELINE_MIN_HEIGHT = 400;
const TIMELINE_EVENT_HEIGHT = 68;
const TIMELINE_TIME_PADDING_RATIO = 0.2;

function formatPatientTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function PatientDetail({ patientId }: { patientId: string }) {
  const [data, setData] = useState<PatientDetailData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
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
  const activeDate = journeyDays.some((day) => day.date === selectedDate) ? selectedDate : journeyDays[0]?.date ?? "";
  const activeDay = journeyDays.find((day) => day.date === activeDate);

  return <div className="mt-7 space-y-7">
    <header className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Patient Journey</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">{patient.name}</h1><p className="mt-1 text-sm text-slate-600">{patient.room ? `Room ${patient.room.number}` : "No room assigned"} · Admitted {formatPatientTime(patient.admittedAt)}</p></div><StatusBadge value={patient.status}>{patient.status.replaceAll("_", " ")}</StatusBadge></div>
      <p className="mt-3 text-sm text-slate-700">Current fever-free streak: <strong>{feverFreeStreak.streak} days</strong> · <StatusBadge value={dischargeEligibility.eligible ? "DISCHARGE_ELIGIBLE" : "PENDING"}>{dischargeEligibility.eligible ? "Eligible for discharge review" : "Not eligible"}</StatusBadge></p>
      <p className="mt-1 text-xs text-slate-500">Days follow UTC. Recorded times are shown in your browser&apos;s local time zone.</p>
    </header>

    <section aria-labelledby="journey-days-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><h2 id="journey-days-heading" className="text-lg font-semibold text-slate-900">Day-by-day journey</h2><p className="text-xs text-slate-500">Historical threshold and classification are shown for each reading.</p></div>
      {journeyDays.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No calendar days in the patient journey yet.</p> : <>
        <div role="tablist" aria-label="Patient journey days" className="mb-4 flex max-w-full gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
          {journeyDays.map(({ date, dayNumber }, index) => <button key={date} id={`journey-tab-${date}`} type="button" role="tab" tabIndex={activeDate === date ? 0 : -1} aria-selected={activeDate === date} aria-controls={activeDate === date ? `journey-panel-${date}` : undefined} onClick={() => setSelectedDate(date)} onKeyDown={(event) => {
            const nextIndex = event.key === "ArrowRight" ? Math.min(index + 1, journeyDays.length - 1) : event.key === "ArrowLeft" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? journeyDays.length - 1 : index;
            if (nextIndex !== index) {
              event.preventDefault();
              const nextDate = journeyDays[nextIndex].date;
              setSelectedDate(nextDate);
              document.getElementById(`journey-tab-${nextDate}`)?.focus();
            }
          }} className={`min-w-[6.5rem] shrink-0 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${activeDate === date ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-200" : "text-slate-600 hover:bg-white"}`}><span className="block text-sm font-semibold">Day {dayNumber}</span><span className="mt-0.5 block text-xs">{formatCompactDate(date)}</span></button>)}
        </div>
        {activeDay && <div id={`journey-panel-${activeDay.date}`} role="tabpanel" aria-labelledby={`journey-tab-${activeDay.date}`}>
          {(() => {
            const { date, dayNumber, details, readings, visits } = activeDay;
          const hasFever = details.readings.some((reading) => reading.feverClassification === "FEVER");
          const noThreshold = details.readings.some((reading) => reading.feverClassification === "THRESHOLD_NOT_CONFIGURED");
            const events = buildTimelineEvents(patient, data.auditHistory, readings, visits, date);
            return <>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"><div><h3 className="font-semibold text-slate-900">{formatUtcDate(date)}</h3><p className="text-xs text-slate-500">Day {dayNumber}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{readings.length} temperature reading{readings.length === 1 ? "" : "s"} · {visits.length} doctor visit{visits.length === 1 ? "" : "s"}</span></div>
              <SharedDayTimeline date={date} events={events} readingCount={readings.length} visitCount={visits.length} />
              <section aria-label="Fever-free streak result" className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><h4 className="text-sm font-semibold text-slate-900">Fever-free streak</h4>
                {details.feverFree ? <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700"><span>Fever-free · Streak: {details.streakLength} day{details.streakLength === 1 ? "" : "s"}</span>{details.streakLength >= 3 && <StatusBadge value="DISCHARGE_ELIGIBLE">Discharge eligible</StatusBadge>}</div> : <p className="mt-2 text-sm font-medium text-slate-700">{readings.length === 0 ? "Missing temperature · streak broken" : noThreshold ? "Classification unavailable (threshold not configured) · streak broken" : hasFever ? "Fever detected · streak broken" : "Day does not qualify · streak broken"}</p>}
              </section>
            </>;
          })()}
        </div>}
      </>}
    </section>

    <section aria-labelledby="audit-heading"><h2 id="audit-heading" className="mb-3 text-lg font-semibold text-slate-900">Audit history</h2>
      {data.auditHistory.length ? <ol className="space-y-3">{data.auditHistory.map((event) => <li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full bg-slate-400" /><div><h3 className="font-semibold text-slate-900">{auditAction(event.action).label}</h3><p className="mt-1 text-sm text-slate-600">{auditActorLabel(event.action)} {event.actor.name} <span className="text-slate-500">({event.actor.role})</span></p></div></div><time className="text-sm text-slate-500" dateTime={event.createdAt}>{formatPatientTime(event.createdAt)}</time></div><AuditEventDetails action={event.action} details={event.details} /></li>)}</ol> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No audit activity available.</p>}
    </section>
  </div>;
}

function formatUtcDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}
function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function buildTimelineEvents(
  patient: PatientDetailData["patient"],
  auditHistory: PatientDetailData["auditHistory"],
  readings: Reading[],
  visits: Visit[],
  date: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...readings.map((reading): TimelineEvent => ({ kind: "temperature", at: reading.recordedAt, reading })),
    ...visits.map((visit): TimelineEvent => ({ kind: "visit", at: visit.visitedAt, visit })),
  ];
  if (patient.admittedAt.slice(0, 10) === date) {
    const admission = auditHistory.find((event) => event.action === "PATIENT_ADMITTED");
    const admissionRoomNumber = admission ? auditRoomNumber(admission.details) : null;
    const roomNumber = admissionRoomNumber ?? patient.room?.number;
    events.push({
      kind: "shared",
      at: patient.admittedAt,
      label: "Patient admitted",
      ...(roomNumber === undefined || roomNumber === null ? {} : { detail: `Room ${roomNumber}` }),
    });
  }
  if (patient.dischargedAt?.slice(0, 10) === date) {
    events.push({ kind: "shared", at: patient.dischargedAt, label: "Patient discharged" });
  }
  for (const event of auditHistory) {
    if (event.action !== "ROOM_CHANGED" || event.createdAt.slice(0, 10) !== date) continue;
    events.push({ kind: "shared", at: event.createdAt, label: "Room assignment changed" });
  }
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function SharedDayTimeline({
  date,
  events,
  readingCount,
  visitCount,
}: {
  date: string;
  events: TimelineEvent[];
  readingCount: number;
  visitCount: number;
}) {
  const timestamps = events.map((event) => new Date(event.at).getTime());
  const first = timestamps.length ? Math.min(...timestamps) : 0;
  const last = timestamps.length ? Math.max(...timestamps) : 0;
  const eventSpan = last - first;
  const timePadding = eventSpan > 0 ? eventSpan * TIMELINE_TIME_PADDING_RATIO : 0;
  const timelineHeight = Math.max(TIMELINE_MIN_HEIGHT, events.length * TIMELINE_EVENT_HEIGHT + 60);
  const getY = (event: TimelineEvent) => {
    if (last === first) return timelineHeight / 2;
    const rangeStart = first - timePadding;
    const rangeEnd = last + timePadding;
    return ((new Date(event.at).getTime() - rangeStart) / (rangeEnd - rangeStart)) * timelineHeight;
  };
  const temperature = events.filter((event): event is Extract<TimelineEvent, { kind: "temperature" }> => event.kind === "temperature");
  const visits = events.filter((event): event is Extract<TimelineEvent, { kind: "visit" }> => event.kind === "visit");
  const shared = events.filter((event): event is Extract<TimelineEvent, { kind: "shared" }> => event.kind === "shared");

  return <section aria-label={`Synchronized timeline for ${formatUtcDate(date)}`}>
    <div className="grid grid-cols-2 gap-2 px-1 pb-2 sm:gap-4 sm:px-3">
      <h4 className="text-center text-xs font-semibold uppercase tracking-wide text-teal-800">Temperature</h4>
      <h4 className="text-center text-xs font-semibold uppercase tracking-wide text-indigo-800">Doctor visits</h4>
    </div>
    <div role="region" tabIndex={0} className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700" aria-label="Scrollable day timeline">
      <div className="relative grid grid-cols-2" style={{ height: timelineHeight }}>
        <div aria-hidden="true" className="absolute bottom-0 left-1/4 top-0 border-l-2 border-teal-200" />
        <div aria-hidden="true" className="absolute bottom-0 left-3/4 top-0 border-l-2 border-indigo-200" />
        {readingCount === 0 && <p className="absolute left-0 top-3 z-10 w-1/2 px-2 text-center text-xs text-slate-500 sm:px-4">No temperature readings recorded for this day.</p>}
        {visitCount === 0 && <p className="absolute right-0 top-3 z-10 w-1/2 px-2 text-center text-xs text-slate-500 sm:px-4">No doctor visits recorded for this day.</p>}
        {temperature.map((event) => <TemperatureTimelineMarker key={event.reading.id} event={event} y={getY(event)} placeAbove={getY(event) > timelineHeight - 110} />)}
        {visits.map((event) => <VisitTimelineMarker key={event.visit.id} event={event} y={getY(event)} placeAbove={getY(event) > timelineHeight - 110} />)}
        {shared.map((event, index) => <div key={`${event.label}-${event.at}-${index}`} className="absolute left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs text-slate-700 shadow-sm" style={{ top: getY(event) }}><span className="mb-1 size-2.5 rounded-full bg-slate-500 ring-2 ring-white" aria-hidden="true" /><time className="font-semibold" dateTime={event.at} title={formatPatientTime(event.at)}>{formatPatientClock(event.at)}</time><span className="font-semibold">{event.label}</span>{event.detail && <span>{event.detail}</span>}</div>)}
      </div>
    </div>
  </section>;
}

function auditRoomNumber(details: string): number | null {
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return typeof parsed.roomNumber === "number" ? parsed.roomNumber : null;
  } catch {
    return null;
  }
}

function TemperatureTimelineMarker({ event, y, placeAbove }: { event: Extract<TimelineEvent, { kind: "temperature" }>; y: number; placeAbove: boolean }) {
  const reading = event.reading;
  const classification = reading.feverClassification;
  const classificationLabel = classification === "NO_FEVER" ? "No fever" : classification === "FEVER" ? "Fever" : "Classification unavailable";
  const comparison = reading.applicableThreshold && classification !== "THRESHOLD_NOT_CONFIGURED"
    ? `${reading.value} ${classification === "FEVER" ? "≥" : "<"} ${reading.applicableThreshold.value} °C`
    : "Threshold not configured at reading time";
  return <div className="absolute left-0 z-10 w-1/2 px-1 sm:px-2" style={{ top: y, transform: "translateY(-10px)" }}>
    <span aria-hidden="true" className="absolute left-1/2 top-0 z-20 size-5 -translate-x-1/2 rounded-full border-4 border-white bg-teal-700 shadow ring-1 ring-teal-300" />
    <article className={`mx-auto w-full max-w-[18rem] rounded-lg border border-teal-100 bg-white p-2 text-center text-xs shadow-sm sm:p-3 ${placeAbove ? "absolute bottom-full mb-2" : "mt-5"}`}>
      <time className="block font-semibold text-slate-600" dateTime={reading.recordedAt} title={formatPatientTime(reading.recordedAt)}>{formatPatientClock(reading.recordedAt)}</time>
      <h5 className="mt-0.5 font-semibold leading-tight text-slate-900">Temperature recorded</h5>
      <p className="mt-1 font-semibold text-slate-900">{reading.value} °C <span className="font-medium text-slate-700">· {classificationLabel}</span></p>
      <details className="mt-1 text-left text-slate-600"><summary className="cursor-pointer text-center text-[11px] font-medium text-teal-800">Reading details</summary><dl className="mt-2 space-y-1 border-t border-slate-100 pt-2"><div><dt className="inline">Applicable threshold: </dt><dd className="inline">{reading.applicableThreshold ? `${reading.applicableThreshold.value} °C` : "Not configured"}</dd></div><div><dt className="inline">Comparison: </dt><dd className="inline">{comparison}</dd></div><div><dt className="inline">Recorded by: </dt><dd className="inline">{reading.recordedBy.name} · {reading.recordedBy.role}</dd></div>{reading.note && <div><dt className="inline">Note: </dt><dd className="inline whitespace-pre-wrap">{reading.note}</dd></div>}</dl></details>
    </article>
  </div>;
}

function VisitTimelineMarker({ event, y, placeAbove }: { event: Extract<TimelineEvent, { kind: "visit" }>; y: number; placeAbove: boolean }) {
  const visit = event.visit;
  return <div className="absolute right-0 z-10 w-1/2 px-1 sm:px-2" style={{ top: y, transform: "translateY(-10px)" }}>
    <span aria-hidden="true" className="absolute left-1/2 top-0 z-20 size-5 -translate-x-1/2 rounded-full border-4 border-white bg-indigo-700 shadow ring-1 ring-indigo-300" />
    <article className={`mx-auto w-full max-w-[18rem] rounded-lg border border-indigo-100 bg-white p-2 text-center text-xs shadow-sm sm:p-3 ${placeAbove ? "absolute bottom-full mb-2" : "mt-5"}`}>
      <time className="block font-semibold text-slate-600" dateTime={visit.visitedAt} title={formatPatientTime(visit.visitedAt)}>{formatPatientClock(visit.visitedAt)}</time>
      <h5 className="mt-0.5 font-semibold leading-tight text-slate-900">Doctor visit</h5>
      <p className="mt-1 break-words font-medium text-slate-800">{visit.doctor.name}</p>
      <details className="mt-1 text-left text-slate-600"><summary className="cursor-pointer text-center text-[11px] font-medium text-indigo-800">Visit details</summary><dl className="mt-2 space-y-1 border-t border-slate-100 pt-2"><div><dt className="inline">Doctor: </dt><dd className="inline">{visit.doctor.name} · {visit.doctor.role}</dd></div>{visit.note && <div><dt className="inline">Note: </dt><dd className="inline whitespace-pre-wrap">{visit.note}</dd></div>}</dl></details>
    </article>
  </div>;
}

function formatPatientClock(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function auditAction(action: string) {
  const known: Record<string, string> = {
    PATIENT_ADMITTED: "Patient admitted",
    TEMPERATURE_RECORDED: "Temperature recorded",
    DOCTOR_VISIT_RECORDED: "Doctor visit recorded",
    FEVER_THRESHOLD_CHANGED: "Fever threshold changed",
    PATIENT_DISCHARGED: "Patient discharged",
    ROOM_CHANGED: "Room changed",
  };
  return { label: known[action] ?? action.replaceAll("_", " ") };
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
      if (value !== null) fields.push(["Value", `${value} °C`]);
    } else if (action === "FEVER_THRESHOLD_CHANGED") {
      const previous = number("oldValue");
      const next = number("newValue");
      fields.push(["Previous", previous === null ? "No previous threshold" : `${previous} °C`]);
      if (next !== null) fields.push(["New", `${next} °C`]);
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

