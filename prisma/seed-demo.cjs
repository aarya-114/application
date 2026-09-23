require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const DEMO_THRESHOLD_BASELINE_ID = "demo-threshold-baseline";
const DEMO_THRESHOLD_CHANGE_ID = "demo-threshold-change-1";
const DEMO_THRESHOLD_VALUE = 37.5;
const DEFAULT_THRESHOLD_ID = "fever-threshold-default";

const demoUsers = [
  { id: "demo-nurse", name: "Demo Nurse", role: "NURSE" },
  { id: "demo-doctor", name: "Demo Doctor", role: "DOCTOR" },
  { id: "demo-admin", name: "Demo Admin", role: "ADMIN" },
];

const patientFixtures = [
  { id: "demo-patient-01", name: "Maya Bennett", roomNumber: 1, status: "ACTIVE", outcome: "ONGOING", kind: "new" },
  { id: "demo-patient-02", name: "Noah Clarke", roomNumber: 2, status: "ACTIVE", outcome: "ONGOING", kind: "temp-only" },
  { id: "demo-patient-03", name: "Ava Patel", roomNumber: 3, status: "ACTIVE", outcome: "ONGOING", kind: "temp-visit" },
  { id: "demo-patient-04", name: "Ethan Brooks", roomNumber: 4, status: "ACTIVE", outcome: "ONGOING", kind: "fever" },
  { id: "demo-patient-05", name: "Lina Foster", roomNumber: 5, status: "ACTIVE", outcome: "ONGOING", kind: "one-day" },
  { id: "demo-patient-06", name: "Owen Rivera", roomNumber: 6, status: "ACTIVE", outcome: "ONGOING", kind: "two-days" },
  { id: "demo-patient-07", name: "Zara Kim", roomNumber: 7, status: "ACTIVE", outcome: "ONGOING", kind: "eligible" },
  { id: "demo-patient-08", name: "Caleb Morgan", roomNumber: null, historyRoomNumber: 8, status: "DISCHARGED", outcome: "CURED", kind: "cured" },
  { id: "demo-patient-09", name: "Iris Coleman", roomNumber: null, historyRoomNumber: 9, status: "DISCHARGED", outcome: "DECEASED", kind: "deceased" },
  { id: "demo-patient-10", name: "Leo Thompson", roomNumber: 10, status: "ACTIVE", outcome: "ONGOING", kind: "historical-threshold" },
  { id: "demo-patient-11", name: "Sofia Ward", roomNumber: 11, status: "ACTIVE", outcome: "ONGOING", kind: "duplicate-today" },
  { id: "demo-patient-12", name: "Arjun Shah", roomNumber: 12, status: "ACTIVE", outcome: "ONGOING", kind: "visit-no-temp" },
  { id: "demo-patient-13", name: "Mila Hughes", roomNumber: 13, status: "ACTIVE", outcome: "ONGOING", kind: "filler" },
  { id: "demo-patient-14", name: "Theo James", roomNumber: 14, status: "ACTIVE", outcome: "ONGOING", kind: "filler" },
  { id: "demo-patient-15", name: "Nina Flores", roomNumber: 15, status: "ACTIVE", outcome: "ONGOING", kind: "filler" },
  { id: "demo-patient-16", name: "Samir Desai", roomNumber: 16, status: "ACTIVE", outcome: "ONGOING", kind: "filler" },
  { id: "demo-patient-17", name: "Ella Price", roomNumber: 17, status: "ACTIVE", outcome: "ONGOING", kind: "filler" },
];

function utcDayStart(now, daysAgo = 0) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

