# UNDERGROUND — Version avec comptes et base SQLite

## Démarrage rapide

1. Ouvrez un terminal dans le dossier racine du projet.
2. Installez les dépendances :

```bash
npm install
```

3. Lancez le serveur :

```bash
npm start
```

4. Ouvrez le site :

```text
http://127.0.0.1:5500/
```

## Comptes de démonstration

- Pseudo : `admin`
- Mot de passe : `admin123`

## Fonctionnalités ajoutées

- Inscription d’utilisateur
- Connexion avec mot de passe hashé
- Session utilisateur
- Base SQLite locale
- Sauvegarde du solde et de l’historique par compte
- Classement local par compte
- Réinitialisation des données du compte

## Fichiers importants

- `server.js` : serveur HTTP + API + base SQLite
- `database.sqlite` : base de données locale créée automatiquement
- `public/auth.html` : page de connexion / inscription
- `underground/` : site de jeu HTML/CSS/JS existant

## Limites

Ce projet reste un prototype local. Les comptes sont stockés dans une base SQLite locale et la protection n’est pas comparable à un système de production complet.
