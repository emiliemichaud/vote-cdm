const params = new URLSearchParams(window.location.search);
const code = params.get("s");
const hostSecret = params.get("t");
const app = document.getElementById("app");
const socket = getSocket();

let session = null;
let counts = { pour: 0, contre: 0, abstention: 0 };
let total = 0;
let onlineCount = 0;
let history = [];

const DEFAULT_VOTE_SECONDS = 15;
let countdownDeadline = null;
let countdownDuration = null;
let countdownInterval = null;
let autoStopInProgress = false;
let presentationMode = false;

function statusLabel(s) {
  return { idle: "En attente", voting: "Vote en cours", prolonged: "Vote en cours", stopped: "Vote clos", results: "Résultats affichés" }[s] || s;
}

let isQrModalOpen = false;
let isDrawerOpen = false;
let shellRenderedForCode = null;

function buildActionButtons(status, totalVotes) {
  if (status === "idle") {
    return `
      <button id="startBtn">Démarrer les votes (15s)</button>
      <button id="extendBtn" class="secondary">Démarrer sans limite de temps</button>
    `;
  }
  if (status === "voting") {
    return `
      <button id="stopBtn">Arrêter les votes</button>
      <button id="startBtn" class="secondary">Prolonger le vote de 15 secondes</button>
      <button id="extendBtn" class="secondary">Prolonger sans limite de temps</button>
    `;
  }
  if (status === "prolonged") {
    return `
      <button id="stopBtn">Arrêter les votes</button>
    `;
  }
  if (status === "stopped") {
    return `
      <button id="resultsBtn" ${totalVotes === 0 ? "disabled" : ""}>Afficher les résultats des votes</button>
      <button id="startBtn" class="secondary">Prolonger le vote de 15 secondes</button>
      <button id="extendBtn" class="secondary">Prolonger sans limite de temps</button>
      <button id="newBtn" class="secondary">Nouveau vote (même session)</button>
    `;
  }
  return `
    <button id="newBtn">Nouveau vote (même session)</button>
    <button id="startBtn" class="secondary">Prolonger le vote de 15 secondes</button>
    <button id="extendBtn" class="secondary">Prolonger sans limite de temps</button>
  `;
}