function utcAt(now, daysAgo, hour = 9, minute = 0) {
  const date = utcDayStart(now, daysAgo);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function byEffectiveDate(a, b) {
  return a.effectiveFrom - b.effectiveFrom || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

async function upsertById(delegate, id, data) {
  const existing = await delegate.findUnique({ where: { id }, select: { id: true } });
  await delegate.upsert({ where: { id }, update: data, create: { id, ...data } });
  return existing ? "found" : "created";
}

async function upsertAudit(data) {
  return upsertById(prisma.auditLog, data.id, {
    actorId: data.actorId,
    action: data.action,
    patientId: data.patientId ?? null,
    details: JSON.stringify(data.details),
    createdAt: data.createdAt,
  });
}

async function ensureDemoUsersAndRooms() {
  const counts = { usersFound: 0, usersCreated: 0, roomsFound: 0, roomsCreated: 0 };
  for (const user of demoUsers) {
    const result = await upsertById(prisma.user, user.id, { name: user.name, role: user.role });
    counts[result === "found" ? "usersFound" : "usersCreated"] += 1;
  }

  for (let number = 1; number <= 74; number += 1) {
    const existing = await prisma.room.findUnique({ where: { number }, select: { id: true } });
    await prisma.room.upsert({
      where: { number },
      update: {},
      create: { id: `room-${String(number).padStart(2, "0")}`, number },
    });
    counts[existing ? "roomsFound" : "roomsCreated"] += 1;
  }
  return counts;
}

async function ensureThresholdHistory(now) {
  const defaultSetting = await prisma.feverThresholdSetting.findUnique({ where: { id: DEFAULT_THRESHOLD_ID } });
  if (!defaultSetting || defaultSetting.value !== 38.0) {
    throw new Error("Run the base seed first; the 38.0 default fever threshold is missing or changed.");
  }

  let thresholds = await prisma.feverThresholdSetting.findMany({
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, value: true, effectiveFrom: true, createdAt: true },
  });
  const curedHistoryStart = utcAt(now, 3, 8);
  const hasThresholdForCuredHistory = thresholds.some((setting) => setting.effectiveFrom <= curedHistoryStart);
  const baselineAt = utcAt(now, 14, 0);

  if (!hasThresholdForCuredHistory || thresholds.some((setting) => setting.id === DEMO_THRESHOLD_BASELINE_ID)) {
    const baselineData = {
      value: 38.0,
      setById: "demo-doctor",
      effectiveFrom: baselineAt,
      createdAt: baselineAt,
    };
    await prisma.feverThresholdSetting.upsert({
      where: { id: DEMO_THRESHOLD_BASELINE_ID },
      update: baselineData,
      create: { id: DEMO_THRESHOLD_BASELINE_ID, ...baselineData },
    });
    const oldValue = thresholds
      .filter((setting) => setting.effectiveFrom < baselineAt)
      .sort(byEffectiveDate)
      .at(-1)?.value ?? null;
    await upsertAudit({
      id: "demo-audit-threshold-baseline",
      actorId: "demo-doctor",
      action: "FEVER_THRESHOLD_CHANGED",
      createdAt: baselineAt,
      details: {
        oldValue,
        newValue: baselineData.value,
        effectiveFrom: baselineAt.toISOString(),
        unit: "Â°C",
      },
    });
  }

  thresholds = await prisma.feverThresholdSetting.findMany({
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, value: true, effectiveFrom: true, createdAt: true },
  });
  const effectiveFrom = utcAt(now, 3, 12);
  const previous = thresholds
    .filter((setting) => setting.id !== DEMO_THRESHOLD_CHANGE_ID && setting.effectiveFrom <= effectiveFrom)
    .sort(byEffectiveDate)
    .at(-1);
  const value = previous?.value === DEMO_THRESHOLD_VALUE ? 37.4 : DEMO_THRESHOLD_VALUE;
  const changeData = {
    value,
    setById: "demo-doctor",
    effectiveFrom,
    createdAt: now,
  };
  await prisma.feverThresholdSetting.upsert({
    where: { id: DEMO_THRESHOLD_CHANGE_ID },
    update: changeData,
    create: { id: DEMO_THRESHOLD_CHANGE_ID, ...changeData },
  });
  await upsertAudit({
    id: "demo-audit-threshold-change-1",
    actorId: "demo-doctor",
    action: "FEVER_THRESHOLD_CHANGED",
    createdAt: now,
    details: {
        oldValue: previous?.value ?? null,
      newValue: value,
      effectiveFrom: effectiveFrom.toISOString(),
      unit: "Â°C",
    },
  });

  const previousForReading = thresholds
    .filter((setting) => setting.id !== DEMO_THRESHOLD_CHANGE_ID && setting.effectiveFrom <= new Date(effectiveFrom.getTime() - 60_000))
    .sort(byEffectiveDate)
    .at(-1);
  if (!previousForReading) {
    throw new Error("Could not establish a historical threshold before the demo threshold change.");
  }
  let comparisonValue;
  if (previousForReading.value > value) {
    comparisonValue = (value + Math.min(previousForReading.value, 45)) / 2;
  } else {
    comparisonValue = (Math.max(previousForReading.value, 30) + value) / 2;
  }
  comparisonValue = Math.round(comparisonValue * 10) / 10;
  const preChangeReadingAt = new Date(effectiveFrom.getTime() - 60_000);
  const postChangeReadingAt = new Date(effectiveFrom.getTime() + 60_000);

  thresholds = await prisma.feverThresholdSetting.findMany({
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, value: true, effectiveFrom: true, createdAt: true },
  });
  const currentThreshold = thresholds
    .filter((setting) => setting.effectiveFrom <= now)
    .sort(byEffectiveDate)
    .at(-1);
  let currentValue = currentThreshold?.value ?? value;
  if (currentThreshold && (currentValue < 30 || currentValue > 45)) {
    const restoreAt = new Date(now);
    const restoreData = {
      value: 38.0,
      setById: "demo-doctor",
      effectiveFrom: restoreAt,
      createdAt: restoreAt,
    };
    await prisma.feverThresholdSetting.upsert({
      where: { id: "demo-threshold-current-restore" },
      update: restoreData,
      create: { id: "demo-threshold-current-restore", ...restoreData },
    });
    await upsertAudit({
      id: "demo-audit-threshold-current-restore",
      actorId: "demo-doctor",
      action: "FEVER_THRESHOLD_CHANGED",
      createdAt: restoreAt,
      details: {
        oldValue: currentValue,
        newValue: restoreData.value,
        effectiveFrom: restoreAt.toISOString(),
        unit: "Â°C",
      },
    });
    currentValue = restoreData.value;
  }

  return {
    value,
    effectiveFrom,
    previousValue: previousForReading.value,
    comparisonValue,
    preChangeReadingAt,
    postChangeReadingAt,
    baselineAt,
    currentValue,
  };
}

