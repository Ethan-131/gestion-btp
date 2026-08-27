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
  let session = null,
    profile = null,
    currentPage = "home",
    previewRole = null;
  const shell = el("div", { class: "v66-shell" });
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

  window.addEventListener("online", () => {
    renderOffline();
    if (session && profile?.status === "active")
      syncLegacySheets().catch(() => {});
  });
  window.addEventListener("offline", () => renderOffline());
  window.addEventListener("antras:local-sheets-changed", () => {
    if (session && profile?.status === "active" && navigator.onLine)
      syncLegacySheets().catch(() => {});
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
    shell.innerHTML = `<main class="v66-auth v66-card"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span></div><h1>${mode === "login" ? "Connexion" : "Demande de compte"}</h1><p>${mode === "login" ? "Connecte-toi avec ton adresse professionnelle." : "Une RH devra confirmer ton compte et lui attribuer un rôle avant tout accès."}</p><div class="v66-tabs"><button data-mode="login" class="${mode === "login" ? "active" : ""}">Se connecter</button><button data-mode="register" class="${mode === "register" ? "active" : ""}">Créer un compte</button></div><form class="v66-form" id="v66AuthForm">${mode === "register" ? '<div class="v66-grid"><label class="v66-field">Prénom<input name="first_name" required autocomplete="given-name"></label><label class="v66-field">Nom<input name="last_name" required autocomplete="family-name"></label></div><label class="v66-field">Matricule (facultatif)<input name="employee_number"></label>' : ""}<label class="v66-field">E-mail<input name="email" type="email" required autocomplete="email"></label><label class="v66-field">Mot de passe<input name="password" type="password" minlength="8" required autocomplete="${mode === "login" ? "current-password" : "new-password"}"></label><button class="v66-btn primary" type="submit">${mode === "login" ? "Se connecter" : "Envoyer la demande"}</button></form><div id="v66AuthMessage" class="v66-message"></div></main>`;
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
    if (role === "rh") pages.push(["review", "Validations"]);
    if (role === "conducteur") pages.push(["team", "Fiches équipes"]);
    if (role === "admin") pages.push(["team", "Toutes les fiches"]);
    if (["conducteur", "rh", "admin"].includes(role))
      pages.push(["projects", "Chantiers"]);
    if (["conducteur", "rh", "admin"].includes(role))
      pages.push(["stats", "Avancement"]);
    if (["rh", "admin"].includes(role))
      pages.push(["it-settings", "Paramètres IT"]);
    pages.push(["leaves", "Congés & RTT"]);
    pages.push(["legacy", "Fiches d’heures"]);
    return pages;
  }

  function appScreen() {
    const pages = allowedPages();
    if (!pages.some((x) => x[0] === currentPage)) currentPage = "home";
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
    shell.innerHTML = `<header class="v66-top"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span></div><div class="v66-top-actions">${preview}<div class="v66-user"><strong>${esc(fullName(profile))}</strong><span>${esc(roleLabels[role])}${previewRole ? " · simulation" : ""}</span></div></div></header>${previewRole ? '<div class="v66-preview-banner">Mode aperçu : l’affichage est simulé, ton véritable compte reste RH.</div>' : ""}<nav class="v66-nav">${pages.map(([id, label]) => `<button data-page="${id}" class="${id === currentPage ? "active" : ""}">${esc(label)}</button>`).join("")}<button id="v66Logout">Déconnexion</button></nav><main class="v66-main" id="v66Content"></main>`;
    renderOffline();
    shell.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          currentPage = b.dataset.page;
          appScreen();
        }),
    );
    shell.querySelector("#v66Logout").onclick = () => db.auth.signOut();
    shell.querySelector("#v66RolePreview")?.addEventListener("change", (e) => {
      previewRole = e.target.value === profile.role ? null : e.target.value;
      currentPage = "home";
      appScreen();
    });
    const content = shell.querySelector("#v66Content");
    if (currentPage === "home") renderHome(content);
    if (currentPage === "accounts") renderAccounts(content);
    if (currentPage === "review") renderSharedSheets(content, true);
    if (currentPage === "team") renderSharedSheets(content, false);
    if (currentPage === "projects") renderProjects(content);
    if (currentPage === "stats") renderStats(content);
    if (currentPage === "it-settings") renderItSettings(content);
    if (currentPage === "leaves") renderLeaves(content);
    if (currentPage === "legacy") renderLegacy(content);
  }

  function renderHome(root) {
    const role = visibleRole();
    root.innerHTML = `<section class="v66-page"><div class="v66-pagehead"><div><h1>Bonjour ${esc(profile.first_name || "")}</h1><p>Ton espace est adapté au rôle ${esc(roleLabels[role])}.</p></div></div><div class="v66-stats"><div class="v66-stat"><small>Compte</small><strong>Actif</strong></div><div class="v66-stat"><small>Rôle affiché</small><strong style="font-size:16px">${esc(roleLabels[role])}</strong></div><div class="v66-stat"><small>Connexion</small><strong style="font-size:16px">${navigator.onLine ? "En ligne" : "Hors ligne"}</strong></div></div><div class="v66-card"><h2>Prochaine étape</h2><p class="v66-help">${role === "rh" ? "Valide les demandes de comptes, attribue les rôles, puis crée les chantiers." : role === "admin" ? "Configure les chantiers et contrôle les données techniques." : role === "conducteur" ? "Tu pourras consulter les fiches contenant au moins un chantier qui t’est attribué." : "Utilise la page Fiches d’heures pour saisir et envoyer ta semaine."}</p></div></section>`;
  }

  async function renderAccounts(root) {
    root.innerHTML =
      '<div class="v66-pagehead"><div><h1>Comptes</h1><p>Validation RH et attribution du rôle initial.</p></div></div><div class="v66-card"><div class="v66-list" id="v66Accounts"><div class="v66-empty">Chargement…</div></div></div>';
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
      const list = root.querySelector("#v66Accounts");
      list.innerHTML = data.length
        ? data
            .map(
              (p) =>
                `<article class="v66-row" data-id="${p.id}"><div><strong>${esc(fullName(p))}</strong><small>${esc(p.email)}${p.employee_number ? " · " + esc(p.employee_number) : ""}</small></div><div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status] || p.status)}</span><small>${esc(roleLabels[p.role] || "Rôle non attribué")} · ${esc(establishmentNames.get(p.establishment_id) || "Siège non attribué")}</small></div><div class="v66-actions">${p.status === "pending" ? '<button class="v66-btn primary" data-approve>Valider</button><button class="v66-btn danger" data-reject>Refuser</button>' : '<button class="v66-btn" data-edit-account>Modifier</button>'}</div></article>`,
            )
            .join("")
        : '<div class="v66-empty">Aucun compte.</div>';
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
    return p.start_date === p.end_date
      ? `${fmtDate(p.start_date)} · ${part}`
      : `${fmtDate(p.start_date)} → ${fmtDate(p.end_date)} · ${p.requested_days} jours`;
  }

  async function renderLeaves(root, monthOffset = 0) {
    const role = visibleRole(),
      canReview = role === "rh",
      canCreate = ["salarie", "conducteur"].includes(role) || canReview;
    const month = new Date();
    month.setUTCDate(1);
    month.setUTCMonth(month.getUTCMonth() + monthOffset);
    const first = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
      ),
      last = new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
      );
    root.innerHTML = `<div class="v66-pagehead"><div><h1>Congés & RTT</h1><p>Demandes, validations et calendrier des absences.</p></div>${canCreate ? `<button class="v66-btn primary" id="v66NewLeave">${canReview ? "Enregistrer une absence" : "Nouvelle demande"}</button>` : ""}</div><div class="v66-calendar-head"><button class="v66-btn" id="v66PrevMonth">‹</button><strong>${first.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><button class="v66-btn" id="v66NextMonth">›</button></div><div class="v66-calendar" id="v66LeaveCalendar"><div class="v66-empty">Chargement du calendrier…</div></div><div class="v66-pagehead" style="margin-top:22px"><div><h2>${canReview ? "Demandes à traiter et historique" : "Mes demandes"}</h2></div></div><div class="v66-list" id="v66LeaveList"><div class="v66-card v66-empty">Chargement…</div></div>`;
    root.querySelector("#v66PrevMonth").onclick = () =>
      renderLeaves(root, monthOffset - 1);
    root.querySelector("#v66NextMonth").onclick = () =>
      renderLeaves(root, monthOffset + 1);
    root
      .querySelector("#v66NewLeave")
      ?.addEventListener("click", () => leaveModal(canReview));
    try {
      const { data, error } = await db
        .from("leave_requests")
        .select(
          "*,profiles!leave_requests_employee_id_fkey(first_name,last_name,email),leave_periods(*)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      const requests = data || [];
      renderLeaveCalendar(
        root.querySelector("#v66LeaveCalendar"),
        first,
        last,
        requests,
        role,
        canCreate ? (date) => leaveModal(canReview, date) : null,
      );
      const list = root.querySelector("#v66LeaveList");
      const cardHtml = (r) => {
              const own = r.employee_id === profile.id,
                showType = role !== "conducteur",
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
              if (own && r.status === "pending")
                actions =
                  '<button class="v66-btn danger" data-leave-cancel="cancelled">Annuler la demande</button>';
              if (own && r.status === "approved")
                actions =
                  '<button class="v66-btn danger" data-leave-cancel="cancellation_requested">Demander l’annulation</button>';
              return `<article class="v66-card v66-leave-card" data-id="${r.id}"><div class="v66-pagehead"><div><strong>${esc(fullName(r.profiles))}${showType ? ` · ${esc(leaveTypeLabels[r.leave_type])}` : " · Absence"}</strong><p>${total.toLocaleString("fr-FR")} jour${total > 1 ? "s" : ""}${r.created_by_rh ? " · Créée par les RH" : ""}</p></div><span class="v66-pill ${esc(r.status)}">${esc(leaveStatusLabels[r.status] || r.status)}</span></div><div class="v66-periods">${(
                r.leave_periods || []
              )
                .sort((a, b) => a.position - b.position)
                .map((p) => `<span>${esc(leavePeriodText(p))}</span>`)
                .join(
                  "",
                )}</div>${r.employee_comment ? `<p class="v66-help">${esc(r.employee_comment)}</p>` : ""}${r.rejection_reason ? `<div class="v66-info">Motif : ${esc(r.rejection_reason)}</div>` : ""}${actions ? `<div class="v66-actions" style="margin-top:12px">${actions}</div>` : ""}</article>`;
      };
      const cleanSearch = (value) =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      if (canReview) {
        list.innerHTML = `<input class="v66-search" id="v66LeaveSearch" placeholder="Rechercher un salarié par nom ou prénom…"><div id="v66LeaveGroups"></div>`;
        const groupsNode = list.querySelector("#v66LeaveGroups");
        const paintGroups = (query = "") => {
          const q = cleanSearch(query),
            filtered = requests.filter((r) =>
              cleanSearch(fullName(r.profiles)).includes(q),
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
          groupsNode.innerHTML = groups
            .map(
              (g) => `<section class="v66-leave-group" data-group="${g.id}"><div class="v66-leave-group-head"><div><h3>${g.title}</h3><small>${g.rows.length} demande${g.rows.length > 1 ? "s" : ""}</small></div>${g.rows.length > 1 ? `<button type="button" class="v66-btn" data-expand>Voir toutes</button>` : ""}</div><div class="v66-list">${g.rows.length ? g.rows.map((r, i) => `<div class="${i ? "v66-leave-extra" : ""}">${cardHtml(r)}</div>`).join("") : '<div class="v66-card v66-empty">Aucune demande.</div>'}</div></section>`,
            )
            .join("");
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
          (b.onclick = async () => {
            if (
              !confirm(
                b.dataset.leaveCancel === "cancelled"
                  ? "Annuler cette demande ?"
                  : "Envoyer une demande d’annulation aux RH ?",
              )
            )
              return;
            try {
              const { error } = await db
                .from("leave_requests")
                .update({
                  status: b.dataset.leaveCancel,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", b.closest("[data-id]").dataset.id);
              if (error) throw error;
              toast("Demande mise à jour.");
              await renderLeaves(root, monthOffset);
            } catch (e) {
              fail(e);
            }
          }),
      );
      }
    } catch (e) {
      root.querySelector("#v66LeaveList").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  function renderLeaveCalendar(node, first, last, requests, role, onSelect) {
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
                : `${fullName(r.profiles)} · ${leaveTypeLabels[r.leave_type]}`,
            );
        }),
      );
      const unavailable = weekend || holiday;
      cells.push(
        `${onSelect && !unavailable ? `<button type="button" data-leave-date="${key}" aria-label="Créer une demande pour le ${fmtDate(key)}"` : "<div"} class="v66-cal-day ${onSelect && !unavailable ? "selectable" : ""} ${weekend ? "weekend" : ""} ${holiday ? "holiday" : ""}"><b>${day}</b>${holiday ? `<span class="v66-holiday">${esc(holiday)}</span>` : ""}${people.map((x) => `<span class="v66-absence">${esc(x)}</span>`).join("")}${onSelect && !unavailable ? "</button>" : "</div>"}`,
      );
    }
    node.innerHTML = `${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((x) => `<div class="v66-cal-label">${x}</div>`).join("")}${cells.join("")}`;
    node.querySelectorAll("[data-leave-date]").forEach(
      (day) => (day.onclick = () => onSelect(day.dataset.leaveDate)),
    );
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
      paint("");
      root.querySelector("#v66StatsSearch").oninput = (e) =>
        paint(e.target.value);
    } catch (e) {
      root.querySelector("#v66Stats").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
  }

  async function renderLegacy(root) {
    root.innerHTML = `<div class="v66-pagehead"><div><h1>Fiches d’heures</h1><p>Saisie locale, synchronisation automatique et envoi aux RH.</p></div></div><div class="v66-card"><p class="v66-help">La fiche reste enregistrée sur ce téléphone en cas de coupure. Dès que le réseau revient, elle est copiée dans l’espace sécurisé.</p><div class="v66-actions" style="justify-content:flex-start"><button class="v66-btn primary" id="v66OpenLegacy">Ouvrir la saisie</button><button class="v66-btn" id="v66Sync">Synchroniser maintenant</button></div><div class="v66-message" id="v66SyncMessage"></div></div><div class="v66-list" id="v66MySheets" style="margin-top:12px"><div class="v66-card v66-empty">Chargement…</div></div>`;
    root.querySelector("#v66OpenLegacy").onclick = () => {
      location.href = "index.html";
    };
    root.querySelector("#v66Sync").onclick = async () => {
      const msg = root.querySelector("#v66SyncMessage");
      setMessage(msg, "Synchronisation…");
      try {
        const count = await syncLegacySheets();
        setMessage(msg, `${count} fiche(s) synchronisée(s).`, "ok");
        await loadMySheets(root);
      } catch (e) {
        setMessage(msg, e.message, "error");
      }
    };
    try {
      if (navigator.onLine) await syncLegacySheets();
      await loadMySheets(root);
    } catch (e) {
      root.querySelector("#v66MySheets").innerHTML =
        `<div class="v66-card v66-empty">${esc(e.message)}</div>`;
    }
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
    if (!["salarie", "conducteur"].includes(profile.role)) return 0;
    const sheets = localSheets();
    if (!sheets.length) return 0;
    const { data: projects, error: projectError } = await db
      .from("projects")
      .select("id,code,name");
    if (projectError) throw projectError;
    const byCode = new Map(
      projects.map((p) => [String(p.code).replace(/\W/g, "").toLowerCase(), p]),
    );
    const byName = new Map(
      projects.map((p) => [String(p.name).trim().toLowerCase(), p]),
    );
    for (const local of sheets) {
      const row = {
        employee_id: profile.id,
        iso_year: Number(local.year),
        iso_week: Number(local.week),
        observations: local.obs || "",
      };
      const { data: sheet, error } = await db
        .from("timesheets")
        .upsert(row, { onConflict: "employee_id,iso_year,iso_week" })
        .select("id,status")
        .single();
      if (error) throw error;
      const { error: deleteError } = await db
        .from("timesheet_days")
        .delete()
        .eq("timesheet_id", sheet.id);
      if (deleteError) throw deleteError;
      for (const day of local.days || []) {
        const workDate = isoDate(day.date);
        if (!workDate) continue;
        const legacyIt =
          !day.itZoneLabel && Number.isFinite(Number(day.it))
            ? Number(day.it)
            : 0;
        const { data: newDay, error: dayError } = await db
          .from("timesheet_days")
          .insert({
            timesheet_id: sheet.id,
            work_date: workDate,
            meal: Number(day.repas || 0),
            travel_km: legacyIt,
            it_zone_id: day.itZoneId || null,
            it_zone_label_snapshot: day.itZoneLabel || null,
            it_needs_review: !!day.itNeedsReview,
            establishment_id_snapshot: profile.establishment_id || null,
            tasks: day.tasks?.length ? day.tasks : day.task ? [day.task] : [],
            manual_task: day.manual || "",
            vehicle: day.vehicle || "",
            delivery_note: day.bon || "",
          })
          .select("id")
          .single();
        if (dayError) throw dayError;
        const sites = day.sites?.length
          ? day.sites
          : [
              {
                code: day.code || "",
                chantier: day.chantier || "",
                heures: day.heures ?? "",
              },
            ];
        const rows = sites
          .filter((s) => s.code || s.chantier || Number(s.heures || 0))
          .map((s, position) => {
            const hit =
              byCode.get(
                String(s.code || "")
                  .replace(/\W/g, "")
                  .toLowerCase(),
              ) ||
              byName.get(
                String(s.chantier || "")
                  .trim()
                  .toLowerCase(),
              );
            return {
              day_id: newDay.id,
              project_id: hit?.id || null,
              project_code_snapshot: s.code || hit?.code || "",
              project_name_snapshot: s.chantier || hit?.name || "",
              hours: Number(s.heures || 0),
              position,
            };
          });
        if (rows.length) {
          const { error: siteError } = await db
            .from("timesheet_sites")
            .insert(rows);
          if (siteError) throw siteError;
        }
      }
    }
    return sheets.length;
  }

  async function loadMySheets(root) {
    const { data, error } = await db
      .from("timesheets")
      .select("*")
      .eq("employee_id", profile.id)
      .order("iso_year", { ascending: false })
      .order("iso_week", { ascending: false });
    if (error) throw error;
    const box = root.querySelector("#v66MySheets");
    box.innerHTML = data.length
      ? data
          .map(
            (s) =>
              `<article class="v66-card v66-row" data-id="${s.id}"><div><strong>Semaine ${s.iso_week} — ${s.iso_year}</strong><small>Version ${s.version}${s.rejection_reason ? " · Motif : " + esc(s.rejection_reason) : ""}</small></div><div><span class="v66-pill ${esc(s.status)}">${esc({ draft: "Brouillon", submitted: "Envoyée", pending_review: "En attente RH", rejected: "Refusée", validated: "Validée", changed_after_validation: "Modifiée — à renvoyer" }[s.status] || s.status)}</span></div><div class="v66-actions">${["draft", "rejected", "changed_after_validation"].includes(s.status) ? '<button class="v66-btn primary" data-submit>Envoyer aux RH</button>' : ""}</div></article>`,
          )
          .join("")
      : '<div class="v66-card v66-empty">Aucune fiche synchronisée.</div>';
    box.querySelectorAll("[data-submit]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            const { error } = await db.rpc("submit_timesheet", {
              target_id: b.closest("[data-id]").dataset.id,
            });
            if (error) throw error;
            toast("Fiche envoyée aux RH.");
            await loadMySheets(root);
          } catch (e) {
            fail(e);
          } finally {
            b.disabled = false;
          }
        }),
    );
  }

  db.auth.onAuthStateChange(async (_event, nextSession) => {
    session = nextSession;
    try {
      await loadProfile();
    } catch (e) {
      console.error(e);
    }
    route();
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
  route();
}
