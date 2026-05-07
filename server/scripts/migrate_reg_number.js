const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany({
    where: {
      regNumber: null,
      NOT: { rollNumber: null }
    }
  });

  console.log(`Found ${students.length} students to migrate.`);

  for (const student of students) {
    await prisma.student.update({
      where: { id: student.id },
      data: { regNumber: student.rollNumber }
    });
    console.log(`Migrated ${student.fullName} (${student.rollNumber})`);
  }

  console.log('Migration complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
