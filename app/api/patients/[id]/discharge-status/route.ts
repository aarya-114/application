import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { isAuthError, requireRole } from "@/lib/auth";
import { computeFeverFreeStreak } from "@/lib/discharge";
import { prisma } from "@/lib/prisma";

const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];
type RouteContext = { params: { id: string } };

export async function GET(req: Request, { params }: RouteContext) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const patient = await prisma.patient.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      status: true,
      outcome: true,
      room: { select: { id: true, number: true } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Patient not found." }, { status: 404 });

  const dischargeStatus = await computeFeverFreeStreak(patient.id);
  return NextResponse.json({ patient, ...dischargeStatus });
}
