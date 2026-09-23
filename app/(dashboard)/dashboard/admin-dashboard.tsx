"use client";

import { useState } from "react";
import DashboardOverview from "./dashboard-overview";
import AdminWorkflow from "./admin-workflow";
import RoomManagement from "./room-management";

const tabs = [
  { id: "overview", label: "Facility Overview" },
  { id: "workflow", label: "Today’s Workflow" },
  { id: "rooms", label: "Room Occupancy" },
  { id: "discharge", label: "Discharge Review" },
  { id: "history", label: "Historical Discharge" },
] as const;
type Tab = typeof tabs[number]["id"];

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [admitRequest, setAdmitRequest] = useState(0);
  function openAdmission() {
    setTab("rooms");
    setAdmitRequest((value) => value + 1);
  }

  return <div className="mt-7">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-900 p-4 text-white sm:p-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">Admin Dashboard</p><h2 className="mt-1 text-xl font-semibold">Virus Treatment Facility</h2></div>
      <button type="button" onClick={openAdmission} className="min-h-11 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-300">+ Admit Patient</button>
    </header>
    <nav className="mt-4 -mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1" role="tablist" aria-label="Admin dashboard sections">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" id={`admin-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`admin-panel-${item.id}`} onClick={() => setTab(item.id)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition ${tab === item.id ? "border-teal-700 text-teal-900" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{item.label}</button>)}
    </nav>
    <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`} className="pt-1">
      {tab === "overview" && <DashboardOverview role="ADMIN" />}
      {tab === "workflow" && <AdminWorkflow />}
      {tab === "rooms" && <RoomManagement mode="rooms" admitRequest={admitRequest} />}
      {tab === "discharge" && <RoomManagement mode="dischargeReview" />}
      {tab === "history" && <DashboardOverview role="ADMIN" view="historical" />}
    </div>
  </div>;
}
