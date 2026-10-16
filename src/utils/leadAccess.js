const Lead = require('../models/leadModel');
const LeadTask = require('../models/leadTaskModel');

const getOwnerId = (user) => (user.role === 'admin' ? user._id : user.owner);

/**
 * Mongo filter: leads a non-admin staff member may list (current assignee, workflow history, or past lead owner).
 */
const buildStaffLeadListFilter = (ownerId, userId, taskLeadIds = []) => {
  const or = [{ assignedTo: userId }, { staffInvolved: userId }];
  if (taskLeadIds.length) {
    or.push({ _id: { $in: taskLeadIds } });
  }
  return { owner: ownerId, $or: or };
};

const getStaffLeadListFilter = async (user) => {
  const ownerId = getOwnerId(user);
  if (!ownerId) return null;
  if (user.role === 'admin') {
    return { owner: ownerId };
  }

  const taskLeadIds = await LeadTask.distinct('lead', {
    owner: ownerId,
    assignedTo: user._id,
  });

  return buildStaffLeadListFilter(ownerId, user._id, taskLeadIds);
};

const getLeadIfAccessible = async (user, leadId) => {
  const ownerId = getOwnerId(user);
  if (!ownerId) return null;

  const lead = await Lead.findOne({ _id: leadId, owner: ownerId });
  if (!lead) return null;

  if (user.role === 'admin') return lead;
  if (lead.assignedTo && lead.assignedTo.toString() === user._id.toString()) return lead;

  const involved = (lead.staffInvolved || []).some(
    (id) => id && id.toString() === user._id.toString()
  );
  if (involved) return lead;

  const hasWorkflowTask = await LeadTask.exists({
    lead: leadId,
    assignedTo: user._id,
  });

  return hasWorkflowTask ? lead : null;
};

module.exports = {
  getOwnerId,
  buildStaffLeadListFilter,
  getStaffLeadListFilter,
  getLeadIfAccessible,
};
