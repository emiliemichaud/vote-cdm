# Directives de Développement et Invariants de Sécurité — vote-cdm

Ce document définit les standards d'architecture, les frontières de confiance et les invariants de sécurité stricts que tout agent IA ou développeur doit respecter lors de l'ajout de fonctionnalités ou de la maintenance de ce dépôt.

---

## 1. Vue d'Ensemble de la Pile et Rôles

- **Serveur** : Node.js (v20+), Express 4, Socket.IO v4, pilote `mariadb` (requêtes préparées avec pool).
- **Client** : HTML5 / CSS3 / JavaScript natif (vanilla, sans bundler ni framework).
- **Composition PDF** : Typst compilé via WebAssembly dans le navigateur de l'organisateur (`public/host.js`).
- **Principaux et frontières de confiance** :
  1. *Visiteur anonyme* : Accès public à la page d'accueil et formulaire de saisie de code.
  2. *Votant* : Identifié par un identifiant persistant `voterId` stocké dans `localStorage`, rattaché à son socket actif.
  3. *Organisateur (Hôte)* : Détenteur du jeton de capacité `hostSecret` lui conférant le contrôle exclusif de la séance.

---

## 2. Invariants de Sécurité Obligatoires

### A. Gestionnaires d'Événements Socket.IO (`sockets/handlers.js`)
1. **Protection contre le crash (DoS)** :
   - Tous les gestionnaires doivent obligatoirement être encapsulés dans un bloc `try / catch`.
   - Utiliser systématiquement `toSafeAck(ack)` pour tout acquittement afin de tolérer l'absence ou le type invalide du callback côté client.
   - Toujours normaliser la charge utile reçue :
     ```js
     const data = (payload && typeof payload === 'object') ? payload : {};
     ```
2. **Comparaison en temps constant de `hostSecret`** :
   - Ne jamais comparer `hostSecret` avec l'opérateur d'égalité faible `==` ou strict `===`.
   - Utiliser obligatoirement `isValidHostSecret(session.host_secret, hostSecret)` reposant sur `crypto.timingSafeEqual` sur des tampons de même longueur.
3. **Contrôle d'échéance côté serveur (`voting_ends_at`)** :
   - Lors de l'enregistrement d'un vote (`cast-vote`), ne pas se fier à l'interface client. Vérifier que si `session.status === 'voting'` et `session.voting_ends_at` est défini, `Date.now() <= deadlineMs + 1500` (marge de tolérance réseau).
4. **Liaison du votant au socket actif** :
   - L'identifiant `voterId` doit être enregistré dans `socket.data.voterId` dès `join-as-voter`.
   - Tout événement modifiant un vote (`cast-vote`) doit valider `socket.data.voterId === voterId`.
5. **Isolation stricte des données et des salles (`rooms`)** :
   - Les résultats intermédiaires en direct et l'historique complet des scrutins non publiés sont réservés à `hostRoom(session.code)`.
   - Les votants (`votersRoom(session.code)`) ne doivent recevoir que les résultats explicitement publiés par l'organisateur (`show-results`) et le numéro du vote courant (`itemNumber`).
   - Tout changement de session sur un socket doit appeler `switchSocketRooms` pour quitter proprement les anciennes salles.

### B. Sécurité Côté Client DOM (`public/`)
1. **Élimination des XSS DOM** :
   - Ne jamais injecter de variables issues de l'URL (`window.location.search`, `pathname`), du stockage local ou de Socket.IO directement dans un puits HTML (`element.innerHTML`, `outerHTML`).
   - Utiliser `textContent`, `document.createElement()` ou `replaceChildren()`.
2. **Protection du secret organisateur (`hostSecret`)** :
   - Le secret d'administration ne doit jamais stagner dans la barre d'adresse du navigateur.
   - À l'ouverture de `host.html`, stocker immédiatement le secret dans `sessionStorage` (`host_secret_${code}`) et effacer le paramètre `?t=` via `window.history.replaceState`.
3. **Génération d'identifiants sécurisés** :
   - Utiliser `crypto.randomUUID()` ou `crypto.getRandomValues()` pour générer des identifiants votants. Ne jamais utiliser `Math.random()`.
4. **Dépendances tierces (Typst & CDN)** :
   - Toujours épingler une version exacte et immuable sur les imports dynamiques distants (ex. `@myriaddreamin/typst.ts@0.7.0`).

### C. En-têtes HTTP et Serveur Express (`server.js`)
1. **En-têtes de sécurité obligatoires** :
   - Maintenir les en-têtes défensifs sur toutes les routes :
     - `X-Frame-Options: DENY` (Anti-Clickjacking)
     - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`
     - `Referrer-Policy: no-referrer` (empoche la fuite d'URLs de session)
     - `X-Content-Type-Options: nosniff`
2. **Filtrage d'origine WebSocket** :
   - Valider l'en-tête `Origin` dans l'option `allowRequest` de Socket.IO pour bloquer les connexions inter-origines non autorisées.

### D. Base de Données MariaDB (`db.js`, `sql/schema.sql`)
1. **Requêtes paramétrées obligatoires** :
   - Toujours utiliser les requêtes préparées avec le pilote `mariadb` : `pool.query('SELECT ... WHERE id = ?', [val])`.
   - Ne jamais concaténer de chaînes dans une requête SQL.
2. **Intégrité référentielle** :
   - Respecter les contraintes `UNIQUE KEY uniq_session_voter (session_id, voter_id)` et `UNIQUE KEY uniq_session_numero (session_id, numero)`.

### E. Scripts Système et Déploiement (`scripts/`)
1. **Zéro injection shell** :
   - Ne jamais utiliser `child_process.execSync` avec une chaîne de commande concaténée.
   - Utiliser exclusivement `execFileSync(binary, [args...])` sans invoquer de sous-shell `/bin/sh`.
