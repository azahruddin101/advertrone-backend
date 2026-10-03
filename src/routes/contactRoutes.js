const express = require('express');
const router = express.Router();
const {
  getContacts,
  createContact,
  bulkCreateContacts,
  bulkDeleteContacts,
  deleteContact,
  assignContacts,
  convertContactToLead,
  updateContact,
  getContactDetails,
  handleGoogleFormWebhook,
} = require('../controllers/contactController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getContacts)
  .post(protect, admin, createContact);

router.route('/bulk')
  .post(protect, admin, bulkCreateContacts)
  .delete(protect, admin, bulkDeleteContacts);

// Google Form Webhook
router.post('/google-form-webhook', handleGoogleFormWebhook);

router.route('/assign')
  .patch(protect, admin, assignContacts);

router.route('/:id/convert')
  .post(protect, convertContactToLead);

router.route('/:id')
  .get(protect, getContactDetails)
  .patch(protect, updateContact)
  .delete(protect, admin, deleteContact);

module.exports = router;
