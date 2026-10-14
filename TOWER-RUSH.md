# Tower Rush

Accessible dans **TOWER RUSH**, dans le menu et les cartes d’accueil.
Canvas 2D, ville de nuit originale, plateformes colorées, découpe des morceaux,
particules, caméra verticale, boutons tactiles et barre Espace. Les effets sonores
respectent le réglage de son du casino ; les effets décoratifs respectent la
préférence de réduction des animations. Le mouvement reste visible car il
constitue le gameplay. Aucune bibliothèque supplémentaire.

## Jeu et simulation

Une mise est débitée au démarrage. La fondation fait 180 unités de large dans
un monde de 600 unités. La plateforme suivante se déplace en aller-retour,
à vitesse constante pour l’étage, entre `24 + largeur/2` et `576 − largeur/2`.
Sa vitesse est `150 + 28 × étage` unités/seconde. La phase initiale est générée
par `crypto.randomInt` côté serveur et enregistrée.

Le serveur utilise l’heure de réception HTTP de **PLACER**, capturée avant la
vérification de session, puis sa formule de mouvement. Le client n’envoie que
l’identifiant de partie, l’étage attendu et un identifiant unique de requête.
Les coordonnées, timestamps, multiplicateurs et victoires fournis par le client
ne sont pas utilisés. Une requête retardée de plus de 1,5 seconde dans le serveur
est refusée. Aucune compensation de latence contrôlée par le joueur : le timing
visible reste sensible à la latence réseau. L’horloge d’affichage est synchronisée
sur l’heure serveur et une estimation du demi-temps aller-retour.

Le fichier `underground/js/tower-motion.js` est partagé par Node et le navigateur.
La décision se fonde sur le chevauchement : au moins 55 % de la largeur mobile,
avec un minimum de 24 unités, ou un placement parfait dans les 3 unités autour
du centre de l’étage précédent. Un placement parfait conserve la largeur et
ajoute 25 points ; les autres placements coupent la partie qui dépasse.
Score = 100 points par étage + 25 par étage parfait.

La chute dure 700 ms. Aucun nouveau placement n’est accepté avant la date
`ready_at` du serveur ; l’étage attendu empêche qu’un double clic joue l’étage
suivant. La huitième réussite termine la tour avec encaissement automatique.

## Multiplicateurs

Table initiale conservatrice : **1,08 / 1,22 / 1,40 / 1,64 / 1,95 / 2,35 / 2,90 / 3,65x**.
Configurer `TOWER_MULTIPLIERS` avec un tableau JSON dans `.env`, puis reconstruire
le conteneur. Les huit valeurs doivent être croissantes, avoir au plus deux
décimales et rester sous 20x. Chaque partie garde sa propre copie de la table :
changer la configuration ne change pas une tour en cours.

Pour une phase uniformément choisie, le centre mobile est uniforme dans son
intervalle de déplacement. À largeur w et minimum de recouvrement r, la fenêtre
de réussite ordinaire mesure au plus `2 × (w − r)` ; les bords peuvent la réduire.
La référence initiale supérieure est donc `0,9 × 180 / (552 − 180)`
= **43,5484 %** pour un clic sans timing. La réduction de largeur diminue cette
chance. La configuration refuse un rapport entre multiplicateurs dont le produit
par cette borne dépasse 0,99. La tolérance parfaite reste sous cette borne.

Cette référence sert à vérifier la cohérence des valeurs, **pas à annoncer un
RTP fixe** : l’habileté et la connexion influencent la réussite. Un joueur qui
réussit systématiquement peut dégager un bénéfice. Les paramètres nécessaires
à l’animation sont publics : le modèle protège contre les coordonnées ou temps
forgés, mais ne garantit pas la détection d’un bot qui automatise le timing.
Cette version utilise les jetons virtuels du casino.

Gain total encaissé = `floor(mise × multiplicateur)` en jetons entiers, mise incluse.
Le bonus parfait change le score et la largeur, pas la table des gains.

## Persistance et règlement

Routes authentifiées : `GET /api/tower/state`, `POST /api/tower/start`,
`POST /api/tower/place`, `POST /api/tower/cashout`.
Les tables SQLite `tower_games` et `tower_actions` sont créées au démarrage.
Les états sont WAITING (aucune partie), PLAYING, PLACING, CASHOUT et LOST.
PLACING redevient PLAYING à `ready_at`, sans boucle physique serveur.

Un index unique garantit une seule tour active par joueur. Chaque action est
idempotente par `(user_id, request_id)` ; changer ses paramètres avec le même
identifiant est refusé. L’état, le débit initial, l’encaissement, l’historique et
la banque sont mis à jour dans des transactions atomiques. Le serveur ne crédite
qu’à l’encaissement ; répéter un encaissement ou rejouer sa requête ne le double pas.

La partie est retrouvée après rafraîchissement ou redémarrage serveur. Une action
sans réponse est conservée par compte dans le stockage local et peut être
récupérée avec **RÉCUPÉRER MON ACTION**, en réutilisant exactement la requête.
Une reprise idempotente renvoie l’état actuel de la même partie.

Deux minutes sans placement entraînent une perte, même si la page est fermée.
L’expiration est traitée à la lecture/action, au démarrage et toutes les 30 secondes,
une seule fois. Il n’existe pas de boucle de simulation pour les joueurs inactifs.
Le navigateur arrête les rendus lorsque la rubrique ou l’onglet est masqué.
Les tours restent limitées à huit étages, les particules sont temporaires et
la résolution Canvas est limitée à 2×.

Les autres jeux et les réinitialisations/suppressions du compte sont protégés
pendant une tour active afin de conserver le solde partagé. Une course de chevaux
en cours empêche également le démarrage. Désactiver le jeu ou suspendre les
nouvelles mises n’empêche pas d’achever ou d’encaisser une tour déjà commencée.

## Vérification

`node --test tests/tower*.test.js`, puis `npm test`.
Tests : mouvement partagé, limites, accélération, chevauchement/coupe/parfait,
configuration des gains, démarrages simultanés, étage joué une seule fois,
encaissement concurrent, rollback bancaire, fraude sur les coordonnées/gains,
reprise serveur, expiration sans double perte, tour complète, monnaie conservée,
isolement des comptes, blocage des autres jeux et des réinitialisations, requête
de récupération, animation et clavier.
