# Le Zinc Bouillon

Application de réservation pour le restaurant Le Zinc Bouillon : site client en français, programmation d’événements et tableau de bord établissement avec actualisation en direct.

## Démarrer en local

1. Installez Node.js 20 ou plus récent.
2. Dans ce dossier, lancez `npm install`.
3. Lancez `npm run dev`.
4. Ouvrez l’adresse Vite affichée dans le terminal (habituellement `http://localhost:5173`). Le tableau de bord est accessible sur `/admin`.

En production, le serveur Node sert le site, l’API et Socket.IO sur le même port. Les réservations et événements sont enregistrés dans le chemin défini par `DB_PATH` (par défaut `server/db.json`). `npm run build` compile le site ; `npm start` démarre le serveur.

## Tableau de bord

Le code de démonstration local est `1234`. Changez-le via la variable d’environnement `ADMIN_PIN` avant toute mise en ligne. Le code protège l’accès au tableau de bord par une session en mémoire ; cette version est un prototype mono-serveur, sans gestion de comptes, limitation de tentatives, TLS, envoi d’e-mails ou sauvegarde externe. Configurez ces protections avant un usage public.

Dans l’onglet Réservations, les demandes sont diffusées en temps réel par Socket.IO. Le navigateur peut afficher une notification système (autorisation explicite nécessaire) et émettre un signal sonore. L’onglet Événements permet de créer, modifier et supprimer les soirées, brunchs et autres rendez-vous ; ces événements sont visibles côté client et peuvent être associés à une réservation.

## Déploiement Render

Le fichier `render.yaml` configure un service Node à Francfort avec un disque persistant de 1 Go. Pour publier le site :

1. Poussez ce projet dans un dépôt GitHub privé ou public.
2. Dans Render, créez un **Blueprint** et reliez ce dépôt ; Render lira `render.yaml` et construira le service.
3. Saisissez un `ADMIN_PIN` personnel et robuste lorsque Render le demande. Ne réutilisez pas le code local `1234`.
4. Une fois le déploiement terminé, Render affichera l’adresse publique du site. Le tableau de bord sera disponible à cette même adresse avec `/admin`.

Le service Starter et le disque persistant Render peuvent entraîner des frais. La session admin est conservée en mémoire et les notifications navigateur ne fonctionnent que lorsque le dashboard est ouvert dans un navigateur autorisé.
