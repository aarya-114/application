import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: { id: string } };

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, ["DOCTOR"]);
  if (isAuthError(auth)) return auth;

  let body: { note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string when provided." }, { status: 400 });
  }

  const now = new Date();
  const { start, end } = getUtcCalendarDayRange(now);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  const result = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!patient) return { error: "Patient not found.", status: 404 as const };
    if (patient.status === "DISCHARGED") {
      return { error: "Patient is already discharged; a visit cannot be recorded.", status: 409 as const };
    }
    if (patient.status !== "ACTIVE") {
      return { error: "A doctor visit can only be recorded for an active patient.", status: 409 as const };
    }

    const [earlierVisitCount, todayTemperatureCount] = await Promise.all([
      tx.doctorVisit.count({
        where: { patientId: patient.id, visitedAt: { gte: start, lt: end } },
      }),
      tx.temperatureReading.count({
        where: { patientId: patient.id, recordedAt: { gte: start, lt: end } },
      }),
    ]);

    const visit = await tx.doctorVisit.create({
      data: {
        patientId: patient.id,
        doctorId: auth.id,
        visitedAt: now,
        note,
      },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        visitedAt: true,
        note: true,
        doctor: { select: { id: true, name: true } },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: auth.id,
        action: "DOCTOR_VISIT_RECORDED",
        patientId: patient.id,
        details: JSON.stringify({ visitId: visit.id }),
        createdAt: now,
      },
    });

    return {
      visit,
      duplicateToday: earlierVisitCount > 0,
      ...(todayTemperatureCount === 0 ? { warning: "Temperature not yet recorded today" } : {}),
    };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { status: 201 });
}
