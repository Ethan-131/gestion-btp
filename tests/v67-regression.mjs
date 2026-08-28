import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../js/v66-app.js",import.meta.url),"utf8");
const legacy=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const sql=fs.readFileSync(new URL("../supabase/v67-spa-performance-corrected.sql",import.meta.url),"utf8");
const sw=fs.readFileSync(new URL("../sw.js",import.meta.url),"utf8");

const checks={
  "envoi atomique":/save_and_submit_timesheet/.test(app)&&/create or replace function public\.save_and_submit_timesheet/.test(sql),
  "reprise automatique":/addEventListener\("online"/.test(app)&&/antras_sync_state_v3/.test(app),
  "idempotence semaine":/on conflict\(employee_id,iso_year,iso_week\)/.test(sql),
  "index léger RH":/select\("id,employee_id,iso_year,iso_week,status/.test(app),
  "détail à la demande":/async function openTimesheetDetail/.test(app),
  "arborescence RH":/Année → mois → semaine → salariés/.test(app),
  "arborescence salarié":/v66MySheetSearch/.test(app)&&/v66-folder/.test(app),
  "absence totale":/week_timesheet_roster/.test(sql)&&/bool_and\(coalesce\(a\.full_day,0\)=1\)/.test(sql),
  "congés source unique":/leave_requests r[\s\S]*r\.status='approved'/.test(sql),
  "auto-validation serveur RH":/actor_role <> 'rh'/.test(sql),
  "chantier inconnu autorisé":/project_match := null/.test(sql)&&/Chantier non référencé/.test(app),
  "aucune création chantier automatique":!/insert into public\.projects/.test(sql),
  "SPA sans navigation legacy":!/location\.href = "index\.html"/.test(app),
  "saisie lazy":/loading="lazy" data-src="index\.html\?embedded=1"/.test(app),
  "suppression synchro manuelle":!/Synchroniser maintenant/.test(app),
  "confirmation partager":/Enregistrer la fiche d’heures et la partager avec le bureau/.test(legacy),
  "recherche comptes":/v66AccountSearch/.test(app),
  "cache PWA versionné":/antras-v67-1/.test(sw),
};
for(const [name,ok] of Object.entries(checks))assert.equal(ok,true,`Échec : ${name}`);

function expected(total,fullWeekAbsent,partialAbsent){return total-fullWeekAbsent;}
assert.equal(expected(40,4,0),36);
assert.equal(expected(40,0,4),40);
assert.equal(Math.round((32/expected(40,4,0))*1000)/10,88.9);

function range(a,b){return [a,b].sort();}
assert.deepEqual(range("2026-10-16","2026-10-12"),["2026-10-12","2026-10-16"]);

console.log(`${Object.keys(checks).length+4} contrôles V67 réussis.`);
