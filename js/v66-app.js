import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.GESTION_BTP_SUPABASE || {};
const configured =
  /^https:\/\/.+\.supabase\.co$/.test(cfg.url || "") &&
  String(cfg.anonKey || "").length > 30;
const roleLabels = {
  salarie: "Salarié",
  conducteur: "Conducteur de travaux",
  rh: "RH / Direction",
  admin: "Administrateur technique",
};
const statusLabels = {
  pending: "En attente",
  active: "Actif",
  rejected: "Refusé",
  disabled: "Désactivé",
  upcoming: "À venir",
  overdue: "En retard",
  completed: "Terminé",
  archived: "Archivé",
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmtDate = (value) =>
  value ? new Date(value + "T12:00:00").toLocaleDateString("fr-FR") : "—";
const el = (tag, attrs = {}, html = "") => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) =>
    k === "class" ? (n.className = v) : n.setAttribute(k, v),
  );
  n.innerHTML = html;
  return n;
};

if (!configured) {
  const notice = el(
    "div",
    { class: "v66-setup" },
    "<strong>V66 prête à être connectée.</strong> L’application actuelle reste disponible. Crée le projet Supabase puis renseigne <code>js/supabase-config.js</code> pour activer les comptes, rôles et chantiers.",
  );
  document.body.appendChild(notice);
} else {
  boot(
    createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }),
  );
}

