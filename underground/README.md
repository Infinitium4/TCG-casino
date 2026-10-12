# UNDERGROUND

## Présentation

UNDERGROUND est une plateforme locale de mini-jeux de casino clandestin inspirée d'un club privé des années 1920. Le projet fonctionne sans dépendance externe, uniquement avec HTML5, CSS3 et JavaScript vanilla, et sauvegarde les données dans le LocalStorage du navigateur.

## Architecture retenue

Le projet suit la structure demandée avec une séparation claire entre :

- la structure HTML dans `index.html` ;
- le style visuel dans `css/style.css` ;
- les jeux et l'interface dans les fichiers JavaScript du dossier `js/` ;
- la persistance locale dans `js/storage.js` ;
- les utilitaires communs dans `js/utils.js`.

Cette organisation permet de garder les règles des jeux séparées de l'affichage, ce qui est plus simple à maintenir pour un débutant.

## Installation

1. Téléchargez ou placez le dossier `underground` dans votre ordinateur.
2. Ouvrez le fichier `index.html` dans un navigateur moderne.
3. Vous pouvez aussi lancer un petit serveur local si vous préférez :
   ```bash
   cd underground
   python -m http.server 8000
   ```
   Ensuite, ouvrez `http://localhost:8000` dans votre navigateur.

> Le fichier HTML fonctionne aussi directement en local, mais un petit serveur peut améliorer la fiabilité des chargements.

## Sauvegarde locale

Le projet utilise le `LocalStorage` du navigateur pour enregistrer :

- le pseudo et l'avatar du joueur ;
- le solde de jetons ;
- les statistiques ;
- l'historique des dernières parties ;
- le statut du son.

Les données restent disponibles après fermeture du navigateur. Toutefois, elles ne sont pas sécurisées et ne doivent pas être considérées comme une protection contre la triche ou la manipulation locale.

## Modifier les couleurs et textes

- Les couleurs principales sont définies dans `css/style.css` sous `:root`.
- Les titres, messages et libellés sont généralement visibles dans `index.html`.
- Pour modifier le thème, changez les variables comme `--bg-dark`, `--red-glow`, `--gold` et `--text`.

## Ajuster les probabilités et les paiements

- La roulette est gérée dans `js/roulette.js` et le calcul de gains se trouve dans `evaluateRouletteBet()`.
- Le blackjack suit les règles dans `js/blackjack.js`.
- La machine à sous utilise la table de paiement dans `js/slots.js` et la fonction `evaluateSlots()`.

Pour modifier les paiements, il suffit de changer les valeurs dans ces fonctions.

## Ajouter un nouveau mini-jeu

1. Créez un nouveau fichier JavaScript dans `js/`.
2. Ajoutez une section HTML dans `index.html` et une vue correspondante.
3. Ajoutez une entrée dans la navigation avec `data-view`.
4. Reliez le module dans le fichier `app.js` ou via un nouveau `initialize()`.
5. Sauvegardez les résultats via `addHistoryEntry()` et les statistiques via `updatePlayerStats()`.

## Limites du stockage local

- Les données sont limitées au navigateur du joueur.
- Elles peuvent être supprimées ou vidées par l'utilisateur.
- L'historique est limité à 50 entrées.
- Les données ne sont pas partagées entre appareils ni entre navigateurs.

## Compatibilité

Le projet est pensé pour fonctionner sur les navigateurs modernes avec un support correct de :

- `LocalStorage` ;
- `Array.from`, `map`, `filter`, `Math.random` ;
- `DOM` standard.

Aucun framework ni module de compilation n'est requis.

## Avertissement de jeu

Tous les jetons sont fictifs. Ils n'ont aucune valeur monétaire réelle. Le projet est purement démonstratif et local, destiné à l'expérimentation dans un navigateur.
