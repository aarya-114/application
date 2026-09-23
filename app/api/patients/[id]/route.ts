import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { computeFeverFreeStreak } from "@/lib/discharge";
import { prisma } from "@/lib/prisma";

const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];
const CARE_AUDIT_ACTIONS = [
  "PATIENT_ADMITTED",
  "TEMPERATURE_RECORDED",
  "DOCTOR_VISIT_RECORDED",
  "PATIENT_DISCHARGED",
];
type RouteContext = { params: { id: string } };

function auditWhere(patientId: string, role: UserRole) {
  if (role === "NURSE") {
    return { patientId, action: { in: CARE_AUDIT_ACTIONS } };
  }
  if (role === "DOCTOR") {
    return {
      OR: [
        { patientId, action: { in: [...CARE_AUDIT_ACTIONS, "FEVER_THRESHOLD_CHANGED"] } },
        { action: "FEVER_THRESHOLD_CHANGED", patientId: null },
      ],
    };
  }
  return {
    OR: [
      { patientId },
      { action: "FEVER_THRESHOLD_CHANGED", patientId: null },
    ],
  };
}

export async function GET(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const patient = await prisma.patient.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      room: { select: { id: true, number: true } },
      admittedAt: true,
      status: true,
      outcome: true,
      dischargedAt: true,
      readings: {
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          value: true,
          recordedAt: true,
          note: true,
          recordedBy: { select: { id: true, name: true, role: true } },
        },
      },
      doctorVisits: {
        orderBy: [{ visitedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          visitedAt: true,
          note: true,
          doctor: { select: { id: true, name: true, role: true } },
        },
      },
    },
  });
  if (!patient) return NextResponse.json({ error: "Patient not found." }, { status: 404 });

  const now = new Date();
  const { start, end } = getUtcCalendarDayRange(now);
  const [streak, audits] = await Promise.all([
    computeFeverFreeStreak(patient.id, prisma, true),
    prisma.auditLog.findMany({
      where: auditWhere(patient.id, auth.role),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        actor: { select: { id: true, name: true, role: true } },
      },
    }),
  ]);

  const thresholdByReadingId = new Map(
    streak.days.flatMap((day) => day.readings.map((reading) => [reading.id, {
      applicableThreshold: reading.applicableThreshold,
      feverClassification: reading.feverClassification,
    }] as const)),
  );
  const temperatureHistory = patient.readings.map((reading) => {
    const classification = thresholdByReadingId.get(reading.id);
    return {
      ...reading,
      applicableThreshold: classification?.applicableThreshold ?? null,
      feverClassification: classification?.feverClassification ?? "THRESHOLD_NOT_CONFIGURED",
    };
  });
  const todayReadings = temperatureHistory.filter((reading) => reading.recordedAt >= start && reading.recordedAt < end);
  const todayVisits = patient.doctorVisits.filter((visit) => visit.visitedAt >= start && visit.visitedAt < end);
  const stopDay = streak.days[streak.streak];
  const eligibilityReason = streak.eligible
    ? "At least 3 consecutive fever-free days have been recorded through today."
    : streak.streak === 0
      ? stopDay?.reason ?? "Today's required temperature is missing."
      : `The current streak is ${streak.streak} day(s); 3 are required. Streak stopped: ${stopDay?.reason ?? "no qualifying earlier day is available."}`;

  return NextResponse.json({
    patient: {
      id: patient.id,
      name: patient.name,
      room: patient.room,
      admittedAt: patient.admittedAt,
      status: patient.status,
      outcome: patient.outcome,
      dischargedAt: patient.dischargedAt,
    },
    temperatureHistory,
    feverFreeStreak: streak,
    today: {
      temperature: { recorded: todayReadings.length > 0, readings: todayReadings },
      visit: { completed: todayVisits.length > 0, visits: todayVisits },
    },
    dischargeEligibility: {
      eligible: streak.eligible,
      streak: streak.streak,
      reason: eligibilityReason,
    },
    doctorVisits: patient.doctorVisits,
    auditHistory: audits,
  });
}
