import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { isAuthError, requireRole } from "@/lib/auth";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];

type RouteContext = { params: { id: string } };

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, ["NURSE"]);
  if (isAuthError(auth)) return auth;

  let body: { value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (body.value === undefined || body.value === null || body.value === "") {
    return NextResponse.json({ error: "Temperature value is required." }, { status: 400 });
  }

  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json(
      { error: "Temperature must be a finite number." },
      { status: 400 },
    );
  }
  if (body.value < 30 || body.value > 45) {
    return NextResponse.json({ error: "Temperature must be between 30 and 45 degrees C." }, { status: 400 });
  }

  const value = body.value;
  const now = new Date();
  const { start, end } = getUtcCalendarDayRange(now);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({
        where: { id: params.id },
        select: { id: true, status: true },
      });
      if (!patient) return { error: "Patient not found.", status: 404 as const };
      if (patient.status === "DISCHARGED") {
        return { error: "Patient is already discharged; temperature cannot be recorded.", status: 409 as const };
      }
      if (patient.status !== "ACTIVE") {
        return { error: "Temperature can only be recorded for an active patient.", status: 409 as const };
      }

      const earlierTodayCount = await tx.temperatureReading.count({
        where: { patientId: patient.id, recordedAt: { gte: start, lt: end } },
      });
      const reading = await tx.temperatureReading.create({
        data: {
          patientId: patient.id,
          value,
          recordedById: auth.id,
          recordedAt: now,
        },
        select: {
          id: true,
          patientId: true,
          value: true,
          recordedById: true,
          recordedAt: true,
          recordedBy: { select: { id: true, name: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.id,
          action: "TEMPERATURE_RECORDED",
          patientId: patient.id,
          details: JSON.stringify({ readingId: reading.id, value: reading.value }),
          createdAt: now,
        },
      });
      const duplicateToday = earlierTodayCount > 0;
      return {
        reading,
        duplicateToday,
        ...(duplicateToday ? { message: "Temperature already recorded today; additional reading recorded." } : {}),
      };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Temperature recording failed:", error);
    return NextResponse.json({ error: "Could not record the temperature." }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const patient = await prisma.patient.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      readings: {
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          value: true,
          recordedAt: true,
          recordedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!patient) return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  return NextResponse.json(patient);
}
