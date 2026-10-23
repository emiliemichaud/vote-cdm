const code = getSessionCodeFromLocation();
const app = document.getElementById("app");
const socket = getSocket();

let session = null;
let hasVoted = false;
let counts = { pour: 0, contre: 0, abstention: 0 };
let total = 0;
let itemNumber = 1;
let voting = false;
const voterId = getVoterId();
const DEFAULT_VOTE_SECONDS = 15;
const SHOW_TIMER_SECONDS = false; // Passer à true si souhaité pour réafficher le décompte chiffré en secondes
let countdownDeadline = null;
let countdownDuration = null;
let countdownInterval = null;

function statusLabel(s) {
  return { idle: "En attente du début du vote", voting: "Vote en cours", prolonged: "Vote en cours", stopped: "Vote clos", results: "Résultats" }[s] || s;
}

function render() {
  if (!session) { app.innerHTML = `<div class="card center hint">Chargement…</div>`; return; }

  if (session.status === "results") {
    renderResults();
    return;
  }

  const isVotingMode = (session.status === "voting" || session.status === "prolonged");
  const itemBadge = `<div class="eyebrow" style="margin-bottom:8px;">Vote n°${itemNumber}</div>`;

  if (isVotingMode && !hasVoted) {
    app.innerHTML = `
      <div class="card center">
        ${itemBadge}
        <div class="status-banner voting">Vote en cours</div>
        ${timerMarkup()}
        <p class="hint">Choisissez une option. Vous ne pourrez voter qu'une seule fois.</p>
      </div>
      <div class="choice-grid">
        <button class="choice-btn pour" data-choice="pour">Pour</button>
        <button class="choice-btn contre" data-choice="contre">Contre</button>
        <button class="choice-btn abst" data-choice="abstention">Abstention</button>
      </div>
    `;
    app.querySelectorAll(".choice-btn").forEach((b) => {
      b.onclick = () => castVote(b.dataset.choice);
    });
    return;
  }

  if (hasVoted && session.status !== "results") {
    app.innerHTML = `<div class="card center">${itemBadge}${isVotingMode ? timerMarkup() : ""}<div class="locked-msg"><svg class="lucide lucide-check" style="vertical-align: -3px; color: var(--pour); margin-right: 6px;" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Votre vote a été enregistré.<br><span class="hint">${isVotingMode ? "En attente de la clôture du vote." : "Les votes sont clos."}</span></div></div>`;
    return;
  }

  const banner = session.status === "stopped" ? `<div class="status-banner stopped">Vote clos</div>` : `<div class="status-banner">${statusLabel(session.status)}</div>`;
  app.innerHTML = `<div class="card center">${itemBadge}${banner}<p class="locked-msg" style="margin-top:0;">${session.status === "stopped" ? "Les votes sont clos." : "En attente du début du vote…"}</p></div>`;
}

function timerMarkup() {
  if (session.status === "prolonged") return `<div class="vote-timer-extended">Temps prolongé</div>`;
  const remainingMs = countdownDeadline ? Math.max(0, countdownDeadline - Date.now()) : 0;
  const secs = Math.ceil(remainingMs / 1000);
  const pct = countdownDuration ? (remainingMs / countdownDuration) * 100 : 0;
  const warningClass = remainingMs <= 3000 ? "warning" : "";
  const secondsHtml = SHOW_TIMER_SECONDS ? `<div id="timerSeconds" class="timer-seconds ${warningClass}">${secs}s</div>` : "";
  return `
    ${secondsHtml}
    <div class="timer-bar-track"><div id="timerBarFill" class="timer-bar-fill ${warningClass}" style="width: ${pct}%"></div></div>
  `;
}

function stopLocalTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  countdownDeadline = null;
}

function beginLocalTimer(seconds = DEFAULT_VOTE_SECONDS) {
  if (countdownInterval) clearInterval(countdownInterval);
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
    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 50);
  render();
}

