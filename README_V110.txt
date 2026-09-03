V110 — Correctif annulation des congés / RTT

- Corrige le bouton « Accepter l’annulation » côté RH / Direction, Patron et Administrateur technique.
- Le statut cancellation_requested peut maintenant passer correctement à cancelled.
- « Conserver l’absence » remet correctement la demande au statut approved.
- Les décisions RH restent interdites aux rôles Conducteur de travaux et Salarié.
- Ajout d’une confirmation avant d’accepter une annulation.
- Le bouton affiche « Traitement… » pendant l’enregistrement pour éviter les doubles clics.
- En cas d’erreur Supabase, l’application affiche maintenant un message clair en français au lieu d’une erreur technique brute.
- Le cache PWA passe en V110.

IMPORTANT :
Exécuter SUPABASE_V110_ANNULATION_CONGES.sql dans Supabase > SQL Editor avant de tester le bouton.
