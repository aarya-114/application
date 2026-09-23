"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConfirmDialog, LoadError, Skeleton } from "@/components/ui";

type Setting = {
  id: string;
  value: number;
  effectiveFrom: string;
  createdAt: string;
  setBy: { id: string; name: string; role: "NURSE" | "DOCTOR" | "ADMIN" } | null;
  oldValue: number | null;
  newValue: number;
  isSeededDefault: boolean;
};

export default function FeverThresholdSettings({ canEdit }: { canEdit: boolean }) {
  const [current, setCurrent] = useState<Setting | null>(null);
  const [history, setHistory] = useState<Setting[]>([]);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const parsedValue = value.trim() === "" ? null : Number(value);
  const validationError = parsedValue === null
    ? ""
    : !Number.isFinite(parsedValue)
      ? "Threshold must be a finite number."
      : parsedValue < 30 || parsedValue > 45
        ? "Threshold must be between 30 and 45°C."
        : "";

  const refresh = useCallback(async () => {
    const response = await fetch("/api/settings/fever-threshold", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load threshold settings.");
    setCurrent(body.current);
    setHistory(body.history);
    setLoadError("");
    setValue((previous) => previous || (body.current ? String(body.current.value) : ""));
  }, []);

  useEffect(() => {
    refresh()
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load threshold settings.");
        setIsError(true);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  async function saveThreshold() {
    if (saving) return;
    setMessage("");
    setSaving(true);
    try {
      const response = await fetch("/api/settings/fever-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: Number(value) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update threshold.");
      setMessage("Fever threshold updated. The previous setting remains in history.");
      setIsError(false);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update threshold.");
      setIsError(true);
    } finally {
      setSaving(false);
      setConfirmationOpen(false);
    }
  }

  function requestThresholdChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (parsedValue === null) {
      setMessage("Threshold value is required.");
      setIsError(true);
      return;
    }
    if (validationError) {
      setMessage(validationError);
      setIsError(true);
      return;
    }
    setConfirmationOpen(true);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-medium text-slate-600">Current threshold</p>
        <p className="mt-1 text-3xl font-semibold text-slate-900">
          {loading ? <Skeleton className="mt-2 h-9 w-32" /> : loadError && !current ? "Unavailable" : current ? `${current.value}°C` : "Not configured"}
        </p>
        {!canEdit && <p className="mt-2 text-sm text-slate-600">Only Doctors can change this setting.</p>}
      </section>

      {canEdit && (
        <form onSubmit={requestThresholdChange} className="rounded-xl border border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Update threshold</h2>
          <p className="mt-1 text-sm text-slate-600">This adds a new effective setting and preserves all earlier values.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium text-slate-800" htmlFor="fever-threshold">
              Threshold (°C)
              <input
                className="mt-2 block w-48 rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                id="fever-threshold"
                type="number"
                min="30"
                max="45"
                step="any"
                value={value}
                onChange={(event) => { setValue(event.target.value); setMessage(""); }}
                required
                disabled={loading || saving}
              />
            </label>
            <button
              className="rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={loading || saving || !value}
            >
              {saving ? "Saving…" : "Save threshold"}
            </button>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-600">Allowed range: 30–45°C</p>
          {validationError && <p className="mt-2 text-sm text-red-700" role="alert">{validationError}</p>}
        </form>
      )}

      {loadError && <LoadError message="Unable to load threshold settings." onRetry={() => { setLoading(true); void refresh().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Unable to load threshold settings.")).finally(() => setLoading(false)); }} />}
      {message && (
        <p role={isError ? "alert" : "status"} className={`text-sm ${isError ? "text-red-700" : "text-emerald-800"}`}>
          {message}
        </p>
      )}

      <section aria-labelledby="threshold-history-heading">
        <h2 id="threshold-history-heading" className="text-lg font-semibold text-slate-900">Change history</h2>
        {loading ? <div className="mt-3 space-y-2" role="status" aria-label="Loading threshold history"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : loadError && history.length === 0 ? null : history.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No threshold changes recorded.</p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-slate-900">
                    {entry.oldValue === null ? "Initial value" : `${entry.oldValue}°C → ${entry.newValue}°C`}
                    {entry.oldValue === null && ` · ${entry.newValue}°C`}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {entry.isSeededDefault ? "Seeded prototype default (implementation assumption)" : `Changed by ${entry.setBy?.name ?? "Unknown user"} (${entry.setBy?.role ?? ""})`}
                  </p>
                </div>
                <time className="text-sm text-slate-500" dateTime={entry.effectiveFrom}>
                  {new Date(entry.effectiveFrom).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
      {confirmationOpen && <ConfirmDialog title="Change fever threshold?" confirmLabel="Confirm change" busy={saving} onCancel={() => setConfirmationOpen(false)} onConfirm={() => void saveThreshold()}>
        <p><strong>Current:</strong> {current ? `${current.value}°C` : "Not configured"}</p>
        <p><strong>New:</strong> {value || "—"}°C</p>
        <p>Are you sure you want to create this threshold change?</p>
      </ConfirmDialog>}
    </div>
  );
}
