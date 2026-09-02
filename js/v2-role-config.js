export const V2_ROLE_CONFIG = {
  admin: { label: "Administrateur technique", legacyRole: "admin", canManageAccounts: true, canManageSensitiveRoles: true, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  patron: { label: "Patron", legacyRole: "rh", canManageAccounts: true, canManageSensitiveRoles: false, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  direction: { label: "Direction", legacyRole: "rh", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  conducteur: { label: "Conducteur de travaux", legacyRole: "conducteur", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: "assigned", canReviewTimesheets: false, canReviewLeaves: false, canSeeAllStats: "assigned", canSeeOwnStats: true },
  salarie: { label: "Salarié", legacyRole: "salarie", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: false, canReviewTimesheets: false, canReviewLeaves: false, canSeeAllStats: false, canSeeOwnStats: true },
};

export const V2_ROLE_ORDER = ["admin", "patron", "direction", "conducteur", "salarie"];
export const V2_ROLE_LABELS = Object.fromEntries(V2_ROLE_ORDER.map((id) => [id, V2_ROLE_CONFIG[id].label]));

export function v2Roles(profile) {
  const roles = Array.isArray(profile?.business_roles) ? profile.business_roles.filter(r => V2_ROLE_CONFIG[r]) : [];
  if (roles.length) return [...new Set(roles)];
  if (profile?.business_role && V2_ROLE_CONFIG[profile.business_role]) return [profile.business_role];
  if (profile?.role === "admin") return ["admin"];
  if (profile?.role === "conducteur") return ["conducteur"];
  if (profile?.role === "salarie") return ["salarie"];
  return ["direction"];
}

export function v2Role(profile) {
  const roles = v2Roles(profile);
  return V2_ROLE_ORDER.find(id => roles.includes(id)) || "salarie";
}

export function v2Permissions(input) {
  const roles = Array.isArray(input) ? input : [input];
  const valid = roles.filter(r => V2_ROLE_CONFIG[r]);
  const merged = { canManageAccounts:false, canManageSensitiveRoles:false, canManageProjects:false, canReviewTimesheets:false, canReviewLeaves:false, canSeeAllStats:false, canSeeOwnStats:false };
  for (const role of valid) {
    const p = V2_ROLE_CONFIG[role];
    merged.canManageAccounts ||= !!p.canManageAccounts;
    merged.canManageSensitiveRoles ||= !!p.canManageSensitiveRoles;
    merged.canReviewTimesheets ||= !!p.canReviewTimesheets;
    merged.canReviewLeaves ||= !!p.canReviewLeaves;
    merged.canSeeOwnStats ||= !!p.canSeeOwnStats;
    merged.canManageProjects = merged.canManageProjects === true || p.canManageProjects === true ? true : (merged.canManageProjects || p.canManageProjects);
    merged.canSeeAllStats = merged.canSeeAllStats === true || p.canSeeAllStats === true ? true : (merged.canSeeAllStats || p.canSeeAllStats);
  }
  return merged;
}

export function v2RolesLabel(roles) {
  return v2Roles({business_roles: roles}).map(r => V2_ROLE_LABELS[r]).join(" + ");
}
