const Task = require('../models/taskModel');
const { LEAD_STAFF_ROLES, isLeadStaffRole } = require('../constants/staffRoles');
const { taskCatalogSort } = require('../utils/taskCatalogSort');

const getOwnerId = (user) => (user.role === 'admin' ? user._id : user.owner);

// @desc    Get tasks (admin: all org tasks, staff: matching responsible role)
// @route   GET /api/tasks
// @access  Private
const getTasks = async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    if (!ownerId) {
      return res.json([]);
    }

    const query = { owner: ownerId };
    if (req.user.role !== 'admin') {
      if (!isLeadStaffRole(req.user.role)) {
        return res.json([]);
      }
      query.responsibleStaff = req.user.role;
    }

    if (req.user.role === 'admin') {
      const catalog = await Task.find({ owner: ownerId }).sort({ createdAt: 1 });
      const needsOrder = catalog.some(
        (t) => typeof t.sortOrder !== 'number' || t.sortOrder < 1
      );
      if (catalog.length > 0 && needsOrder) {
        const sorted = [...catalog].sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        await Promise.all(
          sorted.map((task, index) => {
            if (typeof task.sortOrder === 'number' && task.sortOrder >= 1) {
              return Promise.resolve();
            }
            task.sortOrder = index + 1;
            return task.save();
          })
        );
      }
    }

    const tasks = await Task.find(query)
      .select('title description responsibleStaff sortOrder owner createdBy createdAt updatedAt')
      .sort(taskCatalogSort)
      .populate('createdBy', 'name');

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create task
// @route   POST /api/tasks
// @access  Private/Admin
const createTask = async (req, res) => {
  try {
    const { title, description, responsibleStaff, sortOrder } = req.body;
    const ownerId = req.user._id;

    if (!title?.trim() || !responsibleStaff) {
      return res.status(400).json({ message: 'Title and responsible staff are required' });
    }

    if (!LEAD_STAFF_ROLES.includes(responsibleStaff)) {
      return res.status(400).json({ message: 'Invalid responsible staff role' });
    }

    const order = Number(sortOrder);
    if (!Number.isFinite(order) || order < 1) {
      return res.status(400).json({ message: 'Order is required and must be a number of 1 or higher' });
    }

    const task = await Task.create({
      title: title.trim(),
      description: description?.trim() || '',
      responsibleStaff,
      sortOrder: order,
      owner: ownerId,
      createdBy: req.user._id,
    });

    const populated = await Task.findById(task._id)
      .select('title description responsibleStaff sortOrder owner createdBy createdAt updatedAt')
      .populate('createdBy', 'name');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update task
// @route   PUT /api/tasks/:id
// @access  Private
const updateTask = async (req, res) => {
  try {
    const ownerId = getOwnerId(req.user);
    const task = await Task.findOne({ _id: req.params.id, owner: ownerId });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (req.user.role !== 'admin') {
      return res.status(401).json({ message: 'Not authorized to update this task type' });
    }

    const { title, description, responsibleStaff, sortOrder } = req.body;

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description.trim();

    if (sortOrder !== undefined) {
      const order = Number(sortOrder);
      if (!Number.isFinite(order) || order < 1) {
        return res.status(400).json({ message: 'Order must be a positive number' });
      }
      task.sortOrder = order;
    }

    if (responsibleStaff !== undefined) {
      if (!LEAD_STAFF_ROLES.includes(responsibleStaff)) {
        return res.status(400).json({ message: 'Invalid responsible staff role' });
      }
      task.responsibleStaff = responsibleStaff;
    }

    await task.save();

    const populated = await Task.findById(task._id)
      .select('title description responsibleStaff sortOrder owner createdBy createdAt updatedAt')
      .populate('createdBy', 'name');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
// @access  Private/Admin
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, owner: req.user._id });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    await task.deleteOne();
    res.json({ message: 'Task removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getTasks, createTask, updateTask, deleteTask };
