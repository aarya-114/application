"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadError, MetricLoadingCard, Skeleton } from "@/components/ui";

type Patient = { id: string; name: string; room: { number: number } | null; tempPending?: boolean; visitPending?: boolean };
type Dashboard = { todayWorkflow: { needsTemp: number; tempDone: number; needsVisit: number; visitDone: number } };

export default function AdminWorkflow() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const paths = ["/api/dashboard", "/api/patients?filter=needsTemperatureToday", "/api/patients?filter=completedTemperatureToday", "/api/patients?filter=needsVisitToday", "/api/patients?filter=completedVisitToday"];
      const responses = await Promise.all(paths.map((path) => fetch(path, { cache: "no-store" })));
      const bodies = await Promise.all(responses.map((response) => response.json()));
      const failed = responses.findIndex((response) => !response.ok);
      if (failed >= 0) throw new Error(bodies[failed].error ?? "Unable to load today's workflow.");
      setDashboard(bodies[0] as Dashboard);
      const tempPending = bodies[1].patients as Patient[];
      const tempDone = bodies[2].patients as Patient[];
      const visitPending = bodies[3].patients as Patient[];
      const visitDone = bodies[4].patients as Patient[];
      const people = new Map<string, Patient>();
      [...tempPending, ...tempDone, ...visitPending, ...visitDone].forEach((patient) => people.set(patient.id, patient));
      const tempPendingIds = new Set(tempPending.map((patient) => patient.id));
      const visitPendingIds = new Set(visitPending.map((patient) => patient.id));
      const actionIds = new Set(Array.from(tempPendingIds).concat(Array.from(visitPendingIds)));
      setPatients(Array.from(people.values()).filter((patient) => actionIds.has(patient.id)).sort((a, b) => a.name.localeCompare(b.name)).map((patient) => ({
        ...patient,
        tempPending: tempPendingIds.has(patient.id),
        visitPending: visitPendingIds.has(patient.id),
      })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load today's workflow."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const workflow = dashboard?.todayWorkflow;

  return <div className="space-y-6">
    {error && <LoadError message={error} onRetry={() => void refresh()} />}
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4" aria-labelledby="workflow-temp-heading"><h2 id="workflow-temp-heading" className="font-semibold text-slate-900">A. Temperature measurements</h2><div className="mt-3 grid grid-cols-2 gap-3">{loading ? <><MetricLoadingCard label="Completed" /><MetricLoadingCard label="Pending" /></> : workflow && <><WorkflowMetric label="Completed" value={workflow.tempDone} /><WorkflowMetric label="Pending" value={workflow.needsTemp} /></>}</div></section>
      <section className="rounded-xl border border-slate-200 p-4" aria-labelledby="workflow-visit-heading"><h2 id="workflow-visit-heading" className="font-semibold text-slate-900">B. Doctor visits</h2><div className="mt-3 grid grid-cols-2 gap-3">{loading ? <><MetricLoadingCard label="Completed" /><MetricLoadingCard label="Pending" /></> : workflow && <><WorkflowMetric label="Completed" value={workflow.visitDone} /><WorkflowMetric label="Pending" value={workflow.needsVisit} /></>}</div></section>
    </div>
    <section aria-labelledby="workflow-patients-heading"><div className="flex items-center justify-between"><h2 id="workflow-patients-heading" className="text-lg font-semibold text-slate-900">Patients requiring action today</h2>{!loading && <span className="text-sm text-slate-500">{patients.length} patients</span>}</div>
      {loading ? <div className="mt-3 space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full" />)}</div> : patients.length === 0 ? <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No patient actions are pending today.</p> : <ul className="mt-3 grid gap-3 xl:grid-cols-2">{patients.map((patient) => {
        const state = patient;
        return <li key={patient.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><h3 className="font-semibold text-slate-900">{patient.name}</h3><p className="text-sm text-slate-600">{patient.room ? `Room ${patient.room.number}` : "No room assigned"}</p><div className="mt-2 flex flex-wrap gap-2 text-xs">{state?.tempPending ? <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-900">Temperature not recorded</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900">Temperature recorded</span>}{state?.visitPending ? <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-900">Doctor visit pending</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900">Doctor visit completed</span>}</div></div><Link className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50" href={`/patients/${patient.id}`}>View Patient</Link></li>;
      })}</ul>}
    </section>
  </div>;
}

function WorkflowMetric({ label, value }: { label: string; value: number }) { return <article className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-medium text-slate-600">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p></article>; }