function ensureShell(url) {
  if (shellRenderedForCode === session.code && document.getElementById("mainContent")) {
    return;
  }
  shellRenderedForCode = session.code;

  app.innerHTML = `
    <button class="panel-toggle-btn" id="openPanelBtn" title="Infos Session" aria-label="Infos Session">
      <svg class="lucide lucide-menu" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
      <span class="panel-toggle-label">Infos Session</span>
    </button>

    <div class="side-panel ${isDrawerOpen ? 'open' : ''}" id="sidePanel">
      <button class="panel-close-btn" id="closePanelBtn" aria-label="Fermer"><svg class="lucide lucide-x" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      <h3 style="margin-bottom: 16px; color: var(--navy-2); text-align: center;">Rejoindre</h3>
      <div class="code-display" style="padding: 0 0 10px 0;">${session.code}</div>
      <div class="qrcode-wrap" id="qrClickable" title="Agrandir le QR code" style="cursor: zoom-in;"><div id="qrcode"></div></div>
      <div class="url-copy-row" id="copyUrlBtn" title="Cliquer pour copier le lien" role="button" tabindex="0">
        <span class="url-copy-text">${url}</span>
        <span class="url-copy-action" id="copyIconWrap">
          <svg class="lucide lucide-copy" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        </span>
      </div>
      <div class="copy-badge" id="copyBadge">Copié !</div>
      <p class="hint">Les participants scannent ce QR code ou saisissent le code sur ${window.location.origin}</p>
    </div>

    <div class="layout-container">
      <div class="main-content" id="mainContent"></div>
    </div>

    <div id="qrModal" class="modal-overlay" style="display: ${isQrModalOpen ? 'flex' : 'none'};">
      <div class="modal-content">
        <span class="modal-close" id="qrModalClose" title="Fermer"><svg class="lucide lucide-x" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>
        <div class="code-display" style="font-size: 54px; margin-bottom: 20px;">${session.code}</div>
        <div id="qrcode-large"></div>
        <div class="url-copy-text" style="font-size: 18px; margin-top: 20px;">${url}</div>
      </div>
    </div>
  `;

  new QRCode(document.getElementById("qrcode"), {
    text: url, width: 180, height: 180, colorDark: "#1c2321", colorLight: "#ffffff",
  });
  new QRCode(document.getElementById("qrcode-large"), {
    text: url, width: 400, height: 400, colorDark: "#1c2321", colorLight: "#ffffff",
  });

  const copyBtn = document.getElementById("copyUrlBtn");
  const copyIconWrap = document.getElementById("copyIconWrap");
  const copyBadge = document.getElementById("copyBadge");
  const copyIconSvg = `<svg class="lucide lucide-copy" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const checkIconSvg = `<svg class="lucide lucide-check" style="color:var(--pour);" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  if (copyBtn) {
    const triggerCopy = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      if (copyIconWrap) copyIconWrap.innerHTML = checkIconSvg;
      if (copyBadge) copyBadge.classList.add("visible");
      setTimeout(() => {
        if (copyIconWrap) copyIconWrap.innerHTML = copyIconSvg;
        if (copyBadge) copyBadge.classList.remove("visible");
      }, 1800);
    };
    copyBtn.onclick = triggerCopy;
    copyBtn.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        triggerCopy();
      }
    };
  }

  document.getElementById("openPanelBtn").onclick = () => {
    isDrawerOpen = true;
    document.getElementById("sidePanel").classList.add("open");
  };
  document.getElementById("closePanelBtn").onclick = () => {
    isDrawerOpen = false;
    document.getElementById("sidePanel").classList.remove("open");
  };

  document.addEventListener("click", (e) => {
    if (!isDrawerOpen) return;
    const panel = document.getElementById("sidePanel");
    const openBtn = document.getElementById("openPanelBtn");
    if (panel && !panel.contains(e.target) && openBtn && !openBtn.contains(e.target)) {
      isDrawerOpen = false;
      panel.classList.remove("open");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isQrModalOpen) {
        isQrModalOpen = false;
        const m = document.getElementById("qrModal");
        if (m) m.style.display = "none";
      }
      closeDrawer();
    }
  });

  const qrModal = document.getElementById("qrModal");
  document.getElementById("qrClickable").onclick = () => {
    isQrModalOpen = true;
    qrModal.style.display = "flex";
  };
  document.getElementById("qrModalClose").onclick = () => {
    isQrModalOpen = false;
    qrModal.style.display = "none";
  };
  qrModal.onclick = (e) => {
    if (e.target === qrModal) {
      isQrModalOpen = false;
      qrModal.style.display = "none";
    }
  };
}

function closeDrawer() {
  if (isDrawerOpen) {
    isDrawerOpen = false;
    const panel = document.getElementById("sidePanel");
    if (panel) panel.classList.remove("open");
  }
}

