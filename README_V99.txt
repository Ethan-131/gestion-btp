V99 — IT par siège

Avant publication :
1. Ouvrir Supabase > SQL Editor.
2. Exécuter SUPABASE_V99_IT_PAR_SIEGE.sql une seule fois.
3. Publier ensuite le contenu de V99-publication sur Netlify.

Modifications :
- Suppression du bouton « Importer la liste entreprise ».
- Chaque chantier possède maintenant deux kilométrages IT :
  • Plaisance-du-Touch / Menuiserie
  • Salies-du-Salat / Antras Ossature Bois
- Dans la fiche d'heures, l'IT est choisie automatiquement selon le siège de rattachement du salarié.
- Si le siège n'est pas reconnu ou si plusieurs chantiers du même jour ont des IT différentes, la fiche est signalée « IT à vérifier ».
- Les anciennes valeurs V98 sont copiées dans les deux nouveaux champs lors de la migration afin de ne perdre aucune donnée.
