const Task = require('../models/taskModel');
const LeadTask = require('../models/leadTaskModel');
const User = require('../models/userModel');
const { LEAD_STAFF_ROLES } = require('../constants/staffRoles');
const { getOwnerId, getLeadIfAccessible } = require('../utils/leadAccess');
const { syncMissingLeadWorkflowTasks } = require('../utils/leadWorkflow');
const { taskCatalogSort } = require('../utils/taskCatalogSort');
const {
  advanceLeadWorkflowAfterComplete,
  assignLeadTask,
  syncLeadWithTaskAssignment,
} = require('../utils/roundRobinAssignment');
const Lead = require('../models/leadModel');

const formatWorkflowItem = (taskType, leadTask) => ({
  taskType,
  leadTask,
  status: leadTask?.status || 'unassigned',
});

// @desc    Get workflow tasks for a lead (all catalog task types)
// @route   GET /api/leads/:id/tasks
// @access  Private
const findLeadTasksForLead = (filter) =>
  LeadTask.find(filter)
    .populate('assignedTo', 'name email role district')
    .populate('assignedBy', 'name')
    .populate('completedBy', 'name')
    .populate('task');

const getLeadWorkflowTasks = async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    const leadId = req.params.id;

    const [lead, catalog] = await Promise.all([
      getLeadIfAccessible(req.user, leadId),
      Task.find({ owner: ownerId }).sort(taskCatalogSort).lean(),
    ]);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    let leadTasks = await findLeadTasksForLead({ lead: lead._id });

    const existingTaskIds = new Set(
      leadTasks.map((lt) => (lt.task?._id || lt.task).toString())
    );

    const missingIds = await syncMissingLeadWorkflowTasks(
      lead._id,
      ownerId,
      catalog,
      existingTaskIds
    );

    if (missingIds.length > 0) {
      const added = await findLeadTasksForLead({
        lead: lead._id,
        task: { $in: missingIds },
      });
      leadTasks = leadTasks.concat(added);
    }

    const leadTaskByTypeId = new Map(
      leadTasks.map((lt) => [(lt.task?._id || lt.task).toString(), lt])
    );

    const items = catalog.map((taskType) =>
      formatWorkflowItem(taskType, leadTaskByTypeId.get(taskType._id.toString()) || null)
    );

    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Assign workflow task (task type + district + staff)
