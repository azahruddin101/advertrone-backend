const User = require('../models/userModel');
const Task = require('../models/taskModel');
const LeadTask = require('../models/leadTaskModel');
const Lead = require('../models/leadModel');
const Notification = require('../models/notificationModel');
const { TELECALLER_ROLE } = require('../constants/staffRoles');
const { getNextSequenceValue } = require('./counter');
const { syncLeadWorkflowTasks, ensureLeadTasksForTaskIds } = require('./leadWorkflow');
const { taskCatalogSort } = require('./taskCatalogSort');

const normalizeDistrict = (district) => (district || '').trim().toLowerCase();

const resolveOwnerId = (ownerOrLead) => {
  if (!ownerOrLead) return null;
  if (ownerOrLead.owner) {
    const o = ownerOrLead.owner;
    return o._id || o;
  }
  return ownerOrLead._id || ownerOrLead;
};

const buildRoundRobinCounterId = (ownerId, role, district) => {
  const districtKey = normalizeDistrict(district).replace(/\s+/g, '_') || 'any';
  return `rr_${ownerId}_${role}_${districtKey}`;
};

/**
 * Active staff for owner + role, filtered by district when lead has a district.
 * Falls back to all staff in role if none match the district (so assignment still works).
 */
const getEligibleStaff = async (ownerId, role, district) => {
  const staff = await User.find({
    owner: ownerId,
    role,
    isDeleted: { $ne: true },
    status: 'active',
  })
    .sort({ createdAt: 1 })
    .lean();

  const districtNorm = normalizeDistrict(district);
  if (!districtNorm) return staff;

  const matched = staff.filter((s) => normalizeDistrict(s.district) === districtNorm);
  return matched.length > 0 ? matched : staff;
};

/**
 * Pick next staff member using a per-owner / role / district round-robin counter.
 */
const pickRoundRobinStaff = async (ownerId, role, district) => {
  const eligible = await getEligibleStaff(ownerId, role, district);
  if (!eligible.length) return null;

  const counterId = buildRoundRobinCounterId(ownerId, role, district);
  const seq = await getNextSequenceValue(counterId);
  const index = (seq - 1) % eligible.length;
  return eligible[index];
};

/**
 * Pick staff for a workflow task: fewest pending tasks first.
 * Ties go to whoever was given a task longest ago (never-assigned first, then in the
 * order staff were created), so equally loaded staff still take turns A, B, C, A...
 */
const pickLeastLoadedStaff = async (ownerId, role, district) => {
  const eligible = await getEligibleStaff(ownerId, role, district);
  if (!eligible.length) return null;
  if (eligible.length === 1) return eligible[0];

  // pending tasks of deleted task types are not real workload
  const catalogIds = (await Task.find({ owner: ownerId }).select('_id').lean()).map((t) => t._id);
  const stats = await LeadTask.aggregate([
    { $match: { assignedTo: { $in: eligible.map((s) => s._id) } } },
    {
      $group: {
        _id: '$assignedTo',
        pending: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$status', 'pending'] }, { $in: ['$task', catalogIds] }] },
              1,
              0,
            ],
          },
        },
        lastAssignedAt: { $max: '$assignedAt' },
      },
    },
  ]);
  const statsByStaff = new Map(stats.map((row) => [row._id.toString(), row]));
  const pendingOf = (s) => statsByStaff.get(s._id.toString())?.pending || 0;
  const lastAssignedOf = (s) => {
    const at = statsByStaff.get(s._id.toString())?.lastAssignedAt;
    return at ? new Date(at).getTime() : 0;
  };

  // eligible is already in creation order and sort is stable, so that order settles any remaining tie
  return [...eligible].sort(
    (a, b) => pendingOf(a) - pendingOf(b) || lastAssignedOf(a) - lastAssignedOf(b)
  )[0];
};

/** Assign an overall lead (contact) to a Lead Relationship Manager (telecaller). */
const pickRoundRobinTelecaller = async (ownerId) =>
  pickRoundRobinStaff(ownerId, TELECALLER_ROLE, null);

const assignTelecallerToContact = async (contact, ownerId) => {
  if (contact.assignedTo) return contact;
  const telecaller = await pickRoundRobinTelecaller(ownerId);
  if (!telecaller) return contact;
  contact.assignedTo = telecaller._id;
  await contact.save();
  return contact;
};

const LEAD_OPEN_STATUS = 'Open(Not Assigned Yet)';

const sameId = (a, b) => !!a && !!b && a.toString() === b.toString();

/**
 * Keep the lead record in step with its workflow so lists stop showing
 * "Open(Not Assigned Yet)" / "Unassigned" once a task has an owner.
 * - status moves Open(Not Assigned Yet) -> Assigned
 * - assignedTo is filled when empty, and follows the workflow from the previous
 *   task holder to the new one; a consultant picked by hand is left alone
 */
const syncLeadWithTaskAssignment = async ({
  leadId,
  staff,
  taskTitle,
  assignedById,
  previousHolderId,
  notify = true,
}) => {
  const lead = await Lead.findById(leadId).select('name status assignedTo').lean();
  if (!lead) return;

  const set = {};
  if (!lead.assignedTo || sameId(lead.assignedTo, previousHolderId)) {
    if (!sameId(lead.assignedTo, staff._id)) set.assignedTo = staff._id;
  }
  if (lead.status === LEAD_OPEN_STATUS) set.status = 'Assigned';

  const update = {
    $push: {
      history: {
        status: set.status || lead.status,
        comment: `Task "${taskTitle}" assigned to ${staff.name}`,
        updatedBy: assignedById,
        updatedAt: new Date(),
      },
    },
  };
  if (Object.keys(set).length) update.$set = set;
  await Lead.updateOne({ _id: leadId }, update);

  if (notify && !sameId(staff._id, assignedById)) {
    await Notification.create({
      recipient: staff._id,
      title: 'New Task Assigned',
      message: `"${taskTitle}" for ${lead.name} has been assigned to you`,
      type: 'LeadUpdate',
      relatedId: leadId,
    });
  }
};