function render() {
  if (!session) {
    shellRenderedForCode = null;
    app.innerHTML = `<div class="card center hint">Chargement…</div>`;
    return;
  }
  const url = voteUrlForCode(session.code);
  ensureShell(url);

  const isVotingMode = (session.status === "voting" || session.status === "prolonged");
  const bannerClass = isVotingMode ? "voting" : session.status === "stopped" ? "stopped" : "";
  const itemNumber = history.length + 1;

  let timerHtml = "";
  if (isVotingMode) {
    if (session.status === "prolonged") {
      timerHtml = `<div class="vote-timer-extended">Temps prolongé</div>`;
    } else {
      const remainingMs = countdownDeadline ? Math.max(0, countdownDeadline - Date.now()) : 0;
      const secs = Math.ceil(remainingMs / 1000);
      const pct = countdownDuration ? (remainingMs / countdownDuration) * 100 : 0;
      const warningClass = remainingMs <= 3000 ? "warning" : "";
      timerHtml = `
        <div id="timerSeconds" class="timer-seconds ${warningClass}">${secs}s</div>
        <div class="timer-bar-track"><div id="timerBarFill" class="timer-bar-fill ${warningClass}" style="width: ${pct}%"></div></div>
      `;
    }
  }

  let lowerContent = "";
  if (session.status === "results") {
    lowerContent = buildResultCard(counts, total, presentationMode, onlineCount);
  } else if (presentationMode) {
    lowerContent = `
    <div class="card center">
      <div class="eyebrow" style="margin-bottom:8px;">Participation</div>
      <div class="turnout" style="font-size:18px; margin: 10px 0 6px;">${total} vote${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}</div>
    </div>
    `;
  } else {
    const onlineHtml = `<div class="turnout" style="margin-bottom:8px;">${onlineCount} connexion${onlineCount > 1 ? "s" : ""} en ce moment</div>`;
    lowerContent = `
    <div class="card">
      <div class="eyebrow center" style="display:block; margin-bottom:6px;">Dépouillement en direct</div>
      ${onlineHtml}
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, total)}
        ${tallyRow("Contre", "contre", counts.contre, total)}
        ${tallyRow("Abstention", "abst", counts.abstention, total)}
      </div>
      <div class="turnout" style="margin-top:14px;">${total} vote${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}</div>
    </div>
    `;
  }

  const mainContent = document.getElementById("mainContent");
  mainContent.innerHTML = `
    <div class="card center">
      <div class="eyebrow" style="margin-bottom:8px;">Vote n°${itemNumber}</div>
      <div class="status-banner ${bannerClass}">${statusLabel(session.status)}</div>
      ${timerHtml}
      <p class="hint">Cette session expirera automatiquement le ${formatExpiryDate(session)}.</p>
    </div>

    <div class="card">
      <div class="stack">
        ${buildActionButtons(session.status, total)}
      </div>
    </div>

    <div class="segmented-control" title="Basculer le mode d'affichage">
      <input type="radio" id="mode-org" name="display-mode" value="org" ${!presentationMode ? "checked" : ""}>
      <label for="mode-org">Organisateur</label>
      <input type="radio" id="mode-pres" name="display-mode" value="pres" ${presentationMode ? "checked" : ""}>
      <label for="mode-pres">Présentation</label>
      <div class="segment-slider"></div>
    </div>

    ${lowerContent}

    <div class="card">
      <div class="stack">
        <button id="downloadPdfBtn" class="secondary">Télécharger les résultats</button>
        <button id="closeBtn" class="danger">Clôture de session</button>
      </div>
      <p class="hint" style="margin-top:10px;">Ferme définitivement cette session et supprime tous ses votes de la base de données. Action irréversible.</p>
    </div>
  `;

  const bindClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };
  bindClick("startBtn", startVoting);
  bindClick("extendBtn", prolongVoting);
  bindClick("stopBtn", stopVoting);
  bindClick("resultsBtn", showResults);
  bindClick("newBtn", resetSessionForNewItem);
  bindClick("closeBtn", closeSessionPermanently);
  document.getElementsByName("display-mode").forEach(radio => {
    radio.onchange = (event) => {
      presentationMode = (event.target.value === "pres");
      render();
    };
  });

  const dlBtn = document.getElementById("downloadPdfBtn");
  dlBtn.onclick = downloadPdf;
  dlBtn.style.display = (total > 0 || history.length > 0) ? "block" : "none";
}

