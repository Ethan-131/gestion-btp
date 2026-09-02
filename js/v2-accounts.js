import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { V2_ROLE_CONFIG, V2_ROLE_LABELS, V2_ROLE_ORDER, v2Role } from "./v2-role-config.js";

const cfg=window.GESTION_BTP_SUPABASE||{};
if(/^https:\/\/.+\.supabase\.co$/.test(cfg.url||"")&&String(cfg.anonKey||"").length>30){
  const db=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function actor(){const{data:{session}}=await db.auth.getSession();if(!session?.user)return null;const{data}=await db.from("profiles").select("id,role,business_role,status").eq("id",session.user.id).maybeSingle();return data}
  async function targetFromDrawer(drawer){const email=drawer.querySelector("header small")?.textContent.trim();if(!email)return null;const{data}=await db.from("profiles").select("id,email,role,business_role,first_name,last_name").eq("email",email).maybeSingle();return data}
  function allowedRoles(actorRole,targetRole){if(actorRole==="admin")return V2_ROLE_ORDER;if(actorRole==="patron")return ["direction","conducteur","salarie"].filter(r=>!(["admin","patron"].includes(targetRole)));return[]}
  function legacyOf(role){return V2_ROLE_CONFIG[role]?.legacyRole||"salarie"}

  async function enhanceDrawer(drawer){
    if(drawer.dataset.v2RolesReady)return;drawer.dataset.v2RolesReady="loading";
    const [me,target]=await Promise.all([actor(),targetFromDrawer(drawer)]);if(!me||!target){drawer.dataset.v2RolesReady="error";return}
    const meRole=v2Role(me),targetRole=v2Role(target),roles=allowedRoles(meRole,targetRole);
    if(!roles.length){drawer.dataset.v2RolesReady="readonly";return}
    const section=[...drawer.querySelectorAll("section")].find(s=>s.querySelector('input[name="role"]'));
    if(!section){drawer.dataset.v2RolesReady="error";return}
    const oldChoices=section.querySelector(".v66-choice-list");
    if(oldChoices)oldChoices.style.display="none";
    const box=document.createElement("div");box.className="v66-choice-list v2-business-role-list";
    box.innerHTML=roles.map(id=>`<label class="v66-choice-tile"><input type="radio" name="business_role_v2" value="${id}" ${targetRole===id?"checked":""} required><span><b>${esc(V2_ROLE_LABELS[id])}</b><i aria-hidden="true"></i></span></label>`).join("");
    section.appendChild(box);
    const note=document.createElement("p");note.className="v66-help";note.textContent=meRole==="admin"?"L’Administrateur technique peut attribuer tous les rôles.":"Le Patron peut gérer Direction, Conducteur de travaux et Salarié. Les rôles Patron et Administrateur restent protégés.";section.appendChild(note);

    const submit=drawer.querySelector('footer button[type="submit"], footer button:not([type]), button.v66-btn.primary');
    if(submit&&!submit.dataset.v2Intercept){
      submit.dataset.v2Intercept="1";
      submit.addEventListener("click",async e=>{
        if(drawer.dataset.v2Bypass==="1"){drawer.dataset.v2Bypass="0";return}
        e.preventDefault();e.stopImmediatePropagation();
        const selected=drawer.querySelector('input[name="business_role_v2"]:checked')?.value||targetRole;
        const legacy=legacyOf(selected);
        const legacyInput=drawer.querySelector(`input[name="role"][value="${legacy}"]`);if(legacyInput)legacyInput.checked=true;
        submit.disabled=true;
        try{
          if(selected!==targetRole){const{error}=await db.rpc("set_business_role_v2",{target_id:target.id,new_role:selected});if(error)throw error}
          drawer.dataset.v2Bypass="1";submit.disabled=false;drawer.requestSubmit(submit);
        }catch(err){submit.disabled=false;const msg=drawer.querySelector(".v66-message");if(msg){msg.textContent=err.message;msg.className="v66-message error"}else alert(err.message)}
      },true);
    }
    drawer.dataset.v2RolesReady="1";
  }

  async function enhanceAccountPage(){
    const ctx=window.GESTION_BTP_V2;if(!ctx)return;
    const page=document.querySelector('.v66-nav [data-page="accounts"].active');
    if(page&&!ctx.permissions?.canManageAccounts){page.hidden=true;document.querySelector('.v66-nav [data-page="home"]')?.click()}
  }

  const ob=new MutationObserver(()=>{clearTimeout(ob.t);ob.t=setTimeout(()=>{document.querySelectorAll(".v66-account-drawer").forEach(d=>enhanceDrawer(d).catch(console.warn));enhanceAccountPage()},80)});ob.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(()=>{document.querySelectorAll(".v66-account-drawer").forEach(d=>enhanceDrawer(d).catch(console.warn));enhanceAccountPage()},400);
}
