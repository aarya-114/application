"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Room = {
  id: string;
  number: number;
  status: "OCCUPIED" | "AVAILABLE";
  patient: { id: string; name: string } | null;
};

export default function RoomManagement() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refreshRooms = useCallback(async () => {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load rooms.");
    const nextRooms = body.rooms as Room[];
    setRooms(nextRooms);
    setRoomId((current) =>
      nextRooms.some((room) => room.id === current && room.status === "AVAILABLE")
        ? current
        : nextRooms.find((room) => room.status === "AVAILABLE")?.id ?? "",
    );
  }, []);

  useEffect(() => {
    refreshRooms()
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not load rooms.");
        setMessageIsError(true);
      })
      .finally(() => setLoading(false));
  }, [refreshRooms]);

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
    <div className="mt-9 space-y-9">
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
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          {rooms.map((room) => {
            const occupied = room.status === "OCCUPIED";
            return (
              <div
                key={room.id}
                className={`min-h-20 rounded-lg border p-3 ${occupied ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}
                aria-label={`Room ${room.number}: ${occupied ? `occupied by ${room.patient?.name}` : "available"}`}
              >
                <p className="font-semibold text-slate-900">Room {room.number}</p>
                <p className={`mt-1 text-xs font-medium ${occupied ? "text-rose-800" : "text-emerald-800"}`}>
                  {occupied ? room.patient?.name : "Available"}
                </p>
              </div>
            );
          })}
          {!loading && rooms.length === 0 && (
            <p className="col-span-full rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              No rooms are seeded. Run <code>npx prisma db seed</code>.
            </p>
          )}
        </div>
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
    </div>
  );
}
