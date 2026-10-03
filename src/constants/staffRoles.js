/** Non-admin roles that appear in staff registry (excludes admin) */
const STAFF_ROLE_DEFINITIONS = [
  { value: 'staff', label: 'Consultant' },
  { value: 'sales_executive', label: 'Sales Executive' },
  { value: 'computer_operator', label: 'Computer Operator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'site_inspection', label: 'Site Inspection' },
  { value: 'net_metering', label: 'Net Metering' },
  { value: 'local_marketing', label: 'Local Marketing' },
  { value: 'telecaller', label: 'Lead Relationship Manager' },
];

const STAFF_MEMBER_ROLES = STAFF_ROLE_DEFINITIONS.map((d) => d.value);

const TELECALLER_ROLE = 'telecaller';

/** Roles that work on converted leads, quotations, and workflow tasks (not telecaller) */
const LEAD_STAFF_ROLES = STAFF_MEMBER_ROLES.filter((r) => r !== TELECALLER_ROLE);

const USER_ROLES = ['admin', ...STAFF_MEMBER_ROLES];

const isLeadStaffRole = (role) => LEAD_STAFF_ROLES.includes(role);

const getStaffRoleLabel = (role) => {
  const found = STAFF_ROLE_DEFINITIONS.find((d) => d.value === role);
  return found?.label ?? role;
};

module.exports = {
  STAFF_ROLE_DEFINITIONS,
  STAFF_MEMBER_ROLES,
  LEAD_STAFF_ROLES,
  TELECALLER_ROLE,
  USER_ROLES,
  isLeadStaffRole,
  getStaffRoleLabel,
};
