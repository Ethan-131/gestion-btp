V109 — Hiérarchie des rôles

Hiérarchie :
1. Administrateur technique
2. Patron
3. RH / Direction
4. Conducteur de travaux
5. Salarié

Principales modifications :
- Réintroduction du rôle Patron dans toute l'interface.
- L'Administrateur technique a accès à toutes les pages et toutes les fonctions.
- Le mode « Aperçu test » est désormais réservé à tout compte Administrateur technique,
  et permet de simuler Patron, RH / Direction, Conducteur de travaux et Salarié sans
  modifier le rôle réel du compte.
- Patron et RH / Direction disposent des fonctions globales : comptes, congés/RTT,
  fiches salariés, chantiers et statistiques.
- Administrateur technique dispose des mêmes fonctions globales, avec en plus le mode test.
- Conducteur de travaux : accès aux chantiers qui lui sont attribués, à leurs statistiques
  et aux fiches liées à ses chantiers, sans gestion globale des comptes ni validation RH.
- Salarié : accès à ses propres fiches, congés/RTT et saisies uniquement.
- La création / modification de comptes respecte la hiérarchie :
  * Admin : tous les rôles
  * Patron : Patron, RH, Conducteur, Salarié
  * RH : RH, Conducteur, Salarié
- Les Conducteurs ne peuvent plus modifier un chantier : consultation et statistiques seulement.
- Patron/RH/Admin peuvent modifier et traiter les fiches des salariés.
- Cache PWA passé en V109.

IMPORTANT SUPABASE :
Exécuter SUPABASE_V109_ROLE_PATRON.sql avant d'attribuer le rôle Patron.
Le correctif V108 planned_hours reste nécessaire si ce fichier n'a pas déjà été exécuté.
