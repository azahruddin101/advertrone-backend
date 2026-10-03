const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./src/config/db');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Enable CORS
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Dev logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Serve static uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/staff', require('./src/routes/staffRoutes'));
app.use('/api/districts', require('./src/routes/districtRoutes'));
app.use('/api/tasks', require('./src/routes/taskRoutes'));
app.use('/api/lead-tasks', require('./src/routes/leadTaskRoutes'));
app.use('/api/leads', require('./src/routes/leadRoutes'));
app.use('/api/payments', require('./src/routes/paymentRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/quotations', require('./src/routes/quotationRoutes'));
app.use('/api/invoices', require('./src/routes/invoiceRoutes'));
app.use('/api/notifications', require('./src/routes/notificationRoutes'));
app.use('/api/contacts', require('./src/routes/contactRoutes'));
app.use('/api/product-prices', require('./src/routes/productPriceRoutes'));
app.use('/api/inventory', require('./src/routes/inventoryRoutes'));
app.use('/api/estimations', require('./src/routes/estimationRoutes'));
app.use('/api/upload', require('./src/routes/uploadRoutes'));


app.get('/api/clean-and-seed-temp', async (req, res) => {
  try {
    const User = require('./src/models/userModel');
    const Contact = require('./src/models/contactModel');
    const Lead = require('./src/models/leadModel');
    const Invoice = require('./src/models/invoiceModel');
    const Notification = require('./src/models/notificationModel');
    const Payment = require('./src/models/paymentModel');
    const Quotation = require('./src/models/quotationModel');
    const Counter = require('./src/models/counterModel');

    console.log('Clearing old data from database...');
    await User.deleteMany({});
    await Contact.deleteMany({});
    await Lead.deleteMany({});
    await Invoice.deleteMany({});
    await Notification.deleteMany({});
    await Payment.deleteMany({});
    await Quotation.deleteMany({});
    await Counter.deleteMany({});

    console.log('Creating new Admin user account...');
    const adminUser = new User({
      name: process.env.ADMIN_NAME || 'Admin Advertrone',
      email: process.env.ADMIN_EMAIL || 'advertronesolarsolutions@gmail.com',
      phone: process.env.ADMIN_PHONE || '9927452635',
      password: process.env.ADMIN_PASSWORD || 'Admin@123',
      role: 'admin',
      status: 'active',
    });
    await adminUser.save();

    return res.send('Database successfully cleared and seeded with fresh Admin account!');
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.get('/', (req, res) => {
  res.send('Advertrone Solar Solutions CRM API is running...');
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  // Start the background reminder scheduler
  const { startReminderScheduler } = require('./src/utils/scheduler');
  startReminderScheduler();
});
