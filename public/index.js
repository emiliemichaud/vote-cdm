const socket = getSocket();

document.getElementById("createBtn").addEventListener("click", () => {
  const btn = document.getElementById("createBtn");
  const err = document.getElementById("err");
  btn.disabled = true;
  err.style.display = "none";

  socket.emit("create-session", {}, (res) => {
    if (!res.ok) {
      err.textContent = "Erreur : " + res.error;
      err.style.display = "block";
      btn.disabled = false;
      return;
    }
    try {
      sessionStorage.setItem("host_active_code", res.code);
      sessionStorage.setItem(`host_secret_${res.code}`, res.hostSecret);
    } catch (_) {}
    window.location.href = "host.html";
  });
});

document.getElementById("joinBtn").addEventListener("click", () => {
  const joinBtn = document.getElementById("joinBtn");
  const joinErr = document.getElementById("joinErr");
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  joinErr.style.display = "none";
  if (!code) {
    joinErr.textContent = "Saisis d'abord un code de session.";
    joinErr.style.display = "block";
    return;
  }
  joinBtn.disabled = true;

  let resolved = false;
  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      joinBtn.disabled = false;
      window.location.href = voteUrlForCode(code);
    }
  }, 3000);

  socket.emit("join-as-voter", { code, voterId: getVoterId() }, (res) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timer);
    joinBtn.disabled = false;
    if (res && !res.ok) {
      joinErr.textContent = res.error || "Session introuvable.";
      joinErr.style.display = "block";
      return;
    }
    window.location.href = voteUrlForCode(code);
  });
});

document.getElementById("joinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("joinBtn").click();
});

document.getElementById("joinCode")?.focus();
