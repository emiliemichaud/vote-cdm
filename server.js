require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { registerHandlers, cleanupExpiredSessions } = require('./sockets/handlers');

const app = express();
app.disable('x-powered-by');

// En-têtes HTTP de sécurité (protection contre le Clickjacking, sniffing et fuite de referer)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
  );
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e4, // 10 Ko max par message
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    try {
      const originUrl = new URL(origin);
      const host = req.headers.host;
      if (originUrl.host === host) {
        return callback(null, true);
      }
      return callback('Origin not allowed', false);
    } catch (_) {
      return callback('Invalid origin header', false);
    }
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/typ', express.static(path.join(__dirname, 'typ')));

// Lien court /CODE -> bulletin de vote 
app.get('/:code', (req, res, next) => {
  const code = req.params.code;
  if (!/^[A-Z0-9]{4,10}$/i.test(code)) return next();
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

setInterval(() => cleanupExpiredSessions(io), 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`vote-cdm démarré sur http://localhost:${PORT}`);
});
