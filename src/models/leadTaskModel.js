const mongoose = require('mongoose');

const leadTaskSchema = mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    district: {
      type: String,
      default: '',
      trim: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['unassigned', 'pending', 'done'],
      default: 'unassigned',
    },
    remark: {
      type: String,
      default: '',
      trim: true,
    },
    photoUrl: {
      type: String,
      default: '',
    },
    attachments: [
      {
        url: { type: String, required: true },
        name: { type: String, default: '', trim: true },
        mimeType: { type: String, default: '' },
      },
    ],
    completedAt: {
      type: Date,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

leadTaskSchema.index({ lead: 1, task: 1 }, { unique: true });

const LeadTask = mongoose.model('LeadTask', leadTaskSchema);

module.exports = LeadTask;
