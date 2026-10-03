const District = require('../models/districtModel');
const User = require('../models/userModel');
const { STAFF_MEMBER_ROLES } = require('../constants/staffRoles');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findDistrictByName = async (ownerId, name) => {
  const trimmed = name?.toString().trim();
  if (!trimmed || !ownerId) return null;

  return District.findOne({
    owner: ownerId,
    name: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, 'i') },
  });
};

const ensureDistrict = async (ownerId, districtName) => {
  const trimmed = districtName?.toString().trim();
  if (!trimmed || !ownerId) return '';

  const existing = await findDistrictByName(ownerId, trimmed);
  if (existing) return existing.name;

  const created = await District.create({ name: trimmed, owner: ownerId });
  return created.name;
};

const syncDistrictsFromStaff = async (ownerId) => {
  const staffMembers = await User.find({
    owner: ownerId,
    role: { $in: STAFF_MEMBER_ROLES },
    district: { $exists: true, $nin: ['', null] },
  }).select('district');

  for (const member of staffMembers) {
    await ensureDistrict(ownerId, member.district);
  }
};

module.exports = { ensureDistrict, syncDistrictsFromStaff, findDistrictByName };
