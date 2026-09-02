require('dotenv').config();
const { connectDB, mongoose } = require('../utils/db');
const { Student } = require('../models/schemas');

async function main() {
  await connectDB();
  const student = await Student.findOne().lean();
  console.log(JSON.stringify(student, null, 2));
}

main()
  .catch(console.error)
  .finally(() => mongoose.disconnect());
