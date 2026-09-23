import { useEffect, useRef, type ReactNode } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export function MetricSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading content">
      {Array.from({ length: count }, (_, index) => (
        <div className="rounded-xl border border-slate-200 p-4" key={index}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-4 h-8 w-1/3" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
      <span className="sr-only">Loading content…</span>
    </div>
  );
}

export function MetricLoadingCard({ label }: { label: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" role="status"><h3 className="text-sm font-medium text-slate-600">{label}</h3><Skeleton className="mt-3 h-8 w-1/3" /><span className="sr-only">Loading {label.toLowerCase()}</span></article>;
}

export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading records">
      {Array.from({ length: count }, (_, index) => (
        <div className="rounded-xl border border-slate-200 p-4" key={index}>
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-3 h-4 w-1/3" />
          <Skeleton className="mt-5 h-16 w-full" />
          <Skeleton className="mt-4 h-10 w-full" />
        </div>
      ))}
      <span className="sr-only">Loading records…</span>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm text-red-900">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-10 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">
        Retry
      </button>
    </div>
  );
}

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-sky-100 text-sky-900 ring-sky-200",
  DISCHARGE_ELIGIBLE: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  DISCHARGED: "bg-slate-200 text-slate-900 ring-slate-300",
  OCCUPIED: "bg-rose-100 text-rose-900 ring-rose-200",
  AVAILABLE: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  ONGOING: "bg-sky-100 text-sky-900 ring-sky-200",
  CURED: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  DECEASED: "bg-slate-200 text-slate-900 ring-slate-300",
  RECORDED: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  NOT_RECORDED: "bg-amber-100 text-amber-950 ring-amber-200",
  COMPLETED: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  PENDING: "bg-amber-100 text-amber-950 ring-amber-200",
  THRESHOLD_NOT_CONFIGURED: "bg-slate-100 text-slate-800 ring-slate-200",
  FEVER: "bg-rose-100 text-rose-900 ring-rose-200",
  NO_FEVER: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  VISITED_TODAY: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  VISIT_PENDING: "bg-amber-100 text-amber-950 ring-amber-200",
};

export function StatusBadge({ value, children }: { value: string; children?: ReactNode }) {
  const label = children ?? value.replaceAll("_", " ");
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyles[value] ?? "bg-slate-100 text-slate-800 ring-slate-200"}`}>{label}</span>;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Tab" && dialog.current) {
        const focusable = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <h2 id="confirm-dialog-title" className="text-xl font-semibold text-slate-950">{title}</h2>
        <div className="mt-4 space-y-2 text-sm leading-6 text-slate-700">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelButton} type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? "Working…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
