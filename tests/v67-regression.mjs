import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../js/v66-app.js",import.meta.url),"utf8");
const legacy=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const sql=fs.readFileSync(new URL("../supabase/v67-spa-performance-corrected.sql",import.meta.url),"utf8");
const settingsSql=fs.readFileSync(new URL("../supabase/v69-account-settings.sql",import.meta.url),"utf8");
const dayTypesSql=fs.readFileSync(new URL("../supabase/v80-timesheet-day-types.sql",import.meta.url),"utf8");
const pastLeavesSql=fs.readFileSync(new URL("../supabase/v84-block-past-leave-requests.sql",import.meta.url),"utf8");
const accountAccessSql=fs.readFileSync(new URL("../supabase/v86-account-access-management.sql",import.meta.url),"utf8");
const sw=fs.readFileSync(new URL("../sw.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../css/v66.css",import.meta.url),"utf8");

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
  "saisie plein écran stable":/v66-timesheet-modal/.test(app)&&/renderNativeCurrentTimesheet\(modal/.test(app),
  "suppression synchro manuelle":!/Synchroniser maintenant/.test(app),
  "confirmation partager":/Enregistrer la fiche d’heures et la partager avec le bureau/.test(legacy),
  "recherche comptes":/v66AccountSearch/.test(app),
  "cache PWA versionné":/antras-v93-1/.test(sw),
  "session sans double rendu":/authReady/.test(app)&&/_event === "INITIAL_SESSION"/.test(app)&&/_event === "TOKEN_REFRESHED"/.test(app),
  "accueil contextuel":/Comptes en attente/.test(app)&&/Chantiers en cours/.test(app)&&/Continuer ma fiche/.test(app),
  "recherche intelligente":/function smartSearchMatch/.test(app)&&/Aucun salarié trouvé/.test(app),
  "annulation harmonisée":/v66-cancel-action/.test(app)&&/Confirmer la demande d’annulation/.test(app),
  "actions fiche simplifiées":/Choisis une semaine ou complète directement/.test(app)&&/Mes fiches enregistrées/.test(app)&&!/id="v66OtherWeek"/.test(app),
  "paramètres personnels":/update_own_profile/.test(app)&&/Changer mon mot de passe/.test(app),
  "profil protégé côté serveur":/security definer/.test(settingsSql)&&/where id=auth\.uid\(\)/.test(settingsSql),
  "mot de passe oublié":/resetPasswordForEmail/.test(app)&&/PASSWORD_RECOVERY/.test(app),
  "semaine intégrée exacte":/requestedYear/.test(legacy)&&/requestedWeek/.test(legacy),
  "paramètres dans engrenage":/v66-settings-button/.test(app)&&/Paramètres du compte/.test(app),
  "déconnexion dans paramètres":/v66SettingsLogout/.test(app)&&!/id="v66Logout">Déconnexion/.test(app),
  "chantiers regroupés":/renderProjectHub/.test(app)&&/Gestion des chantiers/.test(app)&&/Statistiques chantiers/.test(app),
  "aucune validation fiche UI":!/data-review=/.test(app)&&!/\["review", "Validations"\]/.test(app),
  "alertes fiche":/timesheetWarnings/.test(app)&&/Fiche à vérifier/.test(app),
  "édition fiche RH":/data-save-sheet/.test(app)&&/Modifications RH enregistrées/.test(app),
  "rendu officiel partagé":/officialTimesheetMarkup/.test(app)&&/RAPPORT HEBDOMADAIRE - ANTRAS OSSATURE BOIS/.test(app)&&/v66-official-paper/.test(app),
  "purge locale unique":/antras_timesheet_global_purge_2026_08_29_v1/.test(app)&&/removeItem\("antras_saved_history_v2"\)/.test(app)&&/startsWith\("antras_draft_v1_"\)/.test(app),
  "entrée fiches unique":/Fiches d’heures salariés/.test(app)&&/Mes fiches enregistrées/.test(app)&&!/pages\.push\(\["team"/.test(app),
  "compteurs semaine cliquables":/data-week-filter="received"/.test(app)&&/data-week-filter="missing"/.test(app)&&/data-missing-count/.test(app),
  "semaine RH épurée":/Fiches reçues/.test(app)&&/Fiches manquantes/.test(app)&&/body\.innerHTML='<div class="v66-employee-list"><\/div>'/.test(app),
  "fiche actuelle native":/id="v66CurrentSheetPanel"/.test(app)&&/renderNativeCurrentTimesheet/.test(app)&&/v66-native-sheet/.test(app),
  "journée type d'origine":/Journée type/.test(app)&&/v66-template-code/.test(app)&&/v66-template-project/.test(app)&&/Appliquer à la semaine/.test(app)&&/Les tâches restent à compléter chaque jour/.test(app)&&/index===4\?friday:hours/.test(app),
  "code et chantier séparés":/v66-native-code/.test(app)&&/v66-native-project/.test(app)&&/Chaque chantier saisi doit avoir un code et un nom/.test(app),
  "format code chantier 2-2-3":/digits\.slice\(0,2\)/.test(app)&&/digits\.slice\(2,4\)/.test(app)&&/digits\.slice\(4,7\)/.test(app),
  "types de journées":/\["cp","Congé payé"\]/.test(app)&&/\["rtt","RTT"\]/.test(app)&&/\["holiday","Férié"\]/.test(app)&&/v66-day-watermark/.test(app),
  "types enregistrés serveur":/add column if not exists day_type/.test(dayTypesSql)&&/selected_day_type/.test(dayTypesSql)&&/day_type:dayType/.test(app),
  "compte rendu hebdomadaire":/Compte rendu de la semaine/.test(app)&&/v66-week-recap/.test(app)&&/v66-ro-recap/.test(app),
  "aucune application imbriquée":!/v66CurrentSheetPanel[^;]+<iframe/.test(app)&&!/index\.html\?embedded=1/.test(app),
  "ancien filtre retiré":!/id="v66SheetFilter"[^>]*<option/.test(app)&&/type="hidden" id="v66SheetFilter"/.test(app),
  "navigation semaines étendue":/id="v66TimesheetYear"/.test(app)&&/id="v66TimesheetWeek"/.test(app)&&/id="v66PreviousWeek"/.test(app)&&/id="v66NextWeek"/.test(app)&&/Semaine actuelle/.test(app)&&/length:81/.test(app),
  "calendrier congés actuel visible":/id="v66LeaveMonth"/.test(app)&&/id="v66LeaveYear"/.test(app)&&/Afficher cette période/.test(app)&&/calendarVisible = true/.test(app),
  "absences calendrier compactes":/people\.slice\(0,2\)/.test(app)&&/v66-absence-more/.test(app)&&/openAbsenceDayModal/.test(app)&&/v66-absence-count/.test(css),
  "journée type proportionnée":/grid-template-columns:145px minmax\(300px,1fr\)/.test(css),
  "dates de congé passées bloquées":/past = key < dateKey\(new Date\(\)\)/.test(app)&&/Impossible de demander une absence sur une date déjà passée/.test(app)&&/< current_date/.test(pastLeavesSql),
  "couleurs CP et RTT distinctes":/is-rtt/.test(app)&&/is-cp/.test(app)&&/v66-absence\.is-rtt/.test(css)&&/CP ·/.test(app),
  "comptes séparés et comptés":/Demandes d’accès/.test(app)&&/Comptes validés/.test(app)&&/v66-account-section-head/.test(app),
  "retrait accès sécurisé":/disable_account_access/.test(app)&&/Supprimer l’accès/.test(app)&&/is_rh_or_admin/.test(accountAccessSql)&&/status='disabled'/.test(accountAccessSql)&&/target_id = auth\.uid/.test(accountAccessSql),
  "panneau latéral comptes":/v66-account-drawer/.test(app)&&/v66-choice-tile/.test(app)&&/Enregistrer les modifications/.test(app)&&/v66DrawerIn/.test(css),
  "onglets demandes congés":/data-leave-tab="pending"/.test(app)&&/data-leave-tab="approved"/.test(app)&&/data-leave-tab="history"/.test(app)&&/v66-leave-manager/.test(css),
  "panneau détail congé":/v66-leave-drawer/.test(app)&&/Détail des journées/.test(app)&&/v66-drawer-days/.test(css),
  "panneaux latéraux larges":/width:max\(560px,34vw\)/.test(css),
  "confirmation modification compte":/Voulez-vous modifier les paramètres de/.test(app)&&/Aucune modification n’a été effectuée/.test(app),
  "recherche intelligente fiches salariés":/matchFilter&&smartSearchMatch\([\s\S]*?r\.first_name[\s\S]*?r\.last_name[\s\S]*?r\.email/.test(app),
  "sélecteur salarié avec suggestions":/v66EmployeeSuggestions/.test(app)&&/paintSuggestions/.test(app)&&/data-employee-id/.test(app)&&/v66-employee-suggestions/.test(css),
  "archives individuelles salarié":/showEmployeeArchive/.test(app)&&/Fiches enregistrées de/.test(app)&&/Voir tous les salariés/.test(app)&&/v66-employee-sheet-archive/.test(css),
  "suggestions intelligentes comptes":/v66AccountSuggestions/.test(app)&&/paintAccountSuggestions/.test(app)&&/data-account-suggestion/.test(app)&&/v66-account-picker/.test(css),
  "filtres période congés":/v66LeavePeriodMonth/.test(app)&&/v66LeavePeriodYear/.test(app)&&/overlapsSelectedPeriod/.test(app)&&/v66-leave-toolbar-period/.test(css),
  "confirmation compte Antras":/v66-confirm-overlay/.test(app)&&/Confirmer les modifications/.test(app)&&/roleChange/.test(app)&&/v66-confirm-card/.test(css),
  "chantiers sans paramètres IT":!/data-project-tab="it-settings"/.test(app)&&/Statistiques chantiers/.test(app),
  "formulaire chantier simplifié":/v66-project-drawer/.test(app)&&/Période prévisionnelle/.test(app)&&/automaticStatus/.test(app)&&/Cette affectation est facultative/.test(app)&&!/name="planned_days"/.test(app)&&!/name="actual_start_date"/.test(app),
};
for(const [name,ok] of Object.entries(checks))assert.equal(ok,true,`Échec : ${name}`);

function expected(total,fullWeekAbsent,partialAbsent){return total-fullWeekAbsent;}
assert.equal(expected(40,4,0),36);
assert.equal(expected(40,0,4),40);
assert.equal(Math.round((32/expected(40,4,0))*1000)/10,88.9);

function range(a,b){return [a,b].sort();}
assert.deepEqual(range("2026-10-16","2026-10-12"),["2026-10-12","2026-10-16"]);

console.log(`${Object.keys(checks).length+4} contrôles V67 réussis.`);
