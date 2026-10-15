# Corrections des ralentissements — 15 octobre 2026

Diagnostic dans Chrome headless, profil neuf, serveur local et base SQLite temporaire. Aucun compte de la VM utilisé. Les observations ne constituent pas une mesure de la VM Debian.

## Problèmes corrigés

- Chaque page ouvrait plusieurs connexions Socket.IO : chat, Crash et Plinko utilisaient chacun une connexion. `realtime.js` mutualise la connexion pour les jeux et le chat. Les abonnements attendent `session:ready`, y compris après reconnexion et lorsqu'un module utilise une connexion déjà ouverte.
- Le panneau administrateur chargeait comptes, banque, supervision, paramètres et journal dès l'accueil. Ces données sont maintenant chargées à l'ouverture du panneau.
- Les classements complet et miniature lançaient la même requête simultanément. Ils partagent maintenant la requête en cours.
- `initializeApp` attendait les réponses Crash avant de brancher les commandes des autres jeux. Une réponse Crash lente ne retarde plus leur initialisation.
- Les notifications socket et le polling Blackjack pouvaient lancer plusieurs lectures concurrentes de la même table. Elles sont regroupées, avec un rafraîchissement supplémentaire si une notification arrive pendant une lecture. La protection contre les réponses précédant une action confirmée est conservée.
- Les scripts, styles et assets publics traversaient le middleware de session SQLite : lecture et mise à jour de session même pour des fichiers publics. Ils sont servis avant ce middleware. L'authentification des API et des pages de jeu reste en place.
- Le profil du lobby FPS montrait `character` parmi les principaux coûts JavaScript : transformation de tous les sommets et envoi de la géométrie à chaque image. Les maillages sont maintenant envoyés une fois par skin/pose et transformés par le GPU. Positions, normales, éclairage et géométrie sont conservés.

## Mesures observées

| Observation locale | Avant | Après |
| --- | ---: | ---: |
| Connexions temps réel sur l'accueil | 3 | 1 |
| Requêtes admin au chargement de l'accueil | 5 | 0 |
| Requêtes simultanées de classement au démarrage | 2 | 1 |
| Temps JavaScript du lobby FPS sur une fenêtre de 5 s | 0,499 s | 0,126 s |
| Temps total de tâches navigateur du lobby FPS sur 5 s | 0,779 s | 0,238 s |

Le temps JavaScript du lobby diminue d'environ 75 % dans cet essai. Cela ne représente ni une hausse équivalente des images par seconde, ni une baisse mesurée du CPU du serveur. L'accueil avec une base neuve ne présentait pas de boucle JavaScript intensive ; le gel signalé n'a pas été reproduit localement. Une saturation de la VM ou des délais réseau restent possibles et nécessitent une mesure sur l'installation concernée.

Sources brutes : `browser-before.json`, `browser-after.json`, `browser-fps-before.json`, `browser-fps-after.json`, `browser-smoke.json`.

## Vérifications

160 tests réussis, dont tests ajoutés pour la connexion partagée, les abonnements/reconnexions, le démarrage indépendant d'une réponse Crash lente et l'équivalence des transformations GPU. Un maillage inchangé n'est téléversé qu'une fois sur trois rendus consécutifs dans le test GPU.

Test dans Chrome : ouverture du panneau administrateur, création et chargement d'une table Blackjack, démarrage d'une manche, réception des deux cartes du croupier et action « Rester ». Aucune exception JavaScript détectée pendant ce parcours. Le profil Chrome du lobby FPS ne rapporte pas non plus d'exception.

Relance depuis le dépôt, avec Chrome installé : `node scripts/diagnose-browser.cjs browser-report.json`. `CHROME_PATH` permet d'indiquer un autre exécutable ; `PERF_FPS=true` ajoute le profil FPS et `BROWSER_SMOKE=true` ajoute le parcours admin/Blackjack. Le test utilise une base et un profil temporaires, pas les données du casino.
