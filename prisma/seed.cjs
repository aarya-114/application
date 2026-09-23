const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const demoUsers = [
  { id: "demo-nurse", name: "Demo Nurse", role: "NURSE" },
  { id: "demo-doctor", name: "Demo Doctor", role: "DOCTOR" },
  { id: "demo-admin", name: "Demo Admin", role: "ADMIN" },
];
const DEFAULT_FEVER_THRESHOLD_ID = "fever-threshold-default";

async function main() {
  for (const user of demoUsers) {
    await prisma.user.upsert({ where: { id: user.id }, update: user, create: user });
  }

  for (let number = 1; number <= 74; number += 1) {
    await prisma.room.upsert({
      where: { number },
      update: {},
      create: { id: `room-${String(number).padStart(2, "0")}`, number },
    });
  }

  const existingThreshold = await prisma.feverThresholdSetting.findFirst({ select: { id: true } });
  if (!existingThreshold) {
    const now = new Date();
    await prisma.feverThresholdSetting.upsert({
      where: { id: DEFAULT_FEVER_THRESHOLD_ID },
      update: {},
      create: {
        id: DEFAULT_FEVER_THRESHOLD_ID,
        value: 38.0,
        setById: "demo-doctor",
        effectiveFrom: now,
        createdAt: now,
      },
    });
  }

  console.log("Seeded demo users, rooms 1–74, and the default fever threshold when needed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
