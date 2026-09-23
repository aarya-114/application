import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

const root = process.cwd();
const testDbName = `phase5-temperature-${process.pid}.db`;
const testDbPath = resolve(root, "prisma", testDbName);
const testDatabaseUrl = `file:./${testDbName}`;
const testSecret = "phase-three-integration-test-secret";
const defaultThresholdId = "fever-threshold-default";
const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  SESSION_SECRET: testSecret,
  RUST_LOG: "info",
  NEXT_TELEMETRY_DISABLED: "1",
};

process.env.DATABASE_URL = testDatabaseUrl;
process.env.SESSION_SECRET = testSecret;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let serverProcess;
let baseUrl;
let adminCookie;
let nurseCookie;
let doctorCookie;

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

async function getFreePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  listener.close();
  await once(listener, "close");
  return address.port;
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Next.js test server exited with ${serverProcess.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`Next.js test server did not start: ${lastError ?? "startup timeout"}`);
}

async function signIn(userId) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  assert.equal(response.status, 200, `Login failed for ${userId}: ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, `No signed session cookie issued for ${userId}`);
  return cookie;
}

async function postPatient(cookie, name, roomId) {
  return fetch(`${baseUrl}/api/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name, roomId }),
  });
}

before(async () => {
  runNode(["node_modules/prisma/build/index.js", "migrate", "deploy"], "Test database migrations");
  runNode(["prisma/seed.cjs"], "Initial test database seed");
  runNode(["prisma/seed.cjs"], "Idempotent test database seed");
  assert.equal(await prisma.room.count(), 74, "Seed must leave exactly 74 rooms");
  assert.equal(await prisma.feverThresholdSetting.count(), 1, "Seed must create one default threshold");
  assert.equal((await prisma.feverThresholdSetting.findUnique({ where: { id: defaultThresholdId } })).value, 38.0);

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(port)],
    { cwd: root, env, stdio: "ignore", windowsHide: true },
  );
  await waitForServer();
  adminCookie = await signIn("demo-admin");
  nurseCookie = await signIn("demo-nurse");
  doctorCookie = await signIn("demo-doctor");
});

beforeEach(async () => {
  await prisma.temperatureReading.deleteMany();
  await prisma.doctorVisit.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.feverThresholdSetting.deleteMany();
  const now = new Date("2026-01-01T00:00:00.000Z");
  await prisma.feverThresholdSetting.create({
    data: {
      id: defaultThresholdId,
      value: 38.0,
      setById: "demo-doctor",
      effectiveFrom: now,
      createdAt: now,
    },
  });
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const serverPid = serverProcess.pid;
    if (process.platform === "win32") {
      const killProcessTree = () => {
        if (!serverPid) return;
        spawnSync("taskkill", ["/pid", String(serverPid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      };
      // Enumerate descendants while the parent PID still exists.
      killProcessTree();
      try { serverProcess.kill(); } catch { /* taskkill may already have stopped it. */ }
      // Keep the requested post-kill tree cleanup as a final sweep.
      killProcessTree();
    } else {
      serverProcess.kill();
      await Promise.race([once(serverProcess, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
    }
  }
  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(`${testDbPath}${suffix}`, { force: true });
        break;
      } catch (error) {
        const retryable = error?.code === "EPERM" || error?.code === "EBUSY";
        if (!retryable || attempt === 4) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
  }
});

test("seeding is idempotent and the rooms endpoint reports availability", async () => {
  runNode(["prisma/seed.cjs"], "Repeated seed with an existing threshold");
  runNode(["prisma/seed.cjs"], "Second repeated seed with an existing threshold");
  assert.equal(await prisma.room.count(), 74);
  assert.equal(await prisma.feverThresholdSetting.count(), 1);

  const roomsResponse = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: adminCookie } });
  assert.equal(roomsResponse.status, 200);
  const { rooms } = await roomsResponse.json();
  assert.equal(rooms.length, 74);
  assert.deepEqual(rooms.map((room) => room.number), Array.from({ length: 74 }, (_, i) => i + 1));
  assert.ok(rooms.every((room) => room.status === "AVAILABLE" && room.patient === null));

  const admit = await postPatient(adminCookie, "Room status patient", rooms[0].id);
  assert.equal(admit.status, 201);
  const updatedResponse = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: adminCookie } });
  const updatedRooms = (await updatedResponse.json()).rooms;
  assert.equal(updatedRooms[0].status, "OCCUPIED");
  assert.deepEqual(
    { id: updatedRooms[0].patient.id, name: updatedRooms[0].patient.name },
    { id: (await admit.json()).patient.id, name: "Room status patient" },
  );
  assert.equal(updatedRooms[1].status, "AVAILABLE");
});

test("ADMIN admission succeeds and Nurse and Doctor admissions receive 403", async () => {
  const roomId = `room-${String(1).padStart(2, "0")}`;
  for (const cookie of [nurseCookie, doctorCookie]) {
    const response = await postPatient(cookie, "Denied patient", roomId);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /requires one of these roles: ADMIN/);
  }

  const allowed = await postPatient(adminCookie, "Admin patient", roomId);
  assert.equal(allowed.status, 201);
  const { patient } = await allowed.json();
  assert.equal(patient.status, "ACTIVE");
  assert.equal(patient.outcome, "ONGOING");
  assert.equal(patient.roomId, roomId);
  assert.ok(patient.admittedAt);
  const admissionAudit = await prisma.auditLog.findFirst({ where: { action: "PATIENT_ADMITTED", patientId: patient.id } });
  assert.ok(admissionAudit);
  assert.equal(admissionAudit.actorId, "demo-admin");
  assert.deepEqual(JSON.parse(admissionAudit.details), { roomId, roomNumber: 1 });

  const nurseRooms = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: nurseCookie } });
  assert.equal(nurseRooms.status, 403);
});

test("the first 74 admissions succeed and the 75th is rejected", async () => {
  const { rooms } = await (await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: adminCookie } })).json();
  for (const [index, room] of rooms.entries()) {
    const response = await postPatient(adminCookie, `Patient ${index + 1}`, room.id);
    assert.equal(response.status, 201, `Admission ${index + 1} failed: ${await response.text()}`);
  }

  assert.equal(await prisma.patient.count({ where: { status: "ACTIVE" } }), 74);
  const auditsBeforeOverflow = await prisma.auditLog.count({ where: { action: "PATIENT_ADMITTED" } });
  const overflow = await postPatient(adminCookie, "Patient 75", rooms[0].id);
  assert.equal(overflow.status, 409);
  assert.match((await overflow.json()).error, /All 74 rooms are occupied.*No room is available/);
  assert.equal(await prisma.patient.count(), 74);
  assert.equal(await prisma.patient.count({ where: { roomId: { not: null } } }), 74);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_ADMITTED" } }), auditsBeforeOverflow);
});

