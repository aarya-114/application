"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CardSkeletons, LoadError, Skeleton, ConfirmDialog, StatusBadge } from "@/components/ui";

type Room = {
  id: string;
  number: number;
  status: "OCCUPIED" | "AVAILABLE";
  patient: { id: string; name: string } | null;
};
type CurrentPatient = { id: string; name: string; status: string; admittedAt: string; today: { temperature: { recorded: boolean }; visit: { completed: boolean } } };

function formatRoomTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function RoomManagement({ mode = "rooms", admitRequest = 0 }: { mode?: "rooms" | "dischargeReview"; admitRequest?: number }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roomLoadError, setRoomLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<CurrentPatient | null>(null);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState("");
  const [patientLoadAttempt, setPatientLoadAttempt] = useState(0);

  const refreshRooms = useCallback(async () => {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load rooms.");
    const nextRooms = body.rooms as Room[];
    setRooms(nextRooms);
    setRoomLoadError("");
    setRoomId((current) =>
      nextRooms.some((room) => room.id === current && room.status === "AVAILABLE")
        ? current
        : nextRooms.find((room) => room.status === "AVAILABLE")?.id ?? "",
    );
  }, []);

  useEffect(() => {
    refreshRooms()
      .catch((error: unknown) => {
        setRoomLoadError(error instanceof Error ? error.message : "Unable to load rooms.");
      })
      .finally(() => setLoading(false));
  }, [refreshRooms]);

  useEffect(() => {
    if (!admitRequest) return;
    const timer = window.setTimeout(() => {
      document.getElementById("patient-name")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("patient-name")?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [admitRequest]);

  useEffect(() => {
    const patientId = selectedRoom?.patient?.id;
    if (!patientId) {
      setSelectedPatient(null);
      setPatientLoadError("");
      setPatientLoading(false);
      return;
    }
    let current = true;
    setSelectedPatient(null);
    setPatientLoadError("");
    setPatientLoading(true);
    fetch(`/api/patients/${patientId}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load the current patient.");
        if (current) setSelectedPatient(body.patient as CurrentPatient);
      })
      .catch((cause: unknown) => {
        if (current) setPatientLoadError(cause instanceof Error ? cause.message : "Unable to load the current patient.");
      })
      .finally(() => { if (current) setPatientLoading(false); });
    return () => { current = false; };
  }, [selectedRoom?.patient?.id, patientLoadAttempt]);

  async function admitPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, roomId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not admit the patient.");
      setName("");
      setSelectedRoom(null);
      setMessage(`${body.patient.name} was admitted to room ${rooms.find((room) => room.id === roomId)?.number ?? ""}.`);
      setMessageIsError(false);
      await refreshRooms();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not admit the patient.");
      setMessageIsError(true);
      await refreshRooms().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  const availableRooms = rooms.filter((room) => room.status === "AVAILABLE");
  const occupiedRooms = rooms.filter((room) => room.status === "OCCUPIED");

  return (
    <div className="mt-6 space-y-6">
      {mode === "rooms" && <>
      <section aria-labelledby="room-grid-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="room-grid-heading" className="text-xl font-semibold text-slate-900">Room occupancy</h2>
            <p className="mt-1 text-sm text-slate-600">
              {loading ? "Loading rooms…" : `${occupiedRooms.length} occupied · ${availableRooms.length} available`}
            </p>
          </div>
          <div className="flex gap-4 text-xs font-medium text-slate-600">
            <span><i className="mr-1.5 inline-block size-2.5 rounded-full bg-emerald-500" />Available</span>
            <span><i className="mr-1.5 inline-block size-2.5 rounded-full bg-rose-500" />Occupied</span>
          </div>
        </div>
        {roomLoadError && <div className="mt-4"><LoadError message={roomLoadError} onRetry={() => { setLoading(true); void refreshRooms().catch((error: unknown) => setRoomLoadError(error instanceof Error ? error.message : "Unable to load rooms.")).finally(() => setLoading(false)); }} /></div>}
        <div className="mt-4 grid grid-cols-5 gap-1.5 min-[480px]:grid-cols-7 sm:gap-2 md:grid-cols-9 lg:grid-cols-11 xl:grid-cols-[repeat(13,minmax(0,1fr))]">
          {loading && Array.from({ length: 26 }, (_, index) => <Skeleton key={index} className="aspect-square w-full" />)}
          {!loading && rooms.map((room) => {
            const occupied = room.status === "OCCUPIED";
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedRoom(room)}
                className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border p-1 text-center transition hover:ring-2 hover:ring-teal-600 focus-visible:ring-2 ${occupied ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}
                aria-label={`Room ${room.number}, ${occupied ? `occupied by ${room.patient?.name ?? "a patient"}` : "available"}. View room details.`}
                aria-haspopup="dialog"
              >
                <span className="text-lg font-bold leading-tight text-slate-950">{String(room.number).padStart(2, "0")}</span>
                <span className={`mt-1 text-[10px] font-semibold leading-tight sm:text-xs ${occupied ? "text-rose-900" : "text-emerald-900"}`}>{occupied ? "Occupied" : "Available"}</span>
              </button>
            );
          })}
          {!loading && !roomLoadError && rooms.length === 0 && (
            <p className="col-span-full rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              No rooms are seeded. Run <code>npx prisma db seed</code>.
            </p>
          )}
        </div>
        {!loading && rooms.length > 0 && availableRooms.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">No available rooms. Admissions cannot be submitted until a room is released.</p>}
      </section>

      <section aria-labelledby="admit-heading" className="rounded-xl border border-slate-200 p-5">
        <h2 id="admit-heading" className="text-lg font-semibold text-slate-900">Admit a patient</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={admitPatient}>
          <label className="block text-sm font-medium text-slate-800" htmlFor="patient-name">
            Patient name
            <input
              id="patient-name"
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="room-choice">
            Available room
            <select
              id="room-choice"
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              disabled={loading || availableRooms.length === 0}
              required
            >
              {availableRooms.length === 0 ? (
                <option value="">No available rooms</option>
              ) : availableRooms.map((room) => (
                <option key={room.id} value={room.id}>Room {room.number}</option>
              ))}
            </select>
          </label>
          <button
            className="rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={loading || submitting || availableRooms.length === 0}
          >
            {submitting ? "Admitting…" : "Admit patient"}
          </button>
        </form>
        {message && (
          <p role={messageIsError ? "alert" : "status"} className={`mt-4 text-sm ${messageIsError ? "text-red-700" : "text-emerald-800"}`}>
            {message}
          </p>
        )}
      </section>

      {selectedRoom && <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRoom(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Room details</p><h2 id="room-dialog-title" className="mt-1 text-2xl font-bold text-slate-950">Room {String(selectedRoom.number).padStart(2, "0")}</h2></div>
            <button type="button" onClick={() => setSelectedRoom(null)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-800" aria-label="Close room details">Close</button>
          </div>
          <div className="mt-4"><StatusBadge value={selectedRoom.status}>{selectedRoom.status === "AVAILABLE" ? "Available" : "Occupied"}</StatusBadge></div>
          {selectedRoom.status === "AVAILABLE" ? <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <p className="text-sm text-slate-700">This room is available for admission.</p>
            <button type="button" onClick={() => { setRoomId(selectedRoom.id); setSelectedRoom(null); document.getElementById("patient-name")?.focus(); }} className="mt-4 min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">Use room in admission form</button>
          </div> : selectedRoom.patient ? <div className="mt-5">
            {patientLoading && <div role="status" aria-label="Loading current patient"><Skeleton className="h-20 w-full" /></div>}
            {patientLoadError && <LoadError message="Unable to load the current patient." onRetry={() => setPatientLoadAttempt((attempt) => attempt + 1)} />}
            {selectedPatient && <>
              <dl className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Current patient</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{selectedPatient.name}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Admitted</dt><dd className="mt-1 text-sm text-slate-800">{formatRoomTime(selectedPatient.admittedAt)}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Patient status</dt><dd className="mt-1"><StatusBadge value={selectedPatient.status} /></dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Today&apos;s temperature</dt><dd className="mt-1"><StatusBadge value={selectedPatient.today?.temperature.recorded ? "RECORDED" : "NOT_RECORDED"}>{selectedPatient.today?.temperature.recorded ? "Recorded" : "Not recorded"}</StatusBadge></dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Today&apos;s doctor visit</dt><dd className="mt-1"><StatusBadge value={selectedPatient.today?.visit.completed ? "COMPLETED" : "PENDING"}>{selectedPatient.today?.visit.completed ? "Visited" : "Not visited"}</StatusBadge></dd></div>
              </dl>
              <Link href={`/patients/${selectedPatient.id}`} onClick={() => setSelectedRoom(null)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">View Patient</Link>
            </>}
          </div> : <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">Patient information is not available for this room.</p>}
        </section>
      </div>}
      </>}
      {mode === "dischargeReview" && <DischargeReview onDischarged={async () => undefined} />}
    </div>
  );
}

type DischargePatient = {
  id: string;
  name: string;
  room: { number: number } | null;
  streak: number;
  eligible: boolean;
  days: Array<{
    date: string;
    hasReadings: boolean;
    feverFree: boolean;
    reason: string;
    readings: Array<{
      id: string;
      value: number;
      recordedAt: string;
      applicableThreshold: { value: number; effectiveFrom: string } | null;
    }>;
  }>;
};

function DischargeReview({ onDischarged }: { onDischarged: () => Promise<void> }) {
  const [patients, setPatients] = useState<DischargePatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{ patient: DischargePatient; outcome: "CURED" | "DECEASED" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function retryLoad() {
    setLoading(true);
    try { await refresh(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load discharge review.");
    } finally { setLoading(false); }
  }

  const refresh = useCallback(async () => {
    const response = await fetch("/api/patients?filter=dischargeReview", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load discharge review.");
    setPatients((body.patients as DischargePatient[]).filter((patient) => patient.eligible));
    setError("");
  }, []);

  useEffect(() => {
    refresh()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load discharge review."))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function discharge(patient: DischargePatient, outcome: "CURED" | "DECEASED") {
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}/discharge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not discharge the patient.");
      setNotice(`${patient.name} was discharged as ${outcome.toLowerCase()}.`);
      await Promise.all([refresh(), onDischarged()]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not discharge the patient.";
      await refresh().catch(() => undefined);
      setError(message);
    } finally {
      setSubmitting(false);
      setConfirmation(null);
    }
  }

  return (
    <section aria-labelledby="discharge-review-heading" className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="discharge-review-heading" className="text-xl font-semibold text-slate-900">Discharge review</h2>
          <p className="mt-1 text-sm text-slate-600">Eligibility is recalculated from recorded temperatures and historical thresholds.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">{patients.length} active</span>
      </div>

      {error && <div className="mt-4"><LoadError message={error} onRetry={() => void retryLoad()} /></div>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {loading && <div className="mt-4"><CardSkeletons count={2} /></div>}
      {!loading && patients.length === 0 && <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No patients are currently eligible for discharge.</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {!loading && patients.map((patient) => (
          <article key={patient.id} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900"><Link href={`/patients/${patient.id}`} className="hover:text-teal-800 hover:underline">{patient.name}</Link></h3>
                <p className="text-sm text-slate-600">ID {patient.id} · {patient.room ? `Room ${patient.room.number}` : "No room assigned"}</p>
              </div>
              <StatusBadge value="DISCHARGE_ELIGIBLE">Active · eligible</StatusBadge>
            </div>
            <p className="mt-3 text-sm text-slate-700">Fever-free streak: <strong>{patient.streak} days</strong></p>
            <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-emerald-800">{patient.days.filter((day) => day.feverFree).slice(0, 3).reverse().map((day) => <li key={day.date}>{day.date} ✓</li>)}</ol>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">Eligibility reasoning</summary>
              <ul className="mt-2 space-y-2 pl-4">
                {patient.days.map((day) => (
                  <li key={day.date}>
                    <strong>{day.date}:</strong> {day.reason}
                    {day.readings.length > 0 && (
                      <ul className="mt-1 pl-4 text-xs text-slate-600">
                        {day.readings.map((reading) => (
                          <li key={reading.id}>
                            {reading.value}°C; threshold {reading.applicableThreshold?.value ?? "not configured"}
                            {reading.applicableThreshold && `°C (effective ${new Date(reading.applicableThreshold.effectiveFrom).toLocaleString()})`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </details>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Link href={`/patients/${patient.id}`} className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50">Review Patient</Link>
              <button
                type="button"
                onClick={() => setConfirmation({ patient, outcome: "CURED" })}
                disabled={!patient.eligible}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discharge as cured
              </button>
              <button
                type="button"
                onClick={() => setConfirmation({ patient, outcome: "DECEASED" })}
                className="rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Discharge as deceased
              </button>
            </div>
          </article>
        ))}
      </div>
      {confirmation && <ConfirmDialog title="Discharge patient?" confirmLabel="Confirm discharge" busy={submitting} onCancel={() => setConfirmation(null)} onConfirm={() => void discharge(confirmation.patient, confirmation.outcome)}>
        <p><strong>Patient:</strong> {confirmation.patient.name}</p>
        <p><strong>Room:</strong> {confirmation.patient.room ? `Room ${confirmation.patient.room.number}` : "No room assigned"}</p>
        <p><strong>Outcome:</strong> {confirmation.outcome}</p>
        <p>This will discharge the patient and release their room.</p>
      </ConfirmDialog>}
    </section>
  );
}
