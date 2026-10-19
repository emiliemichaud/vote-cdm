# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère à [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/emiliemichaud/vote-cdm/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/emiliemichaud/vote-cdm/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/emiliemichaud/vote-cdm/releases/tag/v1.0.0
