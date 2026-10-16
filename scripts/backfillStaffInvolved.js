/**
 * One-time backfill: staffInvolved from current assignee + all workflow task assignees.
 * Run: node scripts/backfillStaffInvolved.js
 */
require('dotenv').config();
const connectDB = require('../src/config/db');
const Lead = require('../src/models/leadModel');
const LeadTask = require('../src/models/leadTaskModel');

const run = async () => {
  await connectDB();

  const tasks = await LeadTask.find({ assignedTo: { $ne: null } })
    .select('lead assignedTo')
    .lean();
  const byLead = new Map();
  for (const row of tasks) {
    const key = row.lead.toString();
    if (!byLead.has(key)) byLead.set(key, new Set());
    byLead.get(key).add(row.assignedTo.toString());
  }

  const leads = await Lead.find().select('_id assignedTo staffInvolved').lean();
  let updated = 0;

  for (const lead of leads) {
    const merged = new Set((lead.staffInvolved || []).map((id) => id.toString()));
    if (lead.assignedTo) merged.add(lead.assignedTo.toString());
    const fromTasks = byLead.get(lead._id.toString());
    if (fromTasks) fromTasks.forEach((id) => merged.add(id));
    if (!merged.size) continue;

    const next = [...merged];
    const prev = (lead.staffInvolved || []).map((id) => id.toString()).sort().join(',');
    const nextKey = next.sort().join(',');
    if (prev === nextKey) continue;

    await Lead.updateOne({ _id: lead._id }, { $set: { staffInvolved: next } });
    updated += 1;
  }

  console.log(`Backfill complete: updated ${updated} lead(s).`);
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
