# Courses hippiques

Lancer le casino avec `npm start`, se connecter, puis ouvrir **Courses hippiques** dans la navigation ou depuis l’accueil. Aucune dépendance supplémentaire n’est nécessaire. La table SQLite est créée automatiquement au démarrage.

Créer une table pour jouer seul ou rejoindre celle d’un ami. Une table accueille **1 à 8 joueurs**, chacun avec son propre cheval et sa propre mise. Plusieurs joueurs peuvent choisir le même cheval. Le solde est débité une seule fois à la confirmation. Les joueurs et leurs paris sont affichés dans la salle d’attente. Seul l’hôte peut lancer, une fois que chaque joueur a misé, y compris lorsqu’il est seul.

Chaque course propose cinq probabilités différentes, avec des cotes plus élevées pour les chevaux moins favoris. Les cotes sont visibles avant de miser, identiques pour tous et figées pendant les paris. Le tirage pondéré utilise exactement les probabilités affichées (affichage arrondi à une décimale). Elles sont indépendantes du nombre de joueurs, des chevaux choisis et des montants misés. Chaque cheval reçoit une nouvelle cote à la course suivante.

Un pari gagnant rapporte `floor(mise × cote)` au total. Les cotes sont arrondies au centième inférieur et reprennent la marge théorique précédente du jeu : `cote = floor(80 / probabilité) / 100`. Le gain est calculé en centièmes entiers côté serveur.

**Lancer la course** déclenche un compte à rebours de trois secondes, puis une course de 14 secondes. Tous les joueurs voient les mêmes chevaux, trajectoires et horaires d’arrivée. Le bouton **Nouvelle course**, réservé à l’hôte, conserve les participants et renouvelle les cotes. Avant le départ, quitter la table rembourse intégralement la mise. Pendant la course, il faut attendre l’arrivée pour quitter. Quand l’hôte quitte, le prochain participant devient hôte. Une table vide est fermée.

Le classement se met à jour en direct. Les chevaux et jockeys sont dessinés et animés sur canvas, avec variations progressives de vitesse, podium, mise en lumière du gagnant et confettis en cas de victoire. Les sons sont facultatifs et suivent le réglage sonore du profil. Le rendu s’adapte aux écrans mobiles et au réglage de réduction des animations.

## Serveur et persistance

- `horse-racing.js` : tirage avec `crypto.randomInt`, routes authentifiées, validation, transactions SQL, paiement et règlement de la banque.
- `horse-tables.js` : tables persistantes, participants, cotes, tirage pondéré, départ commun, transferts d’hôte et remboursements.
- `server.js` : initialisation du schéma, enregistrement des routes et ajout du jeu aux réglages du casino. La réinitialisation personnelle du solde est bloquée pendant une course.
- `horse_races` : propriétaire, identifiant de requête, cheval choisi, mise réservée, résultat, trajectoires, état, dates et paiement. Un index unique limite chaque joueur à une course non réglée. L’unicité de l’identifiant de requête empêche les doubles débits.
- `horse_tables`, `horse_table_members`, `horse_events` : hôte, participants et course commune avec marché des cotes et résultat. Chaque pari conserve sa cote dans `horse_races.odds_cents` et son identifiant de course dans `event_id`. Un index unique empêche un joueur de miser deux fois sur une même course ; plusieurs joueurs peuvent miser sur le même cheval.
- `game_history` et `bank_ledger` : historique et règlement bancaire existants, enregistrés dans la même transaction que le paiement.

Le résultat est enregistré à la préparation de la course et masqué tant qu’elle n’a pas démarré. L’ordre d’arrivée est tiré par sélection pondérée sans remise avec `crypto.randomInt`. Les trajectoires sont générées côté serveur et respectent cet ordre. Tous les paiements d’une course partagée sont réglés dans une même transaction : une écriture qui échoue annule l’ensemble du règlement jusqu’à sa reprise.

Les routes n’acceptent aucun résultat ni gain fourni par le navigateur. Les demandes répétées rendent le même pari ou paiement. Un contrôle de propriété empêche d’accéder à une autre course. Un règlement automatique traite les courses terminées même si le navigateur est fermé. Après un redémarrage serveur, les courses sont reprises depuis SQLite. Après un rechargement de page, une mise confirmée et une animation en cours sont restaurées. En cas de réponse réseau perdue, l’identifiant de pari est réutilisé.

Routes : `GET /api/horses/state`, `POST /api/horses/tables`, puis `POST /api/horses/tables/:tableId/join`, `/bet`, `/start`, `/next`, `/leave`. Les paris et commandes de départ incluent l’identifiant de course pour refuser une requête fondée sur des anciennes cotes. `POST /api/horses/:id/settle` vérifie l’arrivée et règle la course entière. Le client synchronise la salle chaque seconde et anime la course localement à partir des horaires serveur.

L’authentification, la maintenance, les limites de mise et l’arrêt d’urgence réutilisent les contrôles existants. Un pari confirmé reste jouable et payable même si les nouvelles mises sont suspendues. La migration est additive : les anciennes courses solo sont conservées et se terminent avec leur cote initiale ×4.

## Interface et intégration

- `underground/js/horses.js` : interface, animations, sons, reprise et communication avec le serveur.
- `underground/css/horses.css` : styles du jeu et adaptation mobile.
- `underground/index.html` : piste, choix des chevaux, commandes, classement, podium et historique.
- `underground/js/app.js` : navigation, carte d’accueil et activation du jeu.
- `underground/js/admin.js` : nom du jeu dans les réglages de maintenance et de limites.

## Validation

`npm test` lance la suite complète. Les fichiers `tests/horse-racing*.test.js` vérifient les probabilités pondérées, les anciennes courses uniformes, les trajectoires, les doubles clics, les reprises réseau, l’authentification, le solde insuffisant, les paramètres invalides, deux joueurs sur le même cheval, leurs paiements distincts, le départ partagé, les droits d’hôte, les remboursements, les nouvelles cotes, la capacité de huit joueurs, le redémarrage, la maintenance, l’arrêt d’urgence et le rollback d’un règlement bancaire qui échoue.