function buildResultCard(counts, total, isPresentation, onlineCount) {
  let verdict = "Égalité";
  let verdictClass = "";
  if (counts.pour > counts.contre) { verdict = "Résultat : Pour"; verdictClass = "pour"; }
  else if (counts.contre > counts.pour) { verdict = "Résultat : Contre"; verdictClass = "contre"; }

  const onlineHtml = !isPresentation ? `<div class="turnout" style="margin-bottom:8px;">${onlineCount} connexion${onlineCount > 1 ? "s" : ""} en ce moment</div>` : "";

  return `
    <div class="card">
      <div class="verdict ${verdictClass}">${verdict}</div>
      ${onlineHtml}
      <div class="turnout">${total} votant${total > 1 ? "s" : ""}</div>
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, total, true)}
        ${tallyRow("Contre", "contre", counts.contre, total, true)}
        ${tallyRow("Abstention", "abst", counts.abstention, total, true)}
      </div>
    </div>
  `;
}

function tallyRow(label, cls, count, total, showPct = false) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const countText = (showPct && total > 0) ? `${count} <span style="font-size:15px; font-weight:normal; opacity:0.75;">(${pct}%)</span>` : `${count}`;
  return `
    <div class="label ${cls}">${label}</div>
    <div class="count">${countText}</div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
  `;
}

function clearVoteTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  countdownDeadline = null;
  autoStopInProgress = false;
}

function beginVoteTimer(seconds = DEFAULT_VOTE_SECONDS) {
  if (countdownInterval) clearInterval(countdownInterval);
  autoStopInProgress = false;
  countdownDuration = seconds * 1000;
  countdownDeadline = Date.now() + countdownDuration;
  countdownInterval = setInterval(() => {
    const remainingMs = Math.max(0, countdownDeadline - Date.now());
    const timerBarFill = document.getElementById("timerBarFill");
    const timerSeconds = document.getElementById("timerSeconds");
    if (timerBarFill) {
      const pct = (remainingMs / countdownDuration) * 100;
      timerBarFill.style.width = pct + "%";
      timerBarFill.classList.toggle("warning", remainingMs <= 3000);
    }
    if (timerSeconds) {
      timerSeconds.textContent = Math.ceil(remainingMs / 1000) + "s";
      timerSeconds.classList.toggle("warning", remainingMs <= 3000);
    }
    if (remainingMs <= 0 && session && session.status === "voting" && !autoStopInProgress) {
      autoStopInProgress = true;
      clearInterval(countdownInterval);
      countdownInterval = null;
      stopVoting();
    }
  }, 50);
}

function startVoting() {
  closeDrawer();
  beginVoteTimer(DEFAULT_VOTE_SECONDS);
  socket.emit("start-voting", { code, hostSecret, seconds: DEFAULT_VOTE_SECONDS }, (res) => {
    if (!res.ok) { clearVoteTimer(); alert("Erreur : " + res.error); return; }
  });
}

