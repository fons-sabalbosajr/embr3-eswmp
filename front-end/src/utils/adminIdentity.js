export const ADMIN_ALIAS = "ESWM Admin";

export function getAdminDisplayName(user = {}) {
  if (!user || typeof user !== "object") return "";
  if (String(user.role || "").toLowerCase() === "developer") {
    return ADMIN_ALIAS;
  }

  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || user.email || "";
}