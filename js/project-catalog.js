import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg=window.GESTION_BTP_SUPABASE||{};
if(/^https:\/\/.+\.supabase\.co$/.test(cfg.url||'')&&String(cfg.anonKey||'').length>30){
  const db=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data:{session}}=await db.auth.getSession();
  if(session){
    const {data,error}=await db.from('projects').select('code,name,status').neq('status','archived').order('name');
    if(!error){
      window.antrasProjectCatalog=(data||[]).map(project=>({code:project.code,name:project.name}));
      window.dispatchEvent(new CustomEvent('antras:project-catalog-ready'));
    }
  }
}
