# Audit et optimisations — 15 octobre 2026

Les changements visent le travail inutile, sans modifier les tirages, multiplicateurs, durées de jeu, mises, gains ou données des comptes. Aucun déploiement sur la VM ni accès à sa base n'a été effectué.

## Audit : causes identifiées et traitement

| Fichier / fonction | Observation avant modification | Traitement |
| --- | --- | --- |
| `server.js` / `initializeCrashGame`, `broadcastCrashState` | Timer de 200 ms permanent ; pendant une partie, lecture d'un état personnalisé pour chaque connexion du casino à chaque passage. Chaque état nécessite plusieurs requêtes SQL. | Timer démarré à la première manche et arrêté après le règlement de la dernière. Room `crash:watchers`, abonnement/désabonnement explicites. Envoi aux changements de phase et aux actions ; interpolation visuelle conservée dans le navigateur. État calculé une fois par utilisateur lors d'un envoi, même avec plusieurs onglets. |
| `fps.js` / `registerFps` | Intervalle de 50 ms même sans aucun salon ; snapshots complets en attente à 20 Hz. | Aucun timer sans salon. Attente à 1 Hz, simulation en match toujours à 20 Hz. Dernier départ : salon supprimé et timer arrêté. Déconnexions étrangères au lobby sans diffusion de présence. |
| `horse-racing.js` / timer de règlement | Chaque seconde, transaction et deux recherches d'échéances, même sans course. Cela explique les 24 appels SQLite observés sur 6 secondes au repos. | `deadline-scheduler.js` : prochaine échéance persistée, réveil à cette échéance et recalcul après les mutations. Reprise des échéances au démarrage. Règlements atomiques existants conservés, y compris sans client connecté. |
| `tower.js` / `sweep` | Expiration toutes les 30 s ; risque d'empiler des opérations si un passage dure trop longtemps. | Fréquence conservée, passage concurrent interdit, index partiel sur les échéances actives. Aucun changement aux placements ou gains. |
| `underground/js/crash.js` | Poll HTTP toutes les secondes en parallèle du socket, y compris lorsqu'il fonctionne. | HTTP de secours si socket déconnecté ; abonnement uniquement quand la vue est active. Rechargement de l'état lors du retour dans le jeu. |
| `underground/js/blackjack.js`, `poker.js` | Listes interrogées toutes les 2,5 s dans les autres vues du casino. | Rafraîchissement périodique seulement si la vue est affichée ou si une table est déjà rejointe ; aucun polling en onglet masqué. |
| `underground/js/blackjack-game.js`, `poker-game.js`, `horses.js`, `admin.js` | Rafraîchissements périodiques de pages masquées ou du panneau admin fermé. | Polling conditionné à la visibilité ; administration périodique uniquement dans sa vue. Le serveur continue les parties. |
| `underground/js/fps.js` / `frame`, `radar`, `text`, `renderFeed` | Rendu lobby à chaque frame ; carte fixe reparcourue à chaque frame ; textes et journal DOM reconstruits sans changement. | Lobby à 30 images/s, match conservé en requestAnimationFrame. Pas de simulation/rendu local en onglet masqué. Radar à 10 Hz ; textes écrits seulement si différents ; journal reconstruit seulement lorsque son contenu change. |
| `underground/js/fps-shared.js` / `rayWorld` | Les six plans de chaque obstacle sont reconstruits à chaque rayon de tir ou test de grenade. | Plans préparés une seule fois pour la carte statique ; parcours et calcul d'intersection inchangés. Comparaison exacte avec l'ancien algorithme sur 2 000 rayons (distances et normales). |
| `underground/js/general-chat.js` / `refresh` | Historique de 100 messages : reconstruction de toute la liste à chaque message reçu dans un lot, puis une fois supplémentaire. | Fusion du lot, un seul rendu de l'historique. Les nouveaux messages socket restent affichés immédiatement. |
| SQLite / historiques et courses actives | Recherches répétées par utilisateur et par échéance, sans index correspondants dans plusieurs tables. | Index additifs décrits ci-dessous ; attente de verrou à 5 s. Ni réinitialisation, ni changement de mode journal, ni relâchement des garanties de transaction. |
| `compose.yaml`, `.dockerignore`, `.github/workflows/deploy.yaml` | Logs Docker sans rotation ; exclusion des fichiers SQLite ne couvrant pas leurs fichiers auxiliaires. | Logs bornés à 3 × 5 Mo ; fichiers SQLite auxiliaires exclus du contexte Docker et protégés du rsync de déploiement. Volume `casino-data` conservé. |

