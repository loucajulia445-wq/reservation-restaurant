# Le Zinc Bouillon — réservation

Application dédiée aux réservations de tables, conçue pour être intégrée au site du restaurant. Le parcours client comporte trois étapes : choix de la date, de l’heure et du nombre de personnes ; saisie des coordonnées ; confirmation avec une référence de réservation.

L’identité visuelle s’inspire du [site du Zinc Bouillon Toulon](https://lezinc-toulon.com/) : fond sombre, logo blanc et accents rouges. Le logo est intégré localement dans `public/logo-zinc.svg`.

## Démarrer en local

1. Installez Node.js 20 ou plus récent.
2. Dans ce dossier, lancez `npm install`.
3. Lancez `npm run dev`.
4. Ouvrez l’adresse Vite affichée dans le terminal (habituellement `http://localhost:5173`).

Les réservations sont envoyées à l’API Express et enregistrées dans `server/db.json` (ou dans le chemin défini par `DB_PATH`). Pour compiler l’application, lancez `npm run build`. En production, `npm start` démarre le serveur Node qui sert l’API et le site.

## Déploiement Render

Le fichier `render.yaml` configure le déploiement du service Node avec un disque persistant. Reliez le dépôt à Render via un Blueprint ; le serveur Node servira le site et l’API sur la même adresse.
