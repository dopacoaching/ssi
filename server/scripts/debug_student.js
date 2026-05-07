const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const student = await prisma.student.findFirst();
  console.log(JSON.stringify(student, null, 2));
}

main().finally(() => prisma.$disconnect());
