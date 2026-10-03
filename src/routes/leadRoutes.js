const express = require('express');
const router = express.Router();
const { createLead, getLeads, getLeadById, updateLead, logPhoneView, createPublicReferral, handleGoogleFormWebhook } = require('../controllers/leadController');
const {
  getLeadWorkflowTasks,
  assignLeadWorkflowTask,
  completeLeadWorkflowTask,
} = require('../controllers/leadTaskController');
const { admin } = require('../middleware/authMiddleware');
const { verifyWebhook, receiveWebhook } = require('../controllers/fbController');
const { protect } = require('../middleware/authMiddleware');

// Public Route
router.post('/public-referral', createPublicReferral);
router.post('/google-form-webhook', handleGoogleFormWebhook);

// Facebook Webhook Routes (Public)
router.get('/facebook/webhook', verifyWebhook);
router.post('/facebook/webhook', receiveWebhook);

router.route('/')
  .post(protect, createLead)
  .get(protect, getLeads);

router.get('/:id/tasks', protect, getLeadWorkflowTasks);
router.post('/:id/tasks/assign', protect, admin, assignLeadWorkflowTask);
router.patch('/:id/tasks/:leadTaskId/complete', protect, completeLeadWorkflowTask);

router.route('/:id')
  .get(protect, getLeadById)
  .patch(protect, updateLead);

router.post('/:id/log-view-phone', protect, logPhoneView);

module.exports = router;
