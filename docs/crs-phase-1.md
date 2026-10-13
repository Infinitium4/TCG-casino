# CRS VS Manifestants — phase 1

## Architecture

Le casino reste l’application Express / Socket.IO existante. Le module du jeu utilise les mêmes sessions, contrôles d’accès et transactions SQLite. Il n’a ni processus supplémentaire, ni boucle de simulation, ni connexion Socket.IO supplémentaire pendant cette phase.

- `src/crs/server.ts` : catalogue des deux factions, migration idempotente et routes authentifiées.
- `src/crs/client.ts` : choix avec confirmation permanente et écran de faction.
- `build-crs/server.js` et `underground/js/crs.js` : fichiers compilés livrés avec le projet ; le serveur fonctionne sans compilateur en production.
- `underground/css/crs.css` : interface responsive utilisant le thème bunker existant.
- `tests/crs.integration.test.js` : authentification, isolation des comptes, concurrence, persistance et non-modification des jetons.

`npm run build:crs` compile et vérifie le TypeScript. Après modification des sources, reconstruire les fichiers générés avant livraison. `npm test` vérifie aussi les jeux existants. Docker copie le module compilé ; les données restent dans le volume SQLite existant.

## Données et API

Trois tables sont créées automatiquement : `crs_players`, `crs_citadels` et `crs_buildings`. Une faction possède un QG niveau 1, une grille 12 × 12, un QG enregistré en (5, 5), 250 provisions gratuites et un indice initial de 1 000. La création est atomique et gratuite.

- `GET /api/crs/state` : état du compte connecté et catalogue des factions.
- `POST /api/crs/faction`, corps `{ "faction": "crs" }` ou `{ "faction": "manifestants" }` : création unique ; tout second choix renvoie 409.

Le serveur détermine l’utilisateur depuis la session. Le navigateur ne fournit ni solde, ni ressources, ni niveau. Une contrainte SQL empêche le changement de faction. Une suppression définitive du compte supprime ses données de faction par cascade. La réinitialisation du profil casino conserve volontairement cette faction permanente.

Les provisions sont une ressource de jeu, pas une autre monnaie de casino : le seul solde de jetons reste `users.chips`. Aucun achat ni récompense n’est implémenté en phase 1. Les niveaux 2–10 sont présentés comme un parcours futur, sans commande permettant de les obtenir.

## Phases suivantes, après validation

Phase 2 : carte interactive, placement et déplacement validés côté serveur. Un rendu Phaser sera pertinent à cette étape ; il n’est pas chargé pour un simple écran de faction.

Phase 3 : transactions de construction utilisant `users.chips`, horodatages persistants, files de construction et production hors ligne calculée à la demande.

Phase 4 : recrutement et statistiques persistantes. Phase 5 : salons 1v1 sur le serveur Socket.IO existant, simulation autoritaire à fréquence fixe et résultats atomiques. Phase 6 : augmenter les effectifs après mesures de performance. Phase 7 : technologies, classement et raids fondés sur une copie de la citadelle, sans détruire sa progression persistante.

La phase 1 n’implémente pas de carte jouable, de constructions, d’armée ou de combats. Elle doit être validée avant la phase 2.

## Maintenance

Dans Administration → Contrôles de l’admin principal → CRS VS Manifestants, admin1 peut désactiver le jeu ou cocher Maintenance. Le réglage utilise `casino_game_settings`, persiste après redémarrage et figure au journal administratif. Les routes du jeu répondent 503 pendant la maintenance, sans modifier la faction ni sa progression. Le client vérifie la disponibilité à l’ouverture et toutes les 15 secondes uniquement lorsque cette rubrique est affichée. Les limites de mise ne sont pas présentées pour ce jeu de stratégie.