function renderResults() {
  const t = total;
  let verdict = "Égalité";
  let verdictClass = "";
  if (counts.pour > counts.contre) { verdict = "Résultat : Pour"; verdictClass = "pour"; }
  else if (counts.contre > counts.pour) { verdict = "Résultat : Contre"; verdictClass = "contre"; }

  app.innerHTML = `
    <div class="card">
      <div class="eyebrow center" style="display:block; margin-bottom:6px;">Vote n°${itemNumber}</div>
      <div class="verdict ${verdictClass}">${verdict}</div>
      <div class="turnout">${t} votant${t > 1 ? "s" : ""}</div>
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, t, true)}
        ${tallyRow("Contre", "contre", counts.contre, t, true)}
        ${tallyRow("Abstention", "abst", counts.abstention, t, true)}
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

function castVote(choice) {
  if (voting) return;
  if (navigator.vibrate) {
    try { navigator.vibrate(40); } catch (_) {}
  }
  voting = true;
  app.querySelectorAll(".choice-btn").forEach((b) => {
    b.disabled = true;
    if (b.dataset.choice === choice) {
      b.classList.add("selected");
    } else {
      b.style.opacity = "0.35";
    }
  });

  socket.emit("cast-vote", { code: session.code, voterId, choice }, (res) => {
    voting = false;
    if (!res.ok) {
      alert("Erreur : " + res.error);
      app.querySelectorAll(".choice-btn").forEach((b) => {
        b.disabled = false;
        b.classList.remove("selected");
        b.style.opacity = "";
      });
      return;
    }
    hasVoted = true;
    render();
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

    if (session.status === "voting") {
      beginLocalTimer(payload.seconds || DEFAULT_VOTE_SECONDS);
    } else if (session.status === "prolonged") {
      stopLocalTimer();
      render();
    } else {
      stopLocalTimer();
    }

    if (session.status === "results") {
      counts = payload.counts;
      total = payload.total;
      render();
    } else if (payload.reset) {
      hasVoted = false;
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
      if (payload.itemNumber) {
        itemNumber = payload.itemNumber;
      } else if (payload.history) {
        itemNumber = payload.history.length + 1;
      }
      render();
    } else {
      render();
    }
  });

  socket.on("session-closed", () => {
    session = null;
    const expiryNote = document.getElementById("expiryNote");
    if (expiryNote) expiryNote.style.display = "none";
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et n'est plus disponible.</div>`;
  });
}

// Rejoint la session : appelé à la connexion initiale ET à chaque
// reconnexion socket (coupure Wi-Fi/4G), pour ne jamais rester bloqué
// sur un état obsolète après une coupure.
function joinSession() {
  if (!code) {
    app.innerHTML = `<div class="card center hint">Aucun code de session fourni.</div>`;
    return;
  }
  socket.emit("join-as-voter", { code, voterId }, (res) => {
    if (!res || !res.ok) {
      if (!session) {
        const card = document.createElement("div");
        card.className = "card center hint";
        card.append("Session introuvable. Vérifiez le code : ");
        const strong = document.createElement("strong");
        strong.textContent = code || "";
        card.appendChild(strong);
        app.replaceChildren(card);
      }
      return;
    }
    const wasVoting = session && (session.status === "voting" || session.status === "prolonged");
    session = res.session;
    hasVoted = res.hasVoted;
    counts = res.counts;
    total = res.total;
    if (res.itemNumber) itemNumber = res.itemNumber;

    const expiryNote = document.getElementById("expiryNote");
    const expiry = formatExpiryDate(session);
    if (expiryNote && expiry) {
      expiryNote.textContent = `Cette session expirera automatiquement le ${expiry}.`;
      expiryNote.style.display = "block";
    }

    if (session.status === "voting" && !countdownInterval) {
      // Temps réellement restant calculé côté serveur, évite de redonner 15s pleines à quelqu'un qui se reconnecte en fin de vote.
      beginLocalTimer(res.remainingSeconds > 0 ? res.remainingSeconds : 0);
    } else if (session.status === "prolonged") {
      stopLocalTimer();
      render();
    } else if (!wasVoting) {
      stopLocalTimer();
      render();
    } else {
      render();
    }
  });
}

attachSocketListeners();
socket.on("connect", joinSession);
