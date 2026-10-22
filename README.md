# Le Zinc Bouillon — réservation

Application dédiée aux réservations de tables, conçue pour être intégrée au site du restaurant. Le parcours client comporte trois étapes : choix de la date, de l’heure et du nombre de personnes ; saisie des coordonnées ; confirmation avec une référence de réservation.

L’identité visuelle s’inspire du [site du Zinc Bouillon Toulon](https://lezinc-toulon.com/) : fond sombre, logo blanc et accents rouges. Le logo est intégré localement dans `public/logo-zinc.svg`.

## Démarrer en local

1. Installez Node.js 20 ou plus récent.
2. Dans ce dossier, lancez `npm install`.
3. Lancez `npm run dev`.
4. Ouvrez l’adresse Vite affichée dans le terminal (habituellement `http://localhost:5173`).

Les réservations sont envoyées à l’API Express et enregistrées dans `server/db.json` (ou dans le chemin défini par `DB_PATH`). Pour compiler l’application, lancez `npm run build`. En production, `npm start` démarre le serveur Node qui sert le site et l’API.

## Espace créateurs et alertes e-mail

Cliquez sur le petit point caché en bas à droite du logo pour ouvrir l’accès créateurs. Le PIN local par défaut est `1304` ; vous pouvez le remplacer avec `CREATOR_PIN`. Il ouvre un espace privé avec les réservations mises à jour en direct et le réglage de l’adresse de notification. Les PIN de démonstration ne sont pas une protection suffisante pour un déploiement public : utilisez un code privé, activez HTTPS et prévoyez une protection contre les tentatives répétées.

Les notifications utilisent l’API [Resend](https://resend.com/). Pour réellement recevoir un e-mail, créez une clé API, vérifiez un domaine/adresse d’expédition dans Resend, puis configurez `RESEND_API_KEY` et `RESEND_FROM_EMAIL` dans l’environnement du serveur (ou dans les variables Render). Saisissez ensuite l’adresse de réception dans l’espace créateurs. Si Resend n’est pas configuré ou refuse un envoi, la réservation reste enregistrée et le client voit un avertissement ; la raison est aussi inscrite dans les journaux du serveur.

## Déploiement Render

Le fichier `render.yaml` configure le déploiement du service Node avec un disque persistant et demande les variables secrètes du créateur et de Resend. Reliez le dépôt à Render via un Blueprint ; renseignez `CREATOR_PIN`, `RESEND_API_KEY` et `RESEND_FROM_EMAIL` dans Render. Le serveur Node servira le site et l’API sur la même adresse.
