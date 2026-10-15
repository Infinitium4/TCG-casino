# Plinko

Jeu à jetons virtuels intégré à Express, SQLite, aux sessions et à Socket.IO existants.
Après `npm start` (ou reconstruction Docker), ouvrir le casino et choisir **PLINKO**.
La migration SQLite et l’entrée des réglages admin sont créées au démarrage.
Aucune dépendance supplémentaire, aucun service ni moteur physique à installer.

## Plateau et probabilités

16 rangées de 3 à 18 picots, 16 décisions indépendantes et 17 cases.
La bille commence au picot central de la première rangée. Chaque décision décale
sa position d’un demi-espacement ; après 16 décisions, le nombre de droites donne
l’indice de la case, de 0 à 16. Les picots latéraux gardent la forme de référence.

Seul le mode **élevé** est activé. Les modes faible et moyen attendent leurs propres
tables de gains et tests ; les requêtes qui les demandent sont refusées.

Multiplicateurs :
`110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110`.

Probabilité de la case k : `C(16,k) / 65536`.
RTP théorique : `Σ(C(16,k) × multiplicateur[k]) / 65536`
= **0,9898834228515625**, soit **98,98834228515625 %**.
Avantage théorique de la banque : **1,01165771484375 %**.
Les deux extrêmes ont chacun une probabilité de 1/65536 ; la case centrale,
12870/65536. Aucun ajustement selon le compte, son solde ou l’historique.

Les jetons sont entiers : le gain est arrondi vers le bas. Le RTP indiqué est exact
pour une mise multiple de 10 ; pour les autres mises il est légèrement inférieur,
et l’arrondi pèse davantage sur les très petites mises.
RTP effectif pour une mise s : `Σ(P(k) × floor(s × multiplicateur[k])) / s`.

## Règlement et reprise

`POST /api/plinko/drop` accepte une mise entière (1 à 1 000 000, dans les limites
admin), un identifiant de requête, `risk: high` et `rows: 16`.
Il ignore tout gain, multiplicateur ou résultat envoyé par le navigateur.
`crypto.randomInt(2)` fournit chaque direction côté serveur.

Une transaction `BEGIN IMMEDIATE` vérifie les conditions, débite, génère et stocke
la trajectoire, crédite le retour, écrit l’historique et règle la banque. Toute
erreur annule l’ensemble. Le gain est définitivement réglé avant l’animation :
fermer l’onglet ou se déconnecter ne perd ni ne double le règlement.
Pendant l’animation, l’interface affiche seulement le débit de la mise et masque
les retours des billes encore en vol, y compris dans le solde de la barre supérieure,
l’historique et le flux des lancers personnels. Chaque arrivée révèle son propre
gain ; le compte est resynchronisé lorsque toutes les billes sont arrivées.

La contrainte unique `(user_id, request_id)` rend une relance idempotente, même
après redémarrage. Un identifiant réutilisé avec une autre mise est refusé.
Le navigateur garde le lancer non confirmé par compte dans le stockage local et
propose **RÉCUPÉRER MON LANCER** après une interruption. Il réutilise exactement
l’identifiant, sans nouvelle mise. Les anciennes réponses restent récupérables
lorsque les nouvelles mises sont suspendues. Un effacement du stockage local
n’efface pas le lancer de l’historique serveur.

Les mises sont bloquées pendant une partie active de blackjack/poker ou un pari
Crash actif pour éviter de désynchroniser leurs soldes. Le serveur limite les
nouveaux lancers à un toutes les 250 ms par compte ; le navigateur n’impose
aucun plafond de billes simultanées. Aucun mode automatique n’est activé.

## Animation et réseau

Canvas 2D, coordonnées fixes redimensionnées par CSS, résolution limitée à 2×.
La trajectoire contourne chaque picot à 12 px de son centre (rayons : picot 3,2 px,
bille 5 px), puis rejoint la rangée suivante. La case correspond exactement à
la somme des directions du serveur. L’animation dure environ 3,45 secondes.
Elle s’arrête lorsque la rubrique ou l’onglet est masqué ; le résultat reste réglé.
Le réglage de réduction des animations donne directement le résultat.

Socket.IO utilise la salle `plinko:feed`, rejointe uniquement lorsque Plinko est
visible. Un événement par nouveau lancer expose seulement son identifiant public,
le pseudo, la mise, le multiplicateur, le retour et la date. Aucun identifiant de
compte, solde, trajectoire ou identifiant de requête privé n’est diffusé.
Historiques personnels et publics : 20 entrées affichées, pas de polling régulier.

## Validation

`node --test tests/plinko*.test.js`

Tests : exhaustivité des 65 536 chemins et RTP ; trajectoires sans collision et
17 points d’arrivée ; validation des mises ; déduplication concurrente ; règlement
banque et historique ; confidentialité du flux ; suspension et reprise persistante.
