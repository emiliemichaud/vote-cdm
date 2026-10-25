# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère à [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Ajout d'une icône d'agrandissement en mode présentation permettant d'afficher la participation ou les résultats au premier plan dans une modale grand format (idéale pour la projection).

### Changed
- Désactivation de l'ouverture automatique du volet latéral d'informations sur mobile (écrans ≤ 768px) lors de l'arrivée sur la page d'administration.

## [1.3.0] - 2026-10-23

### Added
- Ajout de boutons pour copier et partager le lien d'administration complet aux co-organisateurs (dans le volet d'informations et au bas du tableau de bord, automatiquement masqué en mode Présentation).

## [1.2.1] - 2026-10-23

### Security
- Élimination d'une injection DOM-based XSS dans `public/vote.js` via `textContent` au lieu d'une interpolation directe dans `innerHTML`.
- Protection du jeton organisateur `hostSecret` par stockage en `sessionStorage` et nettoyage immédiat de `?t=` de l'URL (`history.replaceState`), empêchant sa fuite lors de projections publiques ou dans l'en-tête `Referer`.
- Ajout des en-têtes HTTP de sécurité (`Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`) contre le détournement de clic (Clickjacking).
- Validation de l'origine WebSocket (`allowRequest`) sur Socket.IO pour bloquer les connexions inter-origines non autorisées.
- Comparaison en temps constant de `hostSecret` via `crypto.timingSafeEqual`.
- Résilience accrue des gestionnaires Socket.IO face aux charges utiles malformées et callbacks invalides (prévention DoS).
- Contrôle strict côté serveur de la date limite de vote (`voting_ends_at`) lors de la soumission d'un bulletin.
- Liaison de l'identifiant votant `voterId` à la connexion active (`socket.data.voterId`) pour empêcher l'usurpation.
- Confidentialité de l'historique lors de `new-item` : transmission du dépouillement complet uniquement aux hôtes.
- Épinglage de la dépendance CDN Typst (`@myriaddreamin/typst.ts@0.7.0`) dans `public/host.js`.
- Remplacement des appels `child_process.execSync` par `execFileSync` sans interprétation par un shell dans `scripts/release.js`.

### Added
- Ajout de la contrainte `UNIQUE KEY uniq_session_numero (session_id, numero)` sur la table `history`.
- Définition des directives d'architecture et invariants de sécurité dans `AGENTS.md`.

## [1.2.0] - 2026-10-19

### Added
- masquage du décompte textuel des secondes au profit de la seule barre de progression
- confirmation explicite obligatoire avant le passage au vote suivant
- refonte ergonomique et améliorations UX du pilotage et du vote

## [1.1.1] - 2026-10-19

### Added
- ajout du script de release semi-automatique npm run release

## [1.1.0] - 2026-10-19

### Added
- Expiration automatique des sessions configurée à 48 heures.
- Persistance et archivage de l'historique des sessions et votes dans MariaDB.

### Security
- Renforcement de la validation des événements et des flux Socket.io.

## [1.0.0] - 2026-09-05

### Added
- Version initiale de l'application de vote en temps réel avec Node.js, Express, Socket.io et MariaDB.
- Interface d'administration pour la gestion et le pilotage des séances de vote en direct.
- Interface participant responsive pour voter en direct avec support QR Code.
- Export et téléchargement des résultats de vote au format PDF via Typst (WASM).
- Configuration de déploiement en production avec PM2 (`ecosystem.config.js`).

### Changed
- Optimisation du broadcast Socket.io des votes pour limiter la charge réseau.
- Repositionnement ergonomique du bouton de téléchargement des résultats avant la clôture de session.

### Fixed
- Correction de l'affichage du dépouillement en mode présentation sans les compteurs de connexion.

[Unreleased]: https://github.com/emiliemichaud/vote-cdm/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/emiliemichaud/vote-cdm/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/emiliemichaud/vote-cdm/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/emiliemichaud/vote-cdm/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/emiliemichaud/vote-cdm/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/emiliemichaud/vote-cdm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/emiliemichaud/vote-cdm/releases/tag/v1.0.0
