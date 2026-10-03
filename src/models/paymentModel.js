const mongoose = require('mongoose');

const paymentSchema = mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    paymentMode: {
      type: String,
      required: true,
      enum: ['Cash', 'Online', 'Cheque', 'UPI', 'Bank Transfer'],
    },
    paymentType: {
      type: String,
      required: true,
      enum: ['Booking Amount', 'Material Payment', 'Installation Payment', 'Final Payment'],
    },
    referenceNo: {
      type: String,
    },
    bankName: {
      type: String,
    },
    chequeDate: {
      type: Date,
    },
    remarks: {
      type: String,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ owner: 1, paymentDate: 1 });
paymentSchema.index({ owner: 1, leadId: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
