# UNDERGROUND

Casino de démonstration avec comptes, historique SQLite et mini-jeux.

## Lancement local

Prérequis : Node.js LTS et npm.

```bash
npm ci
npm start
```

Ouvre `http://127.0.0.1:5500/`. Sur une base neuve en développement, le compte de démonstration est `admin` / `admin123`. Ne réutilise pas ce mot de passe en production.

## Administration des comptes

Connecte-toi avec un compte administrateur pour afficher l’onglet **Administration**. Il permet de rechercher les comptes, consulter leur solde et leur historique, ajouter ou retirer des jetons, bannir ou débannir un compte, supprimer définitivement un compte et consulter le journal des actions. Un compte banni qui est débanni retrouve l’accès avec sa session existante ou après reconnexion.

La **vue support** ouvre temporairement l’application comme le compte sélectionné, sans révéler ni modifier son mot de passe. Un bandeau reste visible pendant cette vue et son ouverture comme sa fermeture sont journalisées.

La suppression d’un compte retire son historique de parties, l’invalide sur le serveur et conserve son pseudo dans le journal administratif. Elle est refusée pour les comptes admin ou ceux engagés dans une manche en cours.

Au démarrage, le serveur ajoute automatiquement les colonnes de rôle et de bannissement aux bases existantes. Sur une base locale, `admin` et `admin2` reçoivent le rôle administrateur (mot de passe de démonstration `admin123`). En production, configure `ADMIN_USERNAME` / `ADMIN_PASSWORD` et `SECOND_ADMIN_USERNAME` / `SECOND_ADMIN_PASSWORD` avec deux identifiants distincts. Pour donner le rôle à un compte déjà présent, configure le nom correspondant et redémarre le serveur; le mot de passe d'un compte existant n'est jamais réinitialisé.

Un compte interne `casino-bank` (modifiable avec `BANK_USERNAME`) est provisionné automatiquement. Il n'a pas de mot de passe utilisable, ne peut pas se connecter ni jouer, et apparaît dans l'administration avec le solde de la banque ainsi que ses derniers règlements. Les pertes des joueurs aux jeux contre la maison augmentent ce solde; les gains le diminuent, sans plancher à zéro. Le journal conserve aussi les égalités. Le poker est joueur contre joueur et sans commission (« rake ») : ses mises ne constituent donc pas un revenu de la banque.

Dans `.env` de production, définis un mot de passe long et unique pour le deuxième administrateur, par exemple :

```ini
SECOND_ADMIN_USERNAME=admin2
SECOND_ADMIN_PASSWORD=CHOISIR_UN_AUTRE_MOT_DE_PASSE_LONG_ET_UNIQUE
BANK_USERNAME=casino-bank
```

## Lancement avec Docker

Prérequis : Docker Desktop sur Windows/macOS ou Docker Engine avec le plugin Compose sur Linux. Copie `.env.example` vers `.env`, puis remplace les valeurs par tes propres secrets, notamment `SECOND_ADMIN_PASSWORD`. Génère `SESSION_SECRET` avec `openssl rand -hex 32`. Compose transmet les identifiants admin et banque du fichier `.env` au serveur.

Sur PowerShell :

```powershell
Copy-Item .env.example .env
```

Construis et démarre le site :

```bash
docker compose up -d --build
docker compose logs -f casino
```

Ouvre `http://127.0.0.1:5500/`. Le compte initial configuré dans `.env` n'est créé que si la base est vide. Les comptes, soldes, historiques et sessions sont conservés dans le volume Docker `casino-data`, même après `docker compose down`.

Pour arrêter le site sans supprimer les données, utilise `docker compose down`. **N'utilise pas `docker compose down -v`** sauf si tu veux effacer la base.

La base locale existante n'est pas copiée dans l'image. Une nouvelle installation Docker crée une base vide; il faut transférer séparément `database.sqlite` si tu veux garder les comptes actuels.

## Déploiement public sur Ubuntu

