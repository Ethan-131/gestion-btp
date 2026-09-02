export const V2_ROLE_CONFIG = {
  admin: { label: "Administrateur technique", canManageAccounts: true, canManageSensitiveRoles: true, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  patron: { label: "Patron", canManageAccounts: true, canManageSensitiveRoles: false, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  direction: { label: "Direction", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: true, canReviewTimesheets: true, canReviewLeaves: true, canSeeAllStats: true, canSeeOwnStats: true },
  conducteur: { label: "Conducteur de travaux", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: "assigned", canReviewTimesheets: false, canReviewLeaves: false, canSeeAllStats: "assigned", canSeeOwnStats: true },
  salarie: { label: "Salarié", canManageAccounts: false, canManageSensitiveRoles: false, canManageProjects: false, canReviewTimesheets: false, canReviewLeaves: false, canSeeAllStats: false, canSeeOwnStats: true },
};
export const V2_ROLE_ORDER = ["admin","patron","direction","conducteur","salarie"];
export const V2_ROLE_LABELS = Object.fromEntries(V2_ROLE_ORDER.map(id=>[id,V2_ROLE_CONFIG[id].label]));
export function v2Role(profile){
  if(profile?.business_role && V2_ROLE_CONFIG[profile.business_role]) return profile.business_role;
  if(profile?.role==="admin") return "admin";
  if(profile?.role==="conducteur") return "conducteur";
  if(profile?.role==="salarie") return "salarie";
  return "direction";
}
export function v2Permissions(role){return V2_ROLE_CONFIG[role]||V2_ROLE_CONFIG.salarie;}
