import { NextResponse } from "next/server";
import { isAuthError, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const OCCUPIED_STATUSES = ["ADMITTED", "ACTIVE", "DISCHARGE_ELIGIBLE"] as const;

export async function GET(req: Request) {
  const auth = await requireRole(req, ["ADMIN"]);
  if (isAuthError(auth)) return auth;

  const rooms = await prisma.room.findMany({
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      patients: {
        where: { status: { in: [...OCCUPIED_STATUSES] } },
        take: 1,
        select: { id: true, name: true },
      },
    },
  });

  return NextResponse.json({
    rooms: rooms.map(({ patients, ...room }) => ({
      ...room,
      status: patients.length ? "OCCUPIED" : "AVAILABLE",
      patient: patients[0] ?? null,
    })),
  });
}
