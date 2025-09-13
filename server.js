// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const JWT_SECRET = 'change_this_to_a_strong_secret_for_prod';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// DB (file-based)
const db = new Database(path.join(__dirname, 'stakemax.db'));

// Basic DB setup if not exists:
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  balance INTEGER DEFAULT 1000000, -- stored in cents
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  game TEXT,
  bet_amount INTEGER,
  result TEXT,
  change_amount INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO stats (key, value) VALUES
  ('total_bets', '0'),
  ('biggest_win', '0'),
  ('active_users', '0'),
  ('jackpot', '2847592'); 
`);

// helper prepared statements
const findUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const createUserStmt = db.prepare('INSERT INTO users (username, password_hash, balance) VALUES (?, ?, ?)');
const updateBalanceStmt = db.prepare('UPDATE users SET balance = ? WHERE id = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertBetStmt = db.prepare('INSERT INTO bets (user_id, game, bet_amount, result, change_amount) VALUES (?, ?, ?, ?, ?)');
const getStats = db.prepare('SELECT * FROM stats');
const upsertStat = db.prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const getStat = db.prepare('SELECT value FROM stats WHERE key = ?');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple auth helpers
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = getUserById.get(data.id);
    if (!req.user) return res.status(401).json({ error: 'Invalid user' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Public API
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (findUserByUsername.get(username)) return res.status(400).json({ error: 'Username exists' });
  const hash = bcrypt.hashSync(password, 10);
  // default balance in cents (e.g., $10,000)
  const defaultBalance = 10000 * 100;
  const info = createUserStmt.run(username, hash, defaultBalance);
  const user = { id: info.lastInsertRowid, username, balance: defaultBalance };
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, balance: user.balance } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername.get(username);
  if (!user) return res.status(400).json({ error: 'Invalid username/password' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Invalid username/password' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, balance: user.balance } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  // return user summary (balance in dollars)
  res.json({ id: req.user.id, username: req.user.username, balance: req.user.balance });
});

app.post('/api/bet', authMiddleware, (req, res) => {
  // Req: { game, betAmount }    betAmount in dollars
  const { game } = req.body;
  let betAmount = Math.round((parseFloat(req.body.betAmount) || 0) * 100); // cents
  if (betAmount <= 0) return res.status(400).json({ error: 'Bad bet' });

  const user = getUserById.get(req.user.id);
  if (!user) return res.status(400).json({ error: 'User not found' });

  if (betAmount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  // Simple fair RNG logic per game — for demo only.
  // winChance and multiplier vary per game
  const games = {
    'Slots': { winChance: 0.35, minMult: 1, maxMult: 6 },
    'Blackjack': { winChance: 0.48, minMult: 1.25, maxMult: 1.95 },
    'Roulette': { winChance: 0.47, minMult: 1.5, maxMult: 36 },
    'Poker': { winChance: 0.40, minMult: 1.5, maxMult: 10 },
    'Dice': { winChance: 0.5, minMult: 1, maxMult: 4 },
    'Crash': { winChance: 0.6, minMult: 1.1, maxMult: 10 }
  };

  const g = games[game] || { winChance: 0.45, minMult: 1, maxMult: 3 };
  const outcome = Math.random();
  let change = 0;
  let result = 'lose';
  if (outcome < g.winChance) {
    const multiplier = Math.random() * (g.maxMult - g.minMult) + g.minMult;
    const winAmount = Math.floor(betAmount * multiplier);
    // net change = winAmount - betAmount
    change = winAmount - betAmount;
    result = 'win';
    // update biggest_win stat if needed
    const biggestWin = parseInt(getStat.get('biggest_win')?.value || '0', 10);
    if (winAmount/100 > biggestWin) {
      upsertStat.run('biggest_win', String(Math.floor(winAmount/100)));
    }
  } else {
    change = -betAmount;
  }

  const newBalance = user.balance + change;
  updateBalanceStmt.run(newBalance, user.id);
  insertBetStmt.run(user.id, game, betAmount, result, change);

  // Update running stats
  const totalBetsRow = getStat.get('total_bets');
  const totalBets = parseInt(totalBetsRow?.value || '0', 10) + 1;
  upsertStat.run('total_bets', String(totalBets));

  // increment jackpot demo
  const jackpotRow = getStat.get('jackpot');
  const jackpot = parseInt(jackpotRow?.value || '0', 10) + Math.floor(Math.random() * 1000);
  upsertStat.run('jackpot', String(jackpot));

  // broadcast small stat changes to all clients
  broadcastStats();

  res.json({
    result,
    changeAmount: change,
    balance: newBalance,
    pretty: {
      change: (change/100).toFixed(2),
      balance: (newBalance/100).toFixed(2)
    }
  });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM stats').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  res.json(obj);
});

// simple leaderboard: biggest wins
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, max(b.change_amount) AS best_win
    FROM bets b JOIN users u ON u.id = b.user_id
    WHERE b.change_amount > 0
    GROUP BY u.id
    ORDER BY best_win DESC
    LIMIT 10
  `).all();
  const formatted = rows.map(r => ({ username: r.username, bestWin: (r.best_win/100).toFixed(2) }));
  res.json(formatted);
});

// fallback to serve index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO for live updates
function broadcastStats() {
  const rows = db.prepare('SELECT key,value FROM stats').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  // compute active users from count of users currently connected
  obj.active_users = String(io.engine.clientsCount || 0);
  io.emit('stats-update', obj);
}

io.on('connection', (socket) => {
  console.log('client connected', socket.id);
  broadcastStats();

  socket.on('disconnect', () => {
    broadcastStats();
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