/**
 * Assign one workflow task of a lead to a staff member (auto or manual) and
 * update the lead record to match.
 */
const assignLeadTask = async ({
  leadId,
  ownerId,
  taskType,
  staff,
  district,
  assignedById,
  previousHolderId,
}) => {
  await ensureLeadTasksForTaskIds(leadId, ownerId, [taskType._id]);

  // returns the row as it was before this assignment
  const before = await LeadTask.findOneAndUpdate(
    { lead: leadId, task: taskType._id },
    {
      $set: {
        district,
        assignedTo: staff._id,
        assignedBy: assignedById,
        assignedAt: new Date(),
        status: 'pending',
        remark: '',
        photoUrl: '',
        completedAt: null,
        completedBy: null,
      },
    }
  ).lean();

  await syncLeadWithTaskAssignment({
    leadId,
    staff,
    taskTitle: taskType.title,
    assignedById,
    previousHolderId: previousHolderId || (before?.status === 'pending' ? before.assignedTo : null),
  });
};

const getSortedCatalog = async (ownerId) =>
  Task.find({ owner: ownerId }).sort(taskCatalogSort).lean();

/**
 * Assign the first workflow step (lowest sortOrder). Further steps are assigned when the previous is completed.
 */
const autoAssignLeadWorkflowTasks = async (lead, assignedById) => {
  const ownerId = resolveOwnerId(lead);
  const leadId = lead._id || lead.id;
  const district = (lead.district || '').trim();
  if (!ownerId || !leadId) return { assigned: 0, reason: 'invalid_lead' };
  if (!district) return { assigned: 0, reason: 'no_district' };

  const catalog = await getSortedCatalog(ownerId);
  if (!catalog.length) return { assigned: 0, reason: 'no_task_types' };

  await syncLeadWorkflowTasks(leadId, ownerId);

  const first = catalog[0];
  const staff = await pickLeastLoadedStaff(ownerId, first.responsibleStaff, district);
  if (!staff) return { assigned: 0, reason: 'no_staff', taskTitle: first.title };

  await assignLeadTask({ leadId, ownerId, taskType: first, staff, district, assignedById });

  return { assigned: 1, taskTitle: first.title, staffName: staff.name };
};

/**
 * Start the workflow for a lead that has no assigned or completed step yet
 * (e.g. district was added after the lead was created). Never resets work already in progress.
 */
const startLeadWorkflowIfNotStarted = async (lead, assignedById) => {
  const leadId = lead._id || lead.id;
  const started = await LeadTask.exists({ lead: leadId, status: { $ne: 'unassigned' } });
  if (started) return { assigned: 0, reason: 'already_started' };
  return autoAssignLeadWorkflowTasks(lead, assignedById);
};

/**
 * After a task is marked done, assign the next step that is still open.
 * Steps already done are skipped; a step someone is already working on is left as is.
 */
const advanceLeadWorkflowAfterComplete = async (lead, completedLeadTask, assignedById) => {
  const ownerId = resolveOwnerId(lead);
  const leadId = lead._id || lead.id;
  if (!ownerId || !leadId) return { assigned: 0 };

  const completedTaskId = completedLeadTask.task?._id || completedLeadTask.task;
  const catalog = await getSortedCatalog(ownerId);
  const completedIdx = catalog.findIndex((t) => t._id.toString() === completedTaskId.toString());
  if (completedIdx < 0) return { assigned: 0 };

  const later = catalog.slice(completedIdx + 1);
  const rows = await LeadTask.find({ lead: leadId, task: { $in: later.map((t) => t._id) } })
    .select('task status')
    .lean();
  const statusByTask = new Map(rows.map((r) => [r.task.toString(), r.status]));
  const statusOf = (t) => statusByTask.get(t._id.toString()) || 'unassigned';

  const nextTask = later.find((t) => statusOf(t) !== 'done');
  if (!nextTask) return { assigned: 0, reason: 'workflow_complete' };
  if (statusOf(nextTask) === 'pending') {
    return { assigned: 0, reason: 'already_assigned', taskTitle: nextTask.title };
  }

  // older leads may have no district of their own; fall back to the finished task's
  const district = (lead.district || completedLeadTask.district || '').trim();
  if (!district) return { assigned: 0, reason: 'no_district', taskTitle: nextTask.title };

  const staff = await pickLeastLoadedStaff(ownerId, nextTask.responsibleStaff, district);
  if (!staff) return { assigned: 0, reason: 'no_staff', taskTitle: nextTask.title };

  await assignLeadTask({
    leadId,
    ownerId,
    taskType: nextTask,
    staff,
    district,
    assignedById,
    previousHolderId: completedLeadTask.assignedTo?._id || completedLeadTask.assignedTo,
  });

  return { assigned: 1, taskTitle: nextTask.title, staffName: staff.name };
};

module.exports = {
  pickRoundRobinStaff,
  pickLeastLoadedStaff,
  pickRoundRobinTelecaller,
  assignTelecallerToContact,
  assignLeadTask,
  syncLeadWithTaskAssignment,
  autoAssignLeadWorkflowTasks,
  startLeadWorkflowIfNotStarted,
  advanceLeadWorkflowAfterComplete,
  getEligibleStaff,
  getSortedCatalog,
};
