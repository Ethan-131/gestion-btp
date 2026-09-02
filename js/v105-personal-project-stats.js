import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.GESTION_BTP_SUPABASE || {};
if (!/^https:\/\/.+\.supabase\.co$/.test(cfg.url || "") || String(cfg.anonKey || "").length < 30) {
  console.warn("V105 statistiques personnelles : Supabase non configuré.");
} else {
  const db = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const PALETTE = ["#0a6b43", "#ef7f1a", "#3489db", "#c83b2b", "#9747b8", "#1da78e", "#f5bf09", "#344d63", "#6b8e23", "#8b5e3c"];
  let personalActive = false;
  let rendering = false;
  let cachedRows = null;
  let cachedUserId = null;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (value, digits = 1) => {
    const n = Number(value || 0);
    return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
  };
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const dateObj = (value) => new Date(`${value}T12:00:00`);
  const isoWeekKey = (value) => {
    const d = dateObj(value);
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
    return `${x.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
  };
  const projectKey = (site) => site.project_id || `${normalize(site.project_code_snapshot)}|${normalize(site.project_name_snapshot)}`;
  const projectLabel = (site) => site.project_name_snapshot || site.project_code_snapshot || "Chantier non renseigné";

  function injectStyles() {
    if (document.getElementById("v105PersonalStatsStyles")) return;
    const style = document.createElement("style");
    style.id = "v105PersonalStatsStyles";
    style.textContent = `
      .v105-personal-nav{position:relative}
      .v105-personal-page{display:grid;gap:18px}
      .v105-personal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
      .v105-personal-head h1{margin:0;color:#10251b}.v105-personal-head p{margin:6px 0 0;color:#6f7d75}
      .v105-private-pill{padding:8px 12px;border-radius:999px;background:#e3f3e9;color:#075f3b;font-size:12px;font-weight:800;white-space:nowrap}
      .v105-filter{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px;border:1px solid #d8e8de;border-radius:18px;background:#fff}
      .v105-filter label{display:grid;gap:7px;color:#075f3b;font-weight:800}.v105-filter select{width:100%;min-height:50px;padding:0 14px;border:1px solid #bfd6c8;border-radius:14px;background:#fff;font:inherit;font-weight:700;color:#111}
      .v105-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.v105-kpi{padding:20px;border:1px solid #d8e8de;border-radius:18px;background:#fff;text-align:center}.v105-kpi small{display:block;color:#707a74;font-weight:800}.v105-kpi strong{display:block;margin-top:8px;color:#076b42;font-size:28px}
      .v105-card{padding:22px;border:1px solid #d8e8de;border-radius:20px;background:#fff}.v105-card h2{margin:0;color:#087247;font-size:24px}.v105-card>p{margin:4px 0 16px;color:#7a837e}
      .v105-donut-wrap{display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:22px;align-items:center}.v105-donut{width:min(310px,72vw);aspect-ratio:1;border-radius:50%;margin:auto;position:relative;box-shadow:0 0 0 3px #eef5f1}.v105-donut:after{content:"";position:absolute;inset:31%;border-radius:50%;background:#fff}
      .v105-legend{display:grid;gap:8px}.v105-legend-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#f8fbf9}.v105-swatch{width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,0,0,.09)}.v105-legend-row b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v105-legend-row strong{color:#076b42;white-space:nowrap}
      .v105-bars{display:grid;gap:12px}.v105-bar-row{display:grid;grid-template-columns:minmax(150px,220px) 1fr 85px;gap:12px;align-items:center}.v105-bar-name{font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v105-bar-track{height:20px;border-radius:999px;background:#e8efeb;overflow:hidden}.v105-bar-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#087247,#22985f)}.v105-bar-value{text-align:right;color:#087247;font-weight:900}
      .v105-week-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.v105-week-box{padding:20px 12px;border:1px solid #d8e8de;border-radius:18px;background:#f9fcfa;text-align:center}.v105-week-box small{display:block;color:#717c76;font-weight:800}.v105-week-box strong{display:block;margin-top:7px;color:#087247;font-size:26px}.v105-week-box span{display:block;margin-top:3px;color:#7a837e}
      .v105-table{display:grid;gap:8px}.v105-table-row{display:grid;grid-template-columns:minmax(0,1.8fr) .65fr .6fr .6fr;gap:10px;align-items:center;padding:14px 16px;border-radius:14px;background:#f9fbfa;font-weight:800}.v105-table-row.head{background:#eef6f1;color:#076b42}.v105-table-row span:not(:first-child){text-align:center}.v105-empty{padding:30px;text-align:center;color:#6f7d75}
      @media(max-width:760px){.v105-personal-page{gap:14px}.v105-personal-head{align-items:center}.v105-private-pill{display:none}.v105-filter{padding:14px}.v105-kpis{grid-template-columns:1fr 1fr}.v105-kpi{padding:17px 10px}.v105-kpi strong{font-size:26px}.v105-card{padding:18px}.v105-card h2{font-size:22px}.v105-donut-wrap{grid-template-columns:1fr}.v105-donut{width:min(300px,78vw)}.v105-bar-row{grid-template-columns:minmax(120px,1fr) 1.4fr 68px;gap:8px}.v105-week-grid{grid-template-columns:1fr 1fr}.v105-table{overflow-x:auto}.v105-table-row{min-width:610px}}
      @media(max-width:420px){.v105-filter{grid-template-columns:1fr}.v105-kpi strong{font-size:23px}.v105-week-box strong{font-size:23px}.v105-bar-row{grid-template-columns:120px 1fr 62px}.v105-card{padding:15px}}
    `;
    document.head.appendChild(style);
  }

  async function currentProfile() {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) return null;
    const { data, error } = await db.from("profiles").select("id,role,status,first_name,last_name").eq("id", session.user.id).maybeSingle();
    if (error) throw error;
    return data;
  }

  function addNavButton(profile) {
    const nav = document.querySelector(".v66-nav");
    if (!nav || profile?.role !== "salarie" || profile?.status !== "active") return;
    if (nav.querySelector("[data-personal-project-stats]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "v105-personal-nav";
    button.dataset.personalProjectStats = "1";
    button.textContent = "Mes statistiques";
    button.addEventListener("click", () => {
      personalActive = true;
      nav.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
      renderPersonalStats(profile).catch(showFailure);
    });
    nav.appendChild(button);
  }

  async function loadRows(userId) {
    if (cachedRows && cachedUserId === userId) return cachedRows;
    const { data, error } = await db
      .from("timesheets")
      .select("id,iso_year,iso_week,status,timesheet_days(work_date,day_type,meal,travel_km,timesheet_sites(project_id,project_code_snapshot,project_name_snapshot,hours))")
      .eq("employee_id", userId)
      .order("iso_year", { ascending: true })
      .order("iso_week", { ascending: true });
    if (error) throw error;
    cachedUserId = userId;
    cachedRows = data || [];
    return cachedRows;
  }

  function flatten(rows) {
    const days = [];
    (rows || []).forEach((sheet) => {
      (sheet.timesheet_days || []).forEach((day) => {
        const sites = (day.timesheet_sites || []).filter((site) => Number(site.hours || 0) > 0 || site.project_id || site.project_name_snapshot || site.project_code_snapshot);
        days.push({
          date: day.work_date,
          dayType: day.day_type || "worked",
          meal: Number(day.meal || 0),
          travelKm: Number(day.travel_km || 0),
          sites,
        });
      });
    });
    return days;
  }

  function periodFilter(days, year, period) {
    const y = Number(year);
    return days.filter((day) => {
      const d = dateObj(day.date);
      return d.getFullYear() === y && (period === "all" || d.getMonth() === Number(period));
    });
  }

  function aggregate(days) {
    const byProject = new Map();
    const weeks = new Map();
    let hours = 0, meals = 0, it = 0;
    days.forEach((day) => {
      if (day.dayType !== "worked") return;
      const dayHours = day.sites.reduce((sum, site) => sum + Number(site.hours || 0), 0);
      hours += dayHours;
      meals += day.meal;
      it += day.travelKm;
      const wk = isoWeekKey(day.date);
      weeks.set(wk, (weeks.get(wk) || 0) + dayHours);
      let primary = null;
      day.sites.forEach((site) => {
        const key = projectKey(site);
        if (!key || key === "|") return;
        const item = byProject.get(key) || { key, name: projectLabel(site), code: site.project_code_snapshot || "", hours: 0, meals: 0, it: 0 };
        item.hours += Number(site.hours || 0);
        byProject.set(key, item);
        if (!primary || Number(site.hours || 0) > Number(primary.hours || 0)) primary = site;
      });
      if (primary) {
        const key = projectKey(primary);
        const item = byProject.get(key);
        if (item) { item.meals += day.meal; item.it += day.travelKm; }
      }
    });
    const projects = [...byProject.values()].sort((a, b) => b.hours - a.hours);
    const weekValues = [...weeks.entries()].filter(([, h]) => h > 0).sort((a, b) => a[0].localeCompare(b[0]));
    const avg = weekValues.length ? weekValues.reduce((s, [, h]) => s + h, 0) / weekValues.length : 0;
    const maxWeek = weekValues.length ? weekValues.reduce((a, b) => b[1] > a[1] ? b : a) : null;
    const minWeek = weekValues.length ? weekValues.reduce((a, b) => b[1] < a[1] ? b : a) : null;
    return { hours, meals, it, projects, weeks: weekValues, avg, maxWeek, minWeek };
  }

  function donutBackground(projects, total) {
    if (!projects.length || total <= 0) return "#e8efeb";
    let cursor = 0;
    const parts = projects.map((p, i) => {
      const start = cursor;
      cursor += (p.hours / total) * 100;
      return `${PALETTE[i % PALETTE.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    return `conic-gradient(${parts.join(",")})`;
  }

  function weekNumberLabel(key) {
    const [, week] = String(key || "").split("-");
    return week ? `Semaine ${Number(week)}` : "—";
  }

  function paint(root, allDays, selectedYear, selectedPeriod) {
    const filtered = periodFilter(allDays, selectedYear, selectedPeriod);
    const data = aggregate(filtered);
    const total = data.hours || 0;
    const maxProject = data.projects[0]?.hours || 1;
    const legend = data.projects.map((p, i) => `<div class="v105-legend-row"><span class="v105-swatch" style="background:${PALETTE[i % PALETTE.length]}"></span><b title="${esc(p.name)}">${esc(p.name)}</b><strong>${fmt(p.hours)} h · ${total ? Math.round((p.hours / total) * 100) : 0}%</strong></div>`).join("");
    const bars = data.projects.map((p) => `<div class="v105-bar-row"><span class="v105-bar-name" title="${esc(p.name)}">${esc(p.name)}</span><div class="v105-bar-track"><div class="v105-bar-fill" style="width:${Math.max(2, (p.hours / maxProject) * 100)}%"></div></div><span class="v105-bar-value">${fmt(p.hours)} h</span></div>`).join("");
    const detail = data.projects.map((p) => `<div class="v105-table-row"><span>${esc(p.name)}</span><span>${fmt(p.hours)} h</span><span>${fmt(p.meals, 0)}</span><span>${fmt(p.it, 0)}</span></div>`).join("");
    root.querySelector("#v105StatsBody").innerHTML = `
      <section class="v105-kpis">
        <div class="v105-kpi"><small>Heures</small><strong>${fmt(data.hours)} h</strong></div>
        <div class="v105-kpi"><small>Repas</small><strong>${fmt(data.meals, 0)}</strong></div>
        <div class="v105-kpi"><small>IT</small><strong>${fmt(data.it, 0)}</strong></div>
        <div class="v105-kpi"><small>Chantiers</small><strong>${data.projects.length}</strong></div>
      </section>
      ${data.projects.length ? `
      <section class="v105-card">
        <h2>Répartition du temps par chantier</h2><p>Part de vos heures passées sur chaque chantier</p>
        <div class="v105-donut-wrap"><div class="v105-donut" style="background:${donutBackground(data.projects, total)}"></div><div class="v105-legend">${legend}</div></div>
      </section>
      <section class="v105-card"><h2>Heures par chantier</h2><p>Répartition de vos heures enregistrées</p><div class="v105-bars">${bars}</div></section>
      <section class="v105-card"><h2>Résumé des semaines</h2><p>Calculé automatiquement à partir de vos fiches enregistrées</p><div class="v105-week-grid">
        <div class="v105-week-box"><small>Moyenne / semaine</small><strong>${fmt(data.avg)} h</strong></div>
        <div class="v105-week-box"><small>Semaines travaillées</small><strong>${data.weeks.length}</strong></div>
        <div class="v105-week-box"><small>Semaine la + chargée</small><strong>${data.maxWeek ? `${fmt(data.maxWeek[1])} h` : "—"}</strong><span>${data.maxWeek ? weekNumberLabel(data.maxWeek[0]) : ""}</span></div>
        <div class="v105-week-box"><small>Semaine la - chargée</small><strong>${data.minWeek ? `${fmt(data.minWeek[1])} h` : "—"}</strong><span>${data.minWeek ? weekNumberLabel(data.minWeek[0]) : ""}</span></div>
      </div></section>
      <section class="v105-card"><h2>Détail par chantier</h2><p>Vos heures, repas et IT. En cas de plusieurs chantiers le même jour, le repas et l’IT sont rattachés au chantier principal de la journée pour éviter les doublons.</p><div class="v105-table"><div class="v105-table-row head"><span>Chantier</span><span>Heures</span><span>Repas</span><span>IT</span></div>${detail}</div></section>` : `<section class="v105-card v105-empty">Aucune heure de chantier enregistrée sur cette période.</section>`}
    `;
  }

  async function renderPersonalStats(profile) {
    if (rendering) return;
    rendering = true;
    try {
      injectStyles();
      const root = document.querySelector("#v66Content");
      if (!root) return;
      root.innerHTML = `<div class="v105-personal-page"><div class="v105-personal-head"><div><h1>Mes statistiques chantier</h1><p>Vos statistiques personnelles, calculées uniquement à partir de vos fiches d’heures.</p></div><span class="v105-private-pill">Données personnelles</span></div><section class="v105-filter"><label>Année<select id="v105Year"></select></label><label>Période<select id="v105Period"><option value="all">Année complète</option>${MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("")}</select></label></section><div id="v105StatsBody"><section class="v105-card v105-empty">Calcul de vos statistiques…</section></div></div>`;
      const rows = await loadRows(profile.id);
      const allDays = flatten(rows);
      const years = [...new Set([...allDays.map((d) => dateObj(d.date).getFullYear()), new Date().getFullYear()])].sort((a, b) => b - a);
      const yearSelect = root.querySelector("#v105Year");
      const periodSelect = root.querySelector("#v105Period");
      yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
      yearSelect.value = String(years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[0]);
      periodSelect.value = "all";
      const repaint = () => paint(root, allDays, yearSelect.value, periodSelect.value);
      yearSelect.addEventListener("change", repaint);
      periodSelect.addEventListener("change", repaint);
      repaint();
    } finally {
      rendering = false;
    }
  }

  function showFailure(error) {
    console.error(error);
    const root = document.querySelector("#v66Content");
    if (root && personalActive) root.innerHTML = `<section class="v66-card v66-empty">Impossible de charger vos statistiques : ${esc(error?.message || "erreur inconnue")}</section>`;
  }

  async function enhance() {
    try {
      const profile = await currentProfile();
      if (!profile) return;
      addNavButton(profile);
      if (personalActive && !document.querySelector("#v105StatsBody") && profile.role === "salarie") await renderPersonalStats(profile);
    } catch (e) { console.warn("V105 statistiques personnelles", e); }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".v66-nav [data-page], #v66Settings")) personalActive = false;
  }, true);

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(enhance, 80);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("antras:local-sheets-changed", () => { cachedRows = null; });
  window.addEventListener("online", () => { cachedRows = null; });
  setTimeout(enhance, 300);
}