async function chooseActiveRooms(fixtures, rooms) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const fixtureIds = new Set(fixtures.map((patient) => patient.id));
  const existingDemo = await prisma.patient.findMany({
    where: { id: { in: [...fixtureIds] } },
    select: { id: true, roomId: true },
  });
  const existingRoomByPatientId = new Map(existingDemo.map((patient) => [patient.id, patient.roomId]));
  const allAssigned = await prisma.patient.findMany({ where: { roomId: { not: null } }, select: { id: true, roomId: true } });
  const usedRoomIds = new Set(allAssigned.filter((patient) => !fixtureIds.has(patient.id)).map((patient) => patient.roomId));
  for (const patient of existingDemo) if (patient.roomId) usedRoomIds.add(patient.roomId);

  const selected = new Map();
  for (const fixture of fixtures.filter((patient) => patient.status === "ACTIVE")) {
    const existingRoomId = existingRoomByPatientId.get(fixture.id);
    if (existingRoomId && roomById.has(existingRoomId)) {
      selected.set(fixture.id, roomById.get(existingRoomId));
      usedRoomIds.add(existingRoomId);
      continue;
    }
    const preferred = rooms.find((room) => room.number === fixture.roomNumber && !usedRoomIds.has(room.id));
    const room = preferred ?? rooms.find((candidate) => !usedRoomIds.has(candidate.id));
    if (!room) throw new Error(`No free room is available for demo patient ${fixture.id}.`);
    selected.set(fixture.id, room);
    usedRoomIds.add(room.id);
  }
  return selected;
}

