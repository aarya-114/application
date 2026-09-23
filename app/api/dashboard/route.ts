import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { isAuthError, requireRole } from "@/lib/auth";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { computeFeverFreeStreak } from "@/lib/discharge";
import { prisma } from "@/lib/prisma";

const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];
const OCCUPIED_STATUSES = ["ADMITTED", "ACTIVE", "DISCHARGE_ELIGIBLE"] as const;

export async function GET(req: Request) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const { start, end } = getUtcCalendarDayRange();
  const activeWhere = { status: { in: [...OCCUPIED_STATUSES] } };
  const todayReadings = { recordedAt: { gte: start, lt: end } };
  const todayVisits = { visitedAt: { gte: start, lt: end } };

  const [
    occupied,
    needsTemp,
    tempDone,
    needsVisit,
    visitDone,
    patientsRequiringAction,
    dischargedPatients,
    dischargedToday,
    activePatients,
  ] = await Promise.all([
    prisma.room.count({
      where: { patients: { some: { status: { in: [...OCCUPIED_STATUSES] } } } },
    }),
    prisma.patient.count({ where: { ...activeWhere, readings: { none: todayReadings } } }),
    prisma.patient.count({ where: { ...activeWhere, readings: { some: todayReadings } } }),
    prisma.patient.count({ where: { ...activeWhere, doctorVisits: { none: todayVisits } } }),
    prisma.patient.count({ where: { ...activeWhere, doctorVisits: { some: todayVisits } } }),
    prisma.patient.count({
      where: {
        ...activeWhere,
        OR: [
          { readings: { none: todayReadings } },
          { doctorVisits: { none: todayVisits } },
        ],
      },
    }),
    prisma.patient.findMany({
      where: { status: "DISCHARGED" },
      select: { id: true, outcome: true, dischargedAt: true },
      orderBy: { dischargedAt: "asc" },
    }),
    prisma.patient.count({
      where: { status: "DISCHARGED", dischargedAt: { gte: start, lt: end } },
    }),
    prisma.patient.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  const [deceasedCount, curedCount] = [
    dischargedPatients.filter((patient) => patient.outcome === "DECEASED").length,
    dischargedPatients.filter((patient) => patient.outcome === "CURED").length,
  ];
  const totalDischarged = dischargedPatients.length;
  const trendByDate = new Map<string, { date: string; curedCount: number; deceasedCount: number; totalDischarged: number }>();
  for (const patient of dischargedPatients) {
    if (!patient.dischargedAt) continue;
    const date = patient.dischargedAt.toISOString().slice(0, 10);
    const entry = trendByDate.get(date) ?? { date, curedCount: 0, deceasedCount: 0, totalDischarged: 0 };
    if (patient.outcome === "CURED") entry.curedCount += 1;
    if (patient.outcome === "DECEASED") entry.deceasedCount += 1;
    entry.totalDischarged += 1;
    trendByDate.set(date, entry);
  }

  const eligibility = await Promise.all(activePatients.map((patient) => computeFeverFreeStreak(patient.id)));
  const dischargeBacklog = eligibility.filter((status) => status.eligible).length;

  return NextResponse.json({
    occupancy: { occupied, total: 74 },
    todayWorkflow: { needsTemp, tempDone, needsVisit, visitDone },
    patientsRequiringAction,
    dischargeBacklog,
    dischargedToday,
    mortality: {
      deceasedCount,
      totalDischarged,
      rate: totalDischarged > 0 ? deceasedCount / totalDischarged : null,
      insufficientData: totalDischarged === 0,
    },
    successRate: {
      curedCount,
      totalDischarged,
      rate: totalDischarged > 0 ? curedCount / totalDischarged : null,
      benchmark: 85,
      insufficientData: totalDischarged === 0,
    },
    historicalTrend: Array.from(trendByDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  });
}
