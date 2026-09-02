import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { V2_ROLE_CONFIG, V2_ROLE_LABELS, V2_ROLE_ORDER, v2Role, v2Permissions } from "./v2-role-config.js";

const cfg=window.GESTION_BTP_SUPABASE||{};
if(/^https:\/\/.+\.supabase\.co$/.test(cfg.url||"")&&String(cfg.anonKey||"").length>30){
  const db=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let profile=null,role=null,previewRole=null;
  const originalRoleMap={salarie:"salarie",conducteur:"conducteur",rh:"direction",admin:"admin"};

  async function load(){const{data:{session}}=await db.auth.getSession();if(!session?.user)return false;const{data,error}=await db.from("profiles").select("*").eq("id",session.user.id).maybeSingle();if(error||!data)return false;profile=data;role=v2Role(profile);return true}
  function effectiveRole(){return previewRole||role}
  function legacyPreviewValue(v2){return V2_ROLE_CONFIG[v2]?.legacyRole||"salarie"}
  function updatePreviewSelect(){const select=document.querySelector("#v66RolePreview");if(!select||!profile)return;const opts=V2_ROLE_ORDER.map(id=>`<option value="${id}" ${effectiveRole()===id?"selected":""}>${esc(V2_ROLE_LABELS[id])}</option>`).join("");select.innerHTML=opts;select.onchange=()=>{const chosen=select.value;previewRole=chosen===role?null:chosen;window.dispatchEvent(new CustomEvent("gestion-btp:v2-preview-role",{detail:{role:effectiveRole()}}));const legacy=legacyPreviewValue(chosen);const temp=document.createElement("select");temp.innerHTML=`<option value="${legacy}" selected>${legacy}</option>`;const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value");try{descriptor?.set?.call(select,legacy);select.dispatchEvent(new Event("change",{bubbles:true}))}catch{}setTimeout(()=>{location.hash="#home";location.reload()},30)}}
  function labelHeader(){const header=document.querySelector(".v66-user span");if(header)header.textContent=`${V2_ROLE_LABELS[effectiveRole()]}${previewRole?" · simulation":""}`;const banner=document.querySelector(".v66-preview-banner");if(banner&&previewRole)banner.textContent=`Mode aperçu : affichage simulé en ${V2_ROLE_LABELS[previewRole]}. Votre véritable compte reste ${V2_ROLE_LABELS[role]}.`}
  function navPermissions(){const nav=document.querySelector(".v66-nav");if(!nav)return;const perms=v2Permissions(effectiveRole());const rules={accounts:!!perms.canManageAccounts,projects:effectiveRole()!=="salarie",leaves:true,legacy:true,home:true};Object.entries(rules).forEach(([page,show])=>{const b=nav.querySelector(`[data-page="${page}"]`);if(b)b.hidden=!show})}
  function settingsLabels(){document.querySelectorAll(".v66-account-readonly strong").forEach(el=>{if(el.textContent===profile?.role||["RH / Direction","Administrateur technique","Conducteur de travaux","Salarié"].includes(el.textContent))el.textContent=V2_ROLE_LABELS[role]});const help=[...document.querySelectorAll(".v66-help")].find(x=>x.textContent.includes("matricule, le rôle"));if(help)help.textContent="Le matricule, le rôle, le siège et le statut sont gérés selon les permissions du Patron et de l’Administrateur technique."}
  function accountDrawerRoles(){document.querySelectorAll('.v66-account-drawer input[name="role"]').forEach(input=>{const tile=input.closest("label");if(!tile)return;const legacy=input.value;let id=legacy==="rh"?"direction":legacy;const b=tile.querySelector("b");if(b)b.textContent=V2_ROLE_LABELS[id]||b.textContent});}
  async function enhance(){if(!profile&&!(await load()))return;updatePreviewSelect();labelHeader();navPermissions();settingsLabels();accountDrawerRoles();window.GESTION_BTP_V2={profile,role,effectiveRole:effectiveRole(),permissions:v2Permissions(effectiveRole()),labels:V2_ROLE_LABELS}}
  const ob=new MutationObserver(()=>{clearTimeout(ob.t);ob.t=setTimeout(enhance,100)});ob.observe(document.documentElement,{subtree:true,childList:true});setTimeout(enhance,350);
}
