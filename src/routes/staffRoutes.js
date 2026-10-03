const express = require('express');
const router = express.Router();
const {
  getStaff,
  getStaffRoles,
  deleteStaff,
  registerUser,
  getStaffDetails,
  toggleStaffStatus,
  updateStaff,
  getStaffAnalytics,
} = require('../controllers/userController');
const { getDistricts, addDistrict } = require('../controllers/districtController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getStaff)
  .post(protect, admin, registerUser);

router.route('/analytics')
  .get(protect, admin, getStaffAnalytics);

router.route('/roles')
  .get(protect, getStaffRoles);

router.route('/districts')
  .get(protect, admin, getDistricts)
  .post(protect, admin, addDistrict);

router.route('/:id')
  .get(protect, admin, getStaffDetails)
  .put(protect, admin, updateStaff)
  .delete(protect, admin, deleteStaff);

router.route('/:id/toggle-status')
  .patch(protect, admin, toggleStaffStatus);

module.exports = router;
