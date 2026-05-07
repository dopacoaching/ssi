require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const credentialsRaw = process.env.ADMIN_CREDENTIALS || '';
  const adminList = credentialsRaw.split(',').map(pair => {
    const [email, password] = pair.split(':').map(s => s.trim());
    return { email, password };
  }).filter(admin => admin.email && admin.password);

  if (adminList.length === 0) {
    console.error('Missing or invalid ADMIN_CREDENTIALS in environment variables (expected email:password,email2:password2)');
    process.exit(1);
  }

  for (const { email, password } of adminList) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log('Admin already exists: ' + email);
      continue;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Super Admin',
        role: 'ADMIN',
      },
    });

    console.log('Admin created:', admin.email);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
