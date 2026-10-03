const Lead = require('../models/leadModel');
const Notification = require('../models/notificationModel');
const { getLeadIfAccessible } = require('../utils/leadAccess');
const { syncLeadWorkflowTasks } = require('../utils/leadWorkflow');

// Uploaded documents are stored as base64 inside the lead (several MB each), so list and
// update responses leave the file contents out; GET /api/leads/:id returns them in full.
const WITHOUT_FILE_CONTENTS = '-personalInfo.additionalImages.url';

const stripFileContents = (lead) => {
  const data = typeof lead.toObject === 'function' ? lead.toObject() : lead;
  const files = data.personalInfo?.additionalImages;
  if (Array.isArray(files)) {
    data.personalInfo.additionalImages = files.map((file) => {
      if (file && typeof file === 'object') {
        const { url, ...rest } = file;
        return rest;
      }
      return { name: 'Document', type: '' };
    });
  }
  return data;
};

// The lead list carries documents without their contents. When such an entry is sent back
// on update, keep the stored file instead of overwriting it with an empty one.
const restoreFileContents = (incoming, existing) => {
  if (!Array.isArray(incoming)) return incoming;
  const stored = (existing || []).filter((file) => file && typeof file === 'object');
  const used = new Set();
  return incoming.reduce((files, file) => {
    if (!file || typeof file !== 'object' || file.url) {
      if (file) files.push(file);
      return files;
    }
    const index = stored.findIndex((s, i) => !used.has(i) && s.name === file.name && (s.type || '') === (file.type || ''));
    if (index !== -1) {
      used.add(index);
      files.push(stored[index]);
    }
    return files;
  }, []);
};

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private
const createLead = async (req, res) => {
  const { name, email, consumerNumber, phone, address, monthlyBill, solarCapacity, roofType, propertyType, source, assignedTo, personalInfo, referredByStaff, referredByCustomer, paymentMode } = req.body;

  try {
    const lead = await Lead.create({
      name,
      email,
      consumerNumber: consumerNumber || '',
      phone,
      address,
      monthlyBill: monthlyBill || '0-1000',
      solarCapacity,
      roofType,
      propertyType,
      source: source || 'Direct',
      referredByStaff: referredByStaff || null,
      referredByCustomer: referredByCustomer || null,
      paymentMode: paymentMode || 'Direct',
      personalInfo,
      assignedTo: assignedTo || req.user._id,
      createdBy: req.user._id,
      owner: req.user.role === 'admin' ? req.user._id : req.user.owner,
    });

    await syncLeadWorkflowTasks(lead._id, lead.owner);
    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create a new lead from public referral form
// @route   POST /api/leads/public-referral
// @access  Public
const createPublicReferral = async (req, res) => {
  const { name, email, phone, source, referrerDetails, remarks } = req.body;

  try {
    const User = require('../models/userModel');
    // Find the main admin to assign as owner
    const adminUser = await User.findOne({ role: 'admin' });

    if (!adminUser) {
      return res.status(500).json({ message: 'System configuration error. Admin not found.' });
    }

    const lead = await Lead.create({
      name,
      email,
      phone,
      address: 'Not Provided (Public Form)',
      monthlyBill: 'Below 1800 rs',
      source: source || 'Direct',
      referrerDetails,
      owner: adminUser._id,
      createdBy: adminUser._id,
      status: 'Open(Not Assigned Yet)'
    });

    // Add remark if provided
    if (remarks) {
      lead.history.push({
        status: lead.status,
        comment: `Public Form Referral Remark: ${remarks}`,
      });
      await lead.save();
    }

    res.status(201).json({ message: 'Referral submitted successfully', lead });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Handle incoming Google Forms webhook
// @route   POST /api/leads/google-form-webhook
// @access  Public
const handleGoogleFormWebhook = async (req, res) => {
  // Google Apps Script will send data in req.body
  const { name, phone, email, source, referrerDetails, remarks, address } = req.body;

  try {
    const User = require('../models/userModel');
    // Find the main admin to assign as owner
    const adminUser = await User.findOne({ role: 'admin' });

    if (!adminUser) {
      return res.status(500).json({ message: 'System configuration error. Admin not found.' });
    }

    // Map source to valid enum
    let mappedSource = source || 'Digital';
    if (mappedSource === 'BTL Lead Referral') {
      mappedSource = 'BTL';
    }

    const lead = await Lead.create({
      name: name || 'Google Form Lead',
      email: email || '',
      phone: phone || 'Not Provided',
      address: address || 'Not Provided (Google Form)',
      monthlyBill: 'Below 1800 rs',
      source: mappedSource,
      referrerDetails: referrerDetails || 'Google Form',
      owner: adminUser._id,
      createdBy: adminUser._id,
      status: 'Open(Not Assigned Yet)'
    });

    // Add remark if provided
    if (remarks) {
      lead.history.push({
        status: lead.status,
        comment: `Google Form Referral Remark: ${remarks}`,
      });
      await lead.save();
    }

    res.status(201).json({ message: 'Google Form webhook received successfully', lead });
  } catch (error) {
    console.error('Google Form Webhook Error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all leads (Admin: all, Staff: assigned only)
// @route   GET /api/leads
// @access  Private
const getLeads = async (req, res) => {
  try {
    let query = { owner: req.user.role === 'admin' ? req.user._id : req.user.owner };

    // If not admin, only show assigned leads
    if (req.user.role !== 'admin') {
      query.assignedTo = req.user._id;
    }

    const leads = await Lead.find(query)
      .select(WITHOUT_FILE_CONTENTS)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name')
      .populate('referredByStaff', 'name')
      .populate('referredByCustomer', 'name phone')
      .populate('history.updatedBy', 'name')
      .lean();
    res.json(leads);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get a single lead with its uploaded documents
// @route   GET /api/leads/:id
// @access  Private
const getLeadById = async (req, res) => {
  try {
    const accessible = await getLeadIfAccessible(req.user, req.params.id);
    if (!accessible) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = await Lead.findOne({ _id: req.params.id })
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name')
      .populate('referredByStaff', 'name')
      .populate('referredByCustomer', 'name phone')
      .populate('history.updatedBy', 'name')
      .lean();

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update lead status or details
// @route   PATCH /api/leads/:id
// @access  Private
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (lead) {
      // Check if lead is closed
      if (lead.status === 'Closed') {
        return res.status(400).json({ message: 'This lead is closed and cannot be modified' });
      }

      // Check if staff is authorized to update this lead
      if (req.user.role !== 'admin' && lead.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: 'Not authorized to update this lead' });
      }

      if (req.body.status && req.body.status !== lead.status) {
        // Clear follow-up if status moves to 'Meeting Done' or 'Meeting Won'
        const completionStatuses = ['Meeting Done(Hot)', 'Meeting Done(Moderate)', 'Meeting Done(Cold)', 'Meeting Won'];
        if (completionStatuses.includes(req.body.status)) {
          lead.followUpDate = null;
          lead.followUpStatus = 'Completed';
        }

        lead.history.push({
          status: req.body.status,
          comment: req.body.comment || 'Status updated',
          updatedBy: req.user._id,
        });
        lead.status = req.body.status;
      }

      lead.name = req.body.name || lead.name;
      lead.email = req.body.email || lead.email;
      if (req.body.consumerNumber !== undefined) {
        lead.consumerNumber = req.body.consumerNumber;
      }
      lead.phone = req.body.phone || lead.phone;
      lead.address = req.body.address || lead.address;
      lead.monthlyBill = req.body.monthlyBill || lead.monthlyBill || '0-1000';
      lead.solarCapacity = req.body.solarCapacity || lead.solarCapacity;
      lead.roofType = req.body.roofType || lead.roofType;
      lead.propertyType = req.body.propertyType || lead.propertyType;
      lead.paymentMode = req.body.paymentMode || lead.paymentMode || 'Direct';
      lead.followUpDate = req.body.followUpDate || lead.followUpDate;
      lead.followUpStatus = req.body.followUpStatus || lead.followUpStatus;
      lead.followUpRemarks = req.body.followUpRemarks || lead.followUpRemarks;
      lead.quotationAmount = req.body.quotationAmount || lead.quotationAmount;
      lead.technicalRemarks = req.body.technicalRemarks || lead.technicalRemarks;
      lead.companyName = req.body.companyName || lead.companyName;
      lead.companyAddress = req.body.companyAddress || lead.companyAddress;
      lead.gstNumber = req.body.gstNumber || lead.gstNumber;
      lead.leadLostReason = req.body.leadLostReason !== undefined ? req.body.leadLostReason : lead.leadLostReason;
      
      if (req.body.subStatus !== undefined) {
        lead.subStatus = req.body.subStatus;
      }
      
      if (req.body.source !== undefined) lead.source = req.body.source;
      if (req.body.referredByStaff !== undefined) lead.referredByStaff = req.body.referredByStaff || null;
      if (req.body.referredByCustomer !== undefined) lead.referredByCustomer = req.body.referredByCustomer || null;

      if (req.body.personalInfo) {
        const currentInfo = lead.personalInfo?.toObject ? lead.personalInfo.toObject() : (lead.personalInfo || {});
        const personalInfo = { ...currentInfo, ...req.body.personalInfo };
        if (req.body.personalInfo.additionalImages !== undefined) {
          personalInfo.additionalImages = restoreFileContents(req.body.personalInfo.additionalImages, currentInfo.additionalImages);
        }
        lead.personalInfo = personalInfo;
      }

      // Only admin can reassign leads
      if (req.user.role === 'admin') {
        lead.assignedTo = req.body.assignedTo || lead.assignedTo;
      }

      const isNewFollowUp = req.body.followUpDate && req.body.followUpDate !== lead.followUpDate?.toISOString();
      if (isNewFollowUp) {
        lead.followUpNotified = false;
      }

      const updatedLead = await lead.save();

      // Create notification for follow-up
      if (isNewFollowUp) {
        const followDate = new Date(req.body.followUpDate);
        const dateStr = followDate.toLocaleDateString('en-GB');
        const timeStr = followDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        await Notification.create({
          recipient: lead.assignedTo,
          title: 'Follow-up Scheduled',
          message: `New follow-up for ${lead.name} on ${dateStr} at ${timeStr}`,
          type: 'FollowUp',
          relatedId: lead._id
        });

        // Also notify admin if staff updated it
        if (req.user.role !== 'admin') {
          await Notification.create({
            recipient: lead.owner, // Admin who owns the system
            title: 'Staff Scheduled Follow-up',
            message: `${req.user.name} scheduled a follow-up for ${lead.name} on ${dateStr} at ${timeStr}`,
            type: 'FollowUp',
            relatedId: lead._id
          });
        }
      }

      res.json(stripFileContents(updatedLead));
    } else {
      res.status(404).json({ message: 'Lead not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const logPhoneView = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (lead) {
      // Ensure we don't spam the history if they click multiple times in a short span, 
      // but simple push is okay for a start.
      lead.history.push({
        status: lead.status, // Keep current status
        comment: "Viewed lead's contact number",
        updatedBy: req.user._id,
      });
      const updatedLead = await lead.save();

      // Notify admin
      if (req.user.role !== 'admin') {
        const dateStr = new Date().toLocaleDateString('en-GB');
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await Notification.create({
          recipient: lead.owner, // Admin who owns the system
          title: 'Contact Number Viewed',
          message: `${req.user.name} viewed contact number for lead ${lead.name} on ${dateStr} at ${timeStr}`,
          type: 'LeadUpdate',
          relatedId: lead._id
        });
      }

      res.json(stripFileContents(updatedLead));
    } else {
      res.status(404).json({ message: 'Lead not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { 
  createLead, 
  getLeads, 
  getLeadById,
  updateLead, 
  logPhoneView,
  createPublicReferral,
  handleGoogleFormWebhook
};
