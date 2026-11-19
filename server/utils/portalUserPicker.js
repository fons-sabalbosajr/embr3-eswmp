// The list of portal accounts offered after a privileged portal sign-in (Developer
// Portal access and Planning Unit access). One function so both pickers show the
// same accounts, labelled the same way.

const UserPortal = require("../models/UserPortal");

// "Province - SLF Name", from the FACILITY record — the name the SLF Data Table
// shows. The account's own `assignedSlfName` is a copy taken when the account was
// assigned and drifts when a facility is renamed; most facility names already
// start with their province, the rest get it prefixed.
const facilityLabel = (f) => {
  const name = String(f?.lgu || "").trim();
  const province = String(f?.province || "").trim();
  if (!name) return province;
  if (!province || name.toLowerCase().startsWith(`${province.toLowerCase()} -`)) return name;
  return `${province} - ${name}`;
};

/**
 * Only ACTUAL, active portal users: no dummy/seed/test accounts, no blocked
 * accounts, nothing pending or rejected. Enforced here (backend) so direct API
 * access can't widen it.
 */
async function listPickablePortalUsers() {
  const users = await UserPortal.find({
    status: "approved",
    isDummy: { $ne: true },
    blocked: { $ne: true },
  })
    .select("firstName lastName email companyName assignedSlf assignedSlfName status isDummy")
    // The picker identifies an account by its landfill + province, and province
    // lives on the facility, not on the portal user.
    .populate("assignedSlf", "province lgu")
    .lean();

  const withProvince = users.map((u) => {
    const facilities = Array.isArray(u.assignedSlf) ? u.assignedSlf : [];
    const provinces = [...new Set(facilities.map((f) => f?.province).filter(Boolean))];
    const slfLabels = [...new Set(facilities.map(facilityLabel).filter(Boolean))];
    return { ...u, province: provinces.join(", "), slfLabels };
  });

  // Sort by the facility label, then account name — clearer than createdAt.
  const label = (u) =>
    u.slfLabels?.[0] ||
    (Array.isArray(u.assignedSlfName) ? u.assignedSlfName[0] : u.assignedSlfName) ||
    u.companyName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "";
  withProvince.sort((a, b) => label(a).localeCompare(label(b)));
  return withProvince;
}

module.exports = { listPickablePortalUsers, facilityLabel };
