import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import { computeFeverFreeStreak } from "@/lib/discharge";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: { id: string } };
type DischargeOutcome = "CURED" | "DECEASED";

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, ["ADMIN"]);
  if (isAuthError(auth)) return auth;

  let body: { outcome?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (body.outcome === undefined || body.outcome === null || body.outcome === "") {
    return NextResponse.json({ error: "outcome is required." }, { status: 400 });
  }
  if (body.outcome !== "CURED" && body.outcome !== "DECEASED") {
    return NextResponse.json({ error: "outcome must be CURED or DECEASED." }, { status: 400 });
  }

  const outcome: DischargeOutcome = body.outcome;
  const dischargedAt = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({
        where: { id: params.id },
        select: { id: true, name: true, roomId: true, status: true },
      });
      if (!patient) return { error: "Patient not found.", status: 404 as const };
      if (patient.status === "DISCHARGED") {
        return { error: "Patient is already discharged.", status: 409 as const };
      }
      if (patient.status !== "ACTIVE") {
        return { error: "Patient is not active and cannot be discharged.", status: 409 as const };
      }

      const eligibility = await computeFeverFreeStreak(patient.id, tx);
      if (outcome === "CURED" && !eligibility.eligible) {
        return {
          error: `Patient is not yet eligible for CURED discharge: 3 consecutive fever-free days are required; current streak is ${eligibility.streak}.`,
          status: 409 as const,
        };
      }

      // Conditional update is the atomic claim: only one concurrent request can
      // transition this ACTIVE patient and release the unique room assignment.
      const updated = await tx.patient.updateMany({
        where: { id: patient.id, status: "ACTIVE" },
        data: {
          status: "DISCHARGED",
          outcome,
          dischargedAt,
          roomId: null,
        },
      });
      if (updated.count !== 1) {
        return { error: "Patient state changed before discharge; refresh and retry.", status: 409 as const };
      }

      const dischargedPatient = await tx.patient.findUnique({
        where: { id: patient.id },
        select: { id: true, name: true, status: true, outcome: true, dischargedAt: true, roomId: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.id,
          action: "PATIENT_DISCHARGED",
          patientId: patient.id,
          details: JSON.stringify({
            outcome,
            dischargedAt: dischargedAt.toISOString(),
            feverFreeStreakDays: eligibility.streak,
            eligibleForCuredDischarge: eligibility.eligible,
            releasedRoomId: patient.roomId,
          }),
          createdAt: dischargedAt,
        },
      });

      return { patient: dischargedPatient, eligibility };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code)) ||
      (error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message))
    ) {
      return NextResponse.json(
        { error: "Discharge conflicted with another request. The patient may already have been discharged; refresh and retry." },
        { status: 409 },
      );
    }
    console.error("Patient discharge failed:", error);
    return NextResponse.json({ error: "Could not discharge the patient." }, { status: 500 });
  }
}
