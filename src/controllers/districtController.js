const District = require('../models/districtModel');
const { ensureDistrict, syncDistrictsFromStaff, findDistrictByName } = require('../utils/districtHelpers');

const getOwnerId = (user) => (user.role === 'admin' ? user._id : user.owner);

// @desc    Get all districts for the organization
// @route   GET /api/districts
// @access  Private/Admin
const getDistricts = async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    if (!ownerId) {
      return res.json([]);
    }

    await syncDistrictsFromStaff(ownerId);
    const districts = await District.find({ owner: ownerId }).sort({ name: 1 });
    res.json(districts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add a new district
// @route   POST /api/districts
// @access  Private/Admin
const addDistrict = async (req, res) => {
  try {
    const { name } = req.body;
    const trimmed = name?.toString().trim();

    if (!trimmed) {
      return res.status(400).json({ message: 'District name is required' });
    }

    const ownerId = req.user._id;
    const existing = await findDistrictByName(ownerId, trimmed);

    if (existing) {
      return res.status(200).json(existing);
    }

    const district = await District.create({ name: trimmed, owner: ownerId });
    res.status(201).json(district);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await findDistrictByName(req.user._id, req.body.name);
      if (existing) return res.status(200).json(existing);
    }
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getDistricts, addDistrict };
