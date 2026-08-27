import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.GESTION_BTP_SUPABASE || {};
if (
  /^https:\/\/.+\.supabase\.co$/.test(cfg.url || "") &&
  String(cfg.anonKey || "").length > 30
) {
  const db = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { session },
  } = await db.auth.getSession();
  if (session) {
    const [{ data: profile }, { data, error }] = await Promise.all([
      db
        .from("profiles")
        .select("establishment_id")
        .eq("id", session.user.id)
        .single(),
      db
        .from("projects")
        .select(
          "code,name,status,project_it_zones(establishment_id,it_zone_id,it_zones(label))",
        )
        .neq("status", "archived")
        .order("name"),
    ]);
    if (!error) {
      window.antrasProjectCatalog = (data || []).map((project) => {
        const mapping = (project.project_it_zones || []).find(
          (item) => item.establishment_id === profile?.establishment_id,
        );
        return {
          code: project.code,
          name: project.name,
          itZoneId: mapping?.it_zone_id || "",
          itZoneLabel: mapping?.it_zones?.label || "",
          itMissing: !mapping,
        };
      });
      window.dispatchEvent(new CustomEvent("antras:project-catalog-ready"));
    }
  }
}