async function boot(db) {
  const globalTimesheetPurge="antras_timesheet_global_purge_2026_08_29_v1";
  if(localStorage.getItem(globalTimesheetPurge)!=="done"){
    localStorage.removeItem("antras_saved_history_v2");
    localStorage.removeItem("antras_sync_state_v3");
    Object.keys(localStorage).filter(key=>key.startsWith("antras_draft_v1_")||key.startsWith("antras_native_timesheet_")).forEach(key=>localStorage.removeItem(key));
    localStorage.setItem(globalTimesheetPurge,"done");
  }
  let session = null,
    profile = null,
    currentPage = "home",
    previewRole = null,
    routeIntent = null,
    authReady = false;
  const pageScrolls=new Map();
  const shell = el("div", { class: "v66-shell" });
  if(/^#[a-z-]+$/.test(location.hash))currentPage=location.hash.slice(1);
  document.body.appendChild(shell);
  document.body.classList.add("v66-lock");
  const setMessage = (node, text, type = "") => {
    node.textContent = text || "";
    node.className = "v66-message " + type;
  };
  const toast = (text) => {
    const n = el("div", { class: "v66-toast" }, esc(text));
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  };
  const fail = (e) => {
    console.error(e);
    toast(e?.message || "Une erreur est survenue.");
  };
  const fullName = (p) =>
    `${p?.first_name || ""} ${p?.last_name || ""}`.trim() ||
    p?.email ||
    "Compte";
  const isEthan = () =>
    String(session?.user?.email || "").toLowerCase() ===
    "ethan.mijalkovic1@gmail.com";
  const visibleRole = () =>
    isEthan() && previewRole ? previewRole : profile?.role;
  const navigateTo = (page, intent = null) => {
    pageScrolls.set(currentPage, shell.scrollTop);
    routeIntent = intent;
    currentPage = page;
    history.pushState({ page: currentPage }, "", `#${currentPage}`);
    appScreen();
  };

  window.addEventListener("online", () => {
    renderOffline();
    if (session && profile?.status === "active"){
      syncLegacySheets().catch(() => {});
      syncNativeDrafts().catch(() => {});
    }
  });
  window.addEventListener("offline", () => renderOffline());
  window.addEventListener("popstate",()=>{const next=(history.state&&history.state.page)||location.hash.slice(1)||"home";if(next!==currentPage){pageScrolls.set(currentPage,shell.scrollTop);currentPage=next;if(session&&profile?.status==="active")appScreen()}});
  window.addEventListener("antras:local-sheets-changed", () => {
    if (session && profile?.status === "active" && navigator.onLine)
      syncLegacySheets().catch(() => {});
  });
  window.addEventListener("message", async (event) => {
    if (event.origin !== location.origin || event.data?.type !== "antras:timesheet-saved") return;
    const msg=shell.querySelector("#v66SyncMessage");
    if (!navigator.onLine) {
      if(msg)setMessage(msg,"Fiche enregistrée sur l’appareil. Elle sera envoyée automatiquement dès que la connexion sera rétablie.","ok");
      return;
    }
    try{
      if(msg)setMessage(msg,"Enregistrement et partage avec le bureau…");
      await syncLegacySheets();
      if(msg)setMessage(msg,"Fiche enregistrée et partagée avec le bureau.","ok");
      const root=shell.querySelector("#v66Content");if(root)await loadMySheets(root);
    }catch(e){if(msg)setMessage(msg,"Fiche conservée sur l’appareil. Nouvel envoi automatique dès que possible.","error")}
  });
  function renderOffline() {
    document.querySelector(".v66-offline")?.remove();
    if (!navigator.onLine) {
      const n = el(
        "div",
        { class: "v66-offline" },
        "Mode hors connexion — les données déjà chargées restent accessibles. La synchronisation reprendra automatiquement.",
      );
      shell.prepend(n);
    }
  }

  async function loadProfile() {
    if (!session) {
      profile = null;
      return;
    }
    const { data, error } = await db
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (error) throw error;
    profile = data;
  }

  function authScreen(mode = "login") {
    shell.innerHTML = `<main class="v66-auth v66-card"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span></div><h1>${mode === "login" ? "Connexion" : "Demande de compte"}</h1><p>${mode === "login" ? "Connecte-toi avec ton adresse professionnelle." : "Une RH devra confirmer ton compte et lui attribuer un rôle avant tout accès."}</p><div class="v66-tabs"><button data-mode="login" class="${mode === "login" ? "active" : ""}">Se connecter</button><button data-mode="register" class="${mode === "register" ? "active" : ""}">Créer un compte</button></div><form class="v66-form" id="v66AuthForm">${mode === "register" ? '<div class="v66-grid"><label class="v66-field">Prénom<input name="first_name" required autocomplete="given-name"></label><label class="v66-field">Nom<input name="last_name" required autocomplete="family-name"></label></div><label class="v66-field">Matricule (facultatif)<input name="employee_number"></label>' : ""}<label class="v66-field">E-mail<input name="email" type="email" required autocomplete="email"></label><label class="v66-field">Mot de passe<input name="password" type="password" minlength="8" required autocomplete="${mode === "login" ? "current-password" : "new-password"}"></label><button class="v66-btn primary" type="submit">${mode === "login" ? "Se connecter" : "Envoyer la demande"}</button>${mode === "login" ? '<button class="v66-link-btn" type="button" id="v66ForgotPassword">Mot de passe oublié ?</button>' : ""}</form><div id="v66AuthMessage" class="v66-message"></div></main>`;
    shell
      .querySelectorAll("[data-mode]")
      .forEach((b) => (b.onclick = () => authScreen(b.dataset.mode)));
    shell.querySelector("#v66AuthForm").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        msg = shell.querySelector("#v66AuthMessage"),
        button = form.querySelector("button");
      button.disabled = true;
      setMessage(msg, "Traitement…");
      const values = Object.fromEntries(new FormData(form));
      try {
        if (mode === "login") {
          const { error } = await db.auth.signInWithPassword({
            email: values.email,
            password: values.password,
          });
          if (error) throw error;
        } else {
          const { data, error } = await db.auth.signUp({
            email: values.email,
            password: values.password,
            options: {
              emailRedirectTo: new URL("v66.html", location.href).href,
              data: {
                first_name: values.first_name.trim(),
                last_name: values.last_name.trim(),
                employee_number: values.employee_number.trim(),
              },
            },
          });
          if (error) throw error;
          if (!data.session) {
            setMessage(
              msg,
              "Demande créée. Vérifie ton e-mail, puis connecte-toi.",
              "ok",
            );
            form.reset();
            return;
          }
        }
      } catch (error) {
        setMessage(msg, error.message, "error");
      } finally {
        button.disabled = false;
      }
    };
    shell.querySelector("#v66ForgotPassword")?.addEventListener("click",async()=>{
      const email=shell.querySelector('input[name="email"]')?.value.trim(),msg=shell.querySelector("#v66AuthMessage");
      if(!email)return setMessage(msg,"Renseigne d’abord ton adresse e-mail.","error");
      try{setMessage(msg,"Envoi du lien…");const{error}=await db.auth.resetPasswordForEmail(email,{redirectTo:new URL("v66.html#settings",location.href).href});if(error)throw error;setMessage(msg,"Un lien sécurisé vient d’être envoyé par e-mail.","ok")}catch(e){setMessage(msg,e.message,"error")}
    });
  }

  function pendingScreen() {
    const rejected = profile.status === "rejected";
    shell.innerHTML = `<main class="v66-auth v66-card v66-pending"><span class="v66-pill ${esc(profile.status)}">${esc(statusLabels[profile.status] || profile.status)}</span><h1>${rejected ? "Demande refusée" : "Compte en attente de validation"}</h1><p>${rejected ? `Motif : ${esc(profile.rejection_reason || "aucun motif renseigné")}` : "Une RH doit encore confirmer ton compte et choisir ton rôle. Aucune donnée de l’entreprise n’est accessible pendant cette attente."}</p><div class="v66-actions" style="justify-content:center"><button class="v66-btn" id="v66Refresh">Actualiser</button><button class="v66-btn" id="v66Logout">Se déconnecter</button></div></main>`;
    shell.querySelector("#v66Refresh").onclick = async () => {
      try {
        await loadProfile();
        route();
      } catch (e) {
        fail(e);
      }
    };
    shell.querySelector("#v66Logout").onclick = () => db.auth.signOut();
  }

  function route() {
    if (!session) return authScreen();
    if (!profile || profile.status !== "active" || !profile.role)
      return pendingScreen();
    appScreen();
  }

  function allowedPages() {
    const role = visibleRole();
    const pages = [["home", "Accueil"]];
    if (role === "rh") pages.push(["accounts", "Comptes"]);
    if (["conducteur", "rh", "admin"].includes(role))
      pages.push(["projects", "Chantiers"]);
    pages.push(["leaves", "Congés & RTT"]);
    pages.push(["legacy", "Fiches d’heures"]);
    return pages;
  }

  function appScreen() {
    const pages = allowedPages();
    if (["review","team"].includes(currentPage)) { routeIntent={...(routeIntent||{}),employeeSheets:true};currentPage = "legacy"; }
    if (["stats", "it-settings"].includes(currentPage)) {
      routeIntent = { ...(routeIntent || {}), projectTab: currentPage };
      currentPage = "projects";
    }
    if (currentPage !== "settings" && !pages.some((x) => x[0] === currentPage)) currentPage = "home";
    const role = visibleRole();
    const preview = isEthan()
      ? `<label class="v66-role-preview"><span>Aperçu test</span><select id="v66RolePreview">${Object.entries(
          roleLabels,
        )
          .map(
            ([id, label]) =>
              `<option value="${id}" ${role === id ? "selected" : ""}>${esc(label)}</option>`,
          )
          .join("")}</select></label>`
      : "";
    shell.innerHTML = `<header class="v66-top"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span><button type="button" class="v66-settings-button ${currentPage === "settings" ? "active" : ""}" id="v66Settings" title="Paramètres du compte" aria-label="Paramètres du compte">⚙</button></div><div class="v66-top-actions">${preview}<div class="v66-user"><strong>${esc(fullName(profile))}</strong><span>${esc(roleLabels[role])}${previewRole ? " · simulation" : ""}</span></div></div></header>${previewRole ? '<div class="v66-preview-banner">Mode aperçu : l’affichage est simulé, ton véritable compte reste RH.</div>' : ""}<nav class="v66-nav">${pages.map(([id, label]) => `<button data-page="${id}" class="${id === currentPage ? "active" : ""}">${esc(label)}</button>`).join("")}</nav><main class="v66-main" id="v66Content"></main>`;
    renderOffline();
    shell.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          navigateTo(b.dataset.page);
        }),
    );
    shell.querySelector("#v66Settings").onclick = () => navigateTo("settings");
    shell.querySelector("#v66RolePreview")?.addEventListener("change", (e) => {
      previewRole = e.target.value === profile.role ? null : e.target.value;
      currentPage = "home";
      appScreen();
    });
    const content = shell.querySelector("#v66Content");
    if (currentPage === "home") renderHome(content);
    if (currentPage === "accounts") renderAccounts(content);
    if (currentPage === "projects") renderProjectHub(content);
    if (currentPage === "stats") renderStats(content);
    if (currentPage === "it-settings") renderItSettings(content);
    if (currentPage === "leaves") renderLeaves(content);
    if (currentPage === "legacy") renderLegacy(content);
    if (currentPage === "settings") renderSettings(content);
    requestAnimationFrame(()=>{shell.scrollTop=pageScrolls.get(currentPage)||0});
  }

  async function renderHome(root) {
    const role = visibleRole();
    root.innerHTML = `<section class="v66-page"><div class="v66-pagehead"><div><h1>Bonjour ${esc(profile.first_name || "")}</h1><p>Voici les actions utiles pour ton rôle ${esc(roleLabels[role])}.</p></div></div><div class="v66-dashboard" id="v66Dashboard"><div class="v66-card v66-empty">Chargement de ton tableau de bord…</div></div></section>`;
    const dashboard = root.querySelector("#v66Dashboard");
    try {
      if (role === "rh") {
        const now = currentIsoWeek(), previousDate = new Date(isoWeekBounds(now.year, now.week).monday);
        previousDate.setUTCDate(previousDate.getUTCDate() - 7);
        const previous = isoWeekFromDate(previousDate);
        const [accounts, leaves, roster] = await Promise.all([
          db.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
          db.from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "cancellation_requested"]),
          db.rpc("week_timesheet_roster", { target_year: previous.year, target_week: previous.week }),
        ]);
        if (accounts.error) throw accounts.error;if (leaves.error) throw leaves.error;if (roster.error) throw roster.error;
        const missing = (roster.data || []).filter((r) => r.expected && !r.timesheet_id).length;
        dashboard.innerHTML = `<button class="v66-action-card" data-go="accounts"><span>Comptes en attente</span><strong>${accounts.count || 0}</strong><small>Valider ou refuser les demandes</small></button><button class="v66-action-card" data-go="leaves"><span>Congés & RTT à traiter</span><strong>${leaves.count || 0}</strong><small>Ouvrir les demandes récentes</small></button><button class="v66-action-card" data-go="team"><span>Fiches manquantes</span><strong>${missing}</strong><small>${esc(weekTitle(previous.year, previous.week))}</small></button>`;
        dashboard.querySelector('[data-go="accounts"]').onclick=()=>navigateTo("accounts",{status:"pending"});
        dashboard.querySelector('[data-go="leaves"]').onclick=()=>navigateTo("leaves",{group:"pending"});
        dashboard.querySelector('[data-go="team"]').onclick=()=>navigateTo("legacy",{employeeSheets:true,year:previous.year,week:previous.week,filter:"missing"});
      } else if (role === "conducteur") {
        const { data: projects, error } = await db.from("projects").select("id,code,name,planned_end_date,planned_hours,status,project_conductors!inner(conductor_id)").eq("project_conductors.conductor_id",profile.id).in("status",["active","overdue"]).order("planned_end_date",{ascending:true}).limit(8);
        if(error)throw error;
        const ids=(projects||[]).map(p=>p.id);let actual=new Map();
        if(ids.length){const {data:sites,error:se}=await db.from("timesheet_sites").select("project_id,hours").in("project_id",ids);if(se)throw se;(sites||[]).forEach(x=>actual.set(x.project_id,(actual.get(x.project_id)||0)+Number(x.hours||0)))}
        dashboard.innerHTML = (projects||[]).length ? `<div class="v66-card v66-dashboard-wide"><h2>Chantiers en cours</h2><div class="v66-list">${projects.map(p=>{const used=actual.get(p.id)||0,pct=Number(p.planned_hours)>0?Math.round(used/Number(p.planned_hours)*100):0;return `<button class="v66-project-shortcut" data-project="${p.id}"><span><strong>${esc(p.code)} — ${esc(p.name)}</strong><small>Fin prévue : ${fmtDate(p.planned_end_date)}</small></span><span><b>${pct}%</b><small>${used.toLocaleString("fr-FR")} / ${Number(p.planned_hours||0).toLocaleString("fr-FR")} h</small></span></button>`}).join("")}</div></div>` : '<div class="v66-card v66-empty">Aucun chantier en cours ne t’est attribué.</div>';
        dashboard.querySelectorAll("[data-project]").forEach(b=>b.onclick=()=>navigateTo("projects",{projectTab:"stats",projectId:b.dataset.project}));
      } else {
        const now=currentIsoWeek(),{data,error}=await db.from("timesheets").select("id,status,iso_year,iso_week").eq("employee_id",profile.id).eq("iso_year",now.year).eq("iso_week",now.week).maybeSingle();if(error)throw error;
        const editable=!data||["draft","rejected","changed_after_validation"].includes(data.status),label=!data?"Remplir ma fiche":editable?"Continuer ma fiche":"Voir ma fiche";
        dashboard.innerHTML=`<button class="v66-action-card v66-primary-action" id="v66HomeSheet"><span>${esc(weekTitle(now.year,now.week))}</span><strong>${esc(label)}</strong><small>${data?esc(sheetLabels[data.status]||data.status):"Aucune fiche commencée"}</small></button>`;
        dashboard.querySelector("#v66HomeSheet").onclick=()=>navigateTo("legacy",{year:now.year,week:now.week,open:true});
      }
    } catch(e){dashboard.innerHTML=`<div class="v66-card v66-empty">Impossible de charger le tableau de bord : ${esc(e.message)}</div>`}
  }

  async function renderAccounts(root) {
    root.innerHTML =
      '<div class="v66-pagehead"><div><h1>Comptes</h1><p>Validation RH et attribution du rôle initial.</p></div></div><input class="v66-search" id="v66AccountSearch" placeholder="Rechercher par nom, prénom, e-mail ou matricule…"><div class="v66-card"><div class="v66-list" id="v66Accounts"><div class="v66-empty">Chargement…</div></div></div>';
    try {
      const [{ data, error }, { data: establishments, error: estError }] =
        await Promise.all([
          db
            .from("profiles")
            .select("*")
            .order("created_at", { ascending: false }),
          db.from("establishments").select("*").order("name"),
        ]);
      if (error) throw error;
      if (estError) throw estError;
      const establishmentNames = new Map(
        (establishments || []).map((x) => [x.id, x.name]),
      );
      const pendingOnly=routeIntent?.status==="pending";if(pendingOnly)routeIntent=null;
      const list = root.querySelector("#v66Accounts");
      const paint = (query = "") => {
        const q = normalizeSearch(query),
          filtered = data.filter((p) => (!pendingOnly||p.status==="pending")&&
            smartSearchMatch(
              `${p.first_name || ""} ${p.last_name || ""} ${p.email || ""} ${p.employee_number || ""}`,
              q,
            ),
          );
      list.innerHTML = filtered.length
        ? filtered
            .map(
              (p) =>
                `<article class="v66-row" data-id="${p.id}"><div><strong>${esc(fullName(p))}</strong><small>${esc(p.email)}${p.employee_number ? " · " + esc(p.employee_number) : ""}</small></div><div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status] || p.status)}</span><small>${esc(roleLabels[p.role] || "Rôle non attribué")} · ${esc(establishmentNames.get(p.establishment_id) || "Siège non attribué")}</small></div><div class="v66-actions">${p.status === "pending" ? '<button class="v66-btn primary" data-approve>Valider</button><button class="v66-btn danger" data-reject>Refuser</button>' : '<button class="v66-btn" data-edit-account>Modifier</button>'}</div></article>`,
            )
            .join("")
        : `<div class="v66-empty">${q ? "Aucun salarié ne correspond à cette recherche." : "Aucun compte."}</div>`;
      list
        .querySelectorAll("[data-approve]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              approveAccount(b.closest("[data-id]").dataset.id, data)),
        );
      list
        .querySelectorAll("[data-reject]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              rejectAccount(b.closest("[data-id]").dataset.id)),
        );
      list.querySelectorAll("[data-edit-account]").forEach(
        (b) =>
          (b.onclick = () =>
            editAccount(
              data.find((x) => x.id === b.closest("[data-id]").dataset.id),
              establishments,
            )),
      );
      };
      paint();
      root.querySelector("#v66AccountSearch").oninput = (event) =>
        paint(event.target.value);
    } catch (e) {
      root.querySelector("#v66Accounts").innerHTML =
        `<div class="v66-empty">${esc(e.message)}</div>`;
    }
  }

  async function approveAccount(id, accounts) {
    const { data: establishments, error } = await db
      .from("establishments")
      .select("*")
      .eq("active", true)
      .order("name");
    if (error) return fail(error);
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>Valider le compte</h2><label class="v66-field">Rôle<select name="role" required><option value="salarie">Salarié</option><option value="conducteur">Conducteur de travaux</option><option value="rh">RH / Direction</option><option value="admin">Administrateur technique</option></select></label><label class="v66-field">Siège de rattachement<select name="establishment_id" required><option value="">Choisir le siège…</option>${(establishments || []).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label><p class="v66-help">Le siège détermine automatiquement la zone IT appliquée pour chaque chantier.</p><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Confirmer</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick = () => modal.remove();
    modal.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const msg = e.currentTarget.querySelector(".v66-message"),
        fd = new FormData(e.currentTarget);
      try {
        const { error } = await db
          .from("profiles")
          .update({
            status: "active",
            role: fd.get("role"),
            establishment_id: fd.get("establishment_id"),
            rejection_reason: null,
            approved_by: profile.id,
            approved_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("status", "pending");
        if (error) throw error;
        modal.remove();
        toast("Compte validé et siège attribué.");
        renderAccounts(shell.querySelector("#v66Content"));
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    };
  }

  function editAccount(account, establishments) {
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>Modifier le compte</h2><p class="v66-help">${esc(fullName(account))}</p><label class="v66-field">Rôle<select name="role" required>${Object.entries(
        roleLabels,
      )
        .map(
          ([id, label]) =>
            `<option value="${id}" ${account.role === id ? "selected" : ""}>${esc(label)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="v66-field">Siège de rattachement<select name="establishment_id" required><option value="">Choisir le siège…</option>${(
        establishments || []
      )
        .filter((x) => x.active)
        .map(
          (x) =>
            `<option value="${x.id}" ${account.establishment_id === x.id ? "selected" : ""}>${esc(x.name)}</option>`,
        )
        .join(
          "",
        )}</select></label><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Enregistrer</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick = () => modal.remove();
    modal.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget),
        msg = e.currentTarget.querySelector(".v66-message");
      try {
        const { error } = await db
          .from("profiles")
          .update({
            role: fd.get("role"),
            establishment_id: fd.get("establishment_id"),
          })
          .eq("id", account.id);
        if (error) throw error;
        modal.remove();
        toast("Compte mis à jour.");
        renderAccounts(shell.querySelector("#v66Content"));
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    };
  }

  async function rejectAccount(id) {
    const reason = prompt("Indique le motif du refus :");
    if (reason === null) return;
    if (!reason.trim()) {
      toast("Un motif est obligatoire.");
      return;
    }
    try {
      const { error } = await db
        .from("profiles")
        .update({
          status: "rejected",
          rejection_reason: reason.trim(),
          role: null,
          approved_by: profile.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
      toast("Demande refusée.");
      renderAccounts(shell.querySelector("#v66Content"));
    } catch (e) {
      fail(e);
    }
  }

  async function renderItSettings(root) {
    root.innerHTML =
      '<div class="v66-pagehead"><div><h1>Paramètres IT</h1><p>Zones IT utilisées dans les fiches d’heures.</p></div><button class="v66-btn primary" id="v66NewZone">Nouvelle zone</button></div><div class="v66-info">Les zones sont associées aux chantiers séparément pour chacun des deux sièges.</div><div class="v66-list" id="v66Zones"><div class="v66-card v66-empty">Chargement…</div></div>';
    root.querySelector("#v66NewZone").onclick = () => zoneModal();
    try {
      const { data, error } = await db
        .from("it_zones")
        .select("*")
        .order("label");
      if (error) throw error;
      const list = root.querySelector("#v66Zones");
      list.innerHTML = data.length
        ? data
            .map(
              (z) =>
                `<article class="v66-card v66-row" data-id="${z.id}"><div><strong>${esc(z.label)}</strong><small>Zone IT</small></div><div><span class="v66-pill ${z.active ? "active" : "archived"}">${z.active ? "Active" : "Désactivée"}</span></div><div class="v66-actions"><button class="v66-btn" data-zone-edit>Modifier</button></div></article>`,
            )
            .join("")
        : '<div class="v66-card v66-empty">Aucune zone IT. Crée la première zone.</div>';
      list
        .querySelectorAll("[data-zone-edit]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              zoneModal(
                data.find((x) => x.id === b.closest("[data-id]").dataset.id),
              )),
        );
    } catch (e) {
      root.querySelector("#v66Zones").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  function zoneModal(zone = null) {
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>${zone ? "Modifier" : "Créer"} une zone IT</h2><label class="v66-field">Nom affiché sur la fiche<input name="label" required placeholder="Ex. Zone 1" value="${esc(zone?.label || "")}"></label>${zone ? `<label class="v66-check"><input name="active" type="checkbox" ${zone.active ? "checked" : ""}> Zone active</label>` : ""}<div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Enregistrer</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick = () => modal.remove();
    modal.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget),
        msg = e.currentTarget.querySelector(".v66-message"),
        values = {
          label: fd.get("label").trim(),
          active: zone ? fd.get("active") === "on" : true,
        };
      if (!zone) values.created_by = profile.id;
      try {
        const query = zone
          ? db.from("it_zones").update(values).eq("id", zone.id)
          : db.from("it_zones").insert(values);
        const { error } = await query;
        if (error) throw error;
        modal.remove();
        toast("Zone IT enregistrée.");
        renderItSettings(shell.querySelector("#v66Content"));
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    };
  }

  const leaveTypeLabels = { paid_leave: "Congés payés", rtt: "RTT" };
  const leaveStatusLabels = {
    pending: "En attente RH",
    approved: "Acceptée",
    rejected: "Refusée",
    cancelled: "Annulée",
    cancellation_requested: "Annulation demandée",
  };
  function easterSunday(year) {
    const a = year % 19,
      b = Math.floor(year / 100),
      c = year % 100,
      d = Math.floor(b / 4),
      e = b % 4,
      f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4),
      k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31),
      day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }
  const isoDay = (date) => date.toISOString().slice(0, 10);
  function holidayName(value) {
    const d =
        typeof value === "string" ? new Date(value + "T12:00:00Z") : value,
      y = d.getUTCFullYear(),
      key = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const fixed = {
      "01-01": "Jour de l’An",
      "05-01": "Fête du Travail",
      "05-08": "Victoire 1945",
      "07-14": "Fête nationale",
      "08-15": "Assomption",
      "11-01": "Toussaint",
      "11-11": "Armistice 1918",
      "12-25": "Noël",
    };
    if (fixed[key]) return fixed[key];
    const easter = easterSunday(y);
    for (const [offset, name] of [
      [1, "Lundi de Pâques"],
      [39, "Ascension"],
      [50, "Lundi de Pentecôte"],
    ]) {
      const x = new Date(easter);
      x.setUTCDate(x.getUTCDate() + offset);
      if (isoDay(x) === isoDay(d)) return name;
    }
    return "";
  }
  function isWeekend(value) {
    const d = new Date(value + "T12:00:00Z"),
      day = d.getUTCDay();
    return day === 0 || day === 6;
  }
  function businessDays(start, end) {
    let count = 0,
      d = new Date(start + "T12:00:00Z"),
      last = new Date(end + "T12:00:00Z");
    while (d <= last) {
      const key = isoDay(d);
      if (!isWeekend(key) && !holidayName(d)) count++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  }
  function leavePeriodText(p) {
    const part =
      p.duration_type === "morning"
        ? "matin"
        : p.duration_type === "afternoon"
          ? "après-midi"
          : "journée complète";
    const type = leaveTypeLabels[p.leave_type] || "Absence";
    return p.start_date === p.end_date
      ? `${fmtDate(p.start_date)} · ${type} · ${part}`
      : `${fmtDate(p.start_date)} → ${fmtDate(p.end_date)} · ${type} · ${p.requested_days} jours`;
  }

  async function renderLeaves(root, monthOffset = 0) {
    const role = visibleRole(),
      canReview = role === "rh",
      canCreate = ["salarie", "conducteur", "rh", "admin"].includes(role);
    const month = new Date();
    month.setUTCDate(1);
    month.setUTCMonth(month.getUTCMonth() + monthOffset);
    const first = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
      ),
      last = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
      );
    root.innerHTML = `<div class="v66-pagehead"><div><h1>Congés & RTT</h1><p>Clique une première date de début, puis une date de fin dans le calendrier.</p></div>${canCreate ? '<button class="v66-btn primary" id="v66NewLeave">Sélectionner des dates</button>' : ""}</div><div class="v66-info" id="v66RangeHint">Premier clic : début · second clic : fin</div><div class="v66-calendar-head"><button class="v66-btn" id="v66PrevMonth">‹</button><strong>${first.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><button class="v66-btn" id="v66NextMonth">›</button></div><div class="v66-calendar" id="v66LeaveCalendar"><div class="v66-empty">Chargement du calendrier…</div></div><div class="v66-pagehead" style="margin-top:22px"><div><h2>${canReview ? "Demandes à traiter et historique" : "Mes demandes"}</h2></div></div><div class="v66-list" id="v66LeaveList"><div class="v66-card v66-empty">Chargement…</div></div>`;
    root.querySelector("#v66PrevMonth").onclick = () =>
      renderLeaves(root, monthOffset - 1);
    root.querySelector("#v66NextMonth").onclick = () =>
      renderLeaves(root, monthOffset + 1);
    root.querySelector("#v66NewLeave")?.addEventListener("click", () => {
      root.querySelector("#v66LeaveCalendar").scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Choisis la date de début, puis la date de fin.");
    });
    try {
      const { data, error } = await db
        .from("leave_requests")
        .select(
          "*,profiles!leave_requests_employee_id_fkey(first_name,last_name,email),leave_periods(*)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      const requests = data || [];
      let rangeStart = "";
      const paintCalendar = () =>
        renderLeaveCalendar(
          root.querySelector("#v66LeaveCalendar"),
          first,
          last,
          requests,
          role,
          canCreate
            ? (date) => {
                if (!rangeStart) {
                  rangeStart = date;
                  root.querySelector("#v66RangeHint").textContent =
                    `Début : ${fmtDate(date)} · choisis maintenant la date de fin`;
                  paintCalendar();
                  return;
                }
                const start = date < rangeStart ? date : rangeStart,
                  end = date < rangeStart ? rangeStart : date;
                rangeStart = "";
                root.querySelector("#v66RangeHint").textContent =
                  "Premier clic : début · second clic : fin";
                paintCalendar();
                leaveRangeModal(start, end);
              }
            : null,
          rangeStart,
        );
      paintCalendar();
      const list = root.querySelector("#v66LeaveList");
      const cardHtml = (r) => {
              const own = r.employee_id === profile.id,
                showType = role !== "conducteur",
                periodTypes = [...new Set((r.leave_periods || []).map((p) => p.leave_type || r.leave_type))],
                requestType = periodTypes.length > 1 ? "Congés payés + RTT" : leaveTypeLabels[periodTypes[0] || r.leave_type],
                total = (r.leave_periods || []).reduce(
                  (s, p) => s + Number(p.requested_days || 0),
                  0,
                );
              let actions = "";
              if (canReview && r.status === "pending")
                actions =
                  '<button class="v66-btn danger" data-leave-decision="rejected">Refuser</button><button class="v66-btn primary" data-leave-decision="approved">Accepter</button>';
              if (canReview && r.status === "cancellation_requested")
                actions =
                  '<button class="v66-btn" data-leave-decision="approved">Conserver l’absence</button><button class="v66-btn danger" data-leave-decision="cancelled">Accepter l’annulation</button>';
              if (own && !canReview && r.status === "pending")
                actions =
                  '<button class="v66-btn danger" data-leave-cancel="cancelled">Annuler la demande</button>';
              if (own && !canReview && r.status === "approved")
                actions =
                  '<button class="v66-btn danger" data-leave-cancel="cancellation_requested">Demander l’annulation</button>';
              return `<article class="v66-card v66-leave-card" data-id="${r.id}"><div class="v66-pagehead"><div><strong>${esc(fullName(r.profiles))}${showType ? ` · ${esc(requestType)}` : " · Absence"}</strong><p>${total.toLocaleString("fr-FR")} jour${total > 1 ? "s" : ""}${r.created_by_rh ? " · Créée par les RH" : ""}</p></div><span class="v66-pill ${esc(r.status)}">${esc(leaveStatusLabels[r.status] || r.status)}</span></div><div class="v66-periods">${(
                r.leave_periods || []
              )
                .sort((a, b) => a.position - b.position)
                .map((p) => `<span>${esc(leavePeriodText(p))}</span>`)
                .join(
                  "",
                )}</div>${r.employee_comment ? `<p class="v66-help">${esc(r.employee_comment)}</p>` : ""}${r.rejection_reason ? `<div class="v66-info">Motif : ${esc(r.rejection_reason)}</div>` : ""}${actions ? `<div class="v66-actions" style="margin-top:12px">${actions}</div>` : ""}</article>`;
      };
      if (canReview) {
        list.innerHTML = `<input class="v66-search" id="v66LeaveSearch" placeholder="Rechercher un salarié par nom ou prénom…"><div id="v66LeaveGroups"></div>`;
        const groupsNode = list.querySelector("#v66LeaveGroups");
        const paintGroups = (query = "") => {
          const q = normalizeSearch(query),
            filtered = requests.filter((r) =>
              smartSearchMatch(fullName(r.profiles), q),
            ),
            groups = [
              {
                id: "pending",
                title: "Demandes à traiter",
                rows: filtered.filter((r) =>
                  ["pending", "cancellation_requested"].includes(r.status),
                ),
              },
              {
                id: "approved",
                title: "Demandes acceptées",
                rows: filtered.filter((r) => r.status === "approved"),
              },
              {
                id: "history",
                title: "Historique",
                rows: filtered.filter((r) =>
                  ["rejected", "cancelled"].includes(r.status),
                ),
              },
            ];
          groupsNode.innerHTML = filtered.length ? groups
            .map(
              (g) => `<section class="v66-leave-group" data-group="${g.id}"><div class="v66-leave-group-head"><div><h3>${g.title}</h3><small>${g.rows.length} demande${g.rows.length > 1 ? "s" : ""}</small></div>${g.rows.length > 1 ? `<button type="button" class="v66-btn" data-expand>Voir toutes</button>` : ""}</div><div class="v66-list">${g.rows.length ? g.rows.map((r, i) => `<div class="${i ? "v66-leave-extra" : ""}">${cardHtml(r)}</div>`).join("") : '<div class="v66-card v66-empty">Aucune demande.</div>'}</div></section>`,
            )
            .join("") : '<div class="v66-card v66-empty">Aucun salarié trouvé.</div>';
          groupsNode.querySelectorAll("[data-expand]").forEach((button) => {
            button.onclick = () => {
              const group = button.closest(".v66-leave-group"),
                open = group.classList.toggle("expanded");
              button.textContent = open ? "Réduire" : "Voir toutes";
            };
          });
          bindLeaveActions();
        };
        list.querySelector("#v66LeaveSearch").oninput = (e) =>
          paintGroups(e.target.value);
        paintGroups();
        if(routeIntent?.group==="pending"){routeIntent=null;list.querySelector('[data-group="pending"]')?.scrollIntoView({behavior:"smooth",block:"start"})}
      } else {
        list.innerHTML = requests.length
          ? requests.map(cardHtml).join("")
          : '<div class="v66-card v66-empty">Aucune demande pour le moment.</div>';
        bindLeaveActions();
      }
      function bindLeaveActions() {
      list.querySelectorAll("[data-leave-decision]").forEach(
        (b) =>
          (b.onclick = async () => {
            const decision = b.dataset.leaveDecision,
              reason =
                decision === "rejected" ? prompt("Motif du refus :") || "" : "";
            if (decision === "rejected" && !reason.trim()) return;
            b.disabled = true;
            try {
              const { error } = await db.rpc("review_leave_request", {
                target_id: b.closest("[data-id]").dataset.id,
                decision,
                reason,
              });
              if (error) throw error;
              toast("Demande mise à jour.");
              await renderLeaves(root, monthOffset);
            } catch (e) {
              fail(e);
            } finally {
              b.disabled = false;
            }
          }),
      );
      list.querySelectorAll("[data-leave-cancel]").forEach(
        (b) =>
          (b.onclick = () => {
            const next=b.dataset.leaveCancel,id=b.closest("[data-id]").dataset.id;
            const modal=el("div",{class:"v66-modal"},`<div class="v66-card v66-form"><h2>${next==="cancelled"?"Annuler cette demande ?":"Demander l’annulation ?"}</h2><p class="v66-help">${next==="cancelled"?"La demande ne sera plus transmise aux RH.":"La demande restera acceptée jusqu’à la décision des RH."}</p><div class="v66-actions"><button class="v66-btn" data-close>Conserver l’absence</button><button class="v66-btn v66-cancel-action" data-confirm>${next==="cancelled"?"Confirmer l’annulation":"Confirmer la demande d’annulation"}</button></div><div class="v66-message"></div></div>`);document.body.appendChild(modal);
            modal.querySelector("[data-close]").onclick=()=>modal.remove();
            modal.querySelector("[data-confirm]").onclick=async()=>{const confirmButton=modal.querySelector("[data-confirm]"),msg=modal.querySelector(".v66-message");confirmButton.disabled=true;setMessage(msg,"Enregistrement…");try {
              const { error } = await db
                .from("leave_requests")
                .update({
                  status: next,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", id);
              if (error) throw error;
              modal.remove();
              toast("Demande mise à jour.");
              await renderLeaves(root, monthOffset);
            } catch (e) {
              setMessage(msg,e.message,"error");confirmButton.disabled=false;
            }};
          }),
      );
      }
    } catch (e) {
      root.querySelector("#v66LeaveList").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  function renderLeaveCalendar(node, first, last, requests, role, onSelect, selectedStart = "") {
    const approved = requests.filter((r) => r.status === "approved"),
      cells = [];
    for (let i = 1; i < (first.getUTCDay() || 7); i++)
      cells.push('<div class="v66-cal-day empty"></div>');
    for (let day = 1; day <= last.getUTCDate(); day++) {
      const d = new Date(
          Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day),
        ),
        key = isoDay(d),
        holiday = holidayName(d),
        weekend = [0, 6].includes(d.getUTCDay()),
        people = [];
      approved.forEach((r) =>
        (r.leave_periods || []).forEach((p) => {
          if (key >= p.start_date && key <= p.end_date && !weekend && !holiday)
            people.push(
              role === "conducteur"
                ? fullName(r.profiles)
                : `${fullName(r.profiles)} · ${leaveTypeLabels[p.leave_type || r.leave_type]}`,
            );
        }),
      );
      const unavailable = weekend || holiday;
      cells.push(
        `${onSelect && !unavailable ? `<button type="button" data-leave-date="${key}" aria-label="Choisir le ${fmtDate(key)}"` : "<div"} class="v66-cal-day ${onSelect && !unavailable ? "selectable" : ""} ${key === selectedStart ? "range-start" : ""} ${weekend ? "weekend" : ""} ${holiday ? "holiday" : ""}"><b>${day}</b>${holiday ? `<span class="v66-holiday">${esc(holiday)}</span>` : ""}${people.map((x) => `<span class="v66-absence">${esc(x)}</span>`).join("")}${onSelect && !unavailable ? "</button>" : "</div>"}`,
      );
    }
    node.innerHTML = `${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((x) => `<div class="v66-cal-label">${x}</div>`).join("")}${cells.join("")}`;
    node.querySelectorAll("[data-leave-date]").forEach(
      (day) => (day.onclick = () => onSelect(day.dataset.leaveDate)),
    );
  }

  async function leaveRangeModal(start, end) {
    const dates = [];
    for (let d = new Date(start + "T12:00:00Z"), last = new Date(end + "T12:00:00Z"); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = isoDay(d);
      if (!isWeekend(key) && !holidayName(d)) dates.push(key);
    }
    if (!dates.length) return toast("Cette période ne contient aucun jour ouvré.");
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>Confirmer la demande</h2><p class="v66-help">${fmtDate(start)} → ${fmtDate(end)} · ${dates.length} jour${dates.length > 1 ? "s" : ""} ouvré${dates.length > 1 ? "s" : ""}</p><div class="v66-actions"><button type="button" class="v66-btn primary" data-all-type="paid_leave">Tout en congés payés</button><button type="button" class="v66-btn" data-all-type="rtt">Tout en RTT</button><button type="button" class="v66-btn" data-custom>Personnaliser</button></div><div class="v66-leave-allocation" id="v66LeaveAllocation">${dates.map((date) => `<div class="v66-allocation-row"><strong>${new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</strong><label>Type<select data-day-type><option value="paid_leave">Congés payés</option><option value="rtt">RTT</option></select></label><label>Durée<select data-day-duration><option value="full">Journée complète</option><option value="morning">Matin</option><option value="afternoon">Après-midi</option></select></label><input type="hidden" data-day-date value="${date}"></div>`).join("")}</div><label class="v66-field">Commentaire (facultatif)<textarea name="employee_comment"></textarea></label><div class="v66-info" id="v66AllocationSummary"></div><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Envoyer la demande aux RH</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    const form = modal.querySelector("form"), allocation = form.querySelector("#v66LeaveAllocation");
    const summary = () => {
      let cp = 0, rtt = 0;
      allocation.querySelectorAll(".v66-allocation-row").forEach((row) => {
        const amount = row.querySelector("[data-day-duration]").value === "full" ? 1 : 0.5;
        if (row.querySelector("[data-day-type]").value === "rtt") rtt += amount; else cp += amount;
      });
      form.querySelector("#v66AllocationSummary").textContent = `Congés payés : ${cp.toLocaleString("fr-FR")} jour${cp > 1 ? "s" : ""} · RTT : ${rtt.toLocaleString("fr-FR")} jour${rtt > 1 ? "s" : ""}`;
    };
    form.querySelectorAll("[data-all-type]").forEach((button) => button.onclick = () => {
      allocation.querySelectorAll("[data-day-type]").forEach((select) => select.value = button.dataset.allType);
      allocation.classList.remove("custom-open"); summary();
    });
    form.querySelector("[data-custom]").onclick = () => allocation.classList.toggle("custom-open");
    allocation.querySelectorAll("select").forEach((select) => select.onchange = summary);
    form.querySelector("[data-close]").onclick = () => modal.remove();
    summary();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const periods = [...allocation.querySelectorAll(".v66-allocation-row")].map((row, position) => ({
        start_date: row.querySelector("[data-day-date]").value,
        end_date: row.querySelector("[data-day-date]").value,
        leave_type: row.querySelector("[data-day-type]").value,
        duration_type: row.querySelector("[data-day-duration]").value,
        position,
      }));
      const msg = form.querySelector(".v66-message");
      try {
        const { error } = await db.rpc("create_leave_request", {
          target_employee: profile.id,
          requested_type: periods[0].leave_type,
          note: new FormData(form).get("employee_comment").trim(),
          periods,
          approve_directly: false,
        });
        if (error) throw error;
        modal.remove(); toast("Demande envoyée aux RH."); renderLeaves(shell.querySelector("#v66Content"));
      } catch (error) { setMessage(msg, error.message, "error"); }
    };
  }

  async function leaveModal(createdByRh = false, initialDate = "") {
    let employees = [];
    if (createdByRh) {
      const { data, error } = await db
        .from("profiles")
        .select("id,first_name,last_name,email")
        .eq("status", "active")
        .order("last_name");
      if (error) return fail(error);
      employees = data || [];
    }
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>${createdByRh ? "Enregistrer une absence" : "Demande de congé ou RTT"}</h2>${createdByRh ? `<label class="v66-field">Salarié<select name="employee_id" required><option value="">Choisir…</option>${employees.map((p) => `<option value="${p.id}">${esc(fullName(p))}</option>`).join("")}</select></label>` : ""}<label class="v66-field">Type<select name="leave_type" required><option value="paid_leave">Congés payés</option><option value="rtt">RTT</option></select></label><div class="v66-section"><h3>Périodes demandées</h3><div id="v66PeriodRows" class="v66-list"></div><button type="button" class="v66-btn" id="v66AddPeriod">+ Ajouter une période</button></div><label class="v66-field">Commentaire (facultatif)<textarea name="employee_comment"></textarea></label><div class="v66-info" id="v66LeaveTotal">Total : 0 jour</div><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">${createdByRh ? "Enregistrer comme acceptée" : "Envoyer aux RH"}</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    const form = modal.querySelector("form"),
      rows = form.querySelector("#v66PeriodRows");
    const addRow = (prefill = "") => {
      const row = el(
        "div",
        { class: "v66-period-edit" },
        `<label class="v66-field">Du<input type="date" name="start_date" required></label><label class="v66-field">Au<input type="date" name="end_date" required></label><label class="v66-field">Durée<select name="duration_type"><option value="full">Journée(s) complète(s)</option><option value="morning">Matin</option><option value="afternoon">Après-midi</option></select></label><button type="button" class="v66-btn danger" data-remove>Retirer</button><small class="v66-period-warning"></small>`,
      );
      rows.appendChild(row);
      if (prefill) {
        row.querySelector('[name="start_date"]').value = prefill;
        row.querySelector('[name="end_date"]').value = prefill;
      }
      row.querySelector("[data-remove]").onclick = () => {
        row.remove();
        updateTotal();
      };
      row
        .querySelectorAll("input,select")
        .forEach((x) => (x.onchange = updateTotal));
      return row;
    };
    const updateTotal = () => {
      let total = 0;
      rows.querySelectorAll(".v66-period-edit").forEach((row) => {
        const start = row.querySelector('[name="start_date"]').value,
          end = row.querySelector('[name="end_date"]').value,
          type = row.querySelector('[name="duration_type"]').value,
          warn = row.querySelector(".v66-period-warning");
        warn.textContent = "";
        if (!start || !end) return;
        if (end < start) {
          warn.textContent = "La date de fin doit suivre la date de début.";
          return;
        }
        if (type !== "full" && start !== end) {
          warn.textContent = "Une demi-journée concerne une seule date.";
          return;
        }
        const invalidStart = isWeekend(start) || holidayName(start),
          invalidEnd = isWeekend(end) || holidayName(end);
        if (invalidStart || invalidEnd) {
          warn.textContent = `Date impossible : ${holidayName(start) || holidayName(end) || "week-end"}.`;
          return;
        }
        total += type === "full" ? businessDays(start, end) : 0.5;
      });
      form.querySelector("#v66LeaveTotal").textContent =
        `Total : ${total.toLocaleString("fr-FR")} jour${total > 1 ? "s" : ""}`;
    };
    addRow(initialDate);
    updateTotal();
    form.querySelector("#v66AddPeriod").onclick = () => addRow();
    form.querySelector("[data-close]").onclick = () => modal.remove();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = form.querySelector(".v66-message"),
        periods = [...rows.querySelectorAll(".v66-period-edit")].map(
          (row, position) => ({
            start_date: row.querySelector('[name="start_date"]').value,
            end_date: row.querySelector('[name="end_date"]').value,
            duration_type: row.querySelector('[name="duration_type"]').value,
            position,
          }),
        );
      if (!periods.length)
        return setMessage(msg, "Ajoute au moins une période.", "error");
      for (const p of periods) {
        if (
          !p.start_date ||
          !p.end_date ||
          p.end_date < p.start_date ||
          isWeekend(p.start_date) ||
          isWeekend(p.end_date) ||
          holidayName(p.start_date) ||
          holidayName(p.end_date) ||
          (p.duration_type !== "full" && p.start_date !== p.end_date)
        )
          return setMessage(
            msg,
            "Corrige les périodes signalées avant l’envoi.",
            "error",
          );
      }
      const fd = new FormData(form),
        employeeId = createdByRh ? fd.get("employee_id") : profile.id;
      try {
        const { error } = await db.rpc("create_leave_request", {
          target_employee: employeeId,
          requested_type: fd.get("leave_type"),
          note: fd.get("employee_comment").trim(),
          periods,
          approve_directly: createdByRh,
        });
        if (error) throw error;
        modal.remove();
        toast(createdByRh ? "Absence enregistrée." : "Demande envoyée aux RH.");
        renderLeaves(shell.querySelector("#v66Content"));
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    };
  }

  function renderProjectHub(root) {
    const role=visibleRole(), intent=routeIntent, requested=intent?.projectTab;
    let active=requested||"projects";routeIntent=null;
    if(active==="it-settings"&&!['rh','admin'].includes(role))active="projects";
    root.innerHTML=`<div class="v66-pagehead"><div><h1>Chantiers</h1><p>Gestion, avancement et paramètres associés dans une seule rubrique.</p></div></div><div class="v66-subnav"><button data-project-tab="projects">Gestion des chantiers</button><button data-project-tab="stats">Avancement</button>${['rh','admin'].includes(role)?'<button data-project-tab="it-settings">Paramètres IT</button>':''}</div><section id="v66ProjectContent"></section>`;
    const content=root.querySelector("#v66ProjectContent");
    const show=(tab)=>{active=tab;root.querySelectorAll("[data-project-tab]").forEach(b=>b.classList.toggle("active",b.dataset.projectTab===tab));if(tab==="stats"){routeIntent=intent?.projectId?{projectId:intent.projectId}:null;renderStats(content)}else if(tab==="it-settings")renderItSettings(content);else renderProjects(content)};
    root.querySelectorAll("[data-project-tab]").forEach(b=>b.onclick=()=>show(b.dataset.projectTab));show(active);
  }

  async function renderProjects(root) {
    const role = visibleRole();
    root.innerHTML = `<div class="v66-pagehead"><div><h1>Chantiers</h1><p>Codes, dates, prévisionnel et conducteurs affectés.</p></div><button class="v66-btn primary" id="v66NewProject">Nouveau chantier</button></div>${role === "conducteur" ? '<div class="v66-info">Tu peux créer un chantier et modifier ceux auxquels tu es affecté. L’archivage et les affectations restent gérés par les RH.</div>' : ""}<input class="v66-search" id="v66ProjectSearch" placeholder="Rechercher par code ou nom…"><div class="v66-list" id="v66Projects" style="margin-top:12px"><div class="v66-card v66-empty">Chargement…</div></div>`;
    root.querySelector("#v66NewProject").onclick = () => projectModal();
    try {
      const { data, error } = await db
        .from("projects")
        .select(
          "*,project_conductors(conductor_id,profiles!project_conductors_conductor_id_fkey(first_name,last_name)),project_it_zones(establishment_id,it_zone_id,it_zones(label),establishments(name))",
        )
        .order("code");
      if (error) throw error;
      const paint = (q) => {
        const filtered = data.filter((p) =>
          `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase()),
        );
        root.querySelector("#v66Projects").innerHTML = filtered.length
          ? filtered
              .map((p) => {
                const assigned = (p.project_conductors || []).some(
                    (x) => x.conductor_id === profile.id,
                  ),
                  canEdit =
                    ["rh", "admin"].includes(role) ||
                    (role === "conducteur" && assigned);
                return `<article class="v66-card v66-row" data-id="${p.id}"><div><strong>${esc(p.code)} — ${esc(p.name)}</strong><small>${fmtDate(p.planned_start_date)} → ${fmtDate(p.planned_end_date)} · ${esc(p.planned_days)} jours / ${esc(p.planned_hours)} h</small></div><div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status] || p.status)}</span><small>${p.project_conductors?.length ? esc(p.project_conductors.map((x) => fullName(x.profiles)).join(", ")) : "Aucun conducteur"}</small></div><div class="v66-actions">${canEdit ? '<button class="v66-btn" data-edit>Modifier</button>' : '<span class="v66-help">Consultation</span>'}</div></article>`;
              })
              .join("")
          : '<div class="v66-card v66-empty">Aucun chantier trouvé.</div>';
        root
          .querySelectorAll("[data-edit]")
          .forEach(
            (b) =>
              (b.onclick = () =>
                projectModal(
                  data.find((x) => x.id === b.closest("[data-id]").dataset.id),
                )),
          );
      };
      paint("");
      root.querySelector("#v66ProjectSearch").oninput = (e) =>
        paint(e.target.value);
    } catch (e) {
      root.querySelector("#v66Projects").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  const sheetLabels = {
    draft: "Brouillon",
    submitted: "Transmise",
    pending_review: "Transmise",
    rejected: "À corriger",
    validated: "Transmise",
    changed_after_validation: "Transmise",
  };
  const monthLabels = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  function isoWeekBounds(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { monday, sunday };
  }
  const dateKey = (d) => d.toISOString().slice(0, 10);
  function weekTitle(year, week) {
    const { monday, sunday } = isoWeekBounds(year, week);
    return `Semaine ${week} — ${monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })} au ${sunday.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  }
  function currentIsoWeek() {
    const now = new Date(), d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear(), first = new Date(Date.UTC(year, 0, 1));
    return { year, week: Math.ceil((((d - first) / 86400000) + 1) / 7) };
  }
  function isoWeekFromDate(value){const d=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),first=new Date(Date.UTC(year,0,1));return{year,week:Math.ceil((((d-first)/86400000)+1)/7)}}

  async function renderSheetExplorer(root, canReview) {
    const role = visibleRole();
    root.innerHTML = `<div class="v66-pagehead"><div><h1>${canReview ? "Fiches des salariés" : "Fiches équipes"}</h1><p>Année → mois → semaine → salariés. Les fiches transmises ne demandent aucune validation.</p></div></div><div class="v66-filterbar v66-search-only"><input class="v66-search" id="v66SheetSearch" placeholder="Rechercher un salarié…"><input type="hidden" id="v66SheetFilter" value="received"></div><div id="v66SheetTree" class="v66-tree"><div class="v66-card v66-empty">Chargement de l’index léger…</div></div>`;
    try {
      let query = db.from("timesheets").select("id,employee_id,iso_year,iso_week,status,rejection_reason,submitted_at,reviewed_at,profiles!timesheets_employee_id_fkey(first_name,last_name,email)")
        .order("iso_year", { ascending: false }).order("iso_week", { ascending: false }).limit(500);
      if (canReview) query = query.neq("status", "draft");
      const { data, error } = await query;
      if (error) throw error;
      const weeks = new Map();
      (data || []).forEach((s) => {
        const key = `${s.iso_year}-${s.iso_week}`;
        if (!weeks.has(key)) weeks.set(key, { year: s.iso_year, week: s.iso_week, sheets: [] });
        weeks.get(key).sheets.push(s);
      });
      const now = currentIsoWeek(), nowKey = `${now.year}-${now.week}`;
      if (!weeks.has(nowKey)) weeks.set(nowKey, { ...now, sheets: [] });
      const intent=routeIntent?.year&&routeIntent?.week?routeIntent:null;
      if(intent){const intentKey=`${intent.year}-${intent.week}`;if(!weeks.has(intentKey))weeks.set(intentKey,{year:intent.year,week:intent.week,sheets:[]})}
      const ordered = [...weeks.values()].sort((a,b) => b.year-a.year || b.week-a.week);
      const byYear = new Map();
      ordered.forEach((w) => {
        const month = isoWeekBounds(w.year,w.week).monday.getUTCMonth();
        if (!byYear.has(w.year)) byYear.set(w.year,new Map());
        if (!byYear.get(w.year).has(month)) byYear.get(w.year).set(month,[]);
        byYear.get(w.year).get(month).push(w);
      });
      const tree = root.querySelector("#v66SheetTree");
      tree.innerHTML = [...byYear].map(([year,months],yi) => `<details class="v66-folder" ${yi===0?"open":""}><summary>${year}</summary>${[...months].map(([month,rows],mi)=>`<details class="v66-folder month" ${yi===0&&mi===0?"open":""}><summary>${monthLabels[month]}</summary>${rows.map(w=>`<section class="v66-week" data-year="${w.year}" data-week="${w.week}"><div class="v66-week-head"><button type="button" class="v66-week-open"><span>${weekTitle(w.year,w.week)}</span></button><div class="v66-week-counts"><button type="button" class="active" data-week-filter="received">Fiches reçues <b>${w.sheets.length}</b></button>${canReview||role==="admin"?'<button type="button" data-week-filter="missing">Fiches manquantes <b data-missing-count>…</b></button>':''}</div></div><div class="v66-week-body"></div></section>`).join("")}</details>`).join("")}</details>`).join("");
      const openWeek=async(weekNode,forcedFilter="received")=>{const body=weekNode.querySelector(".v66-week-body"),filter=root.querySelector("#v66SheetFilter");if(forcedFilter&&filter)filter.value=forcedFilter;weekNode.querySelectorAll("[data-week-filter]").forEach(b=>b.classList.toggle("active",b.dataset.weekFilter===forcedFilter));if(!weekNode.classList.contains("open")){weekNode.classList.add("open");await loadWeekRoster(weekNode,body,canReview,role)}else if(forcedFilter&&filter)filter.dispatchEvent(new Event("change"));};
      tree.querySelectorAll(".v66-week-open").forEach(button=>button.onclick=()=>openWeek(button.closest(".v66-week"),"received"));
      tree.querySelectorAll("[data-week-filter]").forEach(button=>button.onclick=()=>openWeek(button.closest(".v66-week"),button.dataset.weekFilter));
      if(canReview||role==="admin"){(async()=>{for(const node of tree.querySelectorAll(".v66-week")){const{data,error}=await db.rpc("week_timesheet_roster",{target_year:Number(node.dataset.year),target_week:Number(node.dataset.week)});if(error)continue;const missing=(data||[]).filter(r=>r.expected&&!r.timesheet_id).length,target=node.querySelector("[data-missing-count]");if(target)target.textContent=String(missing)}})()}
      if(intent){const node=tree.querySelector(`[data-year="${intent.year}"][data-week="${intent.week}"]`);if(node){const monthFolder=node.closest("details.month"),yearFolder=monthFolder?.parentElement;monthFolder?.setAttribute("open","");yearFolder?.setAttribute?.("open","");const filter=root.querySelector("#v66SheetFilter"),chosen=intent.filter||"received";if(filter)filter.value=chosen;node.querySelectorAll("[data-week-filter]").forEach(b=>b.classList.toggle("active",b.dataset.weekFilter===chosen));node.classList.add("open");await loadWeekRoster(node,node.querySelector(".v66-week-body"),canReview,role);node.scrollIntoView({behavior:"smooth",block:"center"})}routeIntent=null}
    } catch (e) { root.querySelector("#v66SheetTree").innerHTML = `<div class="v66-card v66-empty">${esc(e.message)}</div>`; }
  }

  async function loadWeekRoster(node, body, canReview, role) {
    body.innerHTML = '<div class="v66-card v66-empty">Chargement du résumé…</div>';
    const year=Number(node.dataset.year), week=Number(node.dataset.week);
    try {
      let rows;
      if (canReview || role === "admin") {
        const { data, error } = await db.rpc("week_timesheet_roster", { target_year: year, target_week: week });
        if (error) throw error; rows=data||[];
      } else {
        const { data, error } = await db.from("timesheets").select("timesheet_id:id,employee_id,sheet_status:status,rejection_reason,profiles!timesheets_employee_id_fkey(first_name,last_name,email)").eq("iso_year",year).eq("iso_week",week);
        if (error) throw error;
        rows=(data||[]).map(x=>({...x,...x.profiles,expected:true,absent_full_week:false}));
      }
      const ids=rows.map(r=>r.timesheet_id).filter(Boolean),warningMap=new Map();
      if(ids.length){const{data:details,error:detailsError}=await db.from("timesheets").select("id,timesheet_days(work_date,it_needs_review,timesheet_sites(project_id,hours))").in("id",ids);if(detailsError)throw detailsError;(details||[]).forEach(s=>{const reasons=timesheetWarnings(s);if(reasons.length)warningMap.set(s.id,reasons)})}
      body.innerHTML='<div class="v66-employee-list"></div>';
      const list=body.querySelector(".v66-employee-list"), search=rootQuery("#v66SheetSearch"), filter=rootQuery("#v66SheetFilter");
      const paint=()=>{
        const q=normalizeSearch(search?.value), f=filter?.value||"all";
        const filtered=rows.filter(r=>{
          const status=r.absent_full_week?"absent":!r.timesheet_id?"missing":warningMap.has(r.timesheet_id)?"warning":"received";
          const matchFilter=f==="all"||(f==="received"&&!!r.timesheet_id)||f===status;
          return matchFilter&&normalizeSearch(`${r.first_name||""} ${r.last_name||""}`).includes(q);
        });
        list.innerHTML=filtered.map(r=>{const warning=warningMap.get(r.timesheet_id),status=r.absent_full_week?"Dispensé — absence validée":!r.timesheet_id?"À recevoir":warning?"⚠ Fiche à vérifier":"Transmise";return `<button type="button" class="v66-employee ${warning?"v66-has-warning":""}" ${r.timesheet_id?`data-sheet-id="${r.timesheet_id}"`:"disabled"}><span><strong>${esc(`${r.first_name||""} ${r.last_name||""}`.trim()||r.email)}${warning?' <b class="v66-warning-star" aria-label="Fiche à vérifier">*</b>':''}</strong><small>${warning?esc(warning.join(" · ")):"Touchez pour ouvrir la fiche complète"}</small></span><span class="v66-pill ${warning?"warning":esc(r.sheet_status||"")}">${esc(status)}</span></button>`}).join("")||'<div class="v66-empty">Aucun résultat.</div>';
        list.querySelectorAll("[data-sheet-id]").forEach(b=>{b.onclick=()=>openTimesheetDetail(b.dataset.sheetId,canReview);b.ondblclick=b.onclick});
      };
      if(search)search.addEventListener("input",paint);if(filter)filter.addEventListener("change",paint);paint();
    } catch(e){body.innerHTML=`<div class="v66-card v66-empty">${esc(e.message)}</div>`}
  }
  function rootQuery(selector){return shell.querySelector(selector)}
  function normalizeSearch(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9@.+-]+/g," ").trim()}
  function editDistanceAtMostOne(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,d=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++d>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++}}return d+(i<a.length||j<b.length?1:0)<=1}
  function smartSearchMatch(value,query){const q=normalizeSearch(query);if(!q)return true;const words=normalizeSearch(value).split(" ").filter(Boolean);return q.split(" ").filter(Boolean).every(token=>words.some(word=>word.includes(token)||token.includes(word)||(token.length>=5&&editDistanceAtMostOne(word,token))))}
  function timesheetWarnings(sheet){const days=sheet?.timesheet_days||[],reasons=[];let total=0;days.forEach(d=>{const hours=(d.timesheet_sites||[]).reduce((n,s)=>n+Number(s.hours||0),0);total+=hours;const weekday=new Date(`${d.work_date}T12:00:00`).getDay();if(hours>12)reasons.push(`Plus de 12 h le ${fmtDate(d.work_date)}`);if(hours>0&&(weekday===0||weekday===6))reasons.push(`Travail le week-end (${fmtDate(d.work_date)})`);if(d.it_needs_review)reasons.push(`IT à vérifier le ${fmtDate(d.work_date)}`);if((d.timesheet_sites||[]).some(s=>!s.project_id))reasons.push(`Chantier non référencé le ${fmtDate(d.work_date)}`)});if(total>55)reasons.push(`Total inhabituel : ${total.toLocaleString("fr-FR")} h`);return [...new Set(reasons)]}
  function officialTimesheetMarkup(s){
    const days=[...(s.timesheet_days||[])].sort((a,b)=>a.work_date.localeCompare(b.work_date)),worked=days.filter(d=>(d.day_type||"worked")==="worked"),totalHours=worked.reduce((n,d)=>n+(d.timesheet_sites||[]).reduce((a,x)=>a+Number(x.hours||0),0),0),totalMeals=worked.reduce((n,d)=>n+Number(d.meal||0),0),itDays=worked.filter(d=>d.it_zone_label_snapshot),counts={cp:days.filter(d=>d.day_type==="cp").length,rtt:days.filter(d=>d.day_type==="rtt").length,holiday:days.filter(d=>d.day_type==="holiday").length},dayNames=["DIMANCHE","LUNDI","MARDI","MERCREDI","JEUDI","VENDREDI","SAMEDI"],code=value=>{const digits=String(value||"").replace(/\D/g,"");return esc(digits?(digits.match(/.{1,3}/g)||[]).join("\n"):value||"—")};
    const rows=days.map(d=>{const date=new Date(`${d.work_date}T12:00:00`),type=d.day_type||"worked",label=type==="cp"?"CONGÉ PAYÉ":type==="rtt"?"RTT":type==="holiday"?"FÉRIÉ":"";if(type!=="worked")return `<div class="v66-ro-day v66-ro-absence"><div class="v66-ro-date"><strong>${dayNames[date.getDay()]}</strong><span>${fmtDate(d.work_date)}</span></div><div class="v66-ro-absence-mark">${label}</div></div>`;const sites=d.timesheet_sites||[],codes=sites.map(x=>code(x.project_code_snapshot)).join("<br>"),names=sites.map(x=>esc(x.project_name_snapshot||"—")).join("<br>"),hours=sites.map(x=>esc(String(Number(x.hours||0)).replace(".",","))).join("<br>"),tasks=esc([...(d.tasks||[]),d.manual_task].filter(Boolean).join(", ")||"—");return `<div class="v66-ro-day"><div class="v66-ro-date"><strong>${dayNames[date.getDay()]}</strong><span>${fmtDate(d.work_date)}</span></div><div class="v66-ro-cell"><div class="v66-ro-value v66-ro-center v66-ro-code">${codes||"—"}</div></div><div class="v66-ro-cell v66-ro-project"><div class="v66-ro-value">${names||"—"}</div><div class="v66-ro-sub">Sous total</div></div><div class="v66-ro-cell"><div class="v66-ro-value v66-ro-center">${hours||"—"}</div></div><div class="v66-ro-cell"><div class="v66-ro-value v66-ro-center">${Number(d.meal||0)}</div></div><div class="v66-ro-cell"><div class="v66-ro-value v66-ro-center">${esc(d.it_zone_label_snapshot||"Non renseignée")}</div></div><div class="v66-ro-cell v66-ro-tasks"><div class="v66-ro-value">${tasks}</div><div class="v66-ro-vehicle">Véhicule : <span>—</span></div></div></div>`}).join("");
    const recap=[`${worked.length} jour${worked.length>1?"s":""} travaillé${worked.length>1?"s":""}`,counts.cp?`${counts.cp} jour${counts.cp>1?"s":""} de congé payé`:"",counts.rtt?`${counts.rtt} jour${counts.rtt>1?"s":""} de RTT`:"",counts.holiday?`${counts.holiday} jour${counts.holiday>1?"s":""} férié${counts.holiday>1?"s":""}`:"",`${String(totalHours).replace(".",",")} heures effectuées`,`${totalMeals} repas`].filter(Boolean);
    return `<div class="v66-official-paper"><div class="v66-ro-report"><img src="antras-logo.png" alt="">RAPPORT HEBDOMADAIRE - ANTRAS OSSATURE BOIS</div><div class="v66-ro-identity"><div>NOM : <strong>${esc(s.profiles?.last_name||"")}</strong></div><div>Prénom : <strong>${esc(s.profiles?.first_name||"")}</strong></div><div>Semaine n° <strong>${s.iso_week}</strong></div></div><div class="v66-ro-head"><div>JOUR / DATE</div><div>Code</div><div>CHANTIER</div><div>Heures</div><div>Repas</div><div>IT</div><div>TÂCHES EFFECTUÉES</div></div>${rows}<div class="v66-ro-observations"><strong>Observations :</strong><span>${esc(s.observations||"—")}</span><div><small>TOTAL H</small><b>${String(totalHours).replace(".",",")}</b></div><div><small>REPAS</small><b>${totalMeals}</b></div><div><small>JOURS IT</small><b>${itDays.length}</b></div></div><div class="v66-ro-recap"><strong>Compte rendu :</strong><span>${esc(recap.join(" · "))}</span><small><b>IT :</b> ${itDays.length?esc(itDays.map(d=>`${fmtDate(d.work_date)} : ${d.it_zone_label_snapshot}`).join(" · ")):"Aucune IT"}</small></div><div class="v66-ro-footer"><img src="antras-logo.png" alt=""> ANTRAS OSSATURE BOIS · Fiche d’heures enregistrée</div></div>`
  }
  function fitOfficialSheet(modal){const viewport=modal.querySelector(".v66-official-viewport"),paper=modal.querySelector(".v66-official-paper");if(!viewport||!paper)return;const fit=()=>{const scale=Math.min(1,(viewport.clientWidth-4)/980);paper.style.transform=`scale(${scale})`;viewport.style.height=`${paper.scrollHeight*scale+4}px`};fit();if(window.ResizeObserver)new ResizeObserver(fit).observe(viewport)}

  async function openTimesheetDetail(id, canReview) {
    const modal=el("div",{class:"v66-modal"},'<div class="v66-card"><div class="v66-empty">Chargement de la fiche…</div></div>');document.body.appendChild(modal);
    try{
      const [{data:s,error},{data:zones,error:ze}]=await Promise.all([
        db.from("timesheets").select("id,employee_id,iso_year,iso_week,status,rejection_reason,version,observations,profiles!timesheets_employee_id_fkey(first_name,last_name,email),timesheet_days(id,work_date,day_type,meal,it_zone_id,it_zone_label_snapshot,it_needs_review,tasks,manual_task,timesheet_sites(id,project_id,project_code_snapshot,project_name_snapshot,hours))").eq("id",id).single(),
        canReview?db.from("it_zones").select("id,label").eq("active",true).order("label"):Promise.resolve({data:[],error:null})
      ]);if(error)throw error;if(ze)throw ze;
      const hours=(s.timesheet_days||[]).reduce((sum,d)=>sum+(d.timesheet_sites||[]).reduce((a,x)=>a+Number(x.hours||0),0),0),warnings=timesheetWarnings(s),editable=canReview&&visibleRole()==="rh",editRows=(s.timesheet_days||[]).sort((a,b)=>a.work_date.localeCompare(b.work_date)).map(d=>(d.timesheet_sites||[]).map((x,i)=>`<div class="v66-sheet-row"><span><strong>${i?"":fmtDate(d.work_date)}</strong></span><span>${esc(x.project_code_snapshot||"—")} — ${esc(x.project_name_snapshot||"Chantier non renseigné")}</span><span><input class="v66-inline-input" type="number" min="0" max="24" step="0.5" value="${Number(x.hours||0)}" data-site-hours="${x.id}"></span><span>${i?"":`<input class="v66-inline-input" type="number" min="0" max="1" step="1" value="${Number(d.meal||0)}" data-day-meal="${d.id}">`}</span><span>${i?"":esc(d.it_zone_label_snapshot||"Non renseignée")}</span><span>${i?"":`<input class="v66-inline-input" value="${esc([...(d.tasks||[]),d.manual_task].filter(Boolean).join(", "))}" data-day-task="${d.id}">`}</span></div>`).join("")).join("");
      modal.classList.add("v66-official-modal");modal.innerHTML=`<article class="v66-card v66-sheet-detail" data-id="${s.id}"><div class="v66-pagehead"><div><h2>Fiche d’heures — ${esc(fullName(s.profiles))}</h2><p>${weekTitle(s.iso_year,s.iso_week)} · ${hours.toLocaleString("fr-FR")} h · ${esc(sheetLabels[s.status]||"Transmise")}</p></div><button class="v66-btn" data-close>Fermer</button></div>${warnings.length?`<div class="v66-sheet-warning"><strong>⚠ Fiche à vérifier</strong><ul>${warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}<div class="v66-official-viewport">${officialTimesheetMarkup(s)}</div>${editable?`<details class="v66-edit-sheet"><summary>Modifier cette fiche</summary><div class="v66-full-sheet"><div class="v66-sheet-row v66-sheet-heading"><span>Date</span><span>Chantier</span><span>Heures</span><span>Repas</span><span>IT</span><span>Tâches</span></div>${editRows}</div><label class="v66-field v66-sheet-note">Observations<textarea data-sheet-observations>${esc(s.observations||"")}</textarea></label><div class="v66-actions"><button class="v66-btn primary" data-save-sheet>Enregistrer les modifications RH</button></div></details>`:""}</article>`;fitOfficialSheet(modal);
      modal.querySelector("[data-close]").onclick=()=>modal.remove();modal.onclick=e=>{if(e.target===modal)modal.remove()};
      modal.querySelector("[data-save-sheet]")?.addEventListener("click",async e=>{const button=e.currentTarget;button.disabled=true;try{for(const input of modal.querySelectorAll("[data-site-hours]")){const{error}=await db.from("timesheet_sites").update({hours:Number(input.value)}).eq("id",input.dataset.siteHours);if(error)throw error}for(const input of modal.querySelectorAll("[data-day-meal]")){const{error}=await db.from("timesheet_days").update({meal:Number(input.value)}).eq("id",input.dataset.dayMeal);if(error)throw error}for(const input of modal.querySelectorAll("[data-day-task]")){const{error}=await db.from("timesheet_days").update({manual_task:input.value.trim()}).eq("id",input.dataset.dayTask);if(error)throw error}const{error}=await db.from("timesheets").update({observations:modal.querySelector("[data-sheet-observations]").value}).eq("id",id);if(error)throw error;toast("Modifications RH enregistrées.");modal.remove();appScreen()}catch(err){fail(err);button.disabled=false}});
    }catch(e){modal.innerHTML=`<div class="v66-card"><button class="v66-btn" data-close>Fermer</button><div class="v66-empty">${esc(e.message)}</div></div>`;modal.querySelector("[data-close]").onclick=()=>modal.remove()}
  }

  async function renderSharedSheets(root, canReview) {
    const role = visibleRole();
    root.innerHTML = `<div class="v66-pagehead"><div><h1>${canReview ? "Validations RH" : role === "admin" ? "Toutes les fiches" : "Fiches de mes chantiers"}</h1><p>${canReview ? "Fiches envoyées, modifiées, validées ou refusées." : role === "admin" ? "Accès technique à toutes les données." : "Lecture seule : identité, heures, repas, IT et tâches."}</p></div></div><div class="v66-list" id="v66SharedSheets"><div class="v66-card v66-empty">Chargement…</div></div>`;
    try {
      const { data: zones, error: zonesError } = canReview
        ? await db
            .from("it_zones")
            .select("id,label")
            .eq("active", true)
            .order("label")
        : { data: [], error: null };
      if (zonesError) throw zonesError;
      let query = db
        .from("timesheets")
        .select(
          "id,iso_year,iso_week,status,rejection_reason,version,profiles!timesheets_employee_id_fkey(first_name,last_name,email),timesheet_days(id,work_date,meal,travel_km,it_zone_id,it_zone_label_snapshot,it_needs_review,tasks,manual_task,timesheet_sites(project_code_snapshot,project_name_snapshot,hours))",
        )
        .order("iso_year", { ascending: false })
        .order("iso_week", { ascending: false });
      if (canReview)
        query = query.in("status", [
          "pending_review",
          "changed_after_validation",
          "validated",
          "rejected",
        ]);
      const { data, error } = await query;
      if (error) throw error;
      const box = root.querySelector("#v66SharedSheets");
      box.innerHTML = data.length
        ? data
            .map((s) => {
              const days = s.timesheet_days || [],
                hours = days.reduce(
                  (a, d) =>
                    a +
                    (d.timesheet_sites || []).reduce(
                      (x, y) => x + Number(y.hours || 0),
                      0,
                    ),
                  0,
                ),
                meals = days.reduce((a, d) => a + Number(d.meal || 0), 0),
                itDays = days.filter(
                  (d) => d.it_zone_label_snapshot || Number(d.travel_km) > 0,
                ).length;
              return `<article class="v66-card" data-id="${s.id}"><div class="v66-pagehead"><div><strong>${esc(fullName(s.profiles))} · Semaine ${s.iso_week}/${s.iso_year}</strong><p>Version ${s.version}</p></div><span class="v66-pill ${esc(s.status)}">${esc({ pending_review: "En attente RH", changed_after_validation: "Modifiée — à revalider", validated: "Validée", rejected: "Refusée" }[s.status] || s.status)}</span></div><div class="v66-stats"><div class="v66-stat"><small>Heures</small><strong>${hours.toLocaleString("fr-FR")} h</strong></div><div class="v66-stat"><small>Repas</small><strong>${meals.toLocaleString("fr-FR")}</strong></div><div class="v66-stat"><small>Jours IT</small><strong>${itDays}</strong></div></div><div class="v66-list">${days
                .sort((a, b) => a.work_date.localeCompare(b.work_date))
                .map((d) => {
                  const legacy =
                      !d.it_zone_label_snapshot && Number(d.travel_km) > 0,
                    zone =
                      d.it_zone_label_snapshot ||
                      (legacy ? "Ancienne IT" : "Zone IT non renseignée");
                  const chooser =
                    canReview && d.it_needs_review
                      ? `<label class="v66-field">IT à décider<select data-it-review data-day-id="${d.id}"><option value="">Choisir une zone…</option>${zones.map((z) => `<option value="${z.id}" data-label="${esc(z.label)}">${esc(z.label)}</option>`).join("")}</select></label>`
                      : `<small>IT : ${esc(zone)}</small>`;
                  return `<div class="v66-row ${d.it_needs_review ? "it-warning" : ""}"><div><strong>${fmtDate(d.work_date)}</strong><small>${(d.timesheet_sites || []).map((x) => `${esc(x.project_code_snapshot)} ${esc(x.project_name_snapshot)} — ${Number(x.hours || 0).toLocaleString("fr-FR")} h`).join("<br>") || "Aucun chantier"}</small></div><div><small>Repas : ${esc(d.meal)}</small>${chooser}<small>${esc([...(d.tasks || []), d.manual_task].filter(Boolean).join(", ") || "Aucune tâche")}</small></div></div>`;
                })
                .join(
                  "",
                )}</div>${canReview && ["pending_review", "changed_after_validation"].includes(s.status) ? '<div class="v66-actions" style="margin-top:12px"><button class="v66-btn danger" data-decision="rejected">Refuser</button><button class="v66-btn primary" data-decision="validated">Valider</button></div>' : ""}</article>`;
            })
            .join("")
        : '<div class="v66-card v66-empty">Aucune fiche disponible.</div>';
      box.querySelectorAll("[data-it-review]").forEach(
        (select) =>
          (select.onchange = async () => {
            if (!select.value) return;
            const option = select.selectedOptions[0];
            select.disabled = true;
            try {
              const { error } = await db
                .from("timesheet_days")
                .update({
                  it_zone_id: select.value,
                  it_zone_label_snapshot: option.dataset.label,
                  it_needs_review: false,
                })
                .eq("id", select.dataset.dayId);
              if (error) throw error;
              toast("Zone IT appliquée à cette journée.");
              await renderSharedSheets(root, canReview);
            } catch (e) {
              fail(e);
              select.disabled = false;
            }
          }),
      );
      box.querySelectorAll("[data-decision]").forEach(
        (b) =>
          (b.onclick = async () => {
            const decision = b.dataset.decision,
              reason =
                decision === "rejected" ? prompt("Motif du refus :") || "" : "";
            if (decision === "rejected" && !reason.trim()) return;
            b.disabled = true;
            try {
              const { error } = await db.rpc("review_timesheet", {
                target_id: b.closest("[data-id]").dataset.id,
                decision,
                reason,
              });
              if (error) throw error;
              toast(
                decision === "validated" ? "Fiche validée." : "Fiche refusée.",
              );
              await renderSharedSheets(root, canReview);
            } catch (e) {
              fail(e);
            } finally {
              b.disabled = false;
            }
          }),
      );
    } catch (e) {
      root.querySelector("#v66SharedSheets").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  async function projectModal(project = null) {
    const role = visibleRole(),
      canAssign = ["rh", "admin"].includes(role);
    let conductors = [];
    try {
      const requests = [
        db.from("establishments").select("*").eq("active", true).order("name"),
        db.from("it_zones").select("*").eq("active", true).order("label"),
      ];
      if (canAssign)
        requests.push(
          db
            .from("profiles")
            .select("id,first_name,last_name,email")
            .eq("status", "active")
            .eq("role", "conducteur")
            .order("last_name"),
        );
      const results = await Promise.all(requests);
      if (results.some((x) => x.error))
        throw results.find((x) => x.error).error;
      var establishments = results[0].data || [],
        zones = results[1].data || [];
      if (canAssign) conductors = results[2].data || [];
    } catch (e) {
      fail(e);
      return;
    }
    const assigned = new Set(
      (project?.project_conductors || []).map((x) => x.conductor_id),
    );
    const statuses =
      role === "conducteur"
        ? ["upcoming", "active", "overdue", "completed"]
        : ["upcoming", "active", "overdue", "completed", "archived"];
    const assignmentField = canAssign
      ? `<label class="v66-field">Conducteurs affectés<div class="v66-checkboxes">${conductors.length ? conductors.map((c) => `<label><input type="checkbox" name="conductors" value="${c.id}" ${assigned.has(c.id) ? "checked" : ""}> ${esc(fullName(c))}</label>`).join("") : '<span class="v66-help">Aucun conducteur actif.</span>'}</div></label>`
      : '<div class="v66-info">Tu seras automatiquement affecté au chantier que tu crées.</div>';
    const currentIt = new Map(
      (project?.project_it_zones || []).map((x) => [
        x.establishment_id,
        x.it_zone_id,
      ]),
    );
    const itFields = `<div class="v66-section"><h3>Zones IT selon le siège</h3><div class="v66-grid">${establishments.map((site) => `<label class="v66-field">${esc(site.name)}<select name="it_${site.id}"><option value="">Zone non renseignée</option>${zones.map((z) => `<option value="${z.id}" ${currentIt.get(site.id) === z.id ? "selected" : ""}>${esc(z.label)}</option>`).join("")}</select></label>`).join("")}</div></div>`;
    const modal = el(
      "div",
      { class: "v66-modal" },
      `<form class="v66-card v66-form"><h2>${project ? "Modifier" : "Créer"} un chantier</h2><div class="v66-grid"><label class="v66-field">Code chantier<input name="code" value="${esc(project?.code || "")}" required maxlength="30"></label><label class="v66-field">Nom du chantier<input name="name" value="${esc(project?.name || "")}" required></label><label class="v66-field">Jours prévus<input name="planned_days" type="number" min="0.01" step="0.01" value="${esc(project?.planned_days || "")}" required></label><label class="v66-field">Statut<select name="status">${statuses.map((s) => `<option value="${s}" ${project?.status === s ? "selected" : ""}>${esc(statusLabels[s])}</option>`).join("")}</select></label><label class="v66-field">Début prévu<input name="planned_start_date" type="date" value="${esc(project?.planned_start_date || "")}" required></label><label class="v66-field">Fin prévue<input name="planned_end_date" type="date" value="${esc(project?.planned_end_date || "")}" required></label><label class="v66-field">Début réel (facultatif)<input name="actual_start_date" type="date" value="${esc(project?.actual_start_date || "")}"></label><label class="v66-field">Fin réelle (facultatif)<input name="actual_end_date" type="date" value="${esc(project?.actual_end_date || "")}"></label></div>${itFields}${assignmentField}<label class="v66-field">Notes internes<textarea name="internal_notes">${esc(project?.internal_notes || "")}</textarea></label><p class="v66-help">Conversion temporaire : 1 jour prévu = 7,8 h. Le nombre de jours saisi reste conservé séparément.</p><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Enregistrer</button></div><div class="v66-message"></div></form>`,
    );
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick = () => modal.remove();
    modal.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        msg = form.querySelector(".v66-message"),
        fd = new FormData(form),
        start = fd.get("planned_start_date"),
        end = fd.get("planned_end_date");
      if (end < start) {
        setMessage(
          msg,
          "La date de fin doit être après la date de début.",
          "error",
        );
        return;
      }
      const values = {
        code: fd.get("code").trim(),
        name: fd.get("name").trim(),
        planned_days: Number(fd.get("planned_days")),
        status: fd.get("status"),
        planned_start_date: start,
        planned_end_date: end,
        actual_start_date: fd.get("actual_start_date") || null,
        actual_end_date: fd.get("actual_end_date") || null,
        internal_notes: fd.get("internal_notes").trim(),
        updated_by: profile.id,
      };
      try {
        let id = project?.id;
        if (id) {
          const { error } = await db
            .from("projects")
            .update(values)
            .eq("id", id);
          if (error) throw error;
        } else {
          values.created_by = profile.id;
          const { data, error } = await db
            .from("projects")
            .insert(values)
            .select("id")
            .single();
          if (error) throw error;
          id = data.id;
        }
        const itRows = establishments
          .map((site) => ({
            project_id: id,
            establishment_id: site.id,
            it_zone_id: fd.get("it_" + site.id),
            updated_by: profile.id,
          }))
          .filter((x) => x.it_zone_id);
        const { error: itDeleteError } = await db
          .from("project_it_zones")
          .delete()
          .eq("project_id", id);
        if (itDeleteError) throw itDeleteError;
        if (itRows.length) {
          const { error } = await db.from("project_it_zones").insert(itRows);
          if (error) throw error;
        }
        if (canAssign) {
          const selected = fd.getAll("conductors");
          const { error: delError } = await db
            .from("project_conductors")
            .delete()
            .eq("project_id", id);
          if (delError) throw delError;
          if (selected.length) {
            const { error } = await db.from("project_conductors").insert(
              selected.map((conductor_id) => ({
                project_id: id,
                conductor_id,
                assigned_by: profile.id,
              })),
            );
            if (error) throw error;
          }
        }
        modal.remove();
        toast("Chantier et zones IT enregistrés.");
        renderProjects(shell.querySelector("#v66Content"));
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    };
  }

  async function renderStats(root) {
    root.innerHTML =
      '<div class="v66-pagehead"><div><h1>Statistiques chantiers</h1><p>Prévisionnel comparé uniquement aux heures des fiches enregistrées.</p></div></div><input class="v66-search" id="v66StatsSearch" placeholder="Code ou nom du chantier…"><div id="v66Stats" class="v66-list" style="margin-top:12px"><div class="v66-card v66-empty">Calcul…</div></div>';
    try {
      const [{ data: projects, error: pe }, { data: sites, error: se }] =
        await Promise.all([
          db.from("projects").select("*").order("code"),
          db.from("timesheet_sites").select("project_id,hours"),
        ]);
      if (pe) throw pe;
      if (se) throw se;
      const actual = new Map();
      (sites || []).forEach((s) =>
        actual.set(
          s.project_id,
          (actual.get(s.project_id) || 0) + Number(s.hours || 0),
        ),
      );
      const paint = (q) => {
        const rows = projects.filter((p) =>
          `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase()),
        );
        root.querySelector("#v66Stats").innerHTML = rows.length
          ? rows
              .map((p) => {
                const used = actual.get(p.id) || 0,
                  planned = Number(p.planned_hours || 0),
                  pct = planned ? (used / planned) * 100 : 0,
                  kind = pct > 100 ? "danger" : pct >= 80 ? "warn" : "";
                return `<article class="v66-card"><div class="v66-pagehead"><div><strong>${esc(p.code)} — ${esc(p.name)}</strong><p>${fmtDate(p.planned_start_date)} → ${fmtDate(p.planned_end_date)}</p></div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status] || p.status)}</span></div><div class="v66-stats"><div class="v66-stat"><small>Prévu</small><strong>${planned.toLocaleString("fr-FR")} h</strong></div><div class="v66-stat"><small>Réalisé</small><strong>${used.toLocaleString("fr-FR")} h</strong></div><div class="v66-stat"><small>Restant</small><strong>${Math.max(0, planned - used).toLocaleString("fr-FR")} h</strong></div><div class="v66-stat"><small>Consommé</small><strong>${pct.toFixed(1).replace(".", ",")} %</strong></div></div><div class="v66-progress ${kind}"><span style="width:${Math.min(100, pct)}%"></span></div></article>`;
              })
              .join("")
          : '<div class="v66-card v66-empty">Aucun chantier trouvé.</div>';
      };
      const intended=routeIntent?.projectId?projects.find(p=>p.id===routeIntent.projectId):null;
      const initial=intended?intended.code:"";routeIntent=null;root.querySelector("#v66StatsSearch").value=initial;paint(initial);
      root.querySelector("#v66StatsSearch").oninput = (e) =>
        paint(e.target.value);
    } catch (e) {
      root.querySelector("#v66Stats").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  async function renderLegacy(root) {
    const role=visibleRole(),canSeeEmployees=["conducteur","rh","admin"].includes(role),now=currentIsoWeek();
    localStorage.setItem("antras_selected_year_v1",String(now.year));
    root.innerHTML = `<div class="v66-pagehead"><div><h1>Fiches d’heures</h1><p>Complète directement ta fiche de la semaine actuelle.</p></div><div class="v66-actions"><button class="v66-btn" id="v66SavedSheets">Mes fiches enregistrées</button>${canSeeEmployees?'<button class="v66-btn" id="v66EmployeeSheets">Fiches d’heures salariés</button>':''}</div></div><div class="v66-info" id="v66SyncMessage">En ligne : Enregistrer la fiche la partage automatiquement avec le bureau.</div><section id="v66CurrentSheetPanel" class="v66-native-editor"><div class="v66-card v66-empty">Chargement de la fiche actuelle…</div></section><section id="v66SavedSheetsPanel" hidden><div class="v66-filterbar"><input class="v66-search" id="v66MySheetSearch" placeholder="Rechercher une année, un mois, une semaine ou un statut…"></div><div class="v66-list" id="v66MySheets"><div class="v66-card v66-empty">Chargement de l’index…</div></div></section>${canSeeEmployees?'<section id="v66EmployeeSheetsPanel" hidden></section>':''}`;
    try {
      if (navigator.onLine) { await syncLegacySheets(); await syncNativeDrafts(); }
      await Promise.all([renderNativeCurrentTimesheet(root.querySelector("#v66CurrentSheetPanel"),now.year,now.week),loadMySheets(root)]);const intent=routeIntent;
      const hidePanels=()=>{root.querySelector("#v66CurrentSheetPanel").hidden=true;root.querySelector("#v66SavedSheetsPanel").hidden=true;const employee=root.querySelector("#v66EmployeeSheetsPanel");if(employee)employee.hidden=true};
      root.querySelector("#v66SavedSheets").onclick=()=>{const panel=root.querySelector("#v66SavedSheetsPanel"),opening=panel.hidden;hidePanels();panel.hidden=!opening;if(opening)panel.scrollIntoView({behavior:"smooth",block:"start"});else root.querySelector("#v66CurrentSheetPanel").hidden=false};
      const showEmployees=async()=>{const panel=root.querySelector("#v66EmployeeSheetsPanel");if(!panel)return;const opening=panel.hidden;hidePanels();panel.hidden=!opening;if(opening){await renderSheetExplorer(panel,role==="rh");panel.scrollIntoView({behavior:"smooth",block:"start"})}else root.querySelector("#v66CurrentSheetPanel").hidden=false};
      root.querySelector("#v66EmployeeSheets")?.addEventListener("click",showEmployees);
      if(intent?.employeeSheets)await showEmployees();else routeIntent=null;
    } catch (e) {
      root.querySelector("#v66MySheets").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  const nativeDraftKey=(year,week)=>`antras_native_timesheet_${profile.id}_${year}_${week}`;
  async function syncNativeDrafts(){
    if(!navigator.onLine||!session||!profile)return 0;
    let sent=0;
    for(const key of Object.keys(localStorage).filter(k=>k.startsWith(`antras_native_timesheet_${profile.id}_`))){
      let payload;try{payload=JSON.parse(localStorage.getItem(key)||"")}catch{continue}
      const{error}=await db.rpc("save_and_submit_timesheet",{payload});
      if(error)throw error;
      localStorage.removeItem(key);sent++;
    }
    return sent;
  }

  async function renderNativeCurrentTimesheet(panel,year,week){
    if(!panel)return;
    const monday=isoWeekBounds(year,week).monday,dates=Array.from({length:5},(_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return dateKey(d)});
    const dayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi"];
    let projects=[],existing=null;
    if(navigator.onLine){
      const[projectResult,sheetResult]=await Promise.all([
        db.from("projects").select("id,code,name,status,project_it_zones(establishment_id,it_zone_id,it_zones(label))").neq("status","archived").order("code"),
        db.from("timesheets").select("id,observations,timesheet_days(id,work_date,day_type,meal,it_zone_id,it_zone_label_snapshot,it_needs_review,tasks,manual_task,vehicle,delivery_note,timesheet_sites(id,project_id,project_code_snapshot,project_name_snapshot,hours,position))").eq("employee_id",profile.id).eq("iso_year",year).eq("iso_week",week).maybeSingle()
      ]);
      if(projectResult.error)throw projectResult.error;if(sheetResult.error)throw sheetResult.error;
      projects=projectResult.data||[];existing=sheetResult.data;
    }
    let local=null;try{local=JSON.parse(localStorage.getItem(nativeDraftKey(year,week))||"null")}catch{}
    const existingDays=new Map((existing?.timesheet_days||[]).map(d=>[d.work_date,d]));
    const localDays=new Map((local?.days||[]).map(d=>[d.work_date,d]));
    const codeOptions=projects.map(p=>`<option value="${esc(p.code)}">${esc(p.name)}</option>`).join(""),nameOptions=projects.map(p=>`<option value="${esc(p.name)}">${esc(p.code)}</option>`).join("");
    const siteMarkup=(site={})=>`<div class="v66-native-site"><label>Code chantier<input class="v66-native-code" list="v66ProjectCodes" value="${esc(site.project_code_snapshot||site.code||"")}" placeholder="Code chantier"></label><label>Chantier<input class="v66-native-project" list="v66ProjectNames" value="${esc(site.project_name_snapshot||site.name||"")}" placeholder="Nom du chantier"></label><label>Heures<input class="v66-native-hours" type="number" min="0" max="24" step="0.25" inputmode="decimal" value="${esc(site.hours??"")}"></label><button type="button" class="v66-native-remove" aria-label="Supprimer ce chantier">×</button></div>`;
    const typeChoices=(selected="worked")=>`<div class="v66-day-types" role="group" aria-label="Type de journée">${[["worked","Travaillé"],["cp","Congé payé"],["rtt","RTT"],["holiday","Férié"]].map(([value,label])=>`<button type="button" data-day-type="${value}" class="${selected===value?"active":""}">${label}</button>`).join("")}</div>`;
    const daysMarkup=dates.map((date,index)=>{const source=localDays.get(date)||existingDays.get(date)||{},sites=source.sites||(source.timesheet_sites||[]),dayType=source.day_type||"worked";return `<section class="v66-native-day ${dayType!=="worked"?"is-absence":""}" data-date="${date}" data-type="${dayType}"><header><strong>${dayNames[index]}</strong><span>${fmtDate(date)}</span></header>${typeChoices(dayType)}<div class="v66-day-watermark">${dayType==="cp"?"CONGÉ PAYÉ":dayType==="rtt"?"RTT":dayType==="holiday"?"FÉRIÉ":""}</div><div class="v66-native-work-fields"><div class="v66-native-sites">${(sites.length?sites:[{}]).map(siteMarkup).join("")}</div><button type="button" class="v66-link-btn v66-native-add">+ Ajouter un chantier</button><div class="v66-native-day-details"><label>Repas<select class="v66-native-meal"><option value="0">0</option><option value="1" ${Number(source.meal)===1?"selected":""}>1</option></select></label><label>IT<input class="v66-native-it" value="${esc(source.it_zone_label_snapshot||source.it_zone_label||"")}" readonly placeholder="Calcul automatique"></label><label>Tâches effectuées<input class="v66-native-task" value="${esc(source.manual_task||(source.tasks||[]).join(", ")||"")}" placeholder="Travaux réalisés"></label></div><p class="v66-native-warning" hidden></p></div></section>`}).join("");
    const templateMarkup=`<section class="v66-day-template"><div><strong>Journée type</strong><small>Code et chantier sont obligatoires. Les tâches restent à compléter chaque jour.</small></div><div class="v66-day-template-fields"><label>Code chantier<input class="v66-template-code" list="v66ProjectCodes" placeholder="Code chantier"></label><label>Chantier<input class="v66-template-project" list="v66ProjectNames" placeholder="Nom du chantier"></label><label>Heures lun. à jeu.<input class="v66-template-hours" type="number" min="0" max="24" step="0.25" inputmode="decimal" value="8"></label><label>Heures vendredi<input class="v66-template-friday" type="number" min="0" max="24" step="0.25" inputmode="decimal" value="7"></label><label>Repas<select class="v66-template-meal"><option value="0">0</option><option value="1" selected>1</option></select></label></div><button type="button" class="v66-btn primary v66-template-apply">Appliquer à la semaine</button></section>`;
    panel.innerHTML=`<form class="v66-native-sheet"><div class="v66-native-report"><img src="antras-logo.png" alt=""><div><strong>RAPPORT HEBDOMADAIRE</strong><small>${esc(weekTitle(year,week))}</small></div></div><div class="v66-native-identity"><span>Nom : <strong>${esc(profile.last_name||"")}</strong></span><span>Prénom : <strong>${esc(profile.first_name||"")}</strong></span></div><datalist id="v66ProjectCodes">${codeOptions}</datalist><datalist id="v66ProjectNames">${nameOptions}</datalist>${templateMarkup}${daysMarkup}<label class="v66-native-observations">Observations<textarea rows="3">${esc(local?.observations||existing?.observations||"")}</textarea></label><div class="v66-week-recap"></div><div class="v66-actions"><button class="v66-btn primary" type="submit">Enregistrer et partager la fiche</button></div><div class="v66-message"></div></form>`;
    const form=panel.querySelector("form"),normalize=v=>String(v||"").trim().toLowerCase();
    const projectFor=(code,name)=>{const c=normalize(code),n=normalize(name);return projects.find(p=>c&&n?normalize(p.code)===c&&normalize(p.name)===n:c?normalize(p.code)===c:n?normalize(p.name)===n:false)};
    const refresh=()=>{let total=0,meals=0,worked=0,cp=0,rtt=0,holiday=0;const itList=[];form.querySelectorAll(".v66-native-day").forEach(day=>{const type=day.dataset.type||"worked",watermark=day.querySelector(".v66-day-watermark"),work=day.querySelector(".v66-native-work-fields");day.classList.toggle("is-absence",type!=="worked");watermark.textContent=type==="cp"?"CONGÉ PAYÉ":type==="rtt"?"RTT":type==="holiday"?"FÉRIÉ":"";work.querySelectorAll("input,select,button").forEach(x=>x.disabled=type!=="worked");if(type!=="worked"){if(type==="cp")cp++;if(type==="rtt")rtt++;if(type==="holiday")holiday++;return}worked++;const matches=[...day.querySelectorAll(".v66-native-site")].map(row=>projectFor(row.querySelector(".v66-native-code").value,row.querySelector(".v66-native-project").value)).filter(Boolean),unknown=[...day.querySelectorAll(".v66-native-site")].some(row=>{const code=row.querySelector(".v66-native-code").value.trim(),name=row.querySelector(".v66-native-project").value.trim();return(code||name)&&(!code||!name||!projectFor(code,name))}),zones=[...new Map(matches.flatMap(p=>(p.project_it_zones||[]).filter(z=>z.establishment_id===profile.establishment_id&&z.it_zones?.label).map(z=>[z.it_zone_id,z.it_zones.label]))).values()],it=day.querySelector(".v66-native-it"),warning=day.querySelector(".v66-native-warning");it.value=zones.length===1?zones[0]:"";if(it.value)itList.push(`${day.querySelector("header strong").textContent} : ${it.value}`);warning.hidden=!(unknown||zones.length!==1&&matches.length);warning.textContent=unknown?"Attention : le code et le nom du chantier doivent être renseignés. Chantier non référencé autorisé.":zones.length>1?"Plusieurs zones IT : décision RH nécessaire.":"Zone IT non renseignée : 0 IT sera appliqué.";day.querySelectorAll(".v66-native-hours").forEach(i=>total+=Number(i.value||0));meals+=Number(day.querySelector(".v66-native-meal").value||0)});const parts=[`${worked} jour${worked>1?"s":""} travaillé${worked>1?"s":""}`];if(cp)parts.push(`${cp} jour${cp>1?"s":""} de congé payé`);if(rtt)parts.push(`${rtt} jour${rtt>1?"s":""} de RTT`);if(holiday)parts.push(`${holiday} jour${holiday>1?"s":""} férié${holiday>1?"s":""}`);form.querySelector(".v66-week-recap").innerHTML=`<strong>Compte rendu de la semaine</strong><div>${parts.map(x=>`<span>${esc(x)}</span>`).join("")}<span>${String(total).replace(".",",")} heures effectuées</span><span>${meals} repas</span></div><p><b>IT :</b> ${itList.length?esc(itList.join(" · ")):"Aucune IT"}</p>`};
    form.addEventListener("input",e=>{const row=e.target.closest(".v66-native-site");if(row&&e.target.matches(".v66-native-code")){const p=projects.find(x=>normalize(x.code)===normalize(e.target.value));if(p)row.querySelector(".v66-native-project").value=p.name}if(row&&e.target.matches(".v66-native-project")){const p=projects.find(x=>normalize(x.name)===normalize(e.target.value));if(p)row.querySelector(".v66-native-code").value=p.code}if(e.target.matches(".v66-template-code")){const p=projects.find(x=>normalize(x.code)===normalize(e.target.value));if(p)form.querySelector(".v66-template-project").value=p.name}if(e.target.matches(".v66-template-project")){const p=projects.find(x=>normalize(x.name)===normalize(e.target.value));if(p)form.querySelector(".v66-template-code").value=p.code}refresh()});
    form.querySelector(".v66-template-apply").onclick=()=>{
      const code=form.querySelector(".v66-template-code").value.trim(),project=form.querySelector(".v66-template-project").value.trim(),hours=Number(form.querySelector(".v66-template-hours").value||0),friday=Number(form.querySelector(".v66-template-friday").value||0),meal=form.querySelector(".v66-template-meal").value;
      if(!code||!project)return toast("Renseigne le code chantier et le nom du chantier dans la journée type.");
      const alreadyFilled=[...form.querySelectorAll(".v66-native-day")].some(day=>[...day.querySelectorAll(".v66-native-project")].some(i=>i.value.trim())||[...day.querySelectorAll(".v66-native-hours")].some(i=>Number(i.value||0)>0));
      if(alreadyFilled&&!confirm("La journée type va remplacer les chantiers et les heures déjà saisis pour cette semaine. Continuer ?"))return;
      [...form.querySelectorAll(".v66-native-day")].forEach((day,index)=>{if(day.dataset.type!=="worked")return;const sites=day.querySelector(".v66-native-sites");sites.innerHTML=siteMarkup();sites.querySelector(".v66-native-code").value=code;sites.querySelector(".v66-native-project").value=project;sites.querySelector(".v66-native-hours").value=String(index===4?friday:hours);day.querySelector(".v66-native-meal").value=meal});
      refresh();toast("Journée type appliquée à toute la semaine.");
    };
    form.addEventListener("click",e=>{const typeButton=e.target.closest("[data-day-type]");if(typeButton){const day=typeButton.closest(".v66-native-day"),next=typeButton.dataset.dayType,filled=[...day.querySelectorAll(".v66-native-code,.v66-native-project,.v66-native-hours,.v66-native-task")].some(i=>i.value.trim()&&i.value!=="0");if(next!=="worked"&&filled&&!confirm("Cette sélection va effacer les informations déjà saisies pour cette journée. Continuer ?"))return;if(next!=="worked"){day.querySelectorAll(".v66-native-code,.v66-native-project,.v66-native-hours,.v66-native-task,.v66-native-it").forEach(i=>i.value="");day.querySelector(".v66-native-meal").value="0"}day.dataset.type=next;day.querySelectorAll("[data-day-type]").forEach(b=>b.classList.toggle("active",b===typeButton));refresh();return}if(e.target.closest(".v66-native-add")){const sites=e.target.closest(".v66-native-day").querySelector(".v66-native-sites");sites.insertAdjacentHTML("beforeend",siteMarkup());refresh()}if(e.target.closest(".v66-native-remove")){const row=e.target.closest(".v66-native-site"),box=row.parentElement;if(box.children.length>1)row.remove();else{row.querySelectorAll("input").forEach(i=>i.value="")}refresh()}});
    form.onsubmit=async e=>{e.preventDefault();const incomplete=[...form.querySelectorAll('.v66-native-day[data-type="worked"] .v66-native-site')].some(row=>{const code=row.querySelector(".v66-native-code").value.trim(),name=row.querySelector(".v66-native-project").value.trim(),hours=Number(row.querySelector(".v66-native-hours").value||0);return(code||name||hours)&&(!code||!name)});if(incomplete)return toast("Chaque chantier saisi doit avoir un code et un nom.");if(!confirm("Enregistrer la fiche d’heures et la partager avec le bureau ?"))return;const button=form.querySelector('[type="submit"]'),msg=form.querySelector(".v66-message");button.disabled=true;const payload={iso_year:year,iso_week:week,observations:form.querySelector("textarea").value.trim(),days:[...form.querySelectorAll(".v66-native-day")].map(day=>{const dayType=day.dataset.type||"worked",entries=dayType==="worked"?[...day.querySelectorAll(".v66-native-site")].map((row,position)=>{const code=row.querySelector(".v66-native-code").value.trim(),name=row.querySelector(".v66-native-project").value.trim(),known=projectFor(code,name);return{code,name,hours:Number(row.querySelector(".v66-native-hours").value||0),position,project:known}}).filter(x=>x.code||x.name||x.hours):[],zones=[...new Map(entries.flatMap(x=>(x.project?.project_it_zones||[]).filter(z=>z.establishment_id===profile.establishment_id).map(z=>[z.it_zone_id,z]))).values()],zone=zones.length===1?zones[0]:null;return{work_date:day.dataset.date,day_type:dayType,meal:dayType==="worked"?Number(day.querySelector(".v66-native-meal").value):0,travel_km:0,it_zone_id:dayType==="worked"?(zone?.it_zone_id||null):null,it_zone_label_snapshot:dayType==="worked"?(zone?.it_zones?.label||null):null,it_needs_review:dayType==="worked"&&zones.length!==1&&entries.length>0,establishment_id_snapshot:profile.establishment_id||null,tasks:[],manual_task:dayType==="worked"?day.querySelector(".v66-native-task").value.trim():"",vehicle:"",delivery_note:"",sites:entries.map(({code,name,hours,position})=>({code,name,hours,position}))}})};try{if(!navigator.onLine){localStorage.setItem(nativeDraftKey(year,week),JSON.stringify(payload));setMessage(msg,"Fiche enregistrée sur l’appareil. Elle sera envoyée automatiquement dès que la connexion sera rétablie.","ok")}else{const{error}=await db.rpc("save_and_submit_timesheet",{payload});if(error)throw error;localStorage.removeItem(nativeDraftKey(year,week));setMessage(msg,"Fiche enregistrée et partagée avec le bureau.","ok");toast("Fiche enregistrée et partagée.");const pageRoot=panel.closest("#v66Content");if(pageRoot)await loadMySheets(pageRoot)}}catch(err){localStorage.setItem(nativeDraftKey(year,week),JSON.stringify(payload));setMessage(msg,"Fiche conservée sur l’appareil. L’envoi sera retenté automatiquement.","error");console.error(err)}finally{button.disabled=false}};
    refresh();
  }
  function openLegacyEditor(_root,year,week){
    document.querySelector(".v66-timesheet-modal")?.remove();
    localStorage.setItem("antras_selected_year_v1",String(year));
    const modal=el("div",{class:"v66-timesheet-modal"},`<header><div><strong>Ma fiche d’heures</strong><small>${esc(weekTitle(year,week))}</small></div><button type="button" class="v66-btn" data-close>Fermer</button></header><main class="v66-native-editor"><div class="v66-card v66-empty">Chargement…</div></main>`);
    document.body.appendChild(modal);
    modal.querySelector("[data-close]").onclick=()=>modal.remove();
    renderNativeCurrentTimesheet(modal.querySelector(".v66-native-editor"),year,week).catch(e=>{fail(e);modal.remove()});
  }
  function chooseLegacyWeek(root,sheets){const now=currentIsoWeek(),modal=el("div",{class:"v66-modal"},`<form class="v66-card v66-form"><h2>Choisir une semaine</h2><div class="v66-grid"><label class="v66-field">Année<input name="year" type="number" min="2020" max="2100" value="${now.year}" required></label><label class="v66-field">Semaine<input name="week" type="number" min="1" max="53" value="${now.week}" required></label></div><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Ouvrir</button></div></form>`);document.body.appendChild(modal);modal.querySelector("[data-close]").onclick=()=>modal.remove();modal.querySelector("form").onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget),year=Number(fd.get("year")),week=Number(fd.get("week")),existing=sheets.find(s=>Number(s.iso_year)===year&&Number(s.iso_week)===week);modal.remove();if(existing&&!["draft","rejected","changed_after_validation"].includes(existing.status))openTimesheetDetail(existing.id,false);else openLegacyEditor(root,year,week)}}

  async function renderSettings(root){
    let establishmentName="Non attribué";
    if(profile.establishment_id){const{data}=await db.from("establishments").select("name").eq("id",profile.establishment_id).maybeSingle();if(data?.name)establishmentName=data.name}
    root.innerHTML=`<div class="v66-pagehead"><div><h1>Paramètres du compte</h1><p>Informations personnelles, sécurité et connexion.</p></div><button class="v66-btn" id="v66SettingsBack">Retour</button></div><div class="v66-settings-grid"><form class="v66-card v66-form" id="v66PersonalForm"><h2>Mes informations</h2><div class="v66-grid"><label class="v66-field">Prénom<input name="first_name" required maxlength="80" value="${esc(profile.first_name||"")}"></label><label class="v66-field">Nom<input name="last_name" required maxlength="80" value="${esc(profile.last_name||"")}"></label></div><label class="v66-field">Adresse e-mail<input value="${esc(profile.email||session?.user?.email||"")}" readonly></label><div class="v66-account-readonly"><span><small>Matricule</small><strong>${esc(profile.employee_number||"Non renseigné")}</strong></span><span><small>Rôle</small><strong>${esc(roleLabels[profile.role]||profile.role)}</strong></span><span><small>Siège</small><strong>${esc(establishmentName)}</strong></span><span><small>Statut</small><strong>${esc(statusLabels[profile.status]||profile.status)}</strong></span></div><p class="v66-help">Le matricule, le rôle, le siège et le statut sont gérés par les RH.</p><div class="v66-actions"><button class="v66-btn primary">Enregistrer mes informations</button></div><div class="v66-message"></div></form><form class="v66-card v66-form" id="v66PasswordForm"><h2>Changer mon mot de passe</h2><label class="v66-field">Nouveau mot de passe<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label class="v66-field">Confirmer le mot de passe<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></label><p class="v66-help">Utilise au minimum 8 caractères. Ton mot de passe ne sera jamais affiché ni enregistré dans le code.</p><div class="v66-actions"><button class="v66-btn primary">Changer mon mot de passe</button></div><div class="v66-message"></div></form><section class="v66-card v66-logout-card"><h2>Session</h2><p class="v66-help">Fermer ta session sur cet appareil.</p><button type="button" class="v66-btn danger" id="v66SettingsLogout">Se déconnecter</button></section></div>`;
    root.querySelector("#v66SettingsBack").onclick=()=>history.length>1?history.back():navigateTo("home");
    root.querySelector("#v66SettingsLogout").onclick=()=>confirm("Voulez-vous vraiment vous déconnecter ?")&&db.auth.signOut();
    root.querySelector("#v66PersonalForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,msg=form.querySelector(".v66-message"),button=form.querySelector("button"),fd=new FormData(form);button.disabled=true;try{const{data,error}=await db.rpc("update_own_profile",{new_first_name:fd.get("first_name").trim(),new_last_name:fd.get("last_name").trim()});if(error)throw error;profile={...profile,...data};setMessage(msg,"Informations mises à jour.","ok");toast("Profil mis à jour.")}catch(err){setMessage(msg,err.message,"error")}finally{button.disabled=false}};
    root.querySelector("#v66PasswordForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,msg=form.querySelector(".v66-message"),button=form.querySelector("button"),fd=new FormData(form),password=String(fd.get("password")||""),confirmation=String(fd.get("confirm_password")||"");if(password!==confirmation)return setMessage(msg,"Les deux mots de passe ne correspondent pas.","error");button.disabled=true;try{const{error}=await db.auth.updateUser({password});if(error)throw error;form.reset();setMessage(msg,"Mot de passe modifié avec succès.","ok");toast("Mot de passe modifié.")}catch(err){setMessage(msg,err.message,"error")}finally{button.disabled=false}};
  }

  function localSheets() {
    try {
      return JSON.parse(localStorage.getItem("antras_saved_history_v2")) || [];
    } catch {
      return [];
    }
  }
  function isoDate(fr) {
    const m = String(fr || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }
  async function syncLegacySheets() {
    if (!navigator.onLine)
      throw new Error(
        "Pas de réseau : les fiches restent conservées sur cet appareil.",
      );
    // Un conducteur reste aussi un salarié de l'entreprise : il doit pouvoir
    // synchroniser et envoyer ses propres fiches tout en conservant ses droits
    // supplémentaires sur les chantiers.
    if (!["salarie", "conducteur", "rh", "admin"].includes(profile.role)) return 0;
    const sheets = localSheets(), stateKey="antras_sync_state_v3";
    if (!sheets.length) return 0;
    let state={};try{state=JSON.parse(localStorage.getItem(stateKey)||"{}")||{}}catch{}
    let sent=0;
    for (const local of sheets) {
      const key=`${local.year}-${local.week}`,revision=local.savedAt||JSON.stringify(local).length;
      if(state[key]===revision)continue;
      const payload={iso_year:Number(local.year),iso_week:Number(local.week),observations:local.obs||"",days:(local.days||[]).map(day=>({work_date:isoDate(day.date),meal:Number(day.repas||0),travel_km:!day.itZoneLabel&&Number.isFinite(Number(day.it))?Number(day.it):0,it_zone_id:day.itZoneId||null,it_zone_label_snapshot:day.itZoneLabel||null,it_needs_review:!!day.itNeedsReview,establishment_id_snapshot:profile.establishment_id||null,tasks:day.tasks?.length?day.tasks:day.task?[day.task]:[],manual_task:day.manual||"",vehicle:day.vehicle||"",delivery_note:day.bon||"",sites:(day.sites?.length?day.sites:[{code:day.code||"",chantier:day.chantier||"",heures:day.heures??""}]).filter(s=>s.code||s.chantier||Number(s.heures||0)).map((s,position)=>({code:s.code||"",name:s.chantier||"",hours:Number(s.heures||0),position}))})).filter(d=>d.work_date)};
      const {error}=await db.rpc("save_and_submit_timesheet",{payload});if(error)throw error;
      state[key]=revision;localStorage.setItem(stateKey,JSON.stringify(state));sent++;
    }
    return sent;
  }

  async function loadMySheets(root) {
    const { data, error } = await db
      .from("timesheets")
      .select("*")
      .eq("employee_id", profile.id)
      .order("iso_year", { ascending: false })
      .order("iso_week", { ascending: false });
    if (error) throw error;
    const box = root.querySelector("#v66MySheets"), search=root.querySelector("#v66MySheetSearch");
    const paint=(query="")=>{
      const q=normalizeSearch(query), grouped=new Map();
      data.filter(s=>normalizeSearch(`${s.iso_year} ${monthLabels[isoWeekBounds(s.iso_year,s.iso_week).monday.getUTCMonth()]} semaine ${s.iso_week} ${sheetLabels[s.status]||s.status}`).includes(q)).forEach(s=>{const month=isoWeekBounds(s.iso_year,s.iso_week).monday.getUTCMonth();if(!grouped.has(s.iso_year))grouped.set(s.iso_year,new Map());if(!grouped.get(s.iso_year).has(month))grouped.get(s.iso_year).set(month,[]);grouped.get(s.iso_year).get(month).push(s)});
      box.innerHTML=grouped.size?[...grouped].map(([year,months],yi)=>`<details class="v66-folder" ${yi===0?"open":""}><summary>${year}</summary>${[...months].map(([month,sheets],mi)=>`<details class="v66-folder month" ${yi===0&&mi===0?"open":""}><summary>${monthLabels[month]}</summary>${sheets.map(s=>`<button type="button" class="v66-employee" data-sheet-id="${s.id}"><span><strong>${weekTitle(s.iso_year,s.iso_week)}</strong><small>Version ${s.version}${s.rejection_reason?` · Motif : ${esc(s.rejection_reason)}`:""}</small></span><span class="v66-pill ${esc(s.status)}">${esc(sheetLabels[s.status]||s.status)}</span></button>`).join("")}</details>`).join("")}</details>`).join(""):'<div class="v66-card v66-empty">Aucune fiche trouvée.</div>';
      box.querySelectorAll("[data-sheet-id]").forEach(b=>b.onclick=()=>openTimesheetDetail(b.dataset.sheetId,false));
    };paint();if(search)search.oninput=e=>paint(e.target.value);return data;
  }

  db.auth.onAuthStateChange((_event, nextSession) => {
    // getSession() réalise le premier affichage. Ignorer INITIAL_SESSION évite
    // que deux rendus asynchrones reconstruisent la même page en concurrence.
    if (!authReady || _event === "INITIAL_SESSION") return;
    const previousUserId=session?.user?.id||null,nextUserId=nextSession?.user?.id||null;
    session=nextSession;
    // Le renouvellement automatique du jeton ne doit jamais fermer/recréer
    // l'écran que l'utilisateur est en train de compléter.
    if (_event === "TOKEN_REFRESHED" && previousUserId === nextUserId) return;
    setTimeout(async()=>{
      if(_event==="PASSWORD_RECOVERY")currentPage="settings";
      try{await loadProfile()}catch(e){console.error(e)}
      route();
    },0);
  });
  const {
    data: { session: initial },
  } = await db.auth.getSession();
  session = initial;
  if (session) {
    try {
      await loadProfile();
    } catch (e) {
      fail(e);
    }
  }
  authReady = true;
  route();
}