test("occupied and nonexistent rooms are rejected with clear errors", async () => {
  const roomId = "room-01";
  const admitted = await postPatient(adminCookie, "First patient", roomId);
  assert.equal(admitted.status, 201);
  const patient = (await admitted.json()).patient;

  const occupied = await postPatient(adminCookie, "Second patient", roomId);
  assert.equal(occupied.status, 409);
  assert.match((await occupied.json()).error, /already occupied/);

  const missing = await postPatient(adminCookie, "Missing room patient", "not-a-room");
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /room does not exist/);
  assert.equal(await prisma.patient.count(), 1);
  const stored = await prisma.patient.findUnique({ where: { id: patient.id } });
  assert.equal(stored.roomId, roomId);
  assert.equal(stored.status, "ACTIVE");
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_ADMITTED" } }), 1);
});

test("concurrent admissions for one room allow only one assignment", async () => {
  const responses = await Promise.all([
    postPatient(adminCookie, "Concurrent patient A", "room-01"),
    postPatient(adminCookie, "Concurrent patient B", "room-01"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.patient.count({ where: { roomId: "room-01" } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_ADMITTED" } }), 1);
});

test("invalid admission input is rejected", async () => {
  const missingRoom = await fetch(`${baseUrl}/api/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "Missing room" }),
  });
  assert.equal(missingRoom.status, 400);
  assert.match((await missingRoom.json()).error, /roomId is required/);

  const missingName = await postPatient(adminCookie, "   ", "room-01");
  assert.equal(missingName.status, 400);
  assert.match((await missingName.json()).error, /Patient name is required/);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_ADMITTED" } }), 0);
});

async function getThreshold(cookie) {
  return fetch(`${baseUrl}/api/settings/fever-threshold`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function postThreshold(cookie, rawBody) {
  return fetch(`${baseUrl}/api/settings/fever-threshold`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
  });
}

test("Doctor can view the current seeded threshold", async () => {
  const response = await getThreshold(doctorCookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.current.value, 38.0);
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].oldValue, null);
  assert.equal(body.history[0].newValue, 38.0);
  assert.equal(body.history[0].isSeededDefault, true);
  assert.equal(body.history[0].setBy, null);
  assert.equal(body.history[0].source, "SEEDED_DEFAULT");
});

test("Doctor changes threshold and the API creates an audit log", async () => {
  const response = await postThreshold(doctorCookie, { value: 39.2 });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.oldValue, 38.0);
  assert.equal(body.setting.value, 39.2);
  assert.equal(body.setting.setBy.id, "demo-doctor");

  const audit = await prisma.auditLog.findFirst({ where: { action: "FEVER_THRESHOLD_CHANGED" } });
  assert.ok(audit);
  assert.equal(audit.actorId, "demo-doctor");
  assert.ok(audit.createdAt instanceof Date);
  assert.equal(audit.createdAt.toISOString(), body.setting.createdAt);
  assert.deepEqual(JSON.parse(audit.details), {
    oldValue: 38.0,
    newValue: 39.2,
    effectiveFrom: body.setting.effectiveFrom,
    unit: "°C",
  });
});

test("the first threshold change records a null old value when no setting exists", async () => {
  await prisma.feverThresholdSetting.deleteMany();
  const response = await postThreshold(doctorCookie, { value: 38.4 });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.oldValue, null);

  const audit = await prisma.auditLog.findFirst({ where: { action: "FEVER_THRESHOLD_CHANGED" } });
  assert.deepEqual(JSON.parse(audit.details), {
    oldValue: null,
    newValue: 38.4,
    effectiveFrom: body.setting.effectiveFrom,
    unit: "°C",
  });
});

test("threshold history appends rows and returns the latest value first", async () => {
  for (const value of [39.0, 37.8]) {
    const response = await postThreshold(doctorCookie, { value });
    assert.equal(response.status, 201);
  }

  const allRows = await prisma.feverThresholdSetting.findMany({ orderBy: { effectiveFrom: "asc" } });
  assert.equal(allRows.length, 3);
  assert.deepEqual(allRows.map((row) => row.value), [38.0, 39.0, 37.8]);
  assert.equal(allRows[0].value, 38.0);
  assert.equal(allRows[1].value, 39.0);

  const response = await getThreshold(doctorCookie);
  const body = await response.json();
  assert.equal(body.current.value, 37.8);
  assert.deepEqual(body.history.map((entry) => entry.value), [37.8, 39.0, 38.0]);
  assert.deepEqual(body.history.map((entry) => entry.oldValue), [39.0, 38.0, null]);
});

test("Nurse and Admin can view but cannot change the threshold", async () => {
  for (const cookie of [nurseCookie, adminCookie]) {
    assert.equal((await getThreshold(cookie)).status, 200);
    const response = await postThreshold(cookie, { value: 39.0 });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /requires one of these roles: DOCTOR/);
  }
  assert.equal(await prisma.feverThresholdSetting.count(), 1);
});

test("unauthenticated threshold GET and POST requests are rejected", async () => {
  const getResponse = await getThreshold(undefined);
  assert.equal(getResponse.status, 401);
  assert.match((await getResponse.json()).error, /Authentication required/);

  const postResponse = await postThreshold(undefined, { value: 39.0 });
  assert.equal(postResponse.status, 401);
  assert.match((await postResponse.json()).error, /Authentication required/);
});

test("missing, non-numeric, NaN, and infinite thresholds are rejected", async () => {
  for (const body of ["{}", JSON.stringify({ value: "" }), JSON.stringify({ value: null })]) {
    const response = await postThreshold(doctorCookie, body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Threshold value is required/);
  }
  const invalidBodies = [
    JSON.stringify({ value: "38.5" }),
    JSON.stringify({ value: "NaN" }),
    JSON.stringify({ value: "Infinity" }),
    JSON.stringify({ value: "abc" }),
    '{"value":1e400}',
    '{"value":233322333333e3}',
    JSON.stringify({ value: 29 }),
    JSON.stringify({ value: 46 }),
    JSON.stringify({ value: 56 }),
  ];
  for (const body of invalidBodies) {
    const response = await postThreshold(doctorCookie, body);
    assert.equal(response.status, 400, `Expected invalid input to fail: ${body}`);
    assert.match((await response.json()).error, /finite number|between 30 and 45/);
  }
  assert.equal(await prisma.feverThresholdSetting.count(), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "FEVER_THRESHOLD_CHANGED" } }), 0);
});

test("threshold sanity range accepts 30 and 45 inclusive", async () => {
  for (const value of [30, 45]) {
    const response = await postThreshold(doctorCookie, { value });
    assert.equal(response.status, 201);
  }
  assert.deepEqual((await prisma.feverThresholdSetting.findMany()).map((entry) => entry.value).sort((a, b) => a - b), [30, 38.0, 45]);
  assert.equal(await prisma.auditLog.count({ where: { action: "FEVER_THRESHOLD_CHANGED" } }), 2);
});

async function createActivePatient(name, roomNumber = 1) {
  const response = await postPatient(adminCookie, name, `room-${String(roomNumber).padStart(2, "0")}`);
  if (response.status !== 201) {
    throw new Error(`Could not create active patient ${name}: ${await response.text()}`);
  }
  return (await response.json()).patient;
}

async function recordTemperature(cookie, patientId, rawBody) {
  return fetch(`${baseUrl}/api/patients/${patientId}/temperature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
  });
}

async function recordVisit(cookie, patientId, rawBody = {}) {
  return fetch(`${baseUrl}/api/patients/${patientId}/visit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
  });
}

function utcDateDaysAgo(daysAgo, millisecondsAfterMidnight = 1000) {
  const { start } = getUtcTestDayRange();
  return new Date(start.getTime() - daysAgo * 24 * 60 * 60 * 1000 + millisecondsAfterMidnight);
}

async function addTemperature(patientId, value, daysAgo = 0, millisecondsAfterMidnight = 1000) {
  return prisma.temperatureReading.create({
    data: {
      patientId,
      value,
      recordedById: "demo-nurse",
      recordedAt: utcDateDaysAgo(daysAgo, millisecondsAfterMidnight),
    },
  });
}

async function getVisitPatients(filter = "needsVisitToday", cookie = doctorCookie) {
  return fetch(`${baseUrl}/api/patients?filter=${filter}`, { headers: cookie ? { Cookie: cookie } : {} });
}

test("Doctor records a visit with optional note and persisted identity", async () => {
  const patient = await createActivePatient("Visit patient");
  await addTemperature(patient.id, 37.2);
  const response = await recordVisit(doctorCookie, patient.id, { note: "Reviewed this morning" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.visit.patientId, patient.id);
  assert.equal(body.visit.doctorId, "demo-doctor");
  assert.equal(body.visit.note, "Reviewed this morning");
  assert.equal(body.duplicateToday, false);
  assert.equal(body.warning, undefined);
  assert.equal(await prisma.doctorVisit.count({ where: { patientId: patient.id } }), 1);
  const audit = await prisma.auditLog.findFirst({ where: { action: "DOCTOR_VISIT_RECORDED", patientId: patient.id } });
  assert.ok(audit);
  assert.equal(audit.actorId, "demo-doctor");
  assert.deepEqual(JSON.parse(audit.details), { visitId: body.visit.id });
});

test("a visit without today's temperature is allowed with the exact warning", async () => {
  const patient = await createActivePatient("Missing temperature visit");
  const response = await recordVisit(doctorCookie, patient.id);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.warning, "Temperature not yet recorded today");
  assert.equal(body.visit.patientId, patient.id);
  assert.equal(await prisma.doctorVisit.count({ where: { patientId: patient.id } }), 1);
});

test("duplicate same-day doctor visits are allowed and both persist", async () => {
  const patient = await createActivePatient("Duplicate visit patient");
  const first = await recordVisit(doctorCookie, patient.id, { note: "First" });
  const second = await recordVisit(doctorCookie, patient.id, { note: "Second" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await first.json()).duplicateToday, false);
  const secondBody = await second.json();
  assert.equal(secondBody.duplicateToday, true);
  assert.equal(secondBody.warning, "Temperature not yet recorded today");
  assert.equal(await prisma.doctorVisit.count({ where: { patientId: patient.id } }), 2);
});

test("only Doctors can record visits; unauthenticated requests are rejected", async () => {
  const patient = await createActivePatient("Restricted visit patient");
  for (const cookie of [nurseCookie, adminCookie]) {
    const response = await recordVisit(cookie, patient.id);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /requires one of these roles: DOCTOR/);
  }
  const unauthenticated = await recordVisit(undefined, patient.id);
  assert.equal(unauthenticated.status, 401);
  assert.match((await unauthenticated.json()).error, /Authentication required/);
  assert.equal(await prisma.doctorVisit.count(), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "DOCTOR_VISIT_RECORDED" } }), 0);
});

test("visit list separates pending and completed patients and reports today's review data", async () => {
  const pending = await createActivePatient("Pending visit patient", 1);
  const visited = await createActivePatient("Completed visit patient", 2);
  await addTemperature(pending.id, 38.0);
  await addTemperature(visited.id, 37.0);
  const recordedVisit = await recordVisit(doctorCookie, visited.id);
  assert.equal(recordedVisit.status, 201);

  const pendingResponse = await getVisitPatients();
  assert.equal(pendingResponse.status, 200);
  const pendingBody = await pendingResponse.json();
  assert.equal(pendingBody.timezone, "UTC");
  const pendingReview = pendingBody.patients.find((entry) => entry.id === pending.id);
  assert.ok(pendingReview);
  assert.equal(pendingReview.todayTemperature.value, 38.0);
  assert.equal(pendingReview.feverClassification, "FEVER");
  assert.equal(pendingReview.visitStatus, "VISIT_PENDING");
  assert.ok(!pendingBody.patients.some((entry) => entry.id === visited.id));

  const completedResponse = await getVisitPatients("completedVisitToday");
  const completedBody = await completedResponse.json();
  const completedReview = completedBody.patients.find((entry) => entry.id === visited.id);
  assert.ok(completedReview);
  assert.equal(completedReview.todayTemperature.value, 37.0);
  assert.equal(completedReview.feverClassification, "NO_FEVER");
  assert.equal(completedReview.visitStatus, "VISITED_TODAY");
  assert.equal(completedReview.todayVisits.length, 1);
  assert.equal(completedReview.todayVisits[0].doctor.id, "demo-doctor");
});

test("review distinguishes missing temperature and uses latest reading per day for the streak", async () => {
  const threshold = 38.0;
  const streak = await createActivePatient("Three day streak", 1);
  const feverBreak = await createActivePatient("Fever break", 2);
  const missingBreak = await createActivePatient("Missing day break", 3);
  const latestDaily = await createActivePatient("Latest daily reading", 4);
  const missingToday = await createActivePatient("No temperature today", 5);

  for (const patient of [streak, feverBreak, missingBreak, latestDaily]) await addTemperature(patient.id, 37.0);
  await addTemperature(streak.id, 37.0, 1);
  await addTemperature(streak.id, 37.0, 2);
  await addTemperature(feverBreak.id, 37.0, 1);
  await addTemperature(feverBreak.id, 38.0, 2);
  await addTemperature(feverBreak.id, 37.0, 3);
  await addTemperature(missingBreak.id, 37.0, 2);
  await addTemperature(missingBreak.id, 37.0, 3);
  await addTemperature(latestDaily.id, 38.5, 1, 1000);
  await addTemperature(latestDaily.id, 37.0, 1, 2000);
  await addTemperature(latestDaily.id, 37.0, 2);

  const response = await getVisitPatients();
  const body = await response.json();
  const byId = new Map(body.patients.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(streak.id).feverFreeStreakDays, 3);
  assert.equal(byId.get(feverBreak.id).feverFreeStreakDays, 2);
  assert.equal(byId.get(missingBreak.id).feverFreeStreakDays, 1);
  assert.equal(byId.get(latestDaily.id).feverFreeStreakDays, 3);
  const missingReview = byId.get(missingToday.id);
  assert.equal(missingReview.todayTemperature, null);
  assert.equal(missingReview.feverClassification, "NOT_RECORDED");
  assert.equal(missingReview.feverFreeStreakDays, 0);
});

test("current threshold reclassifies raw readings without modifying them", async () => {
  const patient = await createActivePatient("Threshold review patient");
  const reading = await addTemperature(patient.id, 38.1);
  const initial = await (await getVisitPatients()).json();
  assert.equal(initial.patients.find((entry) => entry.id === patient.id).feverClassification, "FEVER");

  const changed = await postThreshold(doctorCookie, { value: 38.2 });
  assert.equal(changed.status, 201);
  const updated = await (await getVisitPatients()).json();
  const review = updated.patients.find((entry) => entry.id === patient.id);
  assert.equal(review.feverClassification, "NO_FEVER");
  assert.equal(updated.currentThreshold.value, 38.2);
  const raw = await prisma.temperatureReading.findUnique({ where: { id: reading.id } });
  assert.equal(raw.value, 38.1);
});

test("current fever classification marks below as no fever and equality or above as fever", async () => {
  const patients = await Promise.all([
    createActivePatient("Below current threshold", 1),
    createActivePatient("At current threshold", 2),
    createActivePatient("Above current threshold", 3),
  ]);
  for (const [index, value] of [37.9, 38.0, 38.1].entries()) {
    const response = await recordTemperature(nurseCookie, patients[index].id, { value });
    assert.equal(response.status, 201);
  }
  const response = await fetch(`${baseUrl}/api/patients?filter=needsVisitToday`, { headers: { Cookie: doctorCookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  const classificationByPatient = new Map(body.patients.map((patient) => [patient.id, patient.feverClassification]));
  assert.equal(classificationByPatient.get(patients[0].id), "NO_FEVER");
  assert.equal(classificationByPatient.get(patients[1].id), "FEVER");
  assert.equal(classificationByPatient.get(patients[2].id), "FEVER");
});

test("visit endpoint rejects malformed notes and inactive or nonexistent patients", async () => {
  const patient = await createActivePatient("Invalid visit patient");
  const invalid = await recordVisit(doctorCookie, patient.id, { note: 42 });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /note must be a string/);

  const inactive = await prisma.patient.create({
    data: { name: "Inactive visit patient", status: "DISCHARGED", outcome: "CURED", admittedAt: new Date(), dischargedAt: new Date() },
  });
  const rejected = await recordVisit(doctorCookie, inactive.id);
  assert.equal(rejected.status, 409);
  const missing = await recordVisit(doctorCookie, "missing-patient-id");
  assert.equal(missing.status, 404);
  assert.equal(await prisma.doctorVisit.count(), 0);
});

test("Nurse records a raw temperature against the patient and nurse identity", async () => {
  const patient = await createActivePatient("Temperature patient");
  const response = await recordTemperature(nurseCookie, patient.id, { value: 38.1 });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.reading.patientId, patient.id);
  assert.equal(body.reading.value, 38.1);
  assert.equal(body.reading.recordedById, "demo-nurse");
  assert.ok(body.reading.recordedAt);
  assert.equal(body.duplicateToday, false);

  const stored = await prisma.temperatureReading.findUnique({ where: { id: body.reading.id } });
  assert.equal(stored.patientId, patient.id);
  assert.equal(stored.recordedById, "demo-nurse");
  assert.equal(stored.value, 38.1);
  assert.ok(stored.recordedAt instanceof Date);
  const audit = await prisma.auditLog.findFirst({ where: { action: "TEMPERATURE_RECORDED", patientId: patient.id } });
  assert.ok(audit);
  assert.equal(audit.actorId, "demo-nurse");
  assert.deepEqual(JSON.parse(audit.details), { readingId: body.reading.id, value: 38.1 });
});

test("second same-day reading succeeds, flags duplicateToday, and keeps both rows", async () => {
  const patient = await createActivePatient("Duplicate reading patient");
  const first = await recordTemperature(nurseCookie, patient.id, { value: 38.1 });
  const second = await recordTemperature(nurseCookie, patient.id, { value: 38.4 });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await first.json()).duplicateToday, false);
  const secondBody = await second.json();
  assert.equal(secondBody.duplicateToday, true);
  assert.equal(secondBody.reading.value, 38.4);

  const { start, end } = getUtcTestDayRange();
  const saved = await prisma.temperatureReading.findMany({
    where: { patientId: patient.id, recordedAt: { gte: start, lt: end } },
  });
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map((reading) => reading.value).sort(), [38.1, 38.4]);
});

function getUtcTestDayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

test("temperature sanity range accepts its inclusive 30Â°C and 45Â°C boundaries", async () => {
  const patient = await createActivePatient("Boundary temperature patient");
  for (const value of [30, 45]) {
    const response = await recordTemperature(nurseCookie, patient.id, { value });
    assert.equal(response.status, 201);
  }
  const values = await prisma.temperatureReading.findMany({
    where: { patientId: patient.id },
    select: { value: true },
  });
  assert.deepEqual(values.map((reading) => reading.value).sort((a, b) => a - b), [30, 45]);
});

test("temperature input rejects missing, non-numeric, out-of-range, and non-finite values", async () => {
  const patient = await createActivePatient("Invalid temperature patient");
  for (const body of ["{}", JSON.stringify({ value: "" }), JSON.stringify({ value: null })]) {
    const response = await recordTemperature(nurseCookie, patient.id, body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Temperature value is required/);
  }
  const invalidBodies = [
    JSON.stringify({ value: "38.2" }),
    JSON.stringify({ value: "NaN" }),
    JSON.stringify({ value: "Infinity" }),
    JSON.stringify({ value: "abc" }),
    JSON.stringify({ value: 29 }),
    JSON.stringify({ value: 46 }),
    JSON.stringify({ value: 56 }),
    '{"value":233322333333e3}',
    JSON.stringify({ value: 29.9 }),
    JSON.stringify({ value: 45.1 }),
    '{"value":1e400}',
  ];
  for (const body of invalidBodies) {
    const response = await recordTemperature(nurseCookie, patient.id, body);
    assert.equal(response.status, 400, `Expected invalid temperature to fail: ${body}`);
    assert.match((await response.json()).error, /finite number|between 30 and 45/);
  }
  assert.equal(await prisma.temperatureReading.count({ where: { patientId: patient.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "TEMPERATURE_RECORDED" } }), 0);
});

test("Doctor, Admin, and unauthenticated callers cannot record temperatures", async () => {
  const patient = await createActivePatient("Role restricted temperature patient");
  for (const cookie of [doctorCookie, adminCookie]) {
    const response = await recordTemperature(cookie, patient.id, { value: 37.2 });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /requires one of these roles: NURSE/);
  }
  const unauthenticated = await recordTemperature(undefined, patient.id, { value: 37.2 });
  assert.equal(unauthenticated.status, 401);
  assert.match((await unauthenticated.json()).error, /Authentication required/);
  assert.equal(await prisma.temperatureReading.count(), 0);
});

test("needsTemperatureToday uses UTC dates and excludes patients with a reading today", async () => {
  const yesterdayOnly = await createActivePatient("Yesterday reading patient", 1);
  const readToday = await createActivePatient("Today reading patient", 2);
  const { start } = getUtcTestDayRange();
  const yesterday = new Date(start.getTime() - 1);
  await prisma.temperatureReading.create({
    data: { patientId: yesterdayOnly.id, value: 37.0, recordedById: "demo-nurse", recordedAt: yesterday },
  });
  await recordTemperature(nurseCookie, readToday.id, { value: 38.0 });

  const needsResponse = await fetch(`${baseUrl}/api/patients?filter=needsTemperatureToday`, {
    headers: { Cookie: nurseCookie },
  });
  assert.equal(needsResponse.status, 200);
  const needsBody = await needsResponse.json();
  assert.equal(needsBody.timezone, "UTC");
  assert.ok(needsBody.patients.some((patient) => patient.id === yesterdayOnly.id));
  assert.ok(!needsBody.patients.some((patient) => patient.id === readToday.id));

  const completedResponse = await fetch(`${baseUrl}/api/patients?filter=completedTemperatureToday`, {
    headers: { Cookie: nurseCookie },
  });
  const completedBody = await completedResponse.json();
  assert.ok(completedBody.patients.some((patient) => patient.id === readToday.id));
  assert.ok(!completedBody.patients.some((patient) => patient.id === yesterdayOnly.id));
});

test("multiple readings keep the patient completed and remain visible in patient history", async () => {
  const patient = await createActivePatient("Multiple reading patient");
  for (const value of [37.8, 38.2, 38.6]) {
    const response = await recordTemperature(nurseCookie, patient.id, { value });
    assert.equal(response.status, 201);
  }

  const needs = await (await fetch(`${baseUrl}/api/patients?filter=needsTemperatureToday`, {
    headers: { Cookie: nurseCookie },
  })).json();
  assert.ok(!needs.patients.some((item) => item.id === patient.id));

  const completed = await (await fetch(`${baseUrl}/api/patients?filter=completedTemperatureToday`, {
    headers: { Cookie: nurseCookie },
  })).json();
  const completedPatient = completed.patients.find((item) => item.id === patient.id);
  assert.ok(completedPatient);
  assert.equal(completedPatient.readings.length, 3);
  assert.deepEqual(completedPatient.readings.map((reading) => reading.value).sort((a, b) => a - b), [37.8, 38.2, 38.6]);

  const historyResponse = await fetch(`${baseUrl}/api/patients/${patient.id}/temperature`, {
    headers: { Cookie: nurseCookie },
  });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.readings.length, 3);
  assert.deepEqual(history.readings.map((reading) => reading.value).sort((a, b) => a - b), [37.8, 38.2, 38.6]);
  assert.ok(history.readings.every((reading) => reading.recordedBy.name === "Demo Nurse"));
});

test("only active patients can receive readings; missing and non-active patients are rejected", async () => {
  const inactivePatients = [];
  for (const status of ["ADMITTED", "DISCHARGE_ELIGIBLE", "DISCHARGED"]) {
    inactivePatients.push(await prisma.patient.create({
      data: {
        name: `${status} patient`,
        status,
        outcome: status === "DISCHARGED" ? "CURED" : "ONGOING",
        admittedAt: new Date(),
        dischargedAt: status === "DISCHARGED" ? new Date() : null,
      },
    }));
  }
  for (const patient of inactivePatients) {
    const response = await recordTemperature(nurseCookie, patient.id, { value: 38.0 });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, patient.status === "DISCHARGED"
      ? /already discharged/ : /only be recorded for an active patient/);
  }
  const missing = await recordTemperature(nurseCookie, "missing-patient-id", { value: 38.0 });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /Patient not found/);
  assert.equal(await prisma.temperatureReading.count(), 0);
});

test("temperature needs list rejects unauthenticated requests", async () => {
  const response = await fetch(`${baseUrl}/api/patients?filter=needsTemperatureToday`);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Authentication required/);
});

async function getDischargeStatus(patientId, cookie = adminCookie) {
  return fetch(`${baseUrl}/api/patients/${patientId}/discharge-status`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function postDischarge(patientId, cookie, rawBody) {
  return fetch(`${baseUrl}/api/patients/${patientId}/discharge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
  });
}

test("discharge status derives zero, one, two, and three day streaks from UTC days", async () => {
  const patients = [];
  for (let streak = 0; streak <= 3; streak += 1) {
    const patient = await createActivePatient(`Streak ${streak}`, streak + 1);
    patients.push(patient);
    for (let day = 0; day < streak; day += 1) await addTemperature(patient.id, 37.0, day);
  }

  for (let streak = 0; streak <= 3; streak += 1) {
    const response = await getDischargeStatus(patients[streak].id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.streak, streak);
    assert.equal(body.eligible, streak >= 3);
    assert.equal(body.days[0].hasReadings, streak > 0);
    assert.ok(body.days[0].reason);
  }
});

test("fever days and missing UTC dates break the current streak", async () => {
  const fever = await createActivePatient("Fever breaks streak", 1);
  const missing = await createActivePatient("Missing breaks streak", 2);
  for (const patient of [fever, missing]) await addTemperature(patient.id, 37.0, 0);
  await addTemperature(fever.id, 38.0, 1);
  await addTemperature(fever.id, 37.0, 2);
  await addTemperature(fever.id, 38.0, 3);
  await addTemperature(fever.id, 37.0, 4);
  await addTemperature(missing.id, 37.0, 2);
  await addTemperature(missing.id, 37.0, 3);
  await addTemperature(missing.id, 37.0, 4);

  const feverStatus = await (await getDischargeStatus(fever.id)).json();
  const missingStatus = await (await getDischargeStatus(missing.id)).json();
  assert.equal(feverStatus.streak, 1);
  assert.equal(feverStatus.days[1].feverFree, false);
  assert.match(feverStatus.days[1].reason, /at or above/);
  assert.equal(missingStatus.streak, 1);
  assert.equal(missingStatus.days[1].hasReadings, false);
  assert.match(missingStatus.days[1].reason, /No temperature readings/);
});

test("all readings below threshold qualify a day; any fever reading breaks it", async () => {
  const allBelow = await createActivePatient("All readings below", 1);
  const oneFever = await createActivePatient("One fever reading", 2);
  await addTemperature(allBelow.id, 37.2, 0, 1000);
  await addTemperature(allBelow.id, 37.8, 0, 2000);
  await addTemperature(oneFever.id, 37.2, 0, 1000);
  await addTemperature(oneFever.id, 38.0, 0, 2000);

  const belowStatus = await (await getDischargeStatus(allBelow.id)).json();
  const feverStatus = await (await getDischargeStatus(oneFever.id)).json();
  assert.equal(belowStatus.streak, 1);
  assert.equal(belowStatus.days[0].readings.length, 2);
  assert.equal(belowStatus.days[0].feverFree, true);
  assert.equal(feverStatus.streak, 0);
  assert.equal(feverStatus.days[0].feverFree, false);
  assert.match(feverStatus.days[0].reason, /at or above/);
});

test("each reading uses its historical threshold, including a threshold change mid-day", async () => {
  const patient = await createActivePatient("Historical threshold patient");
  const { start } = getUtcTestDayRange();
  const yesterdayStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const thresholdChangeAt = new Date(yesterdayStart.getTime() + 12 * 60 * 60 * 1000);
  await prisma.feverThresholdSetting.create({
    data: {
      id: "threshold-mid-day-test",
      value: 37.5,
      setById: "demo-doctor",
      effectiveFrom: thresholdChangeAt,
      createdAt: thresholdChangeAt,
    },
  });
  await addTemperature(patient.id, 37.0, 0);
  await prisma.temperatureReading.createMany({
    data: [
      { patientId: patient.id, value: 37.8, recordedById: "demo-nurse", recordedAt: new Date(yesterdayStart.getTime() + 11 * 60 * 60 * 1000) },
      { patientId: patient.id, value: 37.8, recordedById: "demo-nurse", recordedAt: new Date(yesterdayStart.getTime() + 13 * 60 * 60 * 1000) },
    ],
  });

  const response = await getDischargeStatus(patient.id);
  const body = await response.json();
  assert.equal(body.streak, 1);
  const yesterday = body.days[1];
  assert.equal(yesterday.feverFree, false);
  assert.equal(yesterday.readings[0].applicableThreshold.value, 37.5);
  assert.equal(yesterday.readings[1].applicableThreshold.value, 38.0);
  assert.deepEqual(yesterday.readings.map((reading) => reading.value), [37.8, 37.8]);
  assert.deepEqual(yesterday.readings.map((reading) => reading.feverClassification), ["FEVER", "NO_FEVER"]);
});

test("missing today's readings reset eligibility even after three fever-free prior days", async () => {
  const patient = await createActivePatient("Missing today eligibility", 1);
  for (const day of [1, 2, 3]) await addTemperature(patient.id, 37.0, day);
  const response = await getDischargeStatus(patient.id);
  const body = await response.json();
  assert.equal(body.streak, 0);
  assert.equal(body.eligible, false);
  assert.equal(body.days[0].date, getUtcTestDayRange().start.toISOString().slice(0, 10));
  assert.equal(body.days[0].hasReadings, false);
});

test("discharge status is authenticated and exposes reasoning with threshold details", async () => {
  const patient = await createActivePatient("Status endpoint patient");
  await addTemperature(patient.id, 37.0);
  const response = await getDischargeStatus(patient.id, nurseCookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patient.id, patient.id);
  assert.equal(body.streak, 1);
  assert.equal(body.eligible, false);
  assert.equal(body.days[0].readings[0].applicableThreshold.value, 38.0);
  assert.equal((await fetch(`${baseUrl}/api/patients/${patient.id}/discharge-status`)).status, 401);
  assert.equal((await getDischargeStatus("missing-patient-id")).status, 404);
});

test("Admin discharge review list is role restricted and returns live eligibility", async () => {
  const patient = await createActivePatient("Admin discharge review patient");
  for (const day of [0, 1, 2]) await addTemperature(patient.id, 37.0, day);
  const denied = await fetch(`${baseUrl}/api/patients?filter=dischargeReview`, { headers: { Cookie: nurseCookie } });
  assert.equal(denied.status, 403);
  const allowed = await fetch(`${baseUrl}/api/patients?filter=dischargeReview`, { headers: { Cookie: adminCookie } });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  const review = body.patients.find((entry) => entry.id === patient.id);
  assert.equal(review.streak, 3);
  assert.equal(review.eligible, true);
});

test("premature CURED discharge is rejected without changing patient, room, or audit state", async () => {
  const patient = await createActivePatient("Premature discharge patient");
  const response = await postDischarge(patient.id, adminCookie, { outcome: "CURED" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not yet eligible.*3 consecutive fever-free days are required/);
  const stored = await prisma.patient.findUnique({ where: { id: patient.id } });
  assert.equal(stored.status, "ACTIVE");
  assert.equal(stored.roomId, "room-01");
  assert.equal(stored.outcome, "ONGOING");
  assert.equal(stored.dischargedAt, null);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_DISCHARGED" } }), 0);
});

test("eligible CURED discharge releases the room and creates one audit record", async () => {
  const patient = await createActivePatient("Eligible discharge patient");
  for (const day of [0, 1, 2]) await addTemperature(patient.id, 37.0, day);
  const response = await postDischarge(patient.id, adminCookie, { outcome: "CURED" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.eligibility.streak, 3);
  assert.equal(body.eligibility.eligible, true);
  assert.equal(body.patient.status, "DISCHARGED");
  assert.equal(body.patient.outcome, "CURED");
  assert.ok(body.patient.dischargedAt);
  assert.equal(body.patient.roomId, null);

  const stored = await prisma.patient.findUnique({ where: { id: patient.id } });
  assert.equal(stored.roomId, null);
  const roomsResponse = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: adminCookie } });
  const room = (await roomsResponse.json()).rooms.find((entry) => entry.id === "room-01");
  assert.equal(room.status, "AVAILABLE");
  const audit = await prisma.auditLog.findFirst({ where: { action: "PATIENT_DISCHARGED" } });
  assert.ok(audit);
  assert.equal(audit.actorId, "demo-admin");
  assert.equal(audit.patientId, patient.id);
  assert.deepEqual(JSON.parse(audit.details), {
    outcome: "CURED",
    dischargedAt: body.patient.dischargedAt,
    feverFreeStreakDays: 3,
    eligibleForCuredDischarge: true,
    releasedRoomId: "room-01",
  });
});

test("DECEASED discharge succeeds without fever-free days and releases the room", async () => {
  const patient = await createActivePatient("Deceased discharge patient");
  const response = await postDischarge(patient.id, adminCookie, { outcome: "DECEASED" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patient.status, "DISCHARGED");
  assert.equal(body.patient.outcome, "DECEASED");
  assert.equal(body.patient.roomId, null);
  assert.equal(body.eligibility.streak, 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_DISCHARGED", patientId: patient.id } }), 1);
});

test("only Admin may discharge; unauthenticated callers are rejected", async () => {
  const patient = await createActivePatient("Role restricted discharge patient");
  for (const cookie of [nurseCookie, doctorCookie]) {
    const response = await postDischarge(patient.id, cookie, { outcome: "DECEASED" });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /requires one of these roles: ADMIN/);
  }
  const unauthenticated = await postDischarge(patient.id, undefined, { outcome: "DECEASED" });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).status, "ACTIVE");
});

test("missing and invalid discharge outcomes are rejected", async () => {
  const patient = await createActivePatient("Invalid outcome discharge patient");
  const missing = await postDischarge(patient.id, adminCookie, {});
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /outcome is required/);
  for (const body of [{ outcome: "ONGOING" }]) {
    const response = await postDischarge(patient.id, adminCookie, body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /outcome must be CURED or DECEASED/);
  }
  assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).status, "ACTIVE");
});

