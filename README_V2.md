# Gestion BTP — V2 (branche `v2-refactor`)

Cette branche prépare la refonte sans modifier la version actuellement utilisée sur `main`.

## Objectifs déjà intégrés

- 5 rôles métier :
  - Administrateur technique
  - Patron
  - Direction
  - Conducteur de travaux
  - Salarié
- Compatibilité avec l'ancien champ `role` pour éviter de casser les écrans historiques.
- Permissions séparées :
  - Administrateur : accès absolu et gestion de tous les rôles.
  - Patron : gestion des comptes et rôles non sensibles + accès fonctionnel complet.
  - Direction : accès fonctionnel complet sans gestion des comptes/rôles sensibles.
  - Conducteur : chantiers attribués, données liées à ses chantiers.
  - Salarié : données personnelles, fiches, congés/RTT, statistiques personnelles.
- RPC sécurisée `set_business_role_v2` avec journalisation dans `audit_log`.
- Protection contre la suppression du dernier Administrateur technique actif.
- Tableaux de bord adaptés au rôle.
- Navigation adaptée au rôle.
- Mode Aperçu test étendu aux 5 rôles.
- Statistiques normalisées à partir de `project_id` lorsque disponible.
- Traçabilité IT : valeur automatique, valeur manuelle, valeur revue par le bureau.
- Nouveau cache PWA V2 séparé.

## Migration Supabase obligatoire

Avant de tester cette branche, exécuter dans le SQL Editor :

`supabase/v2-roles-and-security.sql`

La migration conserve la colonne historique `role` et ajoute `business_role`, ce qui permet de continuer à faire fonctionner le code historique pendant la transition.

Après la migration, attribuer le premier administrateur technique :

```sql
update public.profiles
set business_role = 'admin'
where email = 'VOTRE_EMAIL';
```

## Architecture V2 ajoutée

- `js/v2-role-config.js` : matrice centrale des rôles et permissions.
- `js/v2-shell.js` : navigation, labels et aperçu des rôles.
- `js/v2-accounts.js` : attribution sécurisée des rôles dans la gestion des comptes.
- `js/v2-dashboard.js` : accueil différent selon le rôle.
- `supabase/v2-roles-and-security.sql` : migration rôles, RLS/RPC, vues statistiques et suivi IT.

## Principe de migration

La V2 ne réécrit pas brutalement les ~180 kB de logique actuelle dans `v66-app.js`. Elle introduit d'abord une couche métier stable et compatible. Les écrans seront ensuite déplacés progressivement dans des modules (`timesheets`, `projects`, `leaves`, `statistics`, `accounts`) après validation fonctionnelle.

Cela évite une régression globale sur les fiches d'heures, congés et statistiques déjà en production.

## À vérifier avant fusion dans `main`

1. Exécuter la migration Supabase.
2. Vérifier les 5 rôles avec Aperçu test.
3. Vérifier qu'un salarié ne voit que ses données.
4. Vérifier qu'un conducteur n'accède qu'aux chantiers qui lui sont attribués.
5. Vérifier que Direction ne peut pas gérer les comptes.
6. Vérifier que Patron peut gérer Direction / Conducteur / Salarié.
7. Vérifier que seul Administrateur peut créer/retirer Patron et Administrateur.
8. Vérifier validation fiches et congés pour Direction / Patron / Administrateur.
9. Vérifier IT automatique / manuel / revu bureau.
10. Vérifier les statistiques personnelles et les statistiques chantier.

La branche `main` reste inchangée jusqu'à validation de cette V2.