async function seedPatients(now, roomByPatientId) {
  const counts = { created: 0, found: 0 };
  const roomByNumber = new Map((await prisma.room.findMany({ select: { id: true, number: true } })).map((room) => [room.number, room]));
  const dischargeDateByPatient = new Map([
    ["demo-patient-08", utcAt(now, 1, 17)],
    ["demo-patient-09", utcAt(now, 2, 17)],
  ]);
  const admittedAtByPatient = new Map([
    ["demo-patient-01", now],
    ["demo-patient-08", utcAt(now, 12, 9)],
    ["demo-patient-09", utcAt(now, 12, 9)],
  ]);

  for (const fixture of patientFixtures) {
    const room = fixture.status === "ACTIVE"
      ? roomByPatientId.get(fixture.id)
      : roomByNumber.get(fixture.historyRoomNumber);
    if (!room) throw new Error(`Base seed room is missing for ${fixture.id}.`);
    const admittedAt = admittedAtByPatient.get(fixture.id) ?? utcAt(now, 12, 9);
    const dischargedAt = dischargeDateByPatient.get(fixture.id) ?? null;
    const data = {
      name: fixture.name,
      roomId: fixture.status === "ACTIVE" ? room.id : null,
      status: fixture.status,
      outcome: fixture.outcome,
      admittedAt,
      dischargedAt,
    };
    const result = await upsertById(prisma.patient, fixture.id, data);
    counts[result] += 1;
    await upsertAudit({
      id: `demo-audit-admitted-${fixture.id.slice(-2)}`,
      actorId: "demo-admin",
      action: "PATIENT_ADMITTED",
      patientId: fixture.id,
      createdAt: admittedAt,
      details: { roomId: room.id, roomNumber: room.number },
    });
  }
  return { ...counts, roomByNumber };
}

function buildReadingFixtures(now, thresholdDemo) {
  const reading = (id, patientId, value, recordedAt) => ({ id, patientId, value, recordedAt, note: null });
  const readings = [
    reading("demo-temp-02-today", "demo-patient-02", 37.0, now),
    reading("demo-temp-03-today", "demo-patient-03", 37.2, now),
    reading("demo-temp-04-today-fever", "demo-patient-04", thresholdDemo.currentValue, now),
    reading("demo-temp-05-today", "demo-patient-05", 37.1, now),
    reading("demo-temp-06-yesterday", "demo-patient-06", 37.1, utcAt(now, 1, 9)),
    reading("demo-temp-06-today", "demo-patient-06", 37.1, now),
  ];
  for (const daysAgo of [2, 1, 0]) {
    readings.push(reading(`demo-temp-07-day${daysAgo}`, "demo-patient-07", 37.0, daysAgo === 0 ? now : utcAt(now, daysAgo, 9)));
  }
  for (const daysAgo of [3, 2, 1]) {
    readings.push(reading(`demo-temp-08-discharge-day${daysAgo}`, "demo-patient-08", 37.0, utcAt(now, daysAgo, 8)));
  }
  readings.push(
    reading("demo-temp-10-before-threshold", "demo-patient-10", thresholdDemo.comparisonValue, thresholdDemo.preChangeReadingAt),
    reading("demo-temp-10-after-threshold", "demo-patient-10", thresholdDemo.comparisonValue, thresholdDemo.postChangeReadingAt),
    reading("demo-temp-11-today-a", "demo-patient-11", 37.0, now),
    reading("demo-temp-11-today-b", "demo-patient-11", 37.2, now),
  );
  for (let number = 13; number <= 17; number += 1) {
    readings.push(reading(`demo-temp-${String(number).padStart(2, "0")}-today`, `demo-patient-${String(number).padStart(2, "0")}`, 37.0 + (number % 4) / 10, now));
  }
  return readings;
}

