import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const OCCUPIED_STATUSES = ["ADMITTED", "ACTIVE", "DISCHARGE_ELIGIBLE"] as const;

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

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Patient name is required." }, { status: 400 });
  }
  if (typeof body.roomId !== "string" || !body.roomId.trim()) {
    return NextResponse.json({ error: "roomId is required." }, { status: 400 });
  }
  const patientName = body.name.trim();
  const requestedRoomId = body.roomId.trim();

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

      return tx.patient.create({
        data: {
          name: patientName,
          roomId: room.id,
          status: "ACTIVE",
          outcome: "ONGOING",
          admittedAt: new Date(),
        },
        select: { id: true, name: true, roomId: true, status: true, outcome: true, admittedAt: true },
      });
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
