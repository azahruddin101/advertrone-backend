const mongoose = require('mongoose');

const districtSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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

districtSchema.index({ owner: 1, name: 1 }, { unique: true });

const District = mongoose.model('District', districtSchema);

module.exports = District;
