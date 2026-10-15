# Ralentissement généralisé — VM 172.16.113.92

Diagnostic réel via HTTP et SSH le 15 octobre 2026. Le profilage local précédent n'avait pas reproduit ce problème.

## Cause vérifiée

- `docker stats` : 99,27 % de CPU pour le conteneur, sans saturation de RAM.
- Connexion TCP en 52 ms, mais réponses de l'API de santé en 489 à 2 551 ms, y compris en réutilisant la connexion.
- Capture du profil CPU pendant 8 secondes : 7 003 échantillons dans `bcryptjs._encipher`, 346 dans `_key`, sur 7 458 échantillons. La vérification des mots de passe monopolise presque tout le processus.
- Observation des requêtes par `diagnostics_channel`, sans enregistrer de mots de passe : **120 POST `/api/login` en 8 secondes**, avec seulement deux connexions Socket.IO.
- Les comptes utilisent tous un coût bcrypt de 10 ; ce n'est pas une augmentation accidentelle du coût de hachage. L'origine exacte de ce flux de connexions répétées n'a pas été déterminée.

## Correction et déploiement

Protection temporaire ciblée sur `/api/login` pour stabiliser le site, puis remplacement par le correctif testé dans l'image Docker :

- 30 tentatives de connexion par minute et par adresse IP, réponses 429 avec délai de réessai.
- Vérification et création des mots de passe dans un worker dédié ; la boucle événementielle HTTP ne calcule plus bcrypt pour les connexions et inscriptions.
- Un seul worker, au maximum huit travaux en cours ou en attente, et délai maximal d'exécution. Une surcharge est rejetée plutôt qu'accumulée sans limite.
- Algorithme, coût de hachage et mots de passe existants conservés. La requête de connexion ne charge plus les images et bannières des profils.
- Les corrections frontend préparées précédemment sont également présentes dans le conteneur : connexion temps réel partagée, panneau admin à la demande, rendu GPU des personnages et rafraîchissements Blackjack regroupés.

Sauvegardes SQLite cohérentes et copie du code précédent créées sous `/home/cgn/casino-backups/`. `.env` et volumes conservés. Aucune partie active détectée avant la recréation du service. Commande de mise en ligne : `docker compose up -d --no-build casino`, après construction de l'image.

## Vérifications après intervention

- API de santé : 38 à 119 ms ; accueil : 46 ms ; nouveaux fichiers JS : 38 et 98 ms ; CSS : 110 ms.
- `docker stats` : 0,00 % de CPU sur le relevé après intervention. C'est un instantané, pas une garantie de consommation constante.
- Connexion admin avec la configuration existante : HTTP 200, aucun secret affiché.
- SQLite `quick_check` : `ok` ; aucun compte ni historique de la sauvegarde manquant.
- 163 tests locaux réussis, dont nouveaux tests de compatibilité bcrypt, réactivité de la boucle événementielle, limitation de file et de tentatives de connexion. Les sessions déjà authentifiées restent utilisables lorsqu'un client atteint la limite de connexion.

Fichiers du correctif serveur : `server.js`, `password-service.js`, `password-worker.js`. Les copies sont dans le projet local et dans le répertoire de déploiement de la VM. Inclure ces fichiers lors de la prochaine publication Git pour conserver la protection dans les futurs déploiements CI.
