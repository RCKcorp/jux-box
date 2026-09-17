# JuxBox

JuxBox est une petite application Web locale de mixage audio. Elle permet de charger des morceaux et des effets MP3, de les lire depuis une interface navigateur et de gérer les fichiers directement depuis l'application.

## Démarrage

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Par défaut, JuxBox écoute uniquement sur :

```text
http://127.0.0.1:3000
```

Pour l'utiliser volontairement sur un réseau local :

```bash
HOST=0.0.0.0 npm start
```

Sous PowerShell :

```powershell
$env:HOST = "0.0.0.0"
npm start
```

Le port peut être changé avec la variable d'environnement `PORT`.

## Médias

Les morceaux importés sont stockés dans `uploads/music/` et les effets dans `uploads/fx/`. Ces répertoires sont ignorés par Git.

Le dépôt ne distribue aucun extrait audio tiers. Si vous souhaitez fournir vos propres effets par défaut, placez localement des fichiers MP3 dans `defaults/fx/`. Ils seront copiés vers `uploads/fx/` au premier démarrage.

N'ajoutez au dépôt public que des médias que vous êtes autorisé à redistribuer.

## Sécurité

JuxBox n'intègre pas d'authentification. Le serveur est donc limité à `127.0.0.1` par défaut.

Si vous l'exposez sur un LAN avec `HOST=0.0.0.0`, utilisez uniquement un réseau de confiance et ne publiez pas directement le service sur Internet.

## Données locales

Les éléments suivants ne doivent pas être versionnés :

- médias importés ;
- fichiers `.env` réels ;
- clés et certificats privés ;
- réglages locaux d'outils de développement ;
- journaux d'exécution.

## Développement

```bash
npm run dev
```

Le serveur Express est dans `server.js` et l'interface dans `public/index.html`.