test("discharged and otherwise non-active patients cannot be discharged again", async () => {
  const patient = await prisma.patient.create({
    data: { name: "Previously discharged patient", status: "DISCHARGED", outcome: "DECEASED", admittedAt: new Date(), dischargedAt: new Date() },
  });
  const response = await postDischarge(patient.id, adminCookie, { outcome: "DECEASED" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Patient is already discharged/);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_DISCHARGED" } }), 0);
});

test("concurrent discharge requests produce one discharge, one audit, and one room release", async () => {
  const patient = await createActivePatient("Concurrent discharge patient");
  for (const day of [0, 1, 2]) await addTemperature(patient.id, 37.0, day);
  const responses = await Promise.all([
    postDischarge(patient.id, adminCookie, { outcome: "CURED" }),
    postDischarge(patient.id, adminCookie, { outcome: "CURED" }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const failed = responses.find((response) => response.status === 409);
  assert.match((await failed.json()).error, /already discharged|conflicted with another request/);
  const stored = await prisma.patient.findUnique({ where: { id: patient.id } });
  assert.equal(stored.status, "DISCHARGED");
  assert.equal(stored.roomId, null);
  assert.equal(await prisma.auditLog.count({ where: { action: "PATIENT_DISCHARGED", patientId: patient.id } }), 1);
  assert.equal(await prisma.patient.count({ where: { roomId: "room-01" } }), 0);
});

async function getDashboard(cookie) {
  return fetch(`${baseUrl}/api/dashboard`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function createDischargedPatient(name, outcome, dischargedAt) {
  return prisma.patient.create({
    data: {
      name,
      status: "DISCHARGED",
      outcome,
      admittedAt: new Date(dischargedAt.getTime() - 24 * 60 * 60 * 1000),
      dischargedAt,
      roomId: null,
    },
  });
}

test("dashboard rejects unauthenticated requests", async () => {
  const response = await getDashboard(undefined);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Authentication required/);
});

test("dashboard returns null rates and insufficient-data flags with no discharges", async () => {
  const response = await getDashboard(adminCookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.occupancy, { occupied: 0, total: 74 });
  assert.deepEqual(body.todayWorkflow, { needsTemp: 0, tempDone: 0, needsVisit: 0, visitDone: 0 });
  assert.equal(body.patientsRequiringAction, 0);
  assert.equal(body.dischargeBacklog, 0);
  assert.equal(body.dischargedToday, 0);
  assert.deepEqual(body.mortality, { deceasedCount: 0, totalDischarged: 0, rate: null, insufficientData: true });
  assert.deepEqual(body.successRate, { curedCount: 0, totalDischarged: 0, rate: null, benchmark: 85, insufficientData: true });
  assert.deepEqual(body.historicalTrend, []);
});

test("dashboard derives occupancy, daily patient workflows, backlog, rates, and UTC discharge trend", async () => {
  const needsBoth = await createActivePatient("Dashboard needs both", 1);
  const completedBoth = await createActivePatient("Dashboard completed both", 2);
  const multipleBoth = await createActivePatient("Dashboard multiple", 3);
  const backlogPatient = await createActivePatient("Dashboard eligible backlog", 4);

  await recordTemperature(nurseCookie, completedBoth.id, { value: 37.0 });
  await recordVisit(doctorCookie, completedBoth.id);
  await recordTemperature(nurseCookie, multipleBoth.id, { value: 37.0 });
  await recordTemperature(nurseCookie, multipleBoth.id, { value: 37.2 });
  await recordVisit(doctorCookie, multipleBoth.id);
  await recordVisit(doctorCookie, multipleBoth.id);
  for (const day of [0, 1, 2]) await addTemperature(backlogPatient.id, 37.0, day);

  const { start } = getUtcTestDayRange();
  const today = new Date(start.getTime() + 1000);
  const yesterday = new Date(start.getTime() - 24 * 60 * 60 * 1000 + 1000);
  const curedToday = await createDischargedPatient("Cured today", "CURED", today);
  const deceasedToday = await createDischargedPatient("Deceased today", "DECEASED", today);
  const curedEarlier = await createDischargedPatient("Cured earlier", "CURED", yesterday);
  for (const day of [0, 1, 2]) await addTemperature(deceasedToday.id, 37.0, day);
  const dischargedTemp = await prisma.temperatureReading.create({
    data: { patientId: deceasedToday.id, value: 37.0, recordedById: "demo-nurse", recordedAt: today },
  });
  assert.ok(dischargedTemp);
  await prisma.doctorVisit.create({
    data: { patientId: deceasedToday.id, doctorId: "demo-doctor", visitedAt: today },
  });

  const response = await getDashboard(adminCookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.occupancy, { occupied: 4, total: 74 });
  assert.deepEqual(body.todayWorkflow, { needsTemp: 1, tempDone: 3, needsVisit: 2, visitDone: 2 });
  assert.equal(body.patientsRequiringAction, 2);
  assert.equal(body.dischargeBacklog, 1);
  assert.equal(body.dischargedToday, 2);
  assert.deepEqual(body.mortality, { deceasedCount: 1, totalDischarged: 3, rate: 1 / 3, insufficientData: false });
  assert.deepEqual(body.successRate, { curedCount: 2, totalDischarged: 3, rate: 2 / 3, benchmark: 85, insufficientData: false });
  assert.deepEqual(body.historicalTrend, [
    { date: yesterday.toISOString().slice(0, 10), curedCount: 1, deceasedCount: 0, totalDischarged: 1 },
    { date: today.toISOString().slice(0, 10), curedCount: 1, deceasedCount: 1, totalDischarged: 2 },
  ]);
  assert.ok([needsBoth, completedBoth, multipleBoth, backlogPatient, curedToday, curedEarlier].every(Boolean));
});

test("dashboard occupancy drops when discharge releases a patient's room", async () => {
  const patient = await createActivePatient("Dashboard room release patient", 1);
  const before = await (await getDashboard(adminCookie)).json();
  assert.equal(before.occupancy.occupied, 1);
  const discharged = await postDischarge(patient.id, adminCookie, { outcome: "DECEASED" });
  assert.equal(discharged.status, 200);
  const after = await (await getDashboard(adminCookie)).json();
  assert.deepEqual(after.occupancy, { occupied: 0, total: 74 });
});

test("role-based dashboard UI shows role-specific metrics and Admin dashboard tabs", async () => {
  async function dashboardHtml(cookie) {
    const response = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.text();
  }
  const nurseHtml = await dashboardHtml(nurseCookie);
  assert.match(nurseHtml, /Needs temperature/);
  assert.doesNotMatch(nurseHtml, /Mortality rate|Success rate|Room occupancy|Discharge backlog/);

  const doctorHtml = await dashboardHtml(doctorCookie);
  assert.match(doctorHtml, /Visits pending/);
  assert.match(doctorHtml, /Fever threshold settings/);
  assert.doesNotMatch(doctorHtml, /Mortality rate|Success rate|Room occupancy|Discharge backlog/);

  const adminHtml = await dashboardHtml(adminCookie);
  for (const section of ["Facility Overview", "Today’s Workflow", "Room Occupancy", "Discharge Review", "Historical Discharge", "Admit Patient"]) {
    assert.match(adminHtml, new RegExp(section));
  }
});
async function getPatientDetail(patientId, cookie) {
  return fetch(`${baseUrl}/api/patients/${patientId}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test("patient detail returns current status, full records, historical classification, and today's workflow", async () => {
  const patient = await createActivePatient("Patient detail test");
  const firstReadingResponse = await recordTemperature(nurseCookie, patient.id, { value: 37.8 });
  assert.equal(firstReadingResponse.status, 201);
  const thresholdChange = await postThreshold(doctorCookie, { value: 37.5 });
  assert.equal(thresholdChange.status, 201);
  const secondReadingResponse = await recordTemperature(nurseCookie, patient.id, { value: 37.8 });
  assert.equal(secondReadingResponse.status, 201);
  const visitResponse = await recordVisit(doctorCookie, patient.id, { note: "Review note" });
  assert.equal(visitResponse.status, 201);

  const response = await getPatientDetail(patient.id, doctorCookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patient.id, patient.id);
  assert.equal(body.patient.name, "Patient detail test");
  assert.equal(body.patient.room.number, 1);
  assert.equal(body.patient.status, "ACTIVE");
  assert.equal(body.patient.outcome, "ONGOING");
  assert.ok(body.patient.admittedAt);
  assert.equal(body.patient.dischargedAt, null);
  assert.equal(body.temperatureHistory.length, 2);
  assert.deepEqual(body.temperatureHistory.map((reading) => reading.value), [37.8, 37.8]);
  assert.deepEqual(body.temperatureHistory.map((reading) => reading.feverClassification), ["NO_FEVER", "FEVER"]);
  assert.deepEqual(body.temperatureHistory.map((reading) => reading.applicableThreshold.value), [38.0, 37.5]);
  assert.equal(body.feverFreeStreak.streak, 0);
  assert.equal(body.feverFreeStreak.days[0].feverFree, false);
  assert.equal(body.feverFreeStreak.days[0].streakLength, 0);
  assert.match(body.feverFreeStreak.days[0].reason, /at or above/);
  assert.equal(body.today.temperature.recorded, true);
  assert.equal(body.today.temperature.readings.length, 2);
  assert.equal(body.today.visit.completed, true);
  assert.equal(body.today.visit.visits.length, 1);
  assert.equal(body.dischargeEligibility.eligible, false);
  assert.equal(body.dischargeEligibility.streak, 0);
  assert.match(body.dischargeEligibility.reason, /at or above/);
  assert.equal(body.doctorVisits.length, 1);
  assert.equal(body.doctorVisits[0].note, "Review note");
  assert.equal(body.doctorVisits[0].doctor.name, "Demo Doctor");
  assert.ok(body.auditHistory.some((event) => event.action === "PATIENT_ADMITTED"));
  assert.ok(body.auditHistory.some((event) => event.action === "TEMPERATURE_RECORDED"));
  assert.ok(body.auditHistory.some((event) => event.action === "DOCTOR_VISIT_RECORDED"));
  assert.ok(body.auditHistory.some((event) => event.action === "FEVER_THRESHOLD_CHANGED"));
  assert.ok(body.auditHistory.every((event) => event.actor.name));
});

test("patient detail filters room-change audit events by role in the server response", async () => {
  const patient = await createActivePatient("Audit visibility patient");
  assert.equal((await recordTemperature(nurseCookie, patient.id, { value: 37.0 })).status, 201);
  assert.equal((await recordVisit(doctorCookie, patient.id)).status, 201);
  assert.equal((await postThreshold(doctorCookie, { value: 38.1 })).status, 201);
  assert.equal((await postDischarge(patient.id, adminCookie, { outcome: "DECEASED" })).status, 200);
  await prisma.auditLog.create({
    data: {
      actorId: "demo-admin",
      action: "ROOM_CHANGED",
      patientId: patient.id,
      details: JSON.stringify({ previousRoomId: "room-02", newRoomId: "room-01" }),
      createdAt: new Date(),
    },
  });

  const nurse = await (await getPatientDetail(patient.id, nurseCookie)).json();
  const doctor = await (await getPatientDetail(patient.id, doctorCookie)).json();
  const admin = await (await getPatientDetail(patient.id, adminCookie)).json();
  assert.ok(nurse.auditHistory.some((event) => event.action === "PATIENT_ADMITTED"));
  assert.ok(nurse.auditHistory.some((event) => event.action === "TEMPERATURE_RECORDED"));
  assert.ok(nurse.auditHistory.some((event) => event.action === "DOCTOR_VISIT_RECORDED"));
  assert.ok(nurse.auditHistory.some((event) => event.action === "PATIENT_DISCHARGED"));
  assert.ok(!nurse.auditHistory.some((event) => event.action === "ROOM_CHANGED"));
  assert.ok(!nurse.auditHistory.some((event) => event.action === "FEVER_THRESHOLD_CHANGED"));
  assert.ok(doctor.auditHistory.some((event) => event.action === "FEVER_THRESHOLD_CHANGED"));
  assert.ok(doctor.auditHistory.some((event) => event.action === "PATIENT_DISCHARGED"));
  assert.ok(!doctor.auditHistory.some((event) => event.action === "ROOM_CHANGED"));
  assert.ok(admin.auditHistory.some((event) => event.action === "ROOM_CHANGED"));
  assert.ok(admin.auditHistory.some((event) => event.action === "PATIENT_ADMITTED"));
  assert.ok(admin.auditHistory.some((event) => event.action === "FEVER_THRESHOLD_CHANGED"));
});

test("patient detail API requires authentication and rejects missing patients", async () => {
  const patient = await createActivePatient("Protected detail patient");
  assert.equal((await getPatientDetail(patient.id)).status, 401);
  const missing = await getPatientDetail("missing-patient-id", adminCookie);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /Patient not found/);
});
