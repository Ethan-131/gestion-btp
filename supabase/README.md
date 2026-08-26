# Configuration Supabase — Gestion BTP V66

1. Créer un projet Supabase vide.
2. Ouvrir **SQL Editor** et exécuter `schema.sql`.
3. Dans **Authentication > URL Configuration**, ajouter :
   - `https://ethan-131.github.io/gestion-btp/`
   - `http://localhost:8080/` pour les essais locaux.
4. Copier `js/supabase-config.example.js` vers `js/supabase-config.js`.
5. Renseigner l'URL du projet et la clé **publishable/anon**.
6. Ne jamais copier la clé `service_role` dans GitHub ou dans le navigateur.
7. Créer le premier compte depuis l'application, puis exécuter la commande de promotion RH indiquée à la fin du schéma.

Les règles RLS du schéma protègent les données côté serveur. Les contrôles d'interface ne les remplacent pas.
