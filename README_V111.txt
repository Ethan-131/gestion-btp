V111 — Refonte du détail Congés & RTT

- Un même écran de détail est utilisé pour tous les rôles.
- Panneau plus compact : suppression du grand espace vide.
- Résumé immédiat : type, période, durée, statut et date de demande.
- Détail des journées plus lisible avec journée complète / matin / après-midi.
- Commentaire compact quand il est vide.
- Historique de la demande à partir des dates disponibles dans la base.
- Actions adaptées au rôle :
  * Administrateur / Patron / RH : accepter, refuser, conserver une absence ou accepter son annulation.
  * Conducteur : consultation selon les droits existants, sans validation RH.
  * Salarié : annuler une demande en attente ou demander l’annulation d’une absence acceptée.
- Le Conducteur conserve la confidentialité existante : le type précis de l’absence d’un autre salarié est affiché comme « Absence ».
- Aucun nouveau SQL Supabase requis pour l’interface V111. Le correctif SQL V110 reste nécessaire pour accepter une annulation.
