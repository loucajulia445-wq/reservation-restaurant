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

Le client reçoit d’abord un e-mail accusant réception de sa demande. Si la réservation est toujours en attente, le serveur la confirme automatiquement après trois minutes et envoie un second e-mail de confirmation. Si elle est confirmée manuellement avant ce délai, l’e-mail de confirmation est envoyé immédiatement. Les confirmations en attente sont reprises après un redémarrage du serveur.

### Configuration locale de Resend

1. Dans Resend, créez une API key et vérifiez le domaine ou l’adresse qui servira d’expéditeur.
2. À la racine du projet, copiez `.env.example` en `.env`.
3. Dans `.env`, remplacez `re_remplacer_par_votre_cle` par la clé Resend, et `reservations@votre-domaine-verifie.fr` par votre adresse expéditeur vérifiée. Gardez les noms `RESEND_API_KEY` et `RESEND_FROM_EMAIL`.
4. Enregistrez `.env`, arrêtez le serveur de développement avec `Ctrl+C`, puis relancez `npm run dev`.
5. Ouvrez la page créateurs, saisissez votre adresse de réception et cliquez sur **ENREGISTRER**.

Ne collez jamais la clé dans `src/`, `index.html`, ou une variable `VITE_*` : elle doit rester uniquement côté serveur. Le fichier `.env` est ignoré par Git. Sans expéditeur vérifié et clé valide, Resend ne peut pas envoyer. Si l’envoi échoue, la réservation reste enregistrée et le client voit un avertissement ; la raison est inscrite dans les journaux du serveur.

## Déploiement Render

Le fichier `render.yaml` configure le serveur Express et son disque persistant. Pour un déploiement avec l’interface sur Vercel, reliez d’abord le dépôt à Render via un Blueprint et renseignez dans Render (**Dashboard → votre service → Environment**) les variables `CREATOR_PIN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` et `CORS_ALLOWED_ORIGINS`. Cette dernière doit contenir l’origine publique exacte de Vercel, par exemple `https://votre-projet.vercel.app` (sans chemin ni barre finale). Ajoutez aussi tout domaine personnalisé utilisé par le site, séparé par une virgule. Sur Render, ne téléversez pas le fichier `.env`.

Dans Vercel, importez le même dépôt et ajoutez la variable d’environnement `VITE_API_URL` avec l’URL publique de votre service Render, par exemple `https://le-zinc-bouillon.onrender.com` (sans `/api` et sans barre finale). Vercel utilise `vercel.json` pour compiler et publier `dist`. Enregistrez la variable puis relancez un déploiement afin qu’elle soit incluse dans le site. L’API, la connexion créateurs, les e-mails et les réservations continuent de tourner sur Render ; le disque Render conserve les données.

Pour vérifier le raccordement, ouvrez `https://votre-service.onrender.com/api/health` : la réponse doit contenir `{"ok":true}`. Si le site Vercel ne peut toujours pas joindre l’API, vérifiez que l’adresse Render est exacte et que l’origine Vercel figure dans `CORS_ALLOWED_ORIGINS` sur Render, puis redéployez les deux services après modification de leurs variables.
