import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

const root = process.cwd();
const testDbName = `phase3-admission-${process.pid}.db`;
const testDbPath = resolve(root, "prisma", testDbName);
const testDatabaseUrl = `file:./${testDbName}`;
const testSecret = "phase-three-integration-test-secret";
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
  await prisma.patient.deleteMany();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await Promise.race([once(serverProcess, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
  }
  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(`${testDbPath}${suffix}`, { force: true });
  }
});

test("seeding is idempotent and the rooms endpoint reports availability", async () => {
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
  const overflow = await postPatient(adminCookie, "Patient 75", rooms[0].id);
  assert.equal(overflow.status, 409);
  assert.match((await overflow.json()).error, /All 74 rooms are occupied/);
});

test("occupied and nonexistent rooms are rejected with clear errors", async () => {
  const roomId = "room-01";
  assert.equal((await postPatient(adminCookie, "First patient", roomId)).status, 201);

  const occupied = await postPatient(adminCookie, "Second patient", roomId);
  assert.equal(occupied.status, 409);
  assert.match((await occupied.json()).error, /already occupied/);

  const missing = await postPatient(adminCookie, "Missing room patient", "not-a-room");
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /room does not exist/);
});

test("concurrent admissions for one room allow only one assignment", async () => {
  const responses = await Promise.all([
    postPatient(adminCookie, "Concurrent patient A", "room-01"),
    postPatient(adminCookie, "Concurrent patient B", "room-01"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.patient.count({ where: { roomId: "room-01" } }), 1);
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
});
