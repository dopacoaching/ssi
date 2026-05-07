const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany();
  console.log(`Total students: ${students.length}`);

  const toMigrate = students.filter(s => s.password === null && s.regNumber !== null);
  console.log(`Found ${toMigrate.length} to set default passwords.`);

  for (const s of toMigrate) {
    const hashedPassword = await bcrypt.hash(s.regNumber, 12);
    await prisma.student.update({
      where: { id: s.id },
      data: { password: hashedPassword }
    });
    console.log(`Set password for ${s.fullName}`);
  }
}

main().finally(() => prisma.$disconnect());
