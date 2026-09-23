import type { Prisma } from "@prisma/client";
import { getUtcCalendarDayRange } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

type DischargeDataSource = Pick<
  Prisma.TransactionClient,
  "temperatureReading" | "feverThresholdSetting" | "patient"
>;

/**
 * Derives the current fever-free streak without persisting eligibility.
 * For every reading, the applicable threshold is the setting with the greatest
 * effectiveFrom timestamp that is less than or equal to recordedAt. This keeps
 * historical readings tied to the threshold actually in effect when measured.
 */
export async function computeFeverFreeStreak(
  patientId: string,
  db: DischargeDataSource = prisma,
  includeAllDays = false,
) {
  const now = new Date();
  const { start: todayStart } = getUtcCalendarDayRange(now);
  const [readings, thresholds, patient] = await Promise.all([
    db.temperatureReading.findMany({
      where: { patientId, recordedAt: { lte: now } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { id: true, value: true, recordedAt: true },
    }),
    db.feverThresholdSetting.findMany({
      orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, value: true, effectiveFrom: true },
    }),
    includeAllDays ? db.patient.findUnique({ where: { id: patientId }, select: { admittedAt: true } }) : Promise.resolve(null),
  ]);

  const byDate = new Map<string, typeof readings>();
  for (const reading of readings) {
    const date = reading.recordedAt.toISOString().slice(0, 10);
    const daily = byDate.get(date) ?? [];
    daily.push(reading);
    byDate.set(date, daily);
  }

  let streak = 0;
  const days: Array<{
    date: string;
    hasReadings: boolean;
    readings: Array<{
      id: string;
      value: number;
      recordedAt: Date;
      applicableThreshold: { id: string; value: number; effectiveFrom: Date } | null;
      feverClassification: "FEVER" | "NO_FEVER" | "THRESHOLD_NOT_CONFIGURED";
    }>;
    feverFree: boolean;
    reason: string;
    streakLength: number;
  }> = [];

  const cursor = new Date(todayStart);
  let oldestDate = readings.length
    ? getUtcCalendarDayRange(readings[readings.length - 1].recordedAt).start
    : todayStart;
  if (includeAllDays && patient?.admittedAt) {
    oldestDate = getUtcCalendarDayRange(patient.admittedAt).start;
  }
  let currentStreakContinues = true;
  while (true) {
    if (includeAllDays && cursor < oldestDate) break;
    const date = cursor.toISOString().slice(0, 10);
    const dailyReadings = byDate.get(date) ?? [];
    const classifiedReadings = dailyReadings.map((reading) => {
      // Matching rule: greatest effectiveFrom among settings <= recordedAt.
      let applicableThreshold: (typeof thresholds)[number] | null = null;
      for (const setting of thresholds) {
        if (setting.effectiveFrom > reading.recordedAt) break;
        applicableThreshold = setting;
      }
      const feverClassification: "FEVER" | "NO_FEVER" | "THRESHOLD_NOT_CONFIGURED" = !applicableThreshold
        ? "THRESHOLD_NOT_CONFIGURED"
        : reading.value >= applicableThreshold.value ? "FEVER" : "NO_FEVER";
      return {
        ...reading,
        applicableThreshold: applicableThreshold
          ? {
              id: applicableThreshold.id,
              value: applicableThreshold.value,
              effectiveFrom: applicableThreshold.effectiveFrom,
            }
          : null,
        feverClassification,
      };
    });

    let feverFree = false;
    let reason: string;
    if (classifiedReadings.length === 0) {
      reason = "No temperature readings were recorded on this day.";
    } else if (classifiedReadings.some((reading) => reading.applicableThreshold === null)) {
      reason = "At least one reading has no fever threshold effective at its recorded time.";
    } else if (classifiedReadings.some((reading) => reading.value >= reading.applicableThreshold!.value)) {
      reason = "At least one reading was at or above its applicable historical threshold.";
    } else {
      feverFree = true;
      reason = "All readings were below their applicable historical thresholds.";
    }

    days.push({
      date,
      hasReadings: classifiedReadings.length > 0,
      readings: classifiedReadings,
      feverFree,
      reason,
      streakLength: 0,
    });

    if (currentStreakContinues) {
      if (feverFree) streak += 1;
      else currentStreakContinues = false;
    }
    if (!includeAllDays && !feverFree) break;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let dayStreak = 0;
  for (const day of [...days].reverse()) {
    dayStreak = day.feverFree ? dayStreak + 1 : 0;
    day.streakLength = dayStreak;
  }

  return { streak, eligible: streak >= 3, days };
}
