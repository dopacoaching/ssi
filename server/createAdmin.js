require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB, mongoose } = require('./utils/db');
const { User } = require('./models/schemas');

async function main() {
  await connectDB();

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
    const existing = await User.findOne({ email });
    if (existing) {
      console.log('Admin already exists: ' + email);
      continue;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const admin = await User.create({
      email,
      password: hashedPassword,
      name: 'Super Admin',
      role: 'ADMIN',
    });

    console.log('Admin created:', admin.email);
  }
}

main()
  .catch(console.error)
  .finally(() => mongoose.disconnect());