// @route   POST /api/leads/:id/tasks/assign
// @access  Private/Admin
const assignLeadWorkflowTask = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const lead = await Lead.findOne({ _id: req.params.id, owner: ownerId });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const { taskId, district, assignedTo } = req.body;
    if (!taskId || !district?.trim() || !assignedTo) {
      return res.status(400).json({ message: 'Task, district, and staff are required' });
    }

    const taskType = await Task.findOne({ _id: taskId, owner: ownerId });
    if (!taskType) {
      return res.status(400).json({ message: 'Invalid task type' });
    }

    const staff = await User.findOne({
      _id: assignedTo,
      owner: ownerId,
      role: { $in: LEAD_STAFF_ROLES },
      isDeleted: { $ne: true },
      status: 'active',
    });

    if (!staff) {
      return res.status(400).json({ message: 'Invalid staff member' });
    }

    if (staff.role !== taskType.responsibleStaff) {
      return res.status(400).json({
        message: `This task must be assigned to ${taskType.responsibleStaff.replace(/_/g, ' ')} staff`,
      });
    }

    const districtNorm = district.trim().toLowerCase();
    const staffDistrict = (staff.district || '').trim().toLowerCase();
    if (staffDistrict && districtNorm !== staffDistrict) {
      return res.status(400).json({ message: 'Selected staff does not belong to this district' });
    }

    await assignLeadTask({
      leadId: lead._id,
      ownerId,
      taskType,
      staff,
      district: district.trim(),
      assignedById: req.user._id,
    });

    // older leads have no district of their own; keep the one chosen here so later steps can auto-assign
    if (!lead.district) {
      await Lead.updateOne({ _id: lead._id }, { $set: { district: district.trim() } });
    }

    const leadTask = await LeadTask.findOne({ lead: lead._id, task: taskType._id })
      .populate('assignedTo', 'name email role district')
      .populate('assignedBy', 'name')
      .populate('task');

    res.json(formatWorkflowItem(taskType, leadTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark workflow task done (photo + remark)
// @route   PATCH /api/leads/:id/tasks/:leadTaskId/complete
// @access  Private
const completeLeadWorkflowTask = async (req, res) => {
  try {
    const lead = await getLeadIfAccessible(req.user, req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const { remark, photoUrl } = req.body;

    const leadTask = await LeadTask.findOne({
      _id: req.params.leadTaskId,
      lead: lead._id,
    }).populate('task');

    if (!leadTask) {
      return res.status(404).json({ message: 'Task not found for this lead' });
    }

    if (leadTask.status === 'done') {
      return res.status(400).json({ message: 'Task is already completed' });
    }

    const isAdmin = req.user.role === 'admin';
    const isAssignee =
      leadTask.assignedTo && leadTask.assignedTo.toString() === req.user._id.toString();

    if (!isAdmin) {
      if (leadTask.status !== 'pending') {
        return res.status(400).json({ message: 'Task must be assigned before completion' });
      }
      if (!isAssignee) {
        return res.status(401).json({ message: 'Not authorized to complete this task' });
      }
    }

    leadTask.status = 'done';
    leadTask.remark = remark?.trim() || '';
    leadTask.photoUrl = photoUrl?.trim() || '';
    leadTask.completedAt = new Date();
    leadTask.completedBy = req.user._id;
    await leadTask.save();

    const nextAssignment = await advanceLeadWorkflowAfterComplete(lead, leadTask, req.user._id);

    const populated = await LeadTask.findById(leadTask._id)
      .populate('assignedTo', 'name email role district')
      .populate('assignedBy', 'name')
      .populate('completedBy', 'name')
      .populate('task');

    res.json({ ...formatWorkflowItem(populated.task, populated), nextAssignment });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Workflow progress per lead (current step, who holds it, steps done)
// @route   GET /api/lead-tasks/summary
// @access  Private/Admin
const getWorkflowSummary = async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    const catalog = await Task.find({ owner: ownerId })
      .sort(taskCatalogSort)
      .select('title')
      .lean();
    if (!catalog.length) {
      return res.json({ total: 0, leads: {}, counts: {} });
    }

    const rows = await LeadTask.find({
      owner: ownerId,
      task: { $in: catalog.map((t) => t._id) },
      status: { $ne: 'unassigned' },
    })
      .select('lead task status assignedTo')
      .populate('assignedTo', 'name')
      .lean();

    const rowsByLead = new Map();
    for (const row of rows) {
      const key = row.lead.toString();
      if (!rowsByLead.has(key)) rowsByLead.set(key, new Map());
      rowsByLead.get(key).set(row.task.toString(), row);
    }

    const leads = {};
    for (const [leadId, byTask] of rowsByLead) {
      let done = 0;
      let current = null;
      catalog.forEach((taskType, index) => {
        const row = byTask.get(taskType._id.toString());
        if (row?.status === 'done') {
          done += 1;
        } else if (!current) {
          current = {
            title: taskType.title,
            step: index + 1,
            status: row?.status || 'unassigned',
            assignedTo: row?.assignedTo || null,
          };
        }
      });
      leads[leadId] = { done, current };
    }

    // Leads whose task was assigned before the lead record was kept in step:
    // bring status / assignee up to date once, so they stop reading "Not Assigned Yet".
    const heldLeadIds = Object.keys(leads).filter(
      (id) => leads[id].current?.status === 'pending' && leads[id].current.assignedTo
    );
    if (heldLeadIds.length) {
      const stale = await Lead.find({
        _id: { $in: heldLeadIds },
        owner: ownerId,
        $or: [{ status: 'Open(Not Assigned Yet)' }, { assignedTo: null }],
      })
        .select('_id')
        .lean();
      for (const { _id } of stale) {
        const { current } = leads[_id.toString()];
        await syncLeadWithTaskAssignment({
          leadId: _id,
          staff: current.assignedTo,
          taskTitle: current.title,
          assignedById: req.user._id,
          notify: false,
        });
      }
    }

    // Same set the Task Management submenu lists: leads whose current step is this type.
    // A lead with no workflow activity yet is shown under the first task type.
    const ownerLeads = await Lead.find({ owner: ownerId }).select('_id').lean();
    const counts = Object.fromEntries(catalog.map((taskType) => [taskType._id.toString(), 0]));
    const firstId = catalog[0]._id.toString();
    for (const lead of ownerLeads) {
      const entry = leads[lead._id.toString()];
      if (!entry) {
        counts[firstId] += 1;
        continue;
      }
      if (!entry.current) continue;
      const currentType = catalog[entry.current.step - 1];
      if (currentType) counts[currentType._id.toString()] += 1;
    }

    res.json({ total: catalog.length, leads, counts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getWorkflowSummary,
  getLeadWorkflowTasks,
  assignLeadWorkflowTask,
  completeLeadWorkflowTask,
};
