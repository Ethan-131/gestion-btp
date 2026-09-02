V101 — Correctif affichage fiches d'heures

- Corrige le blocage « Chargement de la fiche actuelle… » apparu en V99.
- Si les colonnes it_km_plaisance / it_km_salies ne sont pas encore présentes dans Supabase, la fiche s'affiche quand même avec l'ancien IT unique comme secours.
- Un vrai message d'erreur s'affiche désormais dans la zone de fiche au lieu de laisser un chargement infini.
- Pour bénéficier des IT distincts Plaisance / Salies, exécuter SUPABASE_V99_IT_PAR_SIEGE.sql dans Supabase.