Les assets FPS sont déjà chargés dans la page FPS, avec modèle précompressé : 6 975 840 octets brut, 1 115 685 octets gzip. Aucun changement de format ou compression à la volée coûteuse n'a été ajouté. L'arène statique utilise déjà un buffer WebGL ; les modèles de personnages sont déjà mis en cache. Aucun moteur SWARM actif n'a été identifié dans le serveur actuellement enregistré. Les fichiers historiques CRS n'ont pas été supprimés.

La simulation FPS reste à 20 Hz ; aucun changement de collisions, dégâts, hitboxes ou projectiles. Les snapshots en match restent complets : introduire des deltas avec des émissions volatiles demande un protocole de resynchronisation testé, et n'est pas nécessaire pour supprimer les coûts au repos identifiés ici.

## SQLite

Index ajoutés avec `CREATE INDEX IF NOT EXISTS` dans `initDatabase` :

- `history_user_recent(user_id, id DESC)` : historique récent et agrégats d'un compte.
- `crash_bets_user_recent(user_id, created_at DESC)` : dernier pari personnel.
- `crash_bets_round_active(round_id) WHERE status='active'` : règlement des paris d'une manche.
- `horse_running_deadline(ends_at_ms) WHERE status='running'` : réveil et règlement des courses.
- `horse_event_deadline(ends_at_ms) WHERE status='running'` : événements hippiques multijoueurs.
- `tower_expiry(expires_at) WHERE status IN ('PLAYING','PLACING')` : expiration des tours actives.

Les nouvelles structures occupent de l'espace disque et leur première création peut allonger le démarrage sur un historique volumineux. Les files de transactions, clés étrangères et règles d'idempotence existantes restent en place. WAL n'est pas activé automatiquement : son intérêt doit être mesuré sur la charge et le stockage de la VM, avec vérification de la chaîne de sauvegarde.

## Mesures réellement effectuées

Source : `performance-before.json`, `performance-after.json`. `performance-after-concurrent.json` conserve une autre exécution faite pendant des tests, pour rendre visible la variabilité.

Environnement : Windows, Node v24.21.0, AMD Ryzen AI 9 HX 370, 24 processeurs logiques. Ce n'est pas la VM Debian à 2 vCPU. Serveur isolé, comptes et sessions temporaires, aucun compte de production. Pour chaque scénario : environ 6 secondes. Le FPS utilise un client Socket.IO réel en polling, qui se déplace et tire ; Crash reçoit un vrai pari avec son tirage habituel, puis le client se déconnecte. Le tirage Crash n'est pas forcé : la durée active peut varier entre exécutions. Mesure HTTP : 40 requêtes authentifiées séquentielles à `/api/me`.

Le CPU est celui du processus serveur rapporté à **un cœur**, pas à la totalité de la machine. Les timers sont les timers JS instrumentés par le preload du benchmark, pas tous les handles internes de libuv. SQLite compte les appels `run/get/all`, y compris transactions. La RAM est le RSS du processus serveur ; le client de charge est un autre processus.

| Mesure | Avant | Après |
| --- | ---: | ---: |
| idle : CPU | 0 % | 0 % |
| idle : RSS | 62.68 MiB | 61.39 MiB |
| idle : Timers JS | 7 | 4 |
| idle : Connexions Socket.IO | 0 | 0 |
| idle : Appels SQLite / ~6 s | 24 | 0 |
| fps-solo-moving-firing : CPU | 2.08 % | 5.981 % |
| fps-solo-moving-firing : RSS | 70.85 MiB | 70.52 MiB |
| fps-solo-moving-firing : Timers JS | 7 | 5 |
| fps-solo-moving-firing : Connexions Socket.IO | 1 | 1 |
| fps-solo-moving-firing : Appels SQLite / ~6 s | 24 | 0 |
| crash-connected : CPU | 2.081 % | 0.766 % |
| crash-connected : RSS | 65.36 MiB | 70.45 MiB |
| crash-connected : Timers JS | 7 | 4 |
| crash-connected : Connexions Socket.IO | 1 | 1 |
| crash-connected : Appels SQLite / ~6 s | 65 | 21 |
| after-disconnect : CPU | 2.081 % | 0 % |
| after-disconnect : RSS | 65.84 MiB | 70.47 MiB |
| after-disconnect : Timers JS | 7 | 4 |
| after-disconnect : Connexions Socket.IO | 0 | 0 |
| after-disconnect : Appels SQLite / ~6 s | 24 | 0 |
| HTTP médiane, 40 requêtes | 9.2 ms | 9.69 ms |
| HTTP p95, 40 requêtes | 13.36 ms | 13.34 ms |
| Trafic socket total des phases FPS + Crash | 331115 octets | 310005 octets |

