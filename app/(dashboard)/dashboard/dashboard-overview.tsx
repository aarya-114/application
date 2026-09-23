"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserRole } from "@prisma/client";
import { LoadError, MetricLoadingCard } from "@/components/ui";

type DashboardData = {
  occupancy: { occupied: number; total: number };
  todayWorkflow: { needsTemp: number; tempDone: number; needsVisit: number; visitDone: number };
  patientsRequiringAction: number;
  dischargeBacklog: number;
  dischargedToday: number;
  mortality: { deceasedCount: number; totalDischarged: number; rate: number | null; insufficientData: boolean };
  successRate: { curedCount: number; totalDischarged: number; rate: number | null; benchmark: number; insufficientData: boolean };
  historicalTrend: Array<{ date: string; curedCount: number; deceasedCount: number; totalDischarged: number }>;
};

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-sm font-medium text-slate-600">{label}</h3><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</article>;
}

export default function DashboardOverview({ role, view = "overview" }: { role: UserRole | null; view?: "overview" | "historical" }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load dashboard.");
      setData(body as DashboardData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load dashboard."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (role !== "NURSE" && role !== "DOCTOR" && role !== "ADMIN") return null;

  if (role !== "ADMIN") {
    const nurse = role === "NURSE";
    const done = nurse ? data?.todayWorkflow.tempDone : data?.todayWorkflow.visitDone;
    const pending = nurse ? data?.todayWorkflow.needsTemp : data?.todayWorkflow.needsVisit;
    return <div className="mt-7 space-y-4" aria-label={`${role.toLowerCase()} dashboard metrics`}>
      {error && <LoadError message={error} onRetry={() => void refresh()} />}
      <section><h2 className="mb-3 text-lg font-semibold text-slate-900">Today&apos;s {nurse ? "temperature" : "doctor"} workflow</h2><div className="grid gap-3 sm:grid-cols-2">
        {loading ? <><MetricLoadingCard label={nurse ? "Needs temperature" : "Visits pending"} /><MetricLoadingCard label={nurse ? "Temperature recorded" : "Visited today"} /></> : data && <><MetricCard label={nurse ? "Needs temperature" : "Visits pending"} value={pending ?? 0} /><MetricCard label={nurse ? "Temperature recorded" : "Visited today"} value={done ?? 0} /></>}
      </div></section>
    </div>;
  }

  return <div className="mt-6 space-y-6" aria-label="admin dashboard metrics">
    {error && <LoadError message={error} onRetry={() => void refresh()} />}
    {view === "overview" ? <section aria-labelledby="facility-overview-heading">
      <h2 id="facility-overview-heading" className="mb-3 text-lg font-semibold text-slate-900">Facility status</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? ["Room occupancy", "Patients requiring action today", "Discharge backlog", "Temperature completion", "Doctor-visit completion", "Discharged today", "Cured count", "Deceased count", "Mortality rate", "Success rate"].map((label) => <MetricLoadingCard key={label} label={label} />) : data && <>
          <MetricCard label="Room occupancy" value={`${data.occupancy.occupied} / ${data.occupancy.total}`} detail="Occupied / total rooms" />
          <MetricCard label="Patients requiring action today" value={data.patientsRequiringAction} detail={`${data.todayWorkflow.needsTemp} temperature tasks · ${data.todayWorkflow.needsVisit} doctor visits pending`} />
          <MetricCard label="Discharge backlog" value={data.dischargeBacklog} detail="Currently eligible for review" />
          <MetricCard label="Temperature completion" value={`${data.todayWorkflow.tempDone} completed`} detail={`${data.todayWorkflow.needsTemp} pending`} />
          <MetricCard label="Doctor-visit completion" value={`${data.todayWorkflow.visitDone} completed`} detail={`${data.todayWorkflow.needsVisit} pending`} />
          <MetricCard label="Discharged today" value={data.dischargedToday} />
          <MetricCard label="Cured count" value={data.successRate.curedCount} />
          <MetricCard label="Deceased count" value={data.mortality.deceasedCount} />
          <MetricCard label="Mortality rate" value={data.mortality.insufficientData ? "Insufficient data" : `${(data.mortality.rate! * 100).toFixed(1)}%`} />
          <MetricCard label="Success rate" value={data.successRate.insufficientData ? "Insufficient data" : `${(data.successRate.rate! * 100).toFixed(1)}%`} />
        </>}
      </div>
    </section> : <>
      <section aria-labelledby="historical-summary-heading"><h2 id="historical-summary-heading" className="mb-3 text-lg font-semibold text-slate-900">Discharge outcomes</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {loading ? ["Cured count", "Deceased count", "Total discharged", "Success rate", "Mortality rate"].map((label) => <MetricLoadingCard key={label} label={label} />) : data && <>
          <MetricCard label="Cured count" value={data.successRate.curedCount} /><MetricCard label="Deceased count" value={data.mortality.deceasedCount} /><MetricCard label="Total discharged" value={data.mortality.totalDischarged} />
          <MetricCard label="Success rate" value={data.successRate.insufficientData ? "Insufficient data" : `${(data.successRate.rate! * 100).toFixed(1)}%`} /><MetricCard label="Mortality rate" value={data.mortality.insufficientData ? "Insufficient data" : `${(data.mortality.rate! * 100).toFixed(1)}%`} />
        </>}
      </div></section>
      <section aria-labelledby="discharge-trend-heading"><h2 id="discharge-trend-heading" className="mb-3 text-lg font-semibold text-slate-900">Historical daily discharge outcomes</h2>
        {loading ? <div role="status" className="space-y-2"><div className="sr-only">Loading discharge history…</div><div className="h-10 animate-pulse rounded-lg bg-slate-200" /></div> : !data || data.historicalTrend.length === 0 ? <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No patients have been discharged yet.</p> : <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date (UTC)</th><th className="px-4 py-3">Cured</th><th className="px-4 py-3">Deceased</th><th className="px-4 py-3">Total discharged</th></tr></thead><tbody className="divide-y divide-slate-100">{data.historicalTrend.map((day) => <tr key={day.date}><td className="px-4 py-3 font-medium text-slate-800">{day.date}</td><td className="px-4 py-3 tabular-nums">{day.curedCount}</td><td className="px-4 py-3 tabular-nums">{day.deceasedCount}</td><td className="px-4 py-3 tabular-nums">{day.totalDischarged}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}