async function seedReadings(readings) {
  const counts = { created: 0, found: 0 };
  for (const reading of readings) {
    const result = await upsertById(prisma.temperatureReading, reading.id, {
      patientId: reading.patientId,
      value: reading.value,
      recordedById: "demo-nurse",
      recordedAt: reading.recordedAt,
      note: reading.note,
    });
    counts[result] += 1;
    await upsertAudit({
      id: `demo-audit-temperature-${reading.id.slice("demo-temp-".length)}`,
      actorId: "demo-nurse",
      action: "TEMPERATURE_RECORDED",
      patientId: reading.patientId,
      createdAt: reading.recordedAt,
      details: { readingId: reading.id, value: reading.value },
    });
  }
  return counts;
}

async function seedVisits(now) {
  const visits = [
    { id: "demo-visit-03-today", patientId: "demo-patient-03", visitedAt: now, note: "Daily review completed." },
    { id: "demo-visit-12-today", patientId: "demo-patient-12", visitedAt: now, note: "Reviewed; temperature is still pending." },
  ];
  const counts = { created: 0, found: 0 };
  for (const visit of visits) {
    const result = await upsertById(prisma.doctorVisit, visit.id, {
      patientId: visit.patientId,
      doctorId: "demo-doctor",
      visitedAt: visit.visitedAt,
      note: visit.note,
    });
    counts[result] += 1;
    await upsertAudit({
      id: `demo-audit-visit-${visit.id.slice("demo-visit-".length)}`,
      actorId: "demo-doctor",
      action: "DOCTOR_VISIT_RECORDED",
      patientId: visit.patientId,
      createdAt: visit.visitedAt,
      details: { visitId: visit.id },
    });
  }
  return counts;
}

async function seedDischargeAudits(now, roomByNumber) {
  for (const fixture of patientFixtures.filter((patient) => patient.status === "DISCHARGED")) {
    const dischargedAt = fixture.kind === "cured" ? utcAt(now, 1, 17) : utcAt(now, 2, 17);
    const room = roomByNumber.get(fixture.historyRoomNumber);
    const cured = fixture.outcome === "CURED";
    await upsertAudit({
      id: `demo-audit-discharged-${fixture.id.slice(-2)}`,
      actorId: "demo-admin",
      action: "PATIENT_DISCHARGED",
      patientId: fixture.id,
      createdAt: dischargedAt,
      details: {
        outcome: fixture.outcome,
        dischargedAt: dischargedAt.toISOString(),
        feverFreeStreakDays: cured ? 3 : 0,
        eligibleForCuredDischarge: cured,
        releasedRoomId: room.id,
      },
    });
  }
}

async function countLiveEligiblePatients(now) {
  const todayStart = utcDayStart(now);
  const thresholds = await prisma.feverThresholdSetting.findMany({
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, value: true, effectiveFrom: true, createdAt: true },
  });
  const patients = await prisma.patient.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      readings: {
        where: { recordedAt: { lte: now } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: { id: true, value: true, recordedAt: true },
      },
    },
  });

  let eligible = 0;
  for (const patient of patients) {
    const byDate = new Map();
    for (const reading of patient.readings) {
      const date = reading.recordedAt.toISOString().slice(0, 10);
      const daily = byDate.get(date) ?? [];
      daily.push(reading);
      byDate.set(date, daily);
    }
    let streak = 0;
    const cursor = new Date(todayStart);
    while (true) {
      const readings = byDate.get(cursor.toISOString().slice(0, 10)) ?? [];
      if (readings.length === 0) break;
      const allBelowThreshold = readings.every((reading) => {
        let applicable = null;
        for (const setting of thresholds) {
          if (setting.effectiveFrom > reading.recordedAt) break;
          applicable = setting;
        }
        return applicable !== null && reading.value < applicable.value;
      });
      if (!allBelowThreshold) break;
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    if (streak >= 3) eligible += 1;
  }
  return eligible;
}

