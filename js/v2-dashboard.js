import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { V2_ROLE_LABELS, v2Role, v2Permissions } from "./v2-role-config.js";

const cfg = window.GESTION_BTP_SUPABASE || {};
if (/^https:\/\/.+\.supabase\.co$/.test(cfg.url || "") && String(cfg.anonKey || "").length > 30) {
  const db = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  let state = { profile: null, role: null };

  function injectStyles() {
    if (document.getElementById("v2DashStyles")) return;
    const style = document.createElement("style");
    style.id = "v2DashStyles";
    style.textContent = `
      .v2-dashboard-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
      .v2-dashboard-card{padding:18px;border:1px solid #d7e7de;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(20,70,45,.05)}
      .v2-dashboard-card small{display:block;color:#6f7c74;font-weight:800}.v2-dashboard-card strong{display:block;margin-top:7px;color:#075f3b;font-size:26px}
      .v2-dashboard-section{padding:20px;border:1px solid #d7e7de;border-radius:20px;background:#fff;margin-top:14px}.v2-dashboard-section h2{margin:0;color:#075f3b}.v2-dashboard-section p{color:#758078}
      .v2-dashboard-actions{display:flex;gap:10px;flex-wrap:wrap}.v2-dashboard-action{border:0;border-radius:13px;padding:12px 15px;background:#eef6f1;color:#075f3b;font-weight:900;cursor:pointer}
      .v2-role-chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#e3f2e9;color:#075f3b;font-size:12px;font-weight:900}
      @media(max-width:760px){.v2-dashboard-grid{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  async function getContext() {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) return null;
    const { data: profile, error } = await db.from("profiles").select("id,first_name,last_name,email,status,role,business_role").eq("id", session.user.id).maybeSingle();
    if (error || !profile) return null;
    const role = v2Role(profile);
    state = { profile, role };
    window.dispatchEvent(new CustomEvent("gestion-btp:v2-context", { detail: { profile, role, permissions: v2Permissions(role) } }));
    return state;
  }

  function navButton(label, page) {
    return `<button type="button" class="v2-dashboard-action" data-v2-page="${esc(page)}">${esc(label)}</button>`;
  }

  async function managementMetrics() {
    const now = new Date();
    const monday = new Date(now); const day = (monday.getDay()+6)%7; monday.setDate(monday.getDate()-day); monday.setHours(0,0,0,0);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate()+6);
    const start = monday.toISOString().slice(0,10), end = sunday.toISOString().slice(0,10);
    const [profiles, projects, sheets, leaves] = await Promise.all([
      db.from("profiles").select("id,status,business_role,role"),
      db.from("projects").select("id,status,planned_start_date,planned_end_date"),
      db.from("timesheets").select("id,status,iso_year,iso_week"),
      db.from("leave_requests").select("id,status,start_date,end_date").or(`start_date.lte.${end},end_date.gte.${start}`),
    ]);
    return {
      employees: (profiles.data||[]).filter(p=>p.status==="active").length,
      activeProjects: (projects.data||[]).filter(p=>["active","overdue"].includes(p.status)).length,
      pendingSheets: (sheets.data||[]).filter(s=>["pending_review","changed_after_validation","submitted"].includes(s.status)).length,
      pendingLeaves: (leaves.data||[]).filter(l=>l.status==="pending").length,
    };
  }

  async function conductorMetrics(profileId) {
    const { data: links } = await db.from("project_conductors").select("project_id,projects(id,status)").eq("conductor_id", profileId);
    const ids = (links||[]).map(x=>x.project_id);
    let hours = 0;
    if (ids.length) {
      const { data } = await db.from("v2_project_time_entries").select("project_id,hours").in("project_id", ids);
      hours = (data||[]).reduce((s,x)=>s+Number(x.hours||0),0);
    }
    return { projects: ids.length, hours };
  }

  async function employeeMetrics(profileId) {
    const { data } = await db.from("v2_project_time_entries").select("hours,project_id,work_date,meal,travel_km").eq("employee_id", profileId);
    const rows = data || [];
    return {
      hours: rows.reduce((s,x)=>s+Number(x.hours||0),0),
      projects: new Set(rows.map(x=>x.project_id).filter(Boolean)).size,
      days: new Set(rows.map(x=>x.work_date)).size,
      it: rows.reduce((s,x)=>s+Number(x.travel_km||0),0),
    };
  }

  async function renderDashboard(root, profile, role) {
    const perms = v2Permissions(role);
    const firstName = profile.first_name || "";
    let html = `<div class="v66-pagehead"><div><h1>Bonjour ${esc(firstName)}</h1><p>Tableau de bord adapté à votre rôle.</p></div><span class="v2-role-chip">${esc(V2_ROLE_LABELS[role])}</span></div>`;
    if (["admin","patron","direction"].includes(role)) {
      const m = await managementMetrics();
      html += `<div class="v2-dashboard-grid"><div class="v2-dashboard-card"><small>Comptes actifs</small><strong>${m.employees}</strong></div><div class="v2-dashboard-card"><small>Chantiers actifs</small><strong>${m.activeProjects}</strong></div><div class="v2-dashboard-card"><small>Fiches à traiter</small><strong>${m.pendingSheets}</strong></div><div class="v2-dashboard-card"><small>Congés à traiter</small><strong>${m.pendingLeaves}</strong></div></div>`;
      html += `<section class="v2-dashboard-section"><h2>Actions rapides</h2><p>Accédez directement aux tâches prioritaires.</p><div class="v2-dashboard-actions">${perms.canManageAccounts?navButton("Gérer les comptes","accounts"):""}${navButton("Statistiques chantiers","projects")}${navButton("Fiches d’heures","legacy")}${navButton("Congés & RTT","leaves")}</div></section>`;
    } else if (role === "conducteur") {
      const m = await conductorMetrics(profile.id);
      html += `<div class="v2-dashboard-grid"><div class="v2-dashboard-card"><small>Mes chantiers</small><strong>${m.projects}</strong></div><div class="v2-dashboard-card"><small>Heures suivies</small><strong>${fmt(m.hours)} h</strong></div><div class="v2-dashboard-card"><small>Accès</small><strong>Lecture ciblée</strong></div><div class="v2-dashboard-card"><small>Statistiques</small><strong>Mes chantiers</strong></div></div>`;
      html += `<section class="v2-dashboard-section"><h2>Mes outils</h2><div class="v2-dashboard-actions">${navButton("Mes chantiers","projects")}${navButton("Fiches de mes chantiers","legacy")}${navButton("Mes congés & RTT","leaves")}</div></section>`;
    } else {
      const m = await employeeMetrics(profile.id);
      html += `<div class="v2-dashboard-grid"><div class="v2-dashboard-card"><small>Heures enregistrées</small><strong>${fmt(m.hours)} h</strong></div><div class="v2-dashboard-card"><small>Chantiers travaillés</small><strong>${m.projects}</strong></div><div class="v2-dashboard-card"><small>Jours travaillés</small><strong>${m.days}</strong></div><div class="v2-dashboard-card"><small>IT enregistrés</small><strong>${fmt(m.it)} km</strong></div></div>`;
      html += `<section class="v2-dashboard-section"><h2>Mes outils</h2><div class="v2-dashboard-actions">${navButton("Ma fiche d’heures","legacy")}${navButton("Mes congés & RTT","leaves")}<button type="button" class="v2-dashboard-action" data-v2-personal-stats>Mes statistiques</button></div></section>`;
    }
    root.innerHTML = html;
    root.querySelectorAll("[data-v2-page]").forEach(btn=>btn.onclick=()=>document.querySelector(`.v66-nav [data-page="${btn.dataset.v2Page}"]`)?.click());
    root.querySelector("[data-v2-personal-stats]")?.addEventListener("click",()=>document.querySelector(".v66-nav [data-personal-project-stats],.v66-nav [data-preview-personal-stats]")?.click());
  }

  function enforceNav(role) {
    const nav = document.querySelector(".v66-nav"); if (!nav) return;
    const perms = v2Permissions(role);
    const accountButton = nav.querySelector('[data-page="accounts"]');
    if (accountButton) accountButton.hidden = !perms.canManageAccounts;
  }

  async function enhance() {
    injectStyles();
    const ctx = state.profile ? state : await getContext(); if (!ctx) return;
    enforceNav(ctx.role);
    const root = document.querySelector("#v66Content");
    const activeHome = document.querySelector('.v66-nav [data-page="home"].active');
    if (root && activeHome && !root.dataset.v2DashboardRendered) {
      root.dataset.v2DashboardRendered = "true";
      try { await renderDashboard(root, ctx.profile, ctx.role); } catch (e) { console.warn("V2 dashboard", e); }
    }
  }

  document.addEventListener("click", e=>{
    if (e.target.closest('.v66-nav [data-page]')) {
      const root=document.querySelector("#v66Content"); if(root) delete root.dataset.v2DashboardRendered;
      setTimeout(enhance,120);
    }
  }, true);
  const ob = new MutationObserver(()=>{clearTimeout(ob.t);ob.t=setTimeout(enhance,120)}); ob.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(enhance,400);
}
