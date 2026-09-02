import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { V2_ROLE_CONFIG, V2_ROLE_LABELS, V2_ROLE_ORDER, v2Role, v2Permissions } from "./v2-role-config.js";

const cfg=window.GESTION_BTP_SUPABASE||{};
if(/^https:\/\/.+\.supabase\.co$/.test(cfg.url||"")&&String(cfg.anonKey||"").length>30){
  const db=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const PREVIEW_KEY="gestion_btp_v2_preview_role";
  let profile=null,role=null;

  async function load(){
    const{data:{session}}=await db.auth.getSession();
    if(!session?.user)return false;
    const{data,error}=await db.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
    if(error||!data)return false;
    profile=data;role=v2Role(profile);return true;
  }
  function storedPreview(){const p=localStorage.getItem(PREVIEW_KEY);return V2_ROLE_CONFIG[p]?p:null}
  function effectiveRole(){return storedPreview()||role}
  function legacyPreviewValue(v2){return V2_ROLE_CONFIG[v2]?.legacyRole||"salarie"}

  function installPreviewControl(){
    const legacy=document.querySelector("#v66RolePreview");
    if(!legacy||!profile)return;
    const wrapper=legacy.closest("label")||legacy.parentElement;
    if(!wrapper)return;
    legacy.hidden=true;
    let custom=wrapper.querySelector("#v2RolePreview");
    if(!custom){
      custom=document.createElement("select");custom.id="v2RolePreview";
      wrapper.appendChild(custom);
      custom.addEventListener("change",()=>{
        const chosen=custom.value;
        if(chosen===role)localStorage.removeItem(PREVIEW_KEY);else localStorage.setItem(PREVIEW_KEY,chosen);
        const legacyValue=legacyPreviewValue(chosen);
        if(legacy.value!==legacyValue){legacy.value=legacyValue;legacy.dispatchEvent(new Event("change",{bubbles:true}))}
        else setTimeout(enhance,40);
      });
    }
    custom.innerHTML=V2_ROLE_ORDER.map(id=>`<option value="${id}" ${effectiveRole()===id?"selected":""}>${esc(V2_ROLE_LABELS[id])}</option>`).join("");
  }

  function labelHeader(){
    const current=effectiveRole(),sim=current!==role;
    const header=document.querySelector(".v66-user span");if(header)header.textContent=`${V2_ROLE_LABELS[current]}${sim?" · simulation":""}`;
    let banner=document.querySelector(".v66-preview-banner");
    if(sim){
      if(!banner){banner=document.createElement("div");banner.className="v66-preview-banner";document.querySelector(".v66-top")?.after(banner)}
      banner.textContent=`Mode aperçu : affichage simulé en ${V2_ROLE_LABELS[current]}. Votre véritable compte reste ${V2_ROLE_LABELS[role]}.`;
    }else if(banner){banner.remove()}
  }

  function navPermissions(){
    const nav=document.querySelector(".v66-nav");if(!nav)return;
    const r=effectiveRole(),perms=v2Permissions(r);
    const rules={accounts:!!perms.canManageAccounts,projects:r!=="salarie",leaves:true,legacy:true,home:true};
    Object.entries(rules).forEach(([page,show])=>{const b=nav.querySelector(`[data-page="${page}"]`);if(b)b.hidden=!show});
  }

  function settingsLabels(){
    document.querySelectorAll(".v66-account-readonly strong").forEach(el=>{if(["RH / Direction","Administrateur technique","Conducteur de travaux","Salarié",profile?.role].includes(el.textContent))el.textContent=V2_ROLE_LABELS[role]});
    const help=[...document.querySelectorAll(".v66-help")].find(x=>x.textContent.includes("matricule, le rôle"));
    if(help)help.textContent="Le matricule, le rôle, le siège et le statut sont gérés selon les permissions du Patron et de l’Administrateur technique.";
  }

  async function enhance(){
    if(!profile&&!(await load()))return;
    installPreviewControl();labelHeader();navPermissions();settingsLabels();
    window.GESTION_BTP_V2={profile,role,effectiveRole:effectiveRole(),permissions:v2Permissions(effectiveRole()),labels:V2_ROLE_LABELS};
    window.dispatchEvent(new CustomEvent("gestion-btp:v2-context",{detail:window.GESTION_BTP_V2}));
  }

  const ob=new MutationObserver(()=>{clearTimeout(ob.t);ob.t=setTimeout(enhance,90)});ob.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(enhance,300);
}
