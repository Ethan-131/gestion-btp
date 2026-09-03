V108 — Correctif enregistrement chantier / planned_hours

- Corrige l'erreur PostgreSQL : column "planned_hours" can only be updated to DEFAULT.
- Ajoute la migration SUPABASE_V108_PLANNED_HOURS.sql à exécuter dans Supabase > SQL Editor.
- La migration conserve les valeurs existantes et rend planned_hours modifiable.
- Les erreurs techniques Supabase ne sont plus affichées brutes en anglais dans le formulaire chantier.
- Un message utilisateur en français est affiché à la place, tandis que le détail reste dans la console développeur.
- Cache PWA passé en V108.
