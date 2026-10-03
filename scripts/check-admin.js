const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/userModel');

dotenv.config();

const checkUsers = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await User.find({}, { password: 0 }); // exclude password for security
    console.log('--- USERS IN DATABASE ---');
    console.log(JSON.stringify(users, null, 2));
    console.log('-------------------------');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkUsers();