function prolongVoting() {
  if (!session || session.status === "prolonged") return;
  closeDrawer();
  socket.emit("prolong-voting", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function stopVoting() {
  socket.emit("stop-voting", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function showResults() {
  socket.emit("show-results", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function closeSessionPermanently() {
  if (!confirm("Clôturer définitivement cette session ? Tous les votes seront supprimés et le lien ne fonctionnera plus. Cette action est irréversible.")) {
    return;
  }
  const closeBtn = document.getElementById("closeBtn");
  if (closeBtn) closeBtn.disabled = true;

  socket.emit("close-session", { code, hostSecret }, (res) => {
    if (!res.ok) {
      alert("Erreur : " + res.error);
      if (closeBtn) closeBtn.disabled = false;
      return;
    }
    clearVoteTimer();
    session = null;
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  });
}

function resetSessionForNewItem() {
  const currentNum = history.length + 1;
  const nextNum = currentNum + 1;
  const msg = (session && session.status !== "results" && total > 0)
    ? `Passer au vote suivant (Vote n°${nextNum}) sans afficher les résultats ?\n\nCe vote sera clôturé et archivé pour l'export PDF. Cette action est irréversible.`
    : `Passer au vote suivant (Vote n°${nextNum}) ?\n\nLe résultat actuel sera archivé pour l'export PDF et les compteurs seront remis à zéro. Cette action est irréversible.`;

  if (!confirm(msg)) {
    return;
  }
  const newBtn = document.getElementById("newBtn");
  if (newBtn) newBtn.disabled = true;

  socket.emit("new-item", { code, hostSecret }, (res) => {
    if (newBtn) newBtn.disabled = false;
    if (!res.ok) {
      alert("Erreur : " + res.error);
      return;
    }
  });
}

// --- Écoute des événements serveur (diffusion + resynchronisation) ---

let listenersAttached = false;
function attachSocketListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  socket.on("session-updated", (payload) => {
    if (!session) return;
    session.status = payload.status;

    if (payload.status === "voting") {
      beginVoteTimer(payload.seconds || DEFAULT_VOTE_SECONDS);
    } else {
      clearVoteTimer();
    }
    if (payload.status === "results" && payload.counts) {
      counts = payload.counts;
      total = payload.total;
    }
    if (payload.reset) {
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
      if (payload.history) {
        history = payload.history;
      }
    }
    render();
  });

  socket.on("results:update", (payload) => {
    counts = payload.counts;
    total = payload.total;
    render();
  });

  socket.on("presence-updated", (payload) => {
    onlineCount = payload.onlineCount;
    render();
  });

  socket.on("session-closed", () => {
    clearVoteTimer();
    session = null;
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  });
}

// Rejoint le dashboard : appelé à la connexion initiale ET à chaque
// reconnexion socket (coupure Wi-Fi/4G), pour ne jamais rester bloqué
// sur un état obsolète après une coupure.
function joinSession() {
  if (!code || !hostSecret) {
    app.innerHTML = `<div class="card center hint">Lien invalide. <a href="index.html">Démarrer une nouvelle session</a></div>`;
    return;
  }
  socket.emit("join-as-host", { code, hostSecret }, (res) => {
    if (!res.ok) {
      if (!session) {
        app.innerHTML = `<div class="card center hint">Lien invalide ou expiré. <a href="index.html">Démarrer une nouvelle session</a></div>`;
      }
      return;
    }
    const isFirstLoad = !session;
    const wasVoting = session && (session.status === "voting" || session.status === "prolonged");
    session = res.session;
    counts = res.counts;
    total = res.total;
    onlineCount = res.onlineCount || 0;
    if (res.history) {
      history = res.history;
    }
    if (isFirstLoad && session.status === "idle" && total === 0 && history.length === 0) {
      isDrawerOpen = true;
    }

    // Si le vote était en cours et qu'aucun minuteur local ne tourne
    // (ex : reprise après coupure réseau), on relance le minuteur sur le
    // temps réellement restant (calculé côté serveur depuis voting_ends_at),
    // pas sur une durée fixe.
    if (session.status === "voting" && !countdownInterval) {
      if (res.remainingSeconds > 0) {
        beginVoteTimer(res.remainingSeconds);
      } else {
        // Le délai était déjà écoulé pendant la coupure : on clôt tout
        // de suite plutôt que d'afficher un minuteur qui n'existe plus.
        render();
        stopVoting();
        return;
      }
    } else if (session.status !== "voting" && !wasVoting) {
      clearVoteTimer();
    }

    render();
  });
}

attachSocketListeners();
socket.on("connect", joinSession);

let isTypstInitialized = false;

async function downloadPdf() {
  const btn = document.getElementById("downloadPdfBtn");
  const originalText = btn.innerHTML;
  btn.innerHTML = "Génération...";
  btn.disabled = true;

  try {
    const { $typst } = await import('https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js');
    if (!isTypstInitialized) {
      await $typst.setCompilerInitOptions({
        getModule: () => 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm'
      });
      
      const fontUrls = [
        'fonts/Arial.ttf',
        'fonts/Arial Bold.ttf',
        'fonts/Courier New.ttf',
        'fonts/FiraCode-Regular.ttf',
        'fonts/Helvetica.ttc',
        'fonts/Menlo.ttc'
      ];
      const fontBuffers = (await Promise.all(
        fontUrls.map(path => fetch(path).then(r => r.arrayBuffer()).catch(() => null))
      )).filter(Boolean).map(buf => new Uint8Array(buf));

      if (fontBuffers.length) {
        const { TypstSnippet } = await import('https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js');
        $typst.use(TypstSnippet.preloadFonts(fontBuffers));
      }
      isTypstInitialized = true;
    }

    const fetchTypstFile = async (path) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Impossible de charger ${path} (Avez-vous redémarré le serveur Node ?)`);
      return res.text();
    };

    const [libTyp, translationsTyp, showy, func, id, pre, sections, shadows] = await Promise.all([
      fetchTypstFile('/typ/vote-card/lib.typ'),
      fetchTypstFile('/typ/vote-card/translations.typ'),
      fetchTypstFile('/typ/showybox/showy.typ'),
      fetchTypstFile('/typ/showybox/lib/func.typ'),
      fetchTypstFile('/typ/showybox/lib/id.typ'),
      fetchTypstFile('/typ/showybox/lib/pre-rendering.typ'),
      fetchTypstFile('/typ/showybox/lib/sections.typ'),
      fetchTypstFile('/typ/showybox/lib/shadows.typ')
    ]);

    $typst.addSource('/typ/vote-card/lib.typ', libTyp);
    // lib.typ importe "translations.typ", résolu dans le même dossier
    $typst.addSource('/typ/vote-card/translations.typ', translationsTyp);
    
    // Ajout de showybox au système de fichiers virtuel
    $typst.addSource('/typ/showybox/showy.typ', showy);
    $typst.addSource('/typ/showybox/lib/func.typ', func);
    $typst.addSource('/typ/showybox/lib/id.typ', id);
    $typst.addSource('/typ/showybox/lib/pre-rendering.typ', pre);
    $typst.addSource('/typ/showybox/lib/sections.typ', sections);
    $typst.addSource('/typ/showybox/lib/shadows.typ', shadows);

    const dateStr = new Date().toLocaleString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const allResults = history.map(h => ({ ...h }));
    if (total > 0 || (session && session.status === "results")) {
      allResults.push({ numero: allResults.length + 1, pour: counts.pour, contre: counts.contre, abstention: counts.abstention, total: total });
    }

    const cardsTypst = allResults.map(r => `  [#vote-card(numero: ${r.numero}, pour: ${r.pour}, contre: ${r.contre}, abstention: ${r.abstention}, connexions: ${r.total})]`).join(',\n');

    const typstCode = `
#import "/typ/vote-card/lib.typ": vote-card
#import "/typ/showybox/showy.typ": *

#set page(margin: 1.5cm, fill: rgb("#ffffff"), footer: align(center)[Page #context here().page() sur #context counter(page).final().at(0) ])
#set text(font: ("Helvetica", "Arial", "sans-serif"))

#showybox(
  frame: (
    radius: 0pt,
    thickness: 0.5pt,
  ),
  shadow: (
    offset: 3pt,
  ),
  align: center,
  align(center)[#text(size: 15pt)[Résultats des votes de la session ${session ? session.code : ''}]],
)

#v(2em)
Document généré le ${dateStr}

#v(2em)
#grid(
  columns: 3,
  stroke: .0pt,
  column-gutter: 1em,
  row-gutter: 1em,
  inset: 5pt,
  align: center + horizon,
${cardsTypst}
)
`;

    $typst.addSource('/main.typ', typstCode);
    const pdfBytes = await $typst.pdf({ mainFilePath: '/main.typ' });

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // On libérera l'URL au bout de quelques secondes pour être sûr que l'onglet l'a bien chargée
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    alert("Erreur lors de la génération du PDF : " + err.message);
    console.error(err);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
