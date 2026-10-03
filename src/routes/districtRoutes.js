const express = require('express');
const router = express.Router();
const { getDistricts, addDistrict } = require('../controllers/districtController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, admin, getDistricts)
  .post(protect, admin, addDistrict);

module.exports = router;
