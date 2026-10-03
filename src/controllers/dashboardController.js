const Lead = require('../models/leadModel');
const User = require('../models/userModel');
const { isLeadStaffRole, STAFF_MEMBER_ROLES } = require('../constants/staffRoles');
const Payment = require('../models/paymentModel');
const Contact = require('../models/contactModel');
const Quotation = require('../models/quotationModel');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COMPLETED_FULFILLMENT_STATUSES = [
  'Installation done',
  'Net meter pending',
  'Net meter done',
  'AMC docs pending',
  'AMC handover done',
];

const sumPayments = async (match) => {
  const [row] = await Payment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return row?.total || 0;
};

const sumPipeline = async (match) => {
  const [row] = await Quotation.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$netEffectivePrice' } } },
  ]);
  return row?.total || 0;
};

const buildRevenueChartData = (revenueByMonthRows) => {
  const revenueMap = new Map(
    revenueByMonthRows.map((row) => [`${row._id.year}-${row._id.month}`, row.revenue])
  );

  const chart = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
    const key = `${year}-${monthIndex + 1}`;
    chart.push({
      name: MONTH_LABELS[monthIndex],
      revenue: revenueMap.get(key) || 0,
    });
  }
  return chart;
};

const getOrderInstallationStats = async (quotationQuery, paidLeadIds) => {
  if (!paidLeadIds.length) {
    return { totalOrders: 0, activeInstallations: 0, completedInstallations: 0 };
  }

  const [row] = await Quotation.aggregate([
    {
      $match: {
        ...quotationQuery,
        lead: { $in: paidLeadIds },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        activeInstallations: {
          $sum: {
            $cond: [{ $in: ['$fulfillmentStatus', COMPLETED_FULFILLMENT_STATUSES] }, 0, 1],
          },
        },
        completedInstallations: {
          $sum: {
            $cond: [{ $in: ['$fulfillmentStatus', COMPLETED_FULFILLMENT_STATUSES] }, 1, 0],
          },
        },
      },
    },
  ]);

  return {
    totalOrders: row?.totalOrders || 0,
    activeInstallations: row?.activeInstallations || 0,
    completedInstallations: row?.completedInstallations || 0,
  };
};

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
const getDashboardStats = async (req, res) => {
  try {
    if (req.user.role === 'telecaller') {
      const assignedTo = req.user._id;
      const [totalContacts, pendingContacts, convertedContacts, contactStatusDistribution, recentContacts] =
        await Promise.all([
          Contact.countDocuments({ assignedTo }),
          Contact.countDocuments({ assignedTo, status: 'New' }),
          Contact.countDocuments({ assignedTo, status: 'Converted' }),
          Contact.aggregate([
            { $match: { assignedTo } },
            { $group: { _id: '$status', value: { $sum: 1 } } },
            { $project: { name: '$_id', value: 1, _id: 0 } },
          ]),
          Contact.find({ assignedTo }).sort({ updatedAt: -1 }).limit(5).lean(),
        ]);

      return res.json({
        role: 'telecaller',
        totalContacts,
        pendingContacts,
        convertedContacts,
        contactStatusDistribution,
        recentContacts,
      });
    }

    const isAdmin = req.user.role === 'admin';
    const ownerId = isAdmin ? req.user._id : req.user.owner;
    const isStaff = isLeadStaffRole(req.user.role);

    let staffLeadIds = null;
    if (isStaff) {
      staffLeadIds = await Lead.find({ assignedTo: req.user._id }).distinct('_id');
    }

    const leadQuery = { owner: ownerId };
    if (isStaff) leadQuery.assignedTo = req.user._id;

    const paymentQuery = { owner: ownerId };
    if (isStaff) paymentQuery.leadId = { $in: staffLeadIds };

    const quotationQuery = { owner: ownerId };
    if (isStaff) quotationQuery.lead = { $in: staffLeadIds };

    const chartStart = new Date();
    chartStart.setMonth(chartStart.getMonth() - 5);
    chartStart.setDate(1);
    chartStart.setHours(0, 0, 0, 0);

    const [
      totalLeads,
      pendingLeads,
      totalRevenue,
      recentLeads,
      staffCount,
      totalQuotations,
      pipelineValue,
      paidLeadIds,
      revenueByMonth,
      statusDistribution,
    ] = await Promise.all([
      Lead.countDocuments(leadQuery),
      Lead.countDocuments({ ...leadQuery, status: 'New' }),
      sumPayments(paymentQuery),
      Lead.find(leadQuery)
        .select('-personalInfo.additionalImages')
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('assignedTo', 'name')
        .lean(),
      isAdmin
        ? User.countDocuments({
            role: { $in: STAFF_MEMBER_ROLES },
            owner: ownerId,
            isDeleted: { $ne: true },
          })
        : Promise.resolve(0),
      Quotation.countDocuments(quotationQuery),
      sumPipeline(quotationQuery),
      Payment.distinct('leadId', paymentQuery),
      Payment.aggregate([
        { $match: { ...paymentQuery, paymentDate: { $gte: chartStart } } },
        {
          $group: {
            _id: { year: { $year: '$paymentDate' }, month: { $month: '$paymentDate' } },
            revenue: { $sum: '$amount' },
          },
        },
      ]),
      Lead.aggregate([
        { $match: leadQuery },
        { $group: { _id: '$status', value: { $sum: 1 } } },
        { $project: { name: '$_id', value: 1, _id: 0 } },
      ]),
    ]);

    const { totalOrders, activeInstallations, completedInstallations } =
      await getOrderInstallationStats(quotationQuery, paidLeadIds);

    const revenueChartData = buildRevenueChartData(revenueByMonth);

    const funnelData = [
      { name: 'Total Leads', value: totalLeads },
      { name: 'Quotations Sent', value: totalQuotations },
      { name: 'Confirmed Orders', value: totalOrders },
    ];

    res.json({
      totalLeads,
      pendingLeads,
      totalRevenue,
      pipelineValue,
      totalQuotations,
      totalOrders,
      activeInstallations,
      completedInstallations,
      staffCount,
      recentLeads,
      funnelData,
      revenueChartData,
      statusDistribution,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getDashboardStats };
