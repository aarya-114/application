import { NextResponse } from "next/server";
import type { Prisma, UserRole } from "@prisma/client";
import { isAuthError, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const AUTHENTICATED_ROLES: UserRole[] = ["NURSE", "DOCTOR", "ADMIN"];
const DEFAULT_FEVER_THRESHOLD_ID = "fever-threshold-default";

const settingSelect = {
  id: true,
  value: true,
  effectiveFrom: true,
  createdAt: true,
  setBy: { select: { id: true, name: true, role: true } },
} as const;

type ThresholdEntry = Prisma.FeverThresholdSettingGetPayload<{ select: typeof settingSelect }>;

function serializeSetting(setting: ThresholdEntry, oldValue: number | null) {
  const isSeededDefault = setting.id === DEFAULT_FEVER_THRESHOLD_ID;
  return {
    ...setting,
    setBy: isSeededDefault ? null : setting.setBy,
    oldValue,
    newValue: setting.value,
    isSeededDefault,
    source: isSeededDefault ? "SEEDED_DEFAULT" : "DOCTOR_CHANGE",
  };
}

export async function GET(req: Request) {
  const auth = await requireRole(req, AUTHENTICATED_ROLES);
  if (isAuthError(auth)) return auth;

  const settings = await prisma.feverThresholdSetting.findMany({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: settingSelect,
  });

  const history = settings.map((setting, index) =>
    serializeSetting(setting, settings[index + 1]?.value ?? null),
  );

  return NextResponse.json({
    current: settings[0] ? serializeSetting(settings[0], settings[1]?.value ?? null) : null,
    history,
  });
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ["DOCTOR"]);
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
    return NextResponse.json({ error: "Threshold value is required." }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json(
      { error: "Threshold must be a finite number." },
      { status: 400 },
    );
  }
  if (body.value < 30 || body.value > 45) {
    return NextResponse.json({ error: "Threshold must be between 30 and 45 degrees C." }, { status: 400 });
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.feverThresholdSetting.findFirst({
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { value: true },
    });

    const setting = await tx.feverThresholdSetting.create({
      data: {
        value: body.value as number,
        setById: auth.id,
        effectiveFrom: now,
        createdAt: now,
      },
      select: settingSelect,
    });

    await tx.auditLog.create({
      data: {
        actorId: auth.id,
        action: "FEVER_THRESHOLD_CHANGED",
        details: JSON.stringify({
          oldValue: previous?.value ?? null,
          newValue: setting.value,
          effectiveFrom: setting.effectiveFrom.toISOString(),
          unit: "°C",
        }),
        createdAt: now,
      },
    });

    return { setting, oldValue: previous?.value ?? null };
  });

  return NextResponse.json({
    setting: result.setting,
    oldValue: result.oldValue,
  }, { status: 201 });
}
