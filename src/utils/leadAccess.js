const Lead = require('../models/leadModel');
const LeadTask = require('../models/leadTaskModel');

const getOwnerId = (user) => (user.role === 'admin' ? user._id : user.owner);

const getLeadIfAccessible = async (user, leadId) => {
  const ownerId = getOwnerId(user);
  if (!ownerId) return null;

  const lead = await Lead.findOne({ _id: leadId, owner: ownerId });
  if (!lead) return null;

  if (user.role === 'admin') return lead;
  if (lead.assignedTo && lead.assignedTo.toString() === user._id.toString()) return lead;

  const hasWorkflowTask = await LeadTask.exists({
    lead: leadId,
    assignedTo: user._id,
  });

  return hasWorkflowTask ? lead : null;
};

module.exports = { getOwnerId, getLeadIfAccessible };
