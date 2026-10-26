const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const pool = require('../db');

// Migration automatique non bloquante si la colonne is_locked n'existe pas encore
pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_locked TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

const room = (code) => `session:${code}`;
const votersRoom = (code) => `voters:${code}`;
const hostRoom = (code) => `host:${code}`;

const tallyTimers = new Map();
const allowedVotersBySession = new Map();
const TALLY_PUSH_INTERVAL_MS = 200;

function getAllowedVoters(code) {
  let set = allowedVotersBySession.get(code);
  if (!set) {
    set = new Set();
    allowedVotersBySession.set(code, set);
  }
  return set;
}

function isValidHostSecret(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const bufA = Buffer.from(expected);
  const bufB = Buffer.from(provided);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function getSessionByCode(code) {
  if (!code || typeof code !== 'string') return null;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(clean)) return null;
  const rows = await pool.query(
    'SELECT * FROM sessions WHERE code = ? AND created_at >= (NOW() - INTERVAL 48 HOUR)',
    [clean]
  );
  return rows[0] || null;
}

function toPublicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    code: session.code,
    status: session.status,
    is_locked: Boolean(session.is_locked),
    created_at: session.created_at,
    voting_ends_at: session.voting_ends_at,
  };
}

function isValidVoterId(voterId) {
  return typeof voterId === 'string' && voterId.length >= 8 && voterId.length <= 64;
}

function toSafeAck(ack) {
  return typeof ack === 'function' ? ack : () => {};
}

// Agrégation faite en SQL plutôt qu'en JS
async function getTally(sessionId) {
  const rows = await pool.query(
    `SELECT choice, COUNT(*) AS count FROM votes WHERE session_id = ? GROUP BY choice`,
    [sessionId]
  );
  const counts = { pour: 0, contre: 0, abstention: 0 };
  for (const row of rows) counts[row.choice] = Number(row.count);
  const total = counts.pour + counts.contre + counts.abstention;
  return { counts, total };
}

async function getHistory(sessionId) {
  const rows = await pool.query(
    `SELECT numero, pour, contre, abstention, total FROM history WHERE session_id = ? ORDER BY numero ASC`,
    [sessionId]
  );
  return rows.map((r) => ({
    numero: Number(r.numero),
    pour: Number(r.pour),
    contre: Number(r.contre),
    abstention: Number(r.abstention),
    total: Number(r.total),
  }));
}

function onlineVoters(io, code) {
  return io.sockets.adapter.rooms.get(votersRoom(code))?.size || 0;
}

function scheduleTallyUpdate(io, code, sessionId) {
  if (tallyTimers.has(code)) return;

  const timer = setTimeout(async () => {
    tallyTimers.delete(code);
    try {
      const { counts, total } = await getTally(sessionId);
      io.to(hostRoom(code)).emit('results:update', { counts, total });
    } catch (err) {
      console.error('scheduleTallyUpdate', err);
    }
  }, TALLY_PUSH_INTERVAL_MS);

  timer.unref?.();
  tallyTimers.set(code, timer);
}

function cancelTallyUpdate(code) {
  const timer = tallyTimers.get(code);
  if (timer) clearTimeout(timer);
  tallyTimers.delete(code);
}

// Temps restant réel avant la fin du vote, calculé depuis voting_ends_at (stocké en base)
function remainingSeconds(session) {
  if (session.status !== 'voting' || !session.voting_ends_at) return null;
  const ms = new Date(session.voting_ends_at).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 1000));
}

function switchSocketRooms(io, socket, newCode, isHost) {
  const oldCode = socket.data.code;
  if (oldCode && oldCode !== newCode) {
    socket.leave(room(oldCode));
    socket.leave(votersRoom(oldCode));
    socket.leave(hostRoom(oldCode));
    io.to(hostRoom(oldCode)).emit('presence-updated', { onlineCount: onlineVoters(io, oldCode) });
  }
  socket.join(room(newCode));
  if (isHost) {
    socket.join(hostRoom(newCode));
  } else {
    socket.join(votersRoom(newCode));
  }
  socket.data.code = newCode;
}

