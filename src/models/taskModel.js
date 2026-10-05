const mongoose = require('mongoose');
const { LEAD_STAFF_ROLES } = require('../constants/staffRoles');

const taskSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    responsibleStaff: {
      type: String,
      required: true,
      enum: LEAD_STAFF_ROLES,
    },
    /** Workflow sequence: lower numbers are assigned first */
    sortOrder: {
      type: Number,
      required: [true, 'Order is required'],
      min: [1, 'Order must be at least 1'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

taskSchema.index({ owner: 1, sortOrder: 1, createdAt: 1 });

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;
