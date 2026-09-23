import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import type { UserRole } from "@prisma/client";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { computeFeverFreeStreak } from "@/lib/discharge";
import { prisma } from "@/lib/prisma";

const OCCUPIED_STATUSES = ["ADMITTED", "ACTIVE", "DISCHARGE_ELIGIBLE"] as const;
const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];

export async function GET(req: Request) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const filter = new URL(req.url).searchParams.get("filter");
  const temperatureFilter = filter === "needsTemperatureToday" || filter === "completedTemperatureToday";
  const visitFilter = filter === "needsVisitToday" || filter === "completedVisitToday";
  const dischargeReviewFilter = filter === "dischargeReview";
  if (!temperatureFilter && !visitFilter && !dischargeReviewFilter) {
    return NextResponse.json(
      { error: "filter must be needsTemperatureToday, completedTemperatureToday, needsVisitToday, completedVisitToday, or dischargeReview." },
      { status: 400 },
    );
  }

  if (dischargeReviewFilter) {
    const admin = await requireRole(req, ["ADMIN"]);
    if (isAuthError(admin)) return admin;
    const patients = await prisma.patient.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, room: { select: { number: true } } },
    });
    const reviews = await Promise.all(patients.map(async (patient) => ({
      ...patient,
      ...(await computeFeverFreeStreak(patient.id)),
    })));
    return NextResponse.json({ patients: reviews });
  }

  const { start, end } = getUtcCalendarDayRange();
  const todayReadings = { recordedAt: { gte: start, lt: end } };
  const todayVisits = { visitedAt: { gte: start, lt: end } };

  if (visitFilter) {
    const patients = await prisma.patient.findMany({
      where: {
        status: "ACTIVE",
        doctorVisits: filter === "needsVisitToday"
          ? { none: todayVisits }
          : { some: todayVisits },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        room: { select: { number: true } },
        doctorVisits: {
          where: todayVisits,
          orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            visitedAt: true,
            doctor: { select: { id: true, name: true } },
          },
        },
      },
    });

    const threshold = await prisma.feverThresholdSetting.findFirst({
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { value: true, effectiveFrom: true },
    });
    const patientIds = patients.map((patient) => patient.id);
    const readings = patientIds.length
      ? await prisma.temperatureReading.findMany({
        where: { patientId: { in: patientIds }, recordedAt: { lt: end } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: { patientId: true, value: true, recordedAt: true },
      })
      : [];

    const readingsByPatient = new Map<string, Map<string, (typeof readings)[number]>>();
    for (const reading of readings) {
      let byDay = readingsByPatient.get(reading.patientId);
      if (!byDay) {
        byDay = new Map();
        readingsByPatient.set(reading.patientId, byDay);
      }
      const dayKey = reading.recordedAt.toISOString().slice(0, 10);
      if (!byDay.has(dayKey)) byDay.set(dayKey, reading);
    }

    const todayKey = start.toISOString().slice(0, 10);
    const reviewedPatients = patients.map((patient) => {
      const byDay = readingsByPatient.get(patient.id) ?? new Map();
      const latestToday = byDay.get(todayKey);
      let feverFreeStreakDays: number | null = null;
      if (threshold) {
        feverFreeStreakDays = 0;
        const cursor = new Date(start);
        while (true) {
          const dayReading = byDay.get(cursor.toISOString().slice(0, 10));
          if (!dayReading || dayReading.value >= threshold.value) break;
          feverFreeStreakDays += 1;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
      }

      return {
        id: patient.id,
        name: patient.name,
        room: patient.room,
        todayTemperature: latestToday
          ? { value: latestToday.value, recordedAt: latestToday.recordedAt }
          : null,
        feverClassification: !latestToday
          ? "NOT_RECORDED"
          : !threshold
            ? "THRESHOLD_NOT_CONFIGURED"
            : latestToday.value >= threshold.value
              ? "FEVER"
              : "NO_FEVER",
        feverFreeStreakDays,
        visitStatus: patient.doctorVisits.length ? "VISITED_TODAY" : "VISIT_PENDING",
        todayVisits: patient.doctorVisits,
      };
    });

    return NextResponse.json({
      calendarDate: start.toISOString().slice(0, 10),
      timezone: "UTC",
      currentThreshold: threshold,
      patients: reviewedPatients,
    });
  }

  const patients = await prisma.patient.findMany({
    where: {
      status: "ACTIVE",
      readings: filter === "needsTemperatureToday"
        ? { none: todayReadings }
        : { some: todayReadings },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      room: { select: { number: true } },
      readings: {
        where: todayReadings,
        orderBy: { recordedAt: "asc" },
        select: {
          id: true,
          value: true,
          recordedAt: true,
          recordedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    calendarDate: start.toISOString().slice(0, 10),
    timezone: "UTC",
    patients,
  });
}

class AdmissionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ["ADMIN"]);
  if (isAuthError(auth)) return auth;

  let body: { name?: unknown; roomId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Patient name is required." }, { status: 400 });
  }
  if (typeof body.roomId !== "string" || !body.roomId.trim()) {
    return NextResponse.json({ error: "roomId is required." }, { status: 400 });
  }
  const patientName = body.name.trim();
  const requestedRoomId = body.roomId.trim();
  const admittedAt = new Date();

  try {
    const patient = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { id: requestedRoomId } });
      if (!room) throw new AdmissionError(404, "The selected room does not exist.");

      const occupiedCount = await tx.patient.count({
        where: { status: { in: [...OCCUPIED_STATUSES] }, roomId: { not: null } },
      });
      if (occupiedCount >= 74) {
        throw new AdmissionError(409, "All 74 rooms are occupied. No room is available for admission.");
      }

      const currentPatient = await tx.patient.findFirst({
        where: { roomId: room.id, status: { in: [...OCCUPIED_STATUSES] } },
        select: { id: true },
      });
      if (currentPatient) {
        throw new AdmissionError(409, "The selected room is already occupied. Choose an available room.");
      }

      const patient = await tx.patient.create({
        data: {
          name: patientName,
          roomId: room.id,
          status: "ACTIVE",
          outcome: "ONGOING",
          admittedAt,
        },
        select: { id: true, name: true, roomId: true, status: true, outcome: true, admittedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.id,
          action: "PATIENT_ADMITTED",
          patientId: patient.id,
          details: JSON.stringify({ roomId: room.id, roomNumber: room.number }),
          createdAt: admittedAt,
        },
      });
      return patient;
    });

    return NextResponse.json({ patient }, { status: 201 });
  } catch (error) {
    if (error instanceof AdmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034" || error.code === "P2028")
    ) {
      return NextResponse.json(
        { error: "The selected room was assigned by another admission. Refresh rooms and try again." },
        { status: 409 },
      );
    }
    if (error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message)) {
      return NextResponse.json(
        { error: "The selected room was assigned by another admission. Refresh rooms and try again." },
        { status: 409 },
      );
    }
    console.error("Patient admission failed:", error);
    return NextResponse.json({ error: "Could not admit the patient." }, { status: 500 });
  }
}
