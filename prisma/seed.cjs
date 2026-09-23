const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const demoUsers = [
  { id: "demo-nurse", name: "Demo Nurse", role: "NURSE" },
  { id: "demo-doctor", name: "Demo Doctor", role: "DOCTOR" },
  { id: "demo-admin", name: "Demo Admin", role: "ADMIN" },
];

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

  console.log("Seeded demo users and rooms 1–74.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
