// ============================================================
// Fonctions partagées entre host.html et vote.html
// ============================================================

let _socket;
function getSocket() {
  if (!_socket) {
    _socket = io();
    setupConnectionMonitor(_socket);
  }
  return _socket;
}

function setupConnectionMonitor(socket) {
  let banner = null;
  function getBanner() {
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "connection-banner";
      banner.textContent = "Connexion interrompue… reconnexion en cours";
      document.body.appendChild(banner);
    }
    return banner;
  }
  socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") {
      getBanner().classList.add("visible");
    }
  });
  socket.on("connect", () => {
    if (banner) banner.classList.remove("visible");
  });
  socket.on("connect_error", () => {
    getBanner().classList.add("visible");
  });
}

// Identifiant anonyme et persistant du votant, propre à ce navigateur
function getVoterId() {
  let id = localStorage.getItem("voter_id");
  if (!id || typeof id !== "string" || id.length < 8 || id.length > 64) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      id = crypto.randomUUID();
    } else if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      id = "voter_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
    try {
      localStorage.setItem("voter_id", id);
    } catch (_) {}
  }
  return id;
}

// Lien court : https://ton-domaine/CODE
function voteUrlForCode(code) {
  return window.location.origin + "/" + code;
}

const RESERVED_PATH_NAMES = ["", "index.html", "vote.html", "host.html", "404.html"];

function getSessionCodeFromLocation() {
  const fromQuery = new URLSearchParams(window.location.search).get("s");
  if (fromQuery) {
    const clean = fromQuery.trim().toUpperCase();
    return /^[A-Z0-9]{4,10}$/.test(clean) ? clean : null;
  }

  const segment = window.location.pathname.split("/").filter(Boolean).pop() || "";
  if (!RESERVED_PATH_NAMES.includes(segment.toLowerCase())) {
    const clean = segment.trim().toUpperCase();
    return /^[A-Z0-9]{4,10}$/.test(clean) ? clean : null;
  }
  return null;
}

// created_at + 48h, au format "JJ.MM.AAAA à HH:MM"
function formatExpiryDate(session) {
  if (!session || !session.created_at) return null;
  const created = new Date(session.created_at);
  const expiry = new Date(created.getTime() + 48 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(expiry.getDate())}.${pad(expiry.getMonth() + 1)}.${expiry.getFullYear()} à ${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;
}

function tallyCounts(votes) {
  const counts = { pour: 0, contre: 0, abstention: 0 };
  for (const v of votes) {
    if (counts[v.choice] !== undefined) counts[v.choice]++;
  }
  return counts;
}
