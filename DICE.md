# Dice

Ouvrir le casino puis **DICE**, dans la navigation ou les cartes de l’accueil.
Express, les comptes/sessions, les jetons entiers, SQLite, les réglages admin,
l’historique et le règlement de la banque sont ceux du casino existant.
La table `dice_rolls` est créée automatiquement au démarrage. Aucune dépendance
supplémentaire. Le module serveur est inclus dans la construction Docker.

## Probabilités et retour

Le serveur tire `crypto.randomInt(10000)` et affiche cet entier divisé par 100 :
10 000 résultats uniformes entre 0,00 et 99,99. Seuil de 1 à 99, par pas de 0,01.
Le seuil et le résultat sont comparés en centièmes entiers.

- Under : résultat **strictement inférieur** au seuil.
- Over : résultat **supérieur ou égal** au seuil.

Si T est le seuil en centièmes, le nombre de résultats gagnants W est T pour
Under et 10000 − T pour Over. La probabilité est W/10000.
Le multiplicateur exact est **9900/W** ; celui affiché est arrondi à deux décimales.
Le gain total est `floor(mise × 9900 / W)` en cas de victoire, sinon zéro.
Il inclut la mise. Le calcul utilise un numérateur entier, sans multiplier la mise
par un multiplicateur déjà arrondi.

RTP théorique avant arrondi des jetons : `(W/10000) × (9900/W) = 0,99`,
soit **99 %**, pour chaque seuil et chaque mode. Le RTP effectif après arrondi
est `(W/10000) × floor(mise × 9900/W) / mise` et peut être inférieur pour de
petites mises. Aucune modification des probabilités selon le joueur ou son solde.

Exemple : Under 50, mise 100, probabilité 50 %, multiplicateur 1,98x, retour
198 jetons si le résultat est inférieur à 50,00. L’égalité 50,00 perd en Under
et gagne en Over.

## Sécurité et reprise

`GET /api/dice/state` : solde, réglages et 20 parties privées récentes.
`POST /api/dice/roll` : `stake`, `threshold`, `mode` (`under`/`over`), `requestId`.
Les valeurs de résultat, gain et multiplicateur envoyées par le client sont ignorées.

Les mises sont entières, de 1 à 1 000 000, et respectent les limites admin.
Connexion et autorisation requises ; les comptes banque, bannis ou suspendus
sont refusés. Maintenance et suspension globale des mises sont respectées.
Les parties actives blackjack/poker et les paris Crash actifs empêchent de jouer.

Débit, tirage, crédit, partie, historique et banque sont réglés dans une seule
transaction SQLite. Une erreur annule tout. La contrainte unique
`(user_id, request_id)` empêche toute duplication concurrente ou après redémarrage.
Un identifiant réutilisé avec d’autres paramètres retourne un conflit.
Les anciens résultats restent récupérables pendant une suspension des nouvelles mises.
Un nouveau lancer est limité à un toutes les 250 ms par compte.

Le navigateur conserve un lancer non confirmé dans le stockage local par compte,
puis propose **RÉCUPÉRER MON LANCER** avec le même identifiant. La requête expire
après 15 secondes sans autoriser un nouveau débit à la récupération.
Les identifiants fonctionnent également sur une VM accédée en HTTP.

## Interface

Slider gradué de 0 à 100, seuil réglable de 1 à 99, zones verte/rouge inversées
par le mode, saisie précise du seuil, mise, ½, ×2 et MAX.
La probabilité, le multiplicateur et le gain potentiel suivent les paramètres.
Tous les contrôles de jeu sont verrouillés durant le lancer et son animation.

Le curseur animé rejoint le résultat serveur en 1,1 seconde. La mise est affichée
débitée à la confirmation ; le gain, le résultat et l’historique sont révélés à
l’arrivée, y compris dans le solde de la barre supérieure. Le serveur a déjà réglé
la partie, donc une fermeture ou déconnexion ne perd pas le gain.
Le mode de réduction des animations affiche directement le résultat.
L’historique indique date, mise, mode/seuil, résultat, multiplicateur et gain net.

## Tests

`node --test tests/dice*.test.js`, ou `npm test` pour tous les jeux.

Couverture : comptage exhaustif des 10 000 résultats pour les deux modes et les
seuils extrêmes/fractionnaires ; égalités au seuil ; RTP et gains entiers ;
validation/authentification ; requêtes simultanées et idempotence ; absence de
confiance dans les gains du client ; banque ; rollback sur panne ; suspension
et récupération après redémarrage ; double clic ; animation et révélation différée.
