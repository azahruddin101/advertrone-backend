const assert = require('assert');
const { buildStaffLeadListFilter } = require('../src/utils/leadAccess');

const userId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';
const otherLeadId = '507f1f77bcf86cd799439013';

// Staff sees leads they currently own, were ever involved with, or had a workflow task on
const filter = buildStaffLeadListFilter(ownerId, userId, [otherLeadId]);

assert.deepStrictEqual(filter.owner, ownerId);
assert.strictEqual(filter.$or.length, 3);
assert.deepStrictEqual(filter.$or[0], { assignedTo: userId });
assert.deepStrictEqual(filter.$or[1], { staffInvolved: userId });
assert.deepStrictEqual(filter.$or[2], { _id: { $in: [otherLeadId] } });

const filterNoTasks = buildStaffLeadListFilter(ownerId, userId, []);
assert.strictEqual(filterNoTasks.$or.length, 2);

console.log('leadAccess.test.js: all assertions passed');