Les fenêtres courtes, la résolution de comptage CPU Windows, les GC et la concurrence des autres processus produisent une variabilité importante. Une valeur affichée à 0 % ne signifie pas qu'une tâche n'exécute aucune instruction. Ces essais ne démontrent pas une baisse CPU générale en production, ni une baisse significative de RAM. Les 94 % signalés sur la VM n'ont pas été reproduits. Les gains établis ici sont la suppression de trois timers au repos, la suppression des recherches hippiques continues et la réduction des lectures et envois Crash.

Un microbenchmark séparé, déterministe, compare l'ancien et le nouveau calcul de collision sur les mêmes 2 000 rayons, avec échauffement puis sept passages en alternant l'ordre. Médiane : **130,49 ms avant, 100,76 ms après**, soit **22,8 % de temps en moins** pour ce calcul précis. Tous les résultats cumulés sont identiques. Données brutes : `performance-collisions.json` ; relance : `node scripts/benchmark-collisions.cjs /tmp/collisions.json`. Ce gain de calcul ne représente pas une baisse équivalente du CPU total du site.

## Validation

- Suite complète : **156 tests**, incluant soldes, paiements, idempotence/concurrence, reprise après redémarrage, FPS et autres jeux, chat, maintenance et sessions persistantes.
- Tests ajoutés : arrêt/redémarrage du timer FPS, fréquence 20 Hz conservée en match, ordonnanceur sans polling au repos, annulation d'une échéance, sauvegarde SQLite avec contrôle d'intégrité et refus d'écrasement.
- Comparaison de 2 000 rayons entre la géométrie préparée et l'ancien algorithme : résultats strictement identiques, y compris les impacts sur les étages et les directions parallèles aux axes.
- Les tests ciblés Crash, FPS, courses hippiques et Tower ont aussi été exécutés après les dernières corrections serveur.
- `docker compose config --quiet` valide avec des valeurs factices fournies uniquement au processus de validation. Aucun secret de production utilisé.
- Le moteur Docker local n'est pas lancé : build, consommation du conteneur, redémarrage et logs en conditions Debian non vérifiés.
- Les optimisations frontend sont couvertes par les tests existants de comportement. Aucun gain GPU/FPS visuel n'est revendiqué sans profil de navigateur.

## Refaire les mesures et sauvegarder

Depuis le dépôt, avec les dépendances installées :

```bash
node scripts/benchmark-performance.cjs /tmp/casino-performance.json
npm test
```

Le benchmark crée et nettoie uniquement son propre répertoire temporaire. Il ne mesure pas la base de production et n'altère pas ses comptes. Son preload n'est jamais chargé par `npm start`.

Sauvegarde SQLite cohérente, destination **nouvelle**, parent existant :

```bash
DATA_DIR=/data node scripts/backup-data.cjs /data/backups/snapshot-2026-10-15
```

L'outil utilise `VACUUM INTO` avec source ouverte en lecture seule ; il copie `database.sqlite` puis `sessions.sqlite` si présent. Chaque fichier est un instantané cohérent ; les deux fichiers sont capturés successivement. Il refuse d'écraser une destination existante. Le script est inclus dans l'image Docker. Exporter ensuite les sauvegardes hors de la VM pour couvrir une perte de disque ; ne pas confondre une copie dans le même volume avec une sauvegarde hors machine. Aucun volume Docker n'a été supprimé.

## Suite possible sur la VM

Relever `docker stats --no-stream`, l'espace disque et les logs avec rotation, puis profiler une charge représentative pendant plusieurs minutes : 0, 1 et 8 joueurs FPS, plusieurs jeux ouverts, retours de vues et reconnexions. Corréler CPU, retard de boucle événementielle, requêtes SQL et trafic par jeu. Un profil CPU Node sur un processus de test permettrait d'identifier la cause précise des 94 % si elle persiste. Tester les restaurations dans un volume distinct et mesurer les plans SQLite avec un historique de taille réaliste. La mutualisation des connexions Socket.IO des widgets et la mise en cache GPU des maillages dynamiques restent des pistes à mesurer avant de changer davantage le protocole ou le rendu.