async function main() {
  const now = new Date();
  const dependencyCounts = await ensureDemoUsersAndRooms();
  const rooms = await prisma.room.findMany({ orderBy: { number: "asc" }, select: { id: true, number: true } });
  if (rooms.length !== 74) throw new Error(`Expected 74 base rooms; found ${rooms.length}.`);

  const thresholdDemo = await ensureThresholdHistory(now);
  const roomByPatientId = await chooseActiveRooms(patientFixtures, rooms);
  const patientCounts = await seedPatients(now, roomByPatientId);
  const readingFixtures = buildReadingFixtures(now, thresholdDemo);
  const readingCounts = await seedReadings(readingFixtures);
  const visitCounts = await seedVisits(now);
  await seedDischargeAudits(now, patientCounts.roomByNumber);

  const [activePatients, occupiedRooms, curedDischarges, deceasedDischarges, totalThresholdRows, liveEligible] = await Promise.all([
    prisma.patient.count({ where: { status: "ACTIVE" } }),
    prisma.room.count({ where: { patients: { some: { status: "ACTIVE" } } } }),
    prisma.patient.count({ where: { status: "DISCHARGED", outcome: "CURED" } }),
    prisma.patient.count({ where: { status: "DISCHARGED", outcome: "DECEASED" } }),
    prisma.feverThresholdSetting.count(),
    countLiveEligiblePatients(new Date()),
  ]);
  const demoAuditIds = [
    "demo-audit-threshold-baseline",
    "demo-audit-threshold-change-1",
    ...(await prisma.feverThresholdSetting.findUnique({ where: { id: "demo-threshold-current-restore" }, select: { id: true } })
      ? ["demo-audit-threshold-current-restore"]
      : []),
    ...patientFixtures.map((patient) => `demo-audit-admitted-${patient.id.slice(-2)}`),
    ...readingFixtures.map((reading) => `demo-audit-temperature-${reading.id.slice("demo-temp-".length)}`),
    "demo-audit-visit-03-today",
    "demo-audit-visit-12-today",
    "demo-audit-discharged-08",
    "demo-audit-discharged-09",
  ];
  const demoAuditCount = await prisma.auditLog.count({ where: { id: { in: demoAuditIds } } });

  console.log("Demo seed summary:");
  console.log(`Users found/created: ${dependencyCounts.usersFound}/${dependencyCounts.usersCreated}`);
  console.log(`Rooms found/created: ${dependencyCounts.roomsFound}/${dependencyCounts.roomsCreated}`);
  console.log(`Demo patients found/created: ${patientCounts.found}/${patientCounts.created} (${patientFixtures.length} total)`);
  console.log(`Temperature readings found/created: ${readingCounts.found}/${readingCounts.created} (${readingFixtures.length} total)`);
  console.log(`Doctor visits found/created: ${visitCounts.found}/${visitCounts.created} (2 total)`);
  console.log(`Demo audit rows: ${demoAuditCount}/${demoAuditIds.length}`);
  console.log(`Active patients: ${activePatients}`);
  console.log(`Occupied rooms: ${occupiedRooms}/74`);
  console.log(`Discharged cured: ${curedDischarges}`);
  console.log(`Discharged deceased: ${deceasedDischarges}`);
  console.log(`Currently live-discharge-eligible: ${liveEligible}`);
  console.log(`FeverThresholdSetting rows: ${totalThresholdRows}`);
  console.log(`Demo threshold: ${thresholdDemo.value}°C effective ${thresholdDemo.effectiveFrom.toISOString()}`);
  console.log(`Current threshold: ${thresholdDemo.currentValue}°C`);
  const beforeResult = thresholdDemo.comparisonValue >= thresholdDemo.previousValue ? "FEVER" : "NO_FEVER";
  const afterResult = thresholdDemo.comparisonValue >= thresholdDemo.value ? "FEVER" : "NO_FEVER";
  const beforeOperator = beforeResult === "FEVER" ? "≥" : "<";
  const afterOperator = afterResult === "FEVER" ? "≥" : "<";
  console.log(`Historical baseline: 38.0°C effective ${thresholdDemo.baselineAt.toISOString()}`);
  console.log(`Historical comparison: ${thresholdDemo.comparisonValue}°C ${beforeOperator} ${thresholdDemo.previousValue}°C before (${beforeResult}); ${thresholdDemo.comparisonValue}°C ${afterOperator} ${thresholdDemo.value}°C after (${afterResult}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
