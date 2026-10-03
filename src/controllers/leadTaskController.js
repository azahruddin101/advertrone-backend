const Task = require('../models/taskModel');
const LeadTask = require('../models/leadTaskModel');
const User = require('../models/userModel');
const { LEAD_STAFF_ROLES } = require('../constants/staffRoles');
const { getOwnerId, getLeadIfAccessible } = require('../utils/leadAccess');
const { syncMissingLeadWorkflowTasks, ensureLeadTasksForTaskIds } = require('../utils/leadWorkflow');
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
      Task.find({ owner: ownerId }).sort({ createdAt: 1 }).lean(),
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

    await ensureLeadTasksForTaskIds(lead._id, ownerId, [taskType._id]);

    const leadTask = await LeadTask.findOneAndUpdate(
      { lead: lead._id, task: taskType._id },
      {
        district: district.trim(),
        assignedTo,
        assignedBy: req.user._id,
        assignedAt: new Date(),
        status: 'pending',
        remark: '',
        photoUrl: '',
        completedAt: null,
        completedBy: null,
      },
      { new: true }
    )
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
    if (!remark?.trim() || !photoUrl?.trim()) {
      return res.status(400).json({ message: 'Photo and remark are required to mark task as done' });
    }

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
    leadTask.remark = remark.trim();
    leadTask.photoUrl = photoUrl.trim();
    leadTask.completedAt = new Date();
    leadTask.completedBy = req.user._id;
    await leadTask.save();

    const populated = await LeadTask.findById(leadTask._id)
      .populate('assignedTo', 'name email role district')
      .populate('assignedBy', 'name')
      .populate('completedBy', 'name')
      .populate('task');

    res.json(formatWorkflowItem(populated.task, populated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getLeadWorkflowTasks,
  assignLeadWorkflowTask,
  completeLeadWorkflowTask,
};
