import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg=window.GESTION_BTP_SUPABASE||{};
const configured=/^https:\/\/.+\.supabase\.co$/.test(cfg.url||'')&&String(cfg.anonKey||'').length>30;
const roleLabels={salarie:'Salarié',conducteur:'Conducteur de travaux',rh:'RH / Direction',admin:'Administrateur technique'};
const statusLabels={pending:'En attente',active:'Actif',rejected:'Refusé',disabled:'Désactivé',upcoming:'À venir',overdue:'En retard',completed:'Terminé',archived:'Archivé'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=value=>value?new Date(value+'T12:00:00').toLocaleDateString('fr-FR'):'—';
const el=(tag,attrs={},html='')=>{const n=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>k==='class'?n.className=v:n.setAttribute(k,v));n.innerHTML=html;return n};

if(!configured){
  const notice=el('div',{class:'v66-setup'},'<strong>V66 prête à être connectée.</strong> L’application actuelle reste disponible. Crée le projet Supabase puis renseigne <code>js/supabase-config.js</code> pour activer les comptes, rôles et chantiers.');
  document.body.appendChild(notice);
}else{
  boot(createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}));
}

async function boot(db){
  let session=null,profile=null,currentPage='home';
  const shell=el('div',{class:'v66-shell'});
  document.body.appendChild(shell);document.body.classList.add('v66-lock');
  const setMessage=(node,text,type='')=>{node.textContent=text||'';node.className='v66-message '+type};
  const toast=text=>{const n=el('div',{class:'v66-toast'},esc(text));document.body.appendChild(n);setTimeout(()=>n.remove(),3500)};
  const fail=e=>{console.error(e);toast(e?.message||'Une erreur est survenue.')};
  const fullName=p=>`${p?.first_name||''} ${p?.last_name||''}`.trim()||p?.email||'Compte';

  window.addEventListener('online',()=>{renderOffline();if(session&&profile?.status==='active')syncLegacySheets().catch(()=>{})});window.addEventListener('offline',()=>renderOffline());
  window.addEventListener('antras:local-sheets-changed',()=>{if(session&&profile?.status==='active'&&navigator.onLine)syncLegacySheets().catch(()=>{})});
  function renderOffline(){document.querySelector('.v66-offline')?.remove();if(!navigator.onLine){const n=el('div',{class:'v66-offline'},'Mode hors connexion — les données déjà chargées restent accessibles. La synchronisation reprendra automatiquement.');shell.prepend(n)}}

  async function loadProfile(){
    if(!session){profile=null;return}
    const {data,error}=await db.from('profiles').select('*').eq('id',session.user.id).single();
    if(error)throw error;profile=data;
  }

  function authScreen(mode='login'){
    shell.innerHTML=`<main class="v66-auth v66-card"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span></div><h1>${mode==='login'?'Connexion':'Demande de compte'}</h1><p>${mode==='login'?'Connecte-toi avec ton adresse professionnelle.':'Une RH devra confirmer ton compte et lui attribuer un rôle avant tout accès.'}</p><div class="v66-tabs"><button data-mode="login" class="${mode==='login'?'active':''}">Se connecter</button><button data-mode="register" class="${mode==='register'?'active':''}">Créer un compte</button></div><form class="v66-form" id="v66AuthForm">${mode==='register'?'<div class="v66-grid"><label class="v66-field">Prénom<input name="first_name" required autocomplete="given-name"></label><label class="v66-field">Nom<input name="last_name" required autocomplete="family-name"></label></div><label class="v66-field">Matricule (facultatif)<input name="employee_number"></label>':''}<label class="v66-field">E-mail<input name="email" type="email" required autocomplete="email"></label><label class="v66-field">Mot de passe<input name="password" type="password" minlength="8" required autocomplete="${mode==='login'?'current-password':'new-password'}"></label><button class="v66-btn primary" type="submit">${mode==='login'?'Se connecter':'Envoyer la demande'}</button></form><div id="v66AuthMessage" class="v66-message"></div></main>`;
    shell.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>authScreen(b.dataset.mode));
    shell.querySelector('#v66AuthForm').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,msg=shell.querySelector('#v66AuthMessage'),button=form.querySelector('button');button.disabled=true;setMessage(msg,'Traitement…');
      const values=Object.fromEntries(new FormData(form));
      try{
        if(mode==='login'){
          const {error}=await db.auth.signInWithPassword({email:values.email,password:values.password});if(error)throw error;
        }else{
          const {data,error}=await db.auth.signUp({email:values.email,password:values.password,options:{data:{first_name:values.first_name.trim(),last_name:values.last_name.trim(),employee_number:values.employee_number.trim()}}});if(error)throw error;
          if(!data.session){setMessage(msg,'Demande créée. Vérifie ton e-mail, puis connecte-toi.','ok');form.reset();return}
        }
      }catch(error){setMessage(msg,error.message,'error')}finally{button.disabled=false}
    };
  }

  function pendingScreen(){
    const rejected=profile.status==='rejected';
    shell.innerHTML=`<main class="v66-auth v66-card v66-pending"><span class="v66-pill ${esc(profile.status)}">${esc(statusLabels[profile.status]||profile.status)}</span><h1>${rejected?'Demande refusée':'Compte en attente de validation'}</h1><p>${rejected?`Motif : ${esc(profile.rejection_reason||'aucun motif renseigné')}`:'Une RH doit encore confirmer ton compte et choisir ton rôle. Aucune donnée de l’entreprise n’est accessible pendant cette attente.'}</p><div class="v66-actions" style="justify-content:center"><button class="v66-btn" id="v66Refresh">Actualiser</button><button class="v66-btn" id="v66Logout">Se déconnecter</button></div></main>`;
    shell.querySelector('#v66Refresh').onclick=async()=>{try{await loadProfile();route()}catch(e){fail(e)}};
    shell.querySelector('#v66Logout').onclick=()=>db.auth.signOut();
  }

  function route(){
    if(!session)return authScreen();
    if(!profile||profile.status!=='active'||!profile.role)return pendingScreen();
    appScreen();
  }

  function allowedPages(){
    const pages=[['home','Accueil']];
    if(profile.role==='rh')pages.push(['accounts','Comptes']);
    if(profile.role==='rh')pages.push(['review','Validations']);
    if(profile.role==='conducteur')pages.push(['team','Fiches équipes']);
    if(profile.role==='admin')pages.push(['team','Toutes les fiches']);
    if(['rh','admin'].includes(profile.role))pages.push(['projects','Chantiers']);
    if(['rh','admin'].includes(profile.role))pages.push(['stats','Statistiques']);
    pages.push(['legacy','Fiches d’heures']);
    return pages;
  }

  function appScreen(){
    const pages=allowedPages();if(!pages.some(x=>x[0]===currentPage))currentPage='home';
    shell.innerHTML=`<header class="v66-top"><div class="v66-brand"><img src="antras-logo.png" alt=""><span>Gestion BTP</span></div><div class="v66-user"><strong>${esc(fullName(profile))}</strong><span>${esc(roleLabels[profile.role])}</span></div></header><nav class="v66-nav">${pages.map(([id,label])=>`<button data-page="${id}" class="${id===currentPage?'active':''}">${esc(label)}</button>`).join('')}<button id="v66Logout">Déconnexion</button></nav><main class="v66-main" id="v66Content"></main>`;
    renderOffline();shell.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{currentPage=b.dataset.page;appScreen()});shell.querySelector('#v66Logout').onclick=()=>db.auth.signOut();
    const content=shell.querySelector('#v66Content');
    if(currentPage==='home')renderHome(content);if(currentPage==='accounts')renderAccounts(content);if(currentPage==='review')renderSharedSheets(content,true);if(currentPage==='team')renderSharedSheets(content,false);if(currentPage==='projects')renderProjects(content);if(currentPage==='stats')renderStats(content);if(currentPage==='legacy')renderLegacy(content);
  }

  function renderHome(root){
    root.innerHTML=`<section class="v66-page"><div class="v66-pagehead"><div><h1>Bonjour ${esc(profile.first_name||'')}</h1><p>Ton espace est adapté au rôle ${esc(roleLabels[profile.role])}.</p></div></div><div class="v66-stats"><div class="v66-stat"><small>Compte</small><strong>Actif</strong></div><div class="v66-stat"><small>Rôle</small><strong style="font-size:16px">${esc(roleLabels[profile.role])}</strong></div><div class="v66-stat"><small>Connexion</small><strong style="font-size:16px">${navigator.onLine?'En ligne':'Hors ligne'}</strong></div></div><div class="v66-card"><h2>Prochaine étape</h2><p class="v66-help">${profile.role==='rh'?'Valide les demandes de comptes, attribue les rôles, puis crée les chantiers.':profile.role==='admin'?'Configure les chantiers et contrôle les données techniques.':profile.role==='conducteur'?'Tu pourras consulter les fiches contenant au moins un chantier qui t’est attribué.':'Utilise la page Fiches d’heures pour saisir et envoyer ta semaine.'}</p></div></section>`;
  }

  async function renderAccounts(root){
    root.innerHTML='<div class="v66-pagehead"><div><h1>Comptes</h1><p>Validation RH et attribution du rôle initial.</p></div></div><div class="v66-card"><div class="v66-list" id="v66Accounts"><div class="v66-empty">Chargement…</div></div></div>';
    try{
      const {data,error}=await db.from('profiles').select('*').order('created_at',{ascending:false});if(error)throw error;
      const list=root.querySelector('#v66Accounts');list.innerHTML=data.length?data.map(p=>`<article class="v66-row" data-id="${p.id}"><div><strong>${esc(fullName(p))}</strong><small>${esc(p.email)}${p.employee_number?' · '+esc(p.employee_number):''}</small></div><div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status]||p.status)}</span><small>${esc(roleLabels[p.role]||'Rôle non attribué')}</small></div><div class="v66-actions">${p.status==='pending'?'<button class="v66-btn primary" data-approve>Valider</button><button class="v66-btn danger" data-reject>Refuser</button>':''}</div></article>`).join(''):'<div class="v66-empty">Aucun compte.</div>';
      list.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveAccount(b.closest('[data-id]').dataset.id,data));
      list.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rejectAccount(b.closest('[data-id]').dataset.id));
    }catch(e){root.querySelector('#v66Accounts').innerHTML=`<div class="v66-empty">${esc(e.message)}</div>`}
  }

  async function approveAccount(id,accounts){
    const conductors=accounts.filter(x=>x.status==='active'&&x.role==='conducteur');
    const modal=el('div',{class:'v66-modal'},`<form class="v66-card v66-form"><h2>Valider le compte</h2><label class="v66-field">Rôle<select name="role" required><option value="salarie">Salarié</option><option value="conducteur">Conducteur de travaux</option><option value="rh">RH / Direction</option><option value="admin">Administrateur technique</option></select></label><p class="v66-help">Les chantiers d’un conducteur pourront être attribués depuis la page Chantiers.</p><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Confirmer</button></div><div class="v66-message"></div></form>`);document.body.appendChild(modal);
    modal.querySelector('[data-close]').onclick=()=>modal.remove();modal.querySelector('form').onsubmit=async e=>{e.preventDefault();const msg=e.currentTarget.querySelector('.v66-message'),role=new FormData(e.currentTarget).get('role');try{const {error}=await db.from('profiles').update({status:'active',role,rejection_reason:null,approved_by:profile.id,approved_at:new Date().toISOString()}).eq('id',id).eq('status','pending');if(error)throw error;modal.remove();toast('Compte validé.');renderAccounts(shell.querySelector('#v66Content'))}catch(err){setMessage(msg,err.message,'error')}};
  }

  async function rejectAccount(id){const reason=prompt('Indique le motif du refus :');if(reason===null)return;if(!reason.trim()){toast('Un motif est obligatoire.');return}try{const {error}=await db.from('profiles').update({status:'rejected',rejection_reason:reason.trim(),role:null,approved_by:profile.id,approved_at:new Date().toISOString()}).eq('id',id).eq('status','pending');if(error)throw error;toast('Demande refusée.');renderAccounts(shell.querySelector('#v66Content'))}catch(e){fail(e)}}

  async function renderProjects(root){
    root.innerHTML='<div class="v66-pagehead"><div><h1>Chantiers</h1><p>Codes, dates, prévisionnel et conducteurs affectés.</p></div><button class="v66-btn primary" id="v66NewProject">Nouveau chantier</button></div><input class="v66-search" id="v66ProjectSearch" placeholder="Rechercher par code ou nom…"><div class="v66-list" id="v66Projects" style="margin-top:12px"><div class="v66-card v66-empty">Chargement…</div></div>';
    root.querySelector('#v66NewProject').onclick=()=>projectModal();
    try{
      const {data,error}=await db.from('projects').select('*,project_conductors(conductor_id,profiles!project_conductors_conductor_id_fkey(first_name,last_name))').order('code');if(error)throw error;
      const paint=q=>{const filtered=data.filter(p=>`${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase()));root.querySelector('#v66Projects').innerHTML=filtered.length?filtered.map(p=>`<article class="v66-card v66-row" data-id="${p.id}"><div><strong>${esc(p.code)} — ${esc(p.name)}</strong><small>${fmtDate(p.planned_start_date)} → ${fmtDate(p.planned_end_date)} · ${esc(p.planned_days)} jours / ${esc(p.planned_hours)} h</small></div><div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status]||p.status)}</span><small>${p.project_conductors?.length?esc(p.project_conductors.map(x=>fullName(x.profiles)).join(', ')):'Aucun conducteur'}</small></div><div class="v66-actions"><button class="v66-btn" data-edit>Modifier</button></div></article>`).join(''):'<div class="v66-card v66-empty">Aucun chantier trouvé.</div>';root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>projectModal(data.find(x=>x.id===b.closest('[data-id]').dataset.id)))};paint('');root.querySelector('#v66ProjectSearch').oninput=e=>paint(e.target.value);
    }catch(e){root.querySelector('#v66Projects').innerHTML=`<div class="v66-card v66-empty">${esc(e.message)}</div>`}
  }

  async function renderSharedSheets(root,canReview){
    root.innerHTML=`<div class="v66-pagehead"><div><h1>${canReview?'Validations RH':profile.role==='admin'?'Toutes les fiches':'Fiches de mes chantiers'}</h1><p>${canReview?'Fiches envoyées, modifiées, validées ou refusées.':profile.role==='admin'?'Accès technique à toutes les données.':'Lecture seule : identité, heures, repas, IT et tâches.'}</p></div></div><div class="v66-list" id="v66SharedSheets"><div class="v66-card v66-empty">Chargement…</div></div>`;
    try{
      let query=db.from('timesheets').select('id,iso_year,iso_week,status,rejection_reason,version,profiles!timesheets_employee_id_fkey(first_name,last_name,email),timesheet_days(work_date,meal,travel_km,tasks,manual_task,timesheet_sites(project_code_snapshot,project_name_snapshot,hours))').order('iso_year',{ascending:false}).order('iso_week',{ascending:false});
      if(canReview)query=query.in('status',['pending_review','changed_after_validation','validated','rejected']);
      const {data,error}=await query;if(error)throw error;const box=root.querySelector('#v66SharedSheets');
      box.innerHTML=data.length?data.map(s=>{const days=s.timesheet_days||[],hours=days.reduce((a,d)=>a+(d.timesheet_sites||[]).reduce((x,y)=>x+Number(y.hours||0),0),0),meals=days.reduce((a,d)=>a+Number(d.meal||0),0),it=days.reduce((a,d)=>a+Number(d.travel_km||0),0);return `<article class="v66-card" data-id="${s.id}"><div class="v66-pagehead"><div><strong>${esc(fullName(s.profiles))} · Semaine ${s.iso_week}/${s.iso_year}</strong><p>Version ${s.version}</p></div><span class="v66-pill ${esc(s.status)}">${esc({pending_review:'En attente RH',changed_after_validation:'Modifiée — à revalider',validated:'Validée',rejected:'Refusée'}[s.status]||s.status)}</span></div><div class="v66-stats"><div class="v66-stat"><small>Heures</small><strong>${hours.toLocaleString('fr-FR')} h</strong></div><div class="v66-stat"><small>Repas</small><strong>${meals.toLocaleString('fr-FR')}</strong></div><div class="v66-stat"><small>IT</small><strong>${it.toLocaleString('fr-FR')}</strong></div></div><div class="v66-list">${days.sort((a,b)=>a.work_date.localeCompare(b.work_date)).map(d=>`<div class="v66-row"><div><strong>${fmtDate(d.work_date)}</strong><small>${(d.timesheet_sites||[]).map(x=>`${esc(x.project_code_snapshot)} ${esc(x.project_name_snapshot)} — ${Number(x.hours||0).toLocaleString('fr-FR')} h`).join('<br>')||'Aucun chantier'}</small></div><div><small>Repas : ${esc(d.meal)} · IT : ${esc(d.travel_km)}</small><small>${esc([...(d.tasks||[]),d.manual_task].filter(Boolean).join(', ')||'Aucune tâche')}</small></div></div>`).join('')}</div>${canReview&&['pending_review','changed_after_validation'].includes(s.status)?'<div class="v66-actions" style="margin-top:12px"><button class="v66-btn danger" data-decision="rejected">Refuser</button><button class="v66-btn primary" data-decision="validated">Valider</button></div>':''}</article>`}).join(''):'<div class="v66-card v66-empty">Aucune fiche disponible.</div>';
      box.querySelectorAll('[data-decision]').forEach(b=>b.onclick=async()=>{const decision=b.dataset.decision,reason=decision==='rejected'?prompt('Motif du refus :')||'':'';if(decision==='rejected'&&!reason.trim())return;b.disabled=true;try{const {error}=await db.rpc('review_timesheet',{target_id:b.closest('[data-id]').dataset.id,decision,reason});if(error)throw error;toast(decision==='validated'?'Fiche validée.':'Fiche refusée.');await renderSharedSheets(root,canReview)}catch(e){fail(e)}finally{b.disabled=false}});
    }catch(e){root.querySelector('#v66SharedSheets').innerHTML=`<div class="v66-card v66-empty">${esc(e.message)}</div>`}
  }

  async function projectModal(project=null){
    let conductors=[];try{const {data,error}=await db.from('profiles').select('id,first_name,last_name,email').eq('status','active').eq('role','conducteur').order('last_name');if(error)throw error;conductors=data}catch(e){fail(e);return}
    const assigned=new Set((project?.project_conductors||[]).map(x=>x.conductor_id));
    const modal=el('div',{class:'v66-modal'},`<form class="v66-card v66-form"><h2>${project?'Modifier':'Créer'} un chantier</h2><div class="v66-grid"><label class="v66-field">Code chantier<input name="code" value="${esc(project?.code||'')}" required maxlength="30"></label><label class="v66-field">Nom du chantier<input name="name" value="${esc(project?.name||'')}" required></label><label class="v66-field">Jours prévus<input name="planned_days" type="number" min="0.01" step="0.01" value="${esc(project?.planned_days||'')}" required></label><label class="v66-field">Statut<select name="status">${['upcoming','active','overdue','completed','archived'].map(s=>`<option value="${s}" ${project?.status===s?'selected':''}>${esc(statusLabels[s])}</option>`).join('')}</select></label><label class="v66-field">Début prévu<input name="planned_start_date" type="date" value="${esc(project?.planned_start_date||'')}" required></label><label class="v66-field">Fin prévue<input name="planned_end_date" type="date" value="${esc(project?.planned_end_date||'')}" required></label><label class="v66-field">Début réel (facultatif)<input name="actual_start_date" type="date" value="${esc(project?.actual_start_date||'')}"></label><label class="v66-field">Fin réelle (facultatif)<input name="actual_end_date" type="date" value="${esc(project?.actual_end_date||'')}"></label></div><label class="v66-field">Conducteurs affectés<div class="v66-checkboxes">${conductors.length?conductors.map(c=>`<label><input type="checkbox" name="conductors" value="${c.id}" ${assigned.has(c.id)?'checked':''}> ${esc(fullName(c))}</label>`).join(''):'<span class="v66-help">Aucun conducteur actif.</span>'}</div></label><label class="v66-field">Notes internes<textarea name="internal_notes">${esc(project?.internal_notes||'')}</textarea></label><p class="v66-help">Conversion temporaire : 1 jour prévu = 7,8 h. Le nombre de jours saisi reste conservé séparément.</p><div class="v66-actions"><button type="button" class="v66-btn" data-close>Annuler</button><button class="v66-btn primary">Enregistrer</button></div><div class="v66-message"></div></form>`);document.body.appendChild(modal);modal.querySelector('[data-close]').onclick=()=>modal.remove();
    modal.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,msg=form.querySelector('.v66-message'),fd=new FormData(form),start=fd.get('planned_start_date'),end=fd.get('planned_end_date');if(end<start){setMessage(msg,'La date de fin doit être après la date de début.','error');return}const values={code:fd.get('code').trim(),name:fd.get('name').trim(),planned_days:Number(fd.get('planned_days')),status:fd.get('status'),planned_start_date:start,planned_end_date:end,actual_start_date:fd.get('actual_start_date')||null,actual_end_date:fd.get('actual_end_date')||null,internal_notes:fd.get('internal_notes').trim(),updated_by:profile.id};try{let id=project?.id;if(id){const {error}=await db.from('projects').update(values).eq('id',id);if(error)throw error}else{values.created_by=profile.id;const {data,error}=await db.from('projects').insert(values).select('id').single();if(error)throw error;id=data.id}const selected=fd.getAll('conductors');const {error:delError}=await db.from('project_conductors').delete().eq('project_id',id);if(delError)throw delError;if(selected.length){const {error}=await db.from('project_conductors').insert(selected.map(conductor_id=>({project_id:id,conductor_id,assigned_by:profile.id})));if(error)throw error}modal.remove();toast('Chantier enregistré.');renderProjects(shell.querySelector('#v66Content'))}catch(err){setMessage(msg,err.message,'error')}};
  }

  async function renderStats(root){
    root.innerHTML='<div class="v66-pagehead"><div><h1>Statistiques chantiers</h1><p>Prévisionnel comparé uniquement aux heures des fiches enregistrées.</p></div></div><input class="v66-search" id="v66StatsSearch" placeholder="Code ou nom du chantier…"><div id="v66Stats" class="v66-list" style="margin-top:12px"><div class="v66-card v66-empty">Calcul…</div></div>';
    try{
      const [{data:projects,error:pe},{data:sites,error:se}]=await Promise.all([db.from('projects').select('*').order('code'),db.from('timesheet_sites').select('project_id,hours')]);if(pe)throw pe;if(se)throw se;const actual=new Map();(sites||[]).forEach(s=>actual.set(s.project_id,(actual.get(s.project_id)||0)+Number(s.hours||0)));
      const paint=q=>{const rows=projects.filter(p=>`${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase()));root.querySelector('#v66Stats').innerHTML=rows.length?rows.map(p=>{const used=actual.get(p.id)||0,planned=Number(p.planned_hours||0),pct=planned?used/planned*100:0,kind=pct>100?'danger':pct>=80?'warn':'';return `<article class="v66-card"><div class="v66-pagehead"><div><strong>${esc(p.code)} — ${esc(p.name)}</strong><p>${fmtDate(p.planned_start_date)} → ${fmtDate(p.planned_end_date)}</p></div><span class="v66-pill ${esc(p.status)}">${esc(statusLabels[p.status]||p.status)}</span></div><div class="v66-stats"><div class="v66-stat"><small>Prévu</small><strong>${planned.toLocaleString('fr-FR')} h</strong></div><div class="v66-stat"><small>Réalisé</small><strong>${used.toLocaleString('fr-FR')} h</strong></div><div class="v66-stat"><small>Restant</small><strong>${Math.max(0,planned-used).toLocaleString('fr-FR')} h</strong></div><div class="v66-stat"><small>Consommé</small><strong>${pct.toFixed(1).replace('.',',')} %</strong></div></div><div class="v66-progress ${kind}"><span style="width:${Math.min(100,pct)}%"></span></div></article>`}).join(''):'<div class="v66-card v66-empty">Aucun chantier trouvé.</div>'};paint('');root.querySelector('#v66StatsSearch').oninput=e=>paint(e.target.value);
    }catch(e){root.querySelector('#v66Stats').innerHTML=`<div class="v66-card v66-empty">${esc(e.message)}</div>`}
  }

  async function renderLegacy(root){
    root.innerHTML=`<div class="v66-pagehead"><div><h1>Fiches d’heures</h1><p>Saisie locale, synchronisation automatique et envoi aux RH.</p></div></div><div class="v66-card"><p class="v66-help">La fiche reste enregistrée sur ce téléphone en cas de coupure. Dès que le réseau revient, elle est copiée dans l’espace sécurisé.</p><div class="v66-actions" style="justify-content:flex-start"><button class="v66-btn primary" id="v66OpenLegacy">Ouvrir la saisie</button><button class="v66-btn" id="v66Sync">Synchroniser maintenant</button></div><div class="v66-message" id="v66SyncMessage"></div></div><div class="v66-list" id="v66MySheets" style="margin-top:12px"><div class="v66-card v66-empty">Chargement…</div></div>`;
    root.querySelector('#v66OpenLegacy').onclick=()=>{location.href='index.html'};
    root.querySelector('#v66Sync').onclick=async()=>{const msg=root.querySelector('#v66SyncMessage');setMessage(msg,'Synchronisation…');try{const count=await syncLegacySheets();setMessage(msg,`${count} fiche(s) synchronisée(s).`,'ok');await loadMySheets(root)}catch(e){setMessage(msg,e.message,'error')}};
    try{if(navigator.onLine)await syncLegacySheets();await loadMySheets(root)}catch(e){root.querySelector('#v66MySheets').innerHTML=`<div class="v66-card v66-empty">${esc(e.message)}</div>`}
  }

  function localSheets(){try{return JSON.parse(localStorage.getItem('antras_saved_history_v2'))||[]}catch{return[]}}
  function isoDate(fr){const m=String(fr||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:null}
  async function syncLegacySheets(){
    if(!navigator.onLine)throw new Error('Pas de réseau : les fiches restent conservées sur cet appareil.');
    if(profile.role!=='salarie')return 0;
    const sheets=localSheets();if(!sheets.length)return 0;
    const {data:projects,error:projectError}=await db.from('projects').select('id,code,name');if(projectError)throw projectError;
    const byCode=new Map(projects.map(p=>[String(p.code).replace(/\W/g,'').toLowerCase(),p]));const byName=new Map(projects.map(p=>[String(p.name).trim().toLowerCase(),p]));
    for(const local of sheets){
      const row={employee_id:profile.id,iso_year:Number(local.year),iso_week:Number(local.week),observations:local.obs||''};
      const {data:sheet,error}=await db.from('timesheets').upsert(row,{onConflict:'employee_id,iso_year,iso_week'}).select('id,status').single();if(error)throw error;
      const {error:deleteError}=await db.from('timesheet_days').delete().eq('timesheet_id',sheet.id);if(deleteError)throw deleteError;
      for(const day of local.days||[]){
        const workDate=isoDate(day.date);if(!workDate)continue;
        const {data:newDay,error:dayError}=await db.from('timesheet_days').insert({timesheet_id:sheet.id,work_date:workDate,meal:Number(day.repas||0),travel_km:Number(day.it||0),tasks:day.tasks?.length?day.tasks:(day.task?[day.task]:[]),manual_task:day.manual||'',vehicle:day.vehicle||'',delivery_note:day.bon||''}).select('id').single();if(dayError)throw dayError;
        const sites=day.sites?.length?day.sites:[{code:day.code||'',chantier:day.chantier||'',heures:day.heures??''}];
        const rows=sites.filter(s=>s.code||s.chantier||Number(s.heures||0)).map((s,position)=>{const hit=byCode.get(String(s.code||'').replace(/\W/g,'').toLowerCase())||byName.get(String(s.chantier||'').trim().toLowerCase());return {day_id:newDay.id,project_id:hit?.id||null,project_code_snapshot:s.code||hit?.code||'',project_name_snapshot:s.chantier||hit?.name||'',hours:Number(s.heures||0),position}});
        if(rows.length){const {error:siteError}=await db.from('timesheet_sites').insert(rows);if(siteError)throw siteError}
      }
    }
    return sheets.length;
  }

  async function loadMySheets(root){
    const {data,error}=await db.from('timesheets').select('*').eq('employee_id',profile.id).order('iso_year',{ascending:false}).order('iso_week',{ascending:false});if(error)throw error;
    const box=root.querySelector('#v66MySheets');box.innerHTML=data.length?data.map(s=>`<article class="v66-card v66-row" data-id="${s.id}"><div><strong>Semaine ${s.iso_week} — ${s.iso_year}</strong><small>Version ${s.version}${s.rejection_reason?' · Motif : '+esc(s.rejection_reason):''}</small></div><div><span class="v66-pill ${esc(s.status)}">${esc({draft:'Brouillon',submitted:'Envoyée',pending_review:'En attente RH',rejected:'Refusée',validated:'Validée',changed_after_validation:'Modifiée — à renvoyer'}[s.status]||s.status)}</span></div><div class="v66-actions">${['draft','rejected','changed_after_validation'].includes(s.status)?'<button class="v66-btn primary" data-submit>Envoyer aux RH</button>':''}</div></article>`).join(''):'<div class="v66-card v66-empty">Aucune fiche synchronisée.</div>';
    box.querySelectorAll('[data-submit]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const {error}=await db.rpc('submit_timesheet',{target_id:b.closest('[data-id]').dataset.id});if(error)throw error;toast('Fiche envoyée aux RH.');await loadMySheets(root)}catch(e){fail(e)}finally{b.disabled=false}});
  }

  db.auth.onAuthStateChange(async(_event,nextSession)=>{session=nextSession;try{await loadProfile()}catch(e){console.error(e)}route()});
  const {data:{session:initial}}=await db.auth.getSession();session=initial;if(session){try{await loadProfile()}catch(e){fail(e)}}route();
}
