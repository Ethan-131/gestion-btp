V98 — IT par kilomètre

1. Avant de publier la V98, ouvrir Supabase > SQL Editor.
2. Exécuter le fichier SUPABASE_V98_IT_KM.sql une seule fois.
3. Publier ensuite le contenu du dossier V98-publication sur Netlify.

Nouveau fonctionnement :
- Chaque chantier possède un nombre de kilomètres IT.
- Lorsqu'un salarié sélectionne/renseigne un chantier référencé dans sa fiche d'heures, l'IT se remplit automatiquement.
- Si plusieurs chantiers sont saisis le même jour avec le même kilométrage, l'IT est conservée automatiquement.
- Si plusieurs chantiers du même jour ont des kilométrages différents, la fiche est signalée à la RH pour décision.
- Les anciennes zones IT sont conservées en base uniquement pour l'historique, mais ne sont plus utilisées par la V98.
