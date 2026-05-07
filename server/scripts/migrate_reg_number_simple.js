const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany();
  console.log(`Total students: ${students.length}`);

  const toMigrate = students.filter(s => s.regNumber === null && s.rollNumber !== null);
  console.log(`Found ${toMigrate.length} to migrate.`);

  for (const s of toMigrate) {
    await prisma.student.update({
      where: { id: s.id },
      data: { regNumber: s.rollNumber }
    });
    console.log(`Migrated ${s.fullName}`);
  }
}

main().finally(() => prisma.$disconnect());
