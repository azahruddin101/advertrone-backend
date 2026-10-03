const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/userModel');

dotenv.config();

const updateAdmin = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected successfully!');

    const oldEmail = 'admin@priyankasolar.com';
    const newEmail = process.env.ADMIN_EMAIL || 'advertronesolarsolutions@gmail.com';
    const newName = process.env.ADMIN_NAME || 'Admin PS Solar';
    const newPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

    // 1. Try to find the old admin user and update it
    let admin = await User.findOne({ email: oldEmail });
    if (admin) {
      console.log('Found old admin account. Updating details...');
      admin.name = newName;
      admin.email = newEmail;
      admin.password = newPassword;
      await admin.save();
      console.log(`Updated admin account: ${oldEmail} -> ${newEmail}`);
    } else {
      // 2. Try to find the new admin user
      admin = await User.findOne({ email: newEmail });
      if (admin) {
        console.log('Admin account with new email already exists. Updating password and name...');
        admin.name = newName;
        admin.password = newPassword;
        await admin.save();
        console.log(`Updated existing admin account: ${newEmail}`);
      } else {
        // 3. Create a new admin user if neither exists
        console.log('No admin account found. Creating new admin user...');
        admin = new User({
          name: newName,
          email: newEmail,
          phone: process.env.ADMIN_PHONE || '9999999999',
          password: newPassword,
          role: 'admin',
          status: 'active',
        });
        await admin.save();
        console.log(`Created new admin user: ${newEmail}`);
      }
    }

    console.log('--------------------------------------------------');
    console.log('Admin User Setup Completed Successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error updating admin:', error);
    process.exit(1);
  }
};

updateAdmin();
