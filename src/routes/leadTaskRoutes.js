const express = require('express');
const router = express.Router();
const LeadTask = require('../models/leadTaskModel');
const { protect, admin } = require('../middleware/authMiddleware');
const { getWorkflowSummary } = require('../controllers/leadTaskController');
const { getOwnerId } = require('../utils/leadAccess');

// @desc    Pending workflow tasks assigned to current user
// @route   GET /api/lead-tasks/my-work
// @access  Private
router.get('/my-work', protect, async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    if (!ownerId || req.user.role === 'admin') {
      return res.json([]);
    }

    const items = await LeadTask.find({
      owner: ownerId,
      assignedTo: req.user._id,
      status: 'pending',
    })
      .sort({ updatedAt: -1 })
      .populate('lead', 'name phone leadId')
      .populate('task', 'title responsibleStaff');

    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/summary', protect, admin, getWorkflowSummary);

module.exports = router;