Cette configuration utilise Node.js derrière Nginx avec HTTPS. Il faut un domaine dont l'enregistrement DNS `A` pointe vers l'IP publique de la VM. Autorise les ports 22, 80 et 443 dans le pare-feu du fournisseur; le port 5500 reste privé.

Pour Docker, installe Docker Engine et le plugin Compose sur la VM, clone le projet, crée le fichier `.env`, puis exécute `docker compose up -d --build`. La configuration Docker expose le port 5500 uniquement sur `127.0.0.1`; la configuration Nginx ci-dessous peut donc servir de reverse proxy HTTPS. Les commandes systemd ci-dessous sont une méthode alternative sans Docker.

### Installer le projet

```bash
sudo apt update
sudo apt install -y curl git nginx certbot python3-certbot-nginx build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
sudo useradd --system --create-home --home-dir /opt/tcg-casino --shell /usr/sbin/nologin tcgcasino
sudo git clone https://github.com/Infinitium4/TCG-casino.git /opt/tcg-casino
sudo chown -R tcgcasino:tcgcasino /opt/tcg-casino
sudo install -d -o tcgcasino -g tcgcasino /var/lib/tcg-casino
sudo -u tcgcasino npm --prefix /opt/tcg-casino ci --omit=dev
```

### Configurer les secrets et la base

Crée un secret avec `openssl rand -hex 32`, puis crée `/etc/tcg-casino.env` :

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=5500
DATA_DIR=/var/lib/tcg-casino
SESSION_SECRET=REMPLACER_PAR_LE_SECRET_GENERE
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHOISIR_UN_MOT_DE_PASSE_LONG_ET_UNIQUE
SECOND_ADMIN_USERNAME=admin2
SECOND_ADMIN_PASSWORD=CHOISIR_UN_AUTRE_MOT_DE_PASSE_LONG_ET_UNIQUE
BANK_USERNAME=casino-bank
```

Protège le fichier :

```bash
sudo chown root:root /etc/tcg-casino.env
sudo chmod 600 /etc/tcg-casino.env
```

Les identifiants `ADMIN_USERNAME` et `ADMIN_PASSWORD` créent le compte initial si la base est vide. Sur une base existante, `ADMIN_USERNAME` attribue le rôle administrateur au compte portant exactement ce pseudo; `ADMIN_PASSWORD` ne modifie pas son mot de passe. Si tu copies ta base locale vers `/var/lib/tcg-casino/database.sqlite`, conserve le compte et les données déjà présents. Arrête le serveur avant de copier la base, puis donne-la à l'utilisateur `tcgcasino`.

### Créer le service systemd

Crée `/etc/systemd/system/tcg-casino.service` :

```ini
[Unit]
Description=TCG Casino
After=network.target

[Service]
Type=simple
User=tcgcasino
Group=tcgcasino
WorkingDirectory=/opt/tcg-casino
EnvironmentFile=/etc/tcg-casino.env
ExecStart=/usr/bin/node /opt/tcg-casino/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tcg-casino

[Install]
WantedBy=multi-user.target
```

Active-le et vérifie les journaux :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tcg-casino
sudo systemctl status tcg-casino
sudo journalctl -u tcg-casino -f
```

### Configurer Nginx et HTTPS

Crée `/etc/nginx/sites-available/tcg-casino`, en remplaçant `casino.example.com` par ton domaine :

```nginx
server {
    listen 80;
    server_name casino.example.com;

    location / {
        proxy_pass http://127.0.0.1:5500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tcg-casino /etc/nginx/sites-enabled/tcg-casino
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d casino.example.com
```

Le site sera disponible sur `https://casino.example.com/`. Les comptes, soldes, historiques et sessions restent dans `/var/lib/tcg-casino`; sauvegarde ce dossier régulièrement.

### Mettre à jour après un push Git

```bash
sudo -u tcgcasino git -C /opt/tcg-casino pull
sudo -u tcgcasino npm --prefix /opt/tcg-casino ci --omit=dev
sudo systemctl restart tcg-casino
```

## Limites

Les jetons sont virtuels. Les résultats des mini-jeux sont calculés côté navigateur; ce prototype n'est pas adapté aux paris ou paiements en argent réel.