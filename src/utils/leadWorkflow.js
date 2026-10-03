const Task = require('../models/taskModel');
const LeadTask = require('../models/leadTaskModel');

const buildUpsertOps = (leadId, ownerId, taskIds) =>
  taskIds.map((taskId) => ({
    updateOne: {
      filter: { lead: leadId, task: taskId },
      update: {
        $setOnInsert: {
          lead: leadId,
          task: taskId,
          owner: ownerId,
          status: 'unassigned',
          district: '',
        },
      },
      upsert: true,
    },
  }));

/** Upsert LeadTask rows for the given task type ids (single bulkWrite). */
const ensureLeadTasksForTaskIds = async (leadId, ownerId, taskIds) => {
  if (!taskIds.length) return;
  await LeadTask.bulkWrite(buildUpsertOps(leadId, ownerId, taskIds), { ordered: false });
};

/** Ensure every catalog task type has a LeadTask row for this lead (e.g. on lead create). */
const syncLeadWorkflowTasks = async (leadId, ownerId) => {
  const catalog = await Task.find({ owner: ownerId }).select('_id').lean();
  await ensureLeadTasksForTaskIds(leadId, ownerId, catalog.map((t) => t._id));
};

/**
 * Only upsert rows for catalog types that are missing on this lead (fast path for GET).
 * @param {Array} catalog - task type documents (must include _id)
 * @param {Set<string>} existingTaskIdStrings - task ids already on the lead
 */
const syncMissingLeadWorkflowTasks = async (leadId, ownerId, catalog, existingTaskIdStrings) => {
  const missingIds = catalog
    .filter((t) => !existingTaskIdStrings.has(t._id.toString()))
    .map((t) => t._id);
  await ensureLeadTasksForTaskIds(leadId, ownerId, missingIds);
  return missingIds;
};

module.exports = {
  syncLeadWorkflowTasks,
  syncMissingLeadWorkflowTasks,
  ensureLeadTasksForTaskIds,
};