function registerHandlers(io, socket) {
  // --- Création de session ---
  socket.on('create-session', async (_payload, ack) => {
    const sendAck = toSafeAck(ack);
    try {
      const id = uuidv4();
      const hostSecret = uuidv4();
      let code;
      for (let i = 0; i < 5; i++) {
        code = generateCode();
        if (!(await getSessionByCode(code))) break;
      }
      await pool.query(
        `INSERT INTO sessions (id, code, status, host_secret) VALUES (?, ?, 'idle', ?)`,
        [id, code, hostSecret]
      );
      sendAck({ ok: true, code, hostSecret });
    } catch (err) {
      console.error('create-session', err);
      sendAck({ ok: false, error: 'Erreur lors de la création de la session' });
    }
  });

  // --- L'organisateur rejoint le dashboard d'une session ---
  socket.on('join-as-host', async (payload, ack) => {
    const sendAck = toSafeAck(ack);
    try {
      const data = (payload && typeof payload === 'object') ? payload : {};
      const { code, hostSecret } = data;
      const session = await getSessionByCode(code);
      if (!session || !isValidHostSecret(session.host_secret, hostSecret)) {
        return sendAck({ ok: false, error: 'Lien invalide ou expiré' });
      }
      switchSocketRooms(io, socket, session.code, true);
      const { counts, total } = await getTally(session.id);
      const history = await getHistory(session.id);
      sendAck({
        ok: true,
        session: toPublicSession(session),
        counts,
        total,
        history,
        onlineCount: onlineVoters(io, session.code),
        remainingSeconds: remainingSeconds(session),
      });
    } catch (err) {
      console.error('join-as-host', err);
      sendAck({ ok: false, error: 'Erreur serveur' });
    }
  });

  // --- Un participant rejoint le bulletin de vote ---
  socket.on('join-as-voter', async (payload, ack) => {
    const sendAck = toSafeAck(ack);
    try {
      const data = (payload && typeof payload === 'object') ? payload : {};
      const { code, voterId } = data;
      if (!isValidVoterId(voterId)) {
        return sendAck({ ok: false, error: 'Identifiant votant invalide' });
      }
      if (socket.data.voterId && socket.data.voterId !== voterId) {
        return sendAck({ ok: false, error: 'Identifiant votant incohérent pour cette connexion' });
      }

      const session = await getSessionByCode(code);
      if (!session) return sendAck({ ok: false, error: 'Session introuvable' });

      const allowedVoters = getAllowedVoters(session.code);
      const isAlreadyAllowed = allowedVoters.has(voterId);

      if (session.is_locked && !isAlreadyAllowed) {
        const existingVote = await pool.query(
          'SELECT id FROM votes WHERE session_id = ? AND voter_id = ? LIMIT 1',
          [session.id, voterId]
        );
        if (existingVote.length === 0) {
          return sendAck({
            ok: false,
            locked: true,
            error: 'Cette session est verrouillée. De nouveaux participants ne peuvent plus la rejoindre.',
          });
        }
      }

      allowedVoters.add(voterId);
      switchSocketRooms(io, socket, session.code, false);
      socket.data.voterId = voterId;

      const existing = await pool.query(
        'SELECT id FROM votes WHERE session_id = ? AND voter_id = ?',
        [session.id, voterId]
      );
      const hasVoted = existing.length > 0;

      let counts = { pour: 0, contre: 0, abstention: 0 };
      let total = 0;
      if (session.status === 'results') ({ counts, total } = await getTally(session.id));

      const countRows = await pool.query(
        'SELECT COUNT(*) AS count FROM history WHERE session_id = ?',
        [session.id]
      );
      const itemNumber = Number(countRows[0]?.count || 0) + 1;

      io.to(hostRoom(session.code)).emit('presence-updated', { onlineCount: onlineVoters(io, session.code) });

      sendAck({
        ok: true,
        session: toPublicSession(session),
        hasVoted,
        counts,
        total,
        itemNumber,
        remainingSeconds: remainingSeconds(session),
      });
    } catch (err) {
      console.error('join-as-voter', err);
      sendAck({ ok: false, error: 'Erreur serveur' });
    }
  });

  // --- Un participant vote ---
  socket.on('cast-vote', async (payload, ack) => {
    const sendAck = toSafeAck(ack);
    try {
      const data = (payload && typeof payload === 'object') ? payload : {};
      const { code, voterId, choice } = data;
      if (!isValidVoterId(voterId)) {
        return sendAck({ ok: false, error: 'Identifiant votant invalide' });
      }
      if (socket.data.voterId && socket.data.voterId !== voterId) {
        return sendAck({ ok: false, error: 'Connexion de vote non autorisée pour cet identifiant' });
      }
      if (!['pour', 'contre', 'abstention'].includes(choice)) {
        return sendAck({ ok: false, error: 'Choix invalide' });
      }
      const session = await getSessionByCode(code);
      if (!session) return sendAck({ ok: false, error: 'Session introuvable' });
      if (session.is_locked && !getAllowedVoters(session.code).has(voterId)) {
        return sendAck({
          ok: false,
          locked: true,
          error: 'Cette session est verrouillée. De nouveaux participants ne peuvent plus la rejoindre.',
        });
      }
      if (!['voting', 'prolonged'].includes(session.status)) {
        return sendAck({ ok: false, error: "Le vote n'est pas ouvert" });
      }
      if (session.status === 'voting' && session.voting_ends_at) {
        const deadlineMs = new Date(session.voting_ends_at).getTime();
        // Tolérance de 1,5s pour la latence réseau
        if (Date.now() > deadlineMs + 1500) {
          return sendAck({ ok: false, error: 'Le temps imparti pour ce vote est écoulé' });
        }
      }

      try {
        await pool.query(
          'INSERT INTO votes (session_id, voter_id, choice) VALUES (?, ?, ?)',
          [session.id, voterId, choice]
        );
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return sendAck({ ok: true, alreadyVoted: true });
        }
        throw err;
      }

      scheduleTallyUpdate(io, session.code, session.id);

      sendAck({ ok: true, alreadyVoted: false });
    } catch (err) {
      console.error('cast-vote', err);
      sendAck({ ok: false, error: "Impossible d'enregistrer le vote" });
    }
  });

  // --- Actions de l'organisateur ---
  async function withHost(code, hostSecret, ack, fn) {
    const sendAck = toSafeAck(ack);
    try {
      if (!code || !hostSecret) {
        return sendAck({ ok: false, error: 'Non autorisé' });
      }
      const session = await getSessionByCode(code);
      if (!session || !isValidHostSecret(session.host_secret, hostSecret)) {
        return sendAck({ ok: false, error: 'Non autorisé' });
      }
      return await fn(session, sendAck);
    } catch (err) {
      console.error('withHost', err);
      return sendAck({ ok: false, error: 'Erreur serveur' });
    }
  }

  socket.on('start-voting', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      const secondsVal = Number(data.seconds) > 0 ? Number(data.seconds) : 15;
      const endsAt = new Date(Date.now() + secondsVal * 1000);
      await pool.query(
        `UPDATE sessions SET status = 'voting', voting_ends_at = ? WHERE id = ?`,
        [endsAt, session.id]
      );
      io.to(room(session.code)).emit('session-updated', { status: 'voting', seconds: secondsVal });
      sendAck({ ok: true });
    });
  });

  socket.on('prolong-voting', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      await pool.query(
        `UPDATE sessions SET status = 'prolonged', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      io.to(room(session.code)).emit('session-updated', { status: 'prolonged' });
      sendAck({ ok: true });
    });
  });

  socket.on('stop-voting', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      await pool.query(
        `UPDATE sessions SET status = 'stopped', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      io.to(room(session.code)).emit('session-updated', { status: 'stopped' });
      sendAck({ ok: true });
    });
  });

  socket.on('show-results', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      await pool.query(`UPDATE sessions SET status = 'results' WHERE id = ?`, [session.id]);
      const { counts, total } = await getTally(session.id);
      io.to(room(session.code)).emit('session-updated', { status: 'results', counts, total });
      sendAck({ ok: true });
    });
  });

  socket.on('new-item', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      cancelTallyUpdate(session.code);
      const { counts, total } = await getTally(session.id);
      if (total > 0 || session.status === 'results') {
        const rows = await pool.query(
          `SELECT COALESCE(MAX(numero), 0) + 1 AS nextNum FROM history WHERE session_id = ?`,
          [session.id]
        );
        const nextNum = Number(rows[0]?.nextNum || 1);
        await pool.query(
          `INSERT INTO history (session_id, numero, pour, contre, abstention, total) VALUES (?, ?, ?, ?, ?, ?)`,
          [session.id, nextNum, counts.pour, counts.contre, counts.abstention, total]
        );
      }
      await pool.query('DELETE FROM votes WHERE session_id = ?', [session.id]);
      await pool.query(
        `UPDATE sessions SET status = 'idle', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      const history = await getHistory(session.id);
      // L'hôte reçoit l'historique complet pour son affichage et l'export PDF
      io.to(hostRoom(session.code)).emit('session-updated', { status: 'idle', reset: true, history });
      // Les votants reçoivent uniquement le nouveau numéro de vote sans divulgation des résultats passés non publiés
      io.to(votersRoom(session.code)).emit('session-updated', {
        status: 'idle',
        reset: true,
        itemNumber: history.length + 1,
      });
      sendAck({ ok: true });
    });
  });

  socket.on('toggle-lock-session', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      const nextLocked = data.locked !== undefined ? Boolean(data.locked) : !Boolean(session.is_locked);
      await pool.query(
        'UPDATE sessions SET is_locked = ? WHERE id = ?',
        [nextLocked ? 1 : 0, session.id]
      );
      io.to(hostRoom(session.code)).emit('session-lock-updated', { is_locked: nextLocked });
      sendAck({ ok: true, is_locked: nextLocked });
    });
  });

  socket.on('close-session', (payload, ack) => {
    const data = (payload && typeof payload === 'object') ? payload : {};
    return withHost(data.code, data.hostSecret, ack, async (session, sendAck) => {
      cancelTallyUpdate(session.code);
      allowedVotersBySession.delete(session.code);
      await pool.query('DELETE FROM votes WHERE session_id = ?', [session.id]);
      await pool.query('DELETE FROM sessions WHERE id = ?', [session.id]);
      io.to(room(session.code)).emit('session-closed', { reason: 'closed' });
      sendAck({ ok: true });
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (code) {
      io.to(hostRoom(code)).emit('presence-updated', { onlineCount: onlineVoters(io, code) });
    }
  });
}

// Sessions supprimées automatiquement 48h après leur création
async function cleanupExpiredSessions(io) {
  try {
    const expired = await pool.query(
      `SELECT id, code FROM sessions WHERE created_at < (NOW() - INTERVAL 48 HOUR)`
    );
    for (const s of expired) {
      cancelTallyUpdate(s.code);
      allowedVotersBySession.delete(s.code);
      await pool.query('DELETE FROM sessions WHERE id = ?', [s.id]);
      io.to(room(s.code)).emit('session-closed', { reason: 'expired' });
    }
  } catch (err) {
    console.error('cleanupExpiredSessions', err);
  }
}

module.exports = { registerHandlers, cleanupExpiredSessions };
