const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cors = require('cors');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const webPush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20 * 1024 * 1024 // 20MB fotoğraf ve ses yüklemeleri için
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'couples_db.json');

// Kalıcı VAPID Anahtarları (Uygulama kapalıyken / arka plandayken gerçek iOS & Android Web Push bildirimi için)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHlhAGM0LZePyoZGqglrooN9onafJaEJBO0J4gxiCopvSVUTXoxt764161vRYVst4z4TbnK48zlAhPGMC063caA';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '3cx0VVBhRqqescp2qCslybxeSljHaMpU0kh0l1y_R1Y';

webPush.setVapidDetails(
  'mailto:mustafa3polat@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

let publicTunnelUrl = null;
let tunnelStatus = 'starting';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// GÜVENLİK KATMANI: SHA-256 PIN ŞİFRELEME, HMAC TOKEN VE BRUTE-FORCE KORUMASI
// ============================================================================
const DEFAULT_PIN = process.env.COUPLE_DEFAULT_PIN || '220925';
const AUTH_SECRET = process.env.AUTH_SECRET || 'budulove-private-couple-secret-20250922-v1';
const failedPinAttempts = new Map(); // IP -> { count, lockUntil }

function hashPin(pinStr) {
  return crypto.createHash('sha256').update(String(pinStr || '').trim() + ':' + AUTH_SECRET).digest('hex');
}

function createAuthToken(roomCode, pinHash) {
  const code = String(roomCode || 'BUDU-2026').trim().toUpperCase();
  return crypto.createHmac('sha256', AUTH_SECRET).update(`${code}:${pinHash}`).digest('hex');
}

function getRoomPinHash(room) {
  if (room && room.coupleInfo && room.coupleInfo.pinHash) {
    return room.coupleInfo.pinHash;
  }
  return hashPin(DEFAULT_PIN);
}

function verifyRoomAuth(room, { pin, authToken } = {}) {
  const expectedPinHash = getRoomPinHash(room);
  const expectedToken = createAuthToken(room.roomCode, expectedPinHash);
  if (authToken && authToken === expectedToken) return true;
  if (pin && hashPin(pin) === expectedPinHash) return true;
  return false;
}

function sanitizeRoomForClient(room) {
  if (!room) return room;
  const copy = { ...room, coupleInfo: { ...(room.coupleInfo || {}) } };
  delete copy.coupleInfo.pinHash;
  delete copy.pushSubscriptions;
  return copy;
}

// HTTP Güvenlik ve Önbellek (Cache) Başlıkları
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createInitialMemoryDeck() {
  const symbols = ['🐼', '🐻', '💋', '🧋', '🍓', '💖'];
  const deck = [...symbols, ...symbols];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map((emoji, idx) => ({
    id: idx,
    emoji,
    flipped: false,
    matched: false
  }));
}

const LEGACY_REMOVED_SONG_ID = 'song-gokhan-turkmen-derdim';

function getDefaultRoomData(roomCode = 'BUDU-2026') {
  return {
    roomCode,
    coupleInfo: {
      appName: 'BuDuLove',
      startDate: '2025-09-22', // 22 Eylül 2025
      loveMeter: 100,
      totalInteractions: 0,
      bubuName: 'Bubu',
      duduName: 'Dudu',
      theme: 'visne-curugu'
    },
    affectionHistory: [],
    notes: [],
    messages: [],
    memories: [],
    events: [],
    songs: [],
    deletedIds: [LEGACY_REMOVED_SONG_ID],
    pushSubscriptions: [],
    games: {
      balloonScores: { bubu: 0, dudu: 0 },
      loveRushScores: { bubu: 0, dudu: 0 },
      dartScores: { bubu: 0, dudu: 0 },
      dartTarget: {
        image: null,
        headX: 0.5,
        headY: 0.34
      },
      xox: {
        board: [null, null, null, null, null, null, null, null, null],
        turn: 'bubu',
        winner: null,
        reward: '',
        rewardHistory: [],
        scores: { bubu: 0, dudu: 0 }
      },
      memoryMatch: {
        cards: createInitialMemoryDeck(),
        turn: 'bubu',
        flippedIndices: [],
        scores: { bubu: 0, dudu: 0 },
        winner: null
      },
      quizQuestions: [],
      quizAnswers: {}
    }
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Veritabanı okuma hatası:', e);
  }
  const initial = { 'BUDU-2026': getDefaultRoomData('BUDU-2026') };
  saveDB(initial);
  return initial;
}

let saveDbTimer = null;
let isSavingDb = false;
let pendingSaveDb = false;

function saveDBSync(dbData) {
  try {
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(dbData, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (e) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (err) {
      console.error('Veritabanı yazma hatası:', err);
    }
  }
}

async function flushAsyncDBWrite(dbData) {
  if (isSavingDb) {
    pendingSaveDb = true;
    return;
  }
  isSavingDb = true;
  try {
    const payload = JSON.stringify(dbData, null, 2);
    const tmpFile = DB_FILE + '.tmp';
    await fs.promises.writeFile(tmpFile, payload, 'utf8');
    await fs.promises.rename(tmpFile, DB_FILE);
  } catch (e) {
    try {
      await fs.promises.writeFile(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (err) {
      console.error('Asenkron veritabanı yazma hatası:', err);
    }
  } finally {
    isSavingDb = false;
    if (pendingSaveDb) {
      pendingSaveDb = false;
      flushAsyncDBWrite(dbData);
    }
  }
}

function saveDB(dbData) {
  if (saveDbTimer) clearTimeout(saveDbTimer);
  saveDbTimer = setTimeout(() => {
    saveDbTimer = null;
    flushAsyncDBWrite(dbData);
  }, 60);
}

const db = loadDB();

function ensureRoomStructure(room) {
  const def = getDefaultRoomData(room.roomCode || 'BUDU-2026');
  room.coupleInfo = { ...def.coupleInfo, ...(room.coupleInfo || {}) };
  // İlişki başlangıç tarihi her zaman 22 Eylül 2025 (2025-09-22) olarak sabittir
  room.coupleInfo.startDate = '2025-09-22';
  if (!Array.isArray(room.affectionHistory)) room.affectionHistory = [];
  if (!Array.isArray(room.notes)) room.notes = [];
  if (!Array.isArray(room.messages)) room.messages = [];
  if (!Array.isArray(room.memories)) room.memories = [];
  if (!Array.isArray(room.events)) room.events = [];
  if (!Array.isArray(room.songs)) room.songs = [];
  if (!Array.isArray(room.deletedIds)) room.deletedIds = [];
  if (!room.deletedIds.includes(LEGACY_REMOVED_SONG_ID)) {
    room.deletedIds.push(LEGACY_REMOVED_SONG_ID);
  }
  room.songs = room.songs.filter(
    (s) => s && s.id !== LEGACY_REMOVED_SONG_ID && s.audioUrl !== '/assets/gokhan-turkmen-derdim.m4a'
  );
  if (!Array.isArray(room.pushSubscriptions)) room.pushSubscriptions = [];
  if (!room.games) room.games = def.games;
  if (!room.games.balloonScores) room.games.balloonScores = { bubu: 0, dudu: 0 };
  if (!room.games.loveRushScores) room.games.loveRushScores = { bubu: 0, dudu: 0 };
  if (!room.games.dartScores) room.games.dartScores = { bubu: 0, dudu: 0 };
  if (!room.games.dartTarget) room.games.dartTarget = def.games.dartTarget;
  if (!room.games.xox) room.games.xox = def.games.xox;
  if (!Array.isArray(room.games.xox.rewardHistory)) room.games.xox.rewardHistory = [];
  if (room.games.xox.reward === '100 Öpücük & Kahve Ismarlama 🧋') room.games.xox.reward = '';
  if (!room.games.memoryMatch || !Array.isArray(room.games.memoryMatch.cards)) {
    room.games.memoryMatch = def.games.memoryMatch;
  }
  if (!Array.isArray(room.games.quizQuestions)) {
    room.games.quizQuestions = [];
  } else {
    room.games.quizQuestions = room.games.quizQuestions.filter((q) => q && !['q0', 'q1', 'q2'].includes(q.id));
  }
  if (!room.games.quizAnswers) room.games.quizAnswers = {};
  return room;
}

function getRoom(roomCode) {
  const code = (roomCode || 'BUDU-2026').trim().toUpperCase();
  if (!db[code]) {
    db[code] = getDefaultRoomData(code);
    saveDB(db);
  } else {
    db[code] = ensureRoomStructure(db[code]);
  }
  return db[code];
}

// ============================================================================
// GERÇEK ARKA PLAN / UYGULAMA KAPALIYKEN WEB PUSH BİLDİRİM MOTORU (0ms PARALEL)
// ============================================================================
async function sendPushToRoom(room, { title, body, fromChar, url = '/', tag = 'budulove-notif', sendToAll = false, suppressSocketActivity = false }) {
  // 1) Uygulama açıksa anında (0ms) Socket.io üzerinden canlı bildirim gönder
  if (!suppressSocketActivity) {
    io.to(room.roomCode).emit('activity_notification', {
      title,
      body,
      fromChar: fromChar || 'bubu',
      timestamp: new Date().toISOString()
    });
  }

  // 2) Uygulama arka planda veya tamamen kapalıysa Apple/Google Web Push sunucusuna PARALEL ve YÜKSEK ÖNCELİKLİ (urgency: high) gönder
  if (!Array.isArray(room.pushSubscriptions) || room.pushSubscriptions.length === 0) return;

  const uniqueTag = tag || ('budulove-' + Date.now());
  const payload = JSON.stringify({
    title: title || 'BuDuLove 💕',
    body: body || 'Sevgilinden yeni bir hareket var!',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    url,
    tag: uniqueTag,
    timestamp: Date.now()
  });

  const mutedMap = room.mutedCharacters || {};
  const pushOptions = {
    TTL: 120,
    urgency: 'high'
  };

  const results = await Promise.allSettled(
    room.pushSubscriptions.map(async (item) => {
      if (!item || !item.subscription || !item.subscription.endpoint) {
        return { keep: false, item };
      }
      if (item.muted || (item.character && mutedMap[item.character])) {
        return { keep: true, item };
      }
      const shouldSend = sendToAll || !fromChar || !item.character || item.character !== fromChar;
      if (!shouldSend) {
        return { keep: true, item };
      }
      try {
        await webPush.sendNotification(item.subscription, payload, pushOptions);
        return { keep: true, item };
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          return { keep: false, item };
        }
        return { keep: true, item };
      }
    })
  );

  const validSubs = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && r.value.keep) {
      validSubs.push(r.value.item);
    }
  }
  if (validSubs.length !== room.pushSubscriptions.length) {
    room.pushSubscriptions = validSubs;
    saveDB(db);
  }
}

// VAPID Public Key Endpoint
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Bildirimleri Açma / Kapatma (Çan Kontrolü) Endpointi
app.post('/api/room/:code/push-toggle', (req, res) => {
  const room = getRoom(req.params.code);
  const { character, enabled, endpoint } = req.body;
  if (!room.mutedCharacters) room.mutedCharacters = {};
  if (character) {
    room.mutedCharacters[character] = !enabled;
  }
  if (Array.isArray(room.pushSubscriptions)) {
    room.pushSubscriptions.forEach((s) => {
      if ((endpoint && s.subscription?.endpoint === endpoint) || (character && s.character === character)) {
        s.muted = !enabled;
      }
    });
  }
  saveDB(db);
  res.json({ success: true, enabled: !!enabled });
});

// Web Push Abonelik Kaydı Endpoint
app.post('/api/room/:code/push-subscribe', (req, res) => {
  const room = getRoom(req.params.code);
  const { subscription, character, userName } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Geçersiz abonelik' });
  }

  const existingIdx = room.pushSubscriptions.findIndex(
    (s) => s.subscription && s.subscription.endpoint === subscription.endpoint
  );
  const record = {
    subscription,
    character: character || 'bubu',
    userName: userName || 'Bubu',
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    room.pushSubscriptions[existingIdx] = record;
  } else {
    room.pushSubscriptions.push(record);
  }
  saveDB(db);
  res.json({ success: true, count: room.pushSubscriptions.length });
});

// Test Push Endpoint (Arka plan bildirimini hemen test etmek için)
app.post('/api/room/:code/push-test', async (req, res) => {
  const room = getRoom(req.params.code);
  const { character, userName } = req.body;
  await sendPushToRoom(room, {
    title: `🔔 ${userName || 'BuDuLove'} Arka Plan Bildirimi Aktif!`,
    body: 'Uygulama kapalıyken bile sevgilinin her dokunuşu, planı ve mesajı anında ekranına düşecek! 🐼💕🐻',
    fromChar: character,
    sendToAll: true
  });
  res.json({ success: true });
});

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['localhost'];
}

function startCloudflareTunnel() {
  const cfBin = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
  if (!fs.existsSync(cfBin)) {
    tunnelStatus = 'error';
    return;
  }

  const cfProc = spawn(cfBin, ['tunnel', '--url', `http://localhost:${PORT}`], {
    windowsHide: true
  });

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !publicTunnelUrl) {
      publicTunnelUrl = match[0];
      tunnelStatus = 'ready';
      io.emit('tunnel_ready', { publicTunnelUrl });
    }
  };

  cfProc.stdout.on('data', handleOutput);
  cfProc.stderr.on('data', handleOutput);
  cfProc.on('error', () => {
    tunnelStatus = 'error';
  });
}

app.get('/api/info', async (req, res) => {
  try {
    const ips = getLocalIPs();
    const primaryIp = ips[0];
    const localUrl = `http://${primaryIp}:${PORT}`;
    const hostHeader = req.headers.host || '';
    const isCloudHost = hostHeader && !hostHeader.startsWith('localhost') && !hostHeader.startsWith('127.0.0.1') && !/^\d+\.\d+\.\d+\.\d+/.test(hostHeader);
    const activePublicUrl = publicTunnelUrl || (isCloudHost ? `https://${hostHeader}` : null);
    const targetUrl = req.query.url || activePublicUrl || localUrl;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#4A1525', light: '#FAF7F5' }
    });
    res.json({
      port: PORT,
      ips,
      localUrl,
      publicTunnelUrl: activePublicUrl,
      tunnelStatus: activePublicUrl ? 'ready' : tunnelStatus,
      primaryUrl: targetUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PIN Şifre Doğrulama ve Brute-Force Koruması Endpointi
app.post('/api/auth/verify', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attemptRecord = failedPinAttempts.get(clientIp);

  if (attemptRecord && attemptRecord.lockUntil && now < attemptRecord.lockUntil) {
    const waitMin = Math.ceil((attemptRecord.lockUntil - now) / 60000);
    return res.status(429).json({
      success: false,
      error: `Çok fazla hatalı şifre denemesi! Güvenlik için ${waitMin} dakika engellendiniz.`
    });
  }

  const roomCode = (req.body.roomCode || 'BUDU-2026').trim().toUpperCase();
  const pin = String(req.body.pin || '').trim();
  const authToken = req.body.authToken;
  const room = getRoom(roomCode);

  if (verifyRoomAuth(room, { pin, authToken })) {
    failedPinAttempts.delete(clientIp);
    const activePinHash = getRoomPinHash(room);
    const token = createAuthToken(room.roomCode, activePinHash);
    const charRole = req.body.character === 'dudu' ? 'dudu' : (req.body.character === 'bubu' ? 'bubu' : null);
    const uName = req.body.userName || (charRole === 'dudu' ? room.coupleInfo.duduName : room.coupleInfo.bubuName);
    if (charRole) {
      markCharacterOnlineAndNotify(room, charRole, uName, { notifyEntry: true });
    }
    return res.json({
      success: true,
      authToken: token,
      roomCode: room.roomCode,
      presence: getRoomPresence(room.roomCode),
      room: sanitizeRoomForClient(room)
    });
  }

  const prevCount = (attemptRecord ? attemptRecord.count : 0) + 1;
  const lockUntil = prevCount >= 5 ? now + 15 * 60000 : null;
  failedPinAttempts.set(clientIp, { count: prevCount, lockUntil });

  const remaining = Math.max(0, 5 - prevCount);
  return res.status(401).json({
    success: false,
    error: remaining > 0
      ? `Hatalı PIN şifresi! (${remaining} deneme hakkınız kaldı)`
      : '5 hatalı deneme yapıldı! 15 dakika boyunca giriş kilitlendi.'
  });
});

// PIN Şifresini Değiştirme Endpointi (Mevcut Doğrulama Gerektirir)
app.post('/api/auth/change-pin', (req, res) => {
  const roomCode = (req.body.roomCode || 'BUDU-2026').trim().toUpperCase();
  const { authToken, oldPin, newPin } = req.body;
  const room = getRoom(roomCode);

  if (!verifyRoomAuth(room, { pin: oldPin, authToken })) {
    return res.status(401).json({ success: false, error: 'Mevcut PIN şifresi doğrulanamadı!' });
  }

  const cleanNewPin = String(newPin || '').trim();
  if (cleanNewPin.length < 4) {
    return res.status(400).json({ success: false, error: 'Yeni PIN en az 4 karakter olmalıdır!' });
  }

  const newHash = hashPin(cleanNewPin);
  room.coupleInfo.pinHash = newHash;
  saveDB(db);

  const newToken = createAuthToken(room.roomCode, newHash);
  return res.json({ success: true, authToken: newToken });
});

app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  const authToken = req.headers['x-auth-token'] || req.query.authToken;
  const pin = req.query.pin;
  if (!verifyRoomAuth(room, { pin, authToken })) {
    return res.status(401).json({ error: 'PIN_REQUIRED', message: 'Bu odaya erişmek için çift PIN şifresi gereklidir.' });
  }
  res.json(sanitizeRoomForClient(room));
});

app.post('/api/room/:code/theme', (req, res) => {
  const room = getRoom(req.params.code);
  if (req.body && req.body.theme) {
    room.coupleInfo.theme = req.body.theme;
    saveDB(db);
  }
  res.json({ success: true, theme: room.coupleInfo.theme });
});

// YouTube / Spotify / MP3 Link Çözücü ve Şarkı Yükleme Endpointi
function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractSpotifyTrackId(url) {
  if (!url) return null;
  const m = String(url).match(/spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

app.post('/api/room/:code/song', async (req, res) => {
  try {
    const room = getRoom(req.params.code);
    const song = req.body.song || {};
    let title = (song.title || '').trim();
    let artist = (song.artist || '').trim();
    let audioUrl = (song.audioUrl || '').trim();
    let coverUrl = song.coverUrl || '/assets/budu-icon.png';
    let youtubeId = song.youtubeId || extractYouTubeId(audioUrl);
    let spotifyId = song.spotifyId || extractSpotifyTrackId(audioUrl);

    // Eğer YouTube linki yapıştırıldıysa noembed ile başlık ve kapak çek
    if (youtubeId && (!title || title === 'Bizim Şarkımız 🎵')) {
      try {
        const oeRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${youtubeId}`);
        const oeData = await oeRes.json();
        if (oeData && oeData.title) {
          title = oeData.title;
          artist = oeData.author_name || artist || 'YouTube Müzik';
          coverUrl = oeData.thumbnail_url || coverUrl;
        }
      } catch (e) {}
    }

    // Eğer doğrudan ses dosyası (.mp3/.m4a/data:) değilse veya YouTube/Spotify linkiyse, arka planda iTunes üzerinden doğrudan çalınabilir ses akışını da bul
    const isDirectAudio = audioUrl.startsWith('data:audio/') || audioUrl.startsWith('/assets/') || /\.(mp3|m4a|wav|aac|ogg)(\?.*)?$/i.test(audioUrl);
    if (!isDirectAudio && (title || artist)) {
      try {
        const cleanQuery = `${title} ${artist !== 'Bizim Şarkımız' && artist !== 'YouTube Müzik' ? artist : ''}`.replace(/\(.*?\)|\[.*?\]|official|video|lyrics|klip/gi, '').trim();
        if (cleanQuery) {
          const itRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&media=music&entity=song&country=TR&limit=1`);
          const itData = await itRes.json();
          if (itData && itData.results && itData.results[0]) {
            const track = itData.results[0];
            if (track.previewUrl) {
              song.fallbackStreamUrl = track.previewUrl;
              if (!youtubeId && !spotifyId) {
                audioUrl = track.previewUrl;
              }
            }
            if (coverUrl === '/assets/budu-icon.png' && track.artworkUrl100) {
              coverUrl = track.artworkUrl100;
            }
          }
        }
      } catch (e) {}
    }

    const newSong = {
      id: song.id || ('song-' + Date.now()),
      title: title || 'Bizim Şarkımız 🎵',
      artist: artist || 'Bubu & Dudu',
      audioUrl,
      fallbackStreamUrl: song.fallbackStreamUrl || null,
      youtubeId: youtubeId || null,
      spotifyId: spotifyId || null,
      coverUrl,
      note: song.note || '',
      addedByChar: song.addedByChar || 'bubu',
      addedByName: song.addedByName || 'Bubu',
      createdAt: new Date().toISOString()
    };

    room.songs.unshift(newSong);
    saveDB(db);
    io.to(room.roomCode).emit('song_added', { song: newSong, songs: room.songs });

    sendPushToRoom(room, {
      title: `🎵 ${newSong.addedByName} "Bizim Şarkılarımız"a Şarkı Ekledi!`,
      body: `${newSong.title} - ${newSong.artist}`,
      fromChar: newSong.addedByChar
    });

    res.json({ success: true, song: newSong });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// İstemci Cihaz Yedeğini Sunucu Veritabanıyla Birleştirme (Hiçbir Veri Silinmesin!)
function mergeArrayById(serverArr, clientArr, deletedIds = []) {
  const delSet = new Set(deletedIds);
  const map = new Map();
  (serverArr || []).forEach((item) => {
    if (item && item.id && !delSet.has(item.id)) map.set(item.id, item);
  });
  (clientArr || []).forEach((item) => {
    if (item && item.id && !delSet.has(item.id) && !map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

// ============================================================================
// ÇEVRİMİÇİ (ONLINE PRESENCE) TAKİP VE UYGULAMAYA GİRİŞ BİLDİRİM SİSTEMİ
// ============================================================================
const onlineSocketsByRoom = new Map(); // roomCode -> Map<socketId, { character, userName }>
const activePresenceByRoom = new Map(); // roomCode -> { bubu: number, dudu: number } (last active timestamp)
const lastOnlineNotifAtByRoom = new Map(); // roomCode -> { bubu: number, dudu: number }
const PRESENCE_TTL_MS = 24 * 1000; // 24 sn kalp atışı (heartbeat) süresi

function getRoomPresence(roomCode) {
  const code = (roomCode || 'BUDU-2026').trim().toUpperCase();
  const map = onlineSocketsByRoom.get(code);
  const hb = activePresenceByRoom.get(code) || { bubu: 0, dudu: 0 };
  const now = Date.now();
  const status = {
    bubu: (now - (hb.bubu || 0)) < PRESENCE_TTL_MS,
    dudu: (now - (hb.dudu || 0)) < PRESENCE_TTL_MS
  };
  if (map) {
    for (const [sockId, info] of map.entries()) {
      if (now - (info.lastSeen || 0) > PRESENCE_TTL_MS) {
        map.delete(sockId);
        continue;
      }
      if (info.character === 'bubu') status.bubu = true;
      if (info.character === 'dudu') status.dudu = true;
    }
  }
  return status;
}

function markCharacterOnlineAndNotify(room, character, userName, { socket = null, notifyEntry = false } = {}) {
  const code = (room.roomCode || 'BUDU-2026').trim().toUpperCase();
  const charRole = character === 'dudu' ? 'dudu' : 'bubu';
  const displayName = userName || (charRole === 'dudu' ? (room.coupleInfo?.duduName || 'Dudu') : (room.coupleInfo?.bubuName || 'Bubu'));

  if (!onlineSocketsByRoom.has(code)) {
    onlineSocketsByRoom.set(code, new Map());
  }
  if (!activePresenceByRoom.has(code)) {
    activePresenceByRoom.set(code, { bubu: 0, dudu: 0 });
  }
  if (!lastOnlineNotifAtByRoom.has(code)) {
    lastOnlineNotifAtByRoom.set(code, { bubu: 0, dudu: 0 });
  }

  const before = getRoomPresence(code);
  const now = Date.now();
  const roomMap = onlineSocketsByRoom.get(code);

  if (socket && socket.id) {
    roomMap.set(socket.id, { character: charRole, userName: displayName, lastSeen: now });
  } else if (roomMap) {
    for (const [sid, info] of roomMap.entries()) {
      if (info.character === charRole) {
        roomMap.set(sid, { ...info, lastSeen: now });
      }
    }
  }

  const hb = activePresenceByRoom.get(code);
  hb[charRole] = now;

  const after = getRoomPresence(code);
  io.to(code).emit('presence_state', after);

  // Uygulamaya yeni girildiğinde (veya çevrimdışından çevrimiçiye geçildiğinde) karşı tarafa ANINDA bildirim gönder!
  const lastNotifMap = lastOnlineNotifAtByRoom.get(code);
  const elapsedSinceLastNotif = now - (lastNotifMap[charRole] || 0);
  const wasOffline = !before[charRole];

  if ((wasOffline || notifyEntry) && elapsedSinceLastNotif > 5000) {
    lastNotifMap[charRole] = now;
    const charBadge = charRole === 'bubu' ? '🐼 Bubu' : '🐻 Dudu';

    io.to(code).emit('partner_online_alert', {
      character: charRole,
      userName: displayName,
      timestamp: new Date().toISOString()
    });

    // Karşı tarafın uygulaması kapalı veya arka planda olsa bile telefonuna "Sevgilin şu an çevrimiçi" bildirimi gönder!
    sendPushToRoom(room, {
      title: '🟢 Sevgilin Şu An Çevrimiçi! 💕',
      body: `${displayName} (${charBadge}) uygulamaya girdi ve şu an çevrimiçi!`,
      fromChar: charRole,
      tag: 'partner-online-' + charRole,
      suppressSocketActivity: true
    });
  }

  return after;
}

function markCharacterOffline(roomCode, character, socket = null) {
  const code = (roomCode || 'BUDU-2026').trim().toUpperCase();
  const roomMap = onlineSocketsByRoom.get(code);
  let removedChar = character;

  if (roomMap && socket && socket.id && roomMap.has(socket.id)) {
    const info = roomMap.get(socket.id);
    if (!removedChar && info) removedChar = info.character;
    roomMap.delete(socket.id);
  }

  // Uygulama arka plana atıldığında veya kapatıldığında o karaktere ait tüm aktif soket kayıtlarını ve kalp atışını ANINDA temizle!
  if (removedChar) {
    if (roomMap) {
      for (const [sid, info] of roomMap.entries()) {
        if (info.character === removedChar) {
          roomMap.delete(sid);
        }
      }
    }
    const hb = activePresenceByRoom.get(code);
    if (hb) hb[removedChar] = 0;
    const lastNotifMap = lastOnlineNotifAtByRoom.get(code);
    if (lastNotifMap) lastNotifMap[removedChar] = 0;
  }

  const after = getRoomPresence(code);
  io.to(code).emit('presence_state', after);
  return after;
}

// Arka plana atılan veya bağlantısı kopan cihazları her 8 saniyede bir kontrol edip anında çevrimdışıya düşür
setInterval(() => {
  for (const code of activePresenceByRoom.keys()) {
    io.to(code).emit('presence_state', getRoomPresence(code));
  }
}, 8000);

// HTTP üzerinden Çevrimiçi Kalp Atışı (Heartbeat) ve Uygulamaya Giriş/Çıkış Bildirimi Endpointi
app.post('/api/room/:code/presence', (req, res) => {
  const room = getRoom(req.params.code);
  const { character, userName, status, notifyEntry } = req.body || {};
  const charRole = character === 'dudu' ? 'dudu' : 'bubu';
  if (status === 'offline') {
    const presence = markCharacterOffline(room.roomCode, charRole, null);
    return res.json({ success: true, presence });
  }
  const presence = markCharacterOnlineAndNotify(room, charRole, userName, { notifyEntry: !!notifyEntry });
  return res.json({ success: true, presence });
});

// ============================================================================
// SOCKET.IO GERÇEK ZAMANLI İKİ TARAF SENKRONİZASYONU & BİLDİRİMLER
// ============================================================================
io.on('connection', (socket) => {
  let currentRoomCode = 'BUDU-2026';

  if (publicTunnelUrl) {
    socket.emit('tunnel_ready', { publicTunnelUrl });
  }

  socket.on('join_room', ({ roomCode, character, userName, clientBackup, authToken, pin }) => {
    currentRoomCode = (roomCode || 'BUDU-2026').trim().toUpperCase();
    const room = getRoom(currentRoomCode);

    if (!verifyRoomAuth(room, { pin, authToken })) {
      socket.emit('auth_required', { roomCode: currentRoomCode });
      return;
    }

    socket.isAuthenticated = true;
    socket.join(currentRoomCode);

    // Eğer telefonda kayıtlı yedek veriler varsa sunucuyla birleştir (Veri kaybını %100 önler)
    if (clientBackup && typeof clientBackup === 'object') {
      if (Array.isArray(clientBackup.deletedIds)) {
        room.deletedIds = Array.from(new Set([...(room.deletedIds || []), ...clientBackup.deletedIds]));
      }
      room.notes = mergeArrayById(room.notes, clientBackup.notes, room.deletedIds);
      room.messages = mergeArrayById(room.messages, clientBackup.messages, room.deletedIds)
        .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      room.memories = mergeArrayById(room.memories, clientBackup.memories, room.deletedIds);
      room.events = mergeArrayById(room.events, clientBackup.events, room.deletedIds)
        .sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));
      room.songs = mergeArrayById(room.songs, clientBackup.songs, room.deletedIds).filter(
        (s) => s && s.id !== LEGACY_REMOVED_SONG_ID && s.audioUrl !== '/assets/gokhan-turkmen-derdim.m4a'
      );
      if (clientBackup.games?.xox?.rewardHistory) {
        room.games.xox.rewardHistory = mergeArrayById(
          room.games.xox.rewardHistory,
          clientBackup.games.xox.rewardHistory,
          room.deletedIds
        );
      }
      if (clientBackup.coupleInfo && clientBackup.coupleInfo.theme) {
        room.coupleInfo.theme = clientBackup.coupleInfo.theme;
      }
    }

    if (character === 'bubu' && userName) {
      room.coupleInfo.bubuName = userName;
    } else if (character === 'dudu' && userName) {
      room.coupleInfo.duduName = userName;
    }
    saveDB(db);

    markCharacterOnlineAndNotify(room, character, userName, { socket, notifyEntry: true });
    socket.emit('room_state', sanitizeRoomForClient(room));
  });

  socket.on('update_presence_character', ({ roomCode, character, userName, notifyEntry }) => {
    const room = getRoom(roomCode || currentRoomCode);
    markCharacterOnlineAndNotify(room, character, userName, { socket, notifyEntry: !!notifyEntry });
  });

  socket.on('user_entered_app', ({ roomCode, character, userName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    markCharacterOnlineAndNotify(room, character, userName, { socket, notifyEntry: true });
  });

  socket.on('user_left_app', ({ roomCode, character }) => {
    markCharacterOffline(roomCode || currentRoomCode, character, socket);
  });

  socket.on('disconnect', () => {
    markCharacterOffline(currentRoomCode, null, socket);
  });

  socket.on('update_couple_info', ({ roomCode, coupleInfo, fromChar }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.coupleInfo = { ...room.coupleInfo, ...coupleInfo };
    saveDB(db);
    io.to(room.roomCode).emit('couple_info_updated', room.coupleInfo);
    sendPushToRoom(room, {
      title: '⚙️ Çift Ayarları Güncellendi',
      body: `${room.coupleInfo.bubuName} & ${room.coupleInfo.duduName} ayarları senkronize edildi! 💕`,
      fromChar
    });
  });

  socket.on('save_theme', ({ roomCode, theme }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (theme) {
      room.coupleInfo.theme = theme;
      saveDB(db);
    }
  });

  // 1) SEVGİ GÖSTERME + YUMRUK ATMA (Yumruk atınca sevgi enerjisi düşer!)
  socket.on('send_affection', ({ roomCode, fromChar, fromName, toChar, type, title, message }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const isPunch = type === 'punch';

    const entry = {
      id: 'aff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      fromChar: fromChar || 'bubu',
      fromName: fromName || (fromChar === 'dudu' ? room.coupleInfo.duduName : room.coupleInfo.bubuName),
      toChar: toChar || (fromChar === 'bubu' ? 'dudu' : 'bubu'),
      type: type || 'kiss',
      title: title || 'Sevgi Gönderildi 💕',
      message: message || 'Sana tatlı bir sevgi dokunuşu gönderdi!',
      timestamp: new Date().toISOString()
    };

    room.affectionHistory.unshift(entry);
    if (room.affectionHistory.length > 50) {
      room.affectionHistory = room.affectionHistory.slice(0, 50);
    }

    if (isPunch) {
      // Yumruk atıldığında Günlük Bubu & Dudu Sevgi Enerjisi düşer!
      room.coupleInfo.loveMeter = Math.max(0, (room.coupleInfo.loveMeter ?? 100) - 8);
    } else {
      room.coupleInfo.loveMeter = Math.min(100, (room.coupleInfo.loveMeter ?? 80) + 5);
    }
    room.coupleInfo.totalInteractions = (room.coupleInfo.totalInteractions || 0) + 1;

    // 0ms anında karşı tarafa gönder (Tüm fotoğrafları içeren dev room nesnesini göndermeden!)
    io.to(room.roomCode).emit('affection_received', {
      entry,
      loveMeter: room.coupleInfo.loveMeter,
      totalInteractions: room.coupleInfo.totalInteractions
    });

    sendPushToRoom(room, {
      title: `${entry.fromName}: ${entry.title}`,
      body: entry.message,
      fromChar: entry.fromChar,
      tag: 'affection-' + Date.now(),
      suppressSocketActivity: true
    });

    saveDB(db);
  });

  socket.on('live_touch', (data) => {
    const code = (data.roomCode || currentRoomCode).trim().toUpperCase();
    socket.to(code).emit('partner_live_touch', data);
  });

  // 2) OYUNLAR: SKOR, TEBRİKLER KARTI, XOX, KARŞILIKLI HAFIZA OYUNU, DART
  socket.on('update_game_score', ({ roomCode, gameKey, gameTitle, character, playerName, score }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!room.games[gameKey]) room.games[gameKey] = { bubu: 0, dudu: 0 };
    const prevBest = room.games[gameKey][character] || 0;
    const isNewRecord = score >= prevBest;
    if (score > prevBest) {
      room.games[gameKey][character] = score;
    }

    io.to(room.roomCode).emit('game_score_updated', {
      gameKey,
      scores: room.games[gameKey]
    });

    const otherChar = character === 'bubu' ? 'dudu' : 'bubu';
    const otherScore = room.games[gameKey][otherChar] || 0;
    const winnerChar = score >= otherScore ? character : otherChar;
    const winnerName = winnerChar === 'bubu' ? room.coupleInfo.bubuName : room.coupleInfo.duduName;

    io.to(room.roomCode).emit('game_winner_card', {
      gameTitle: gameTitle || 'Çift Oyunu',
      winnerChar,
      winnerName,
      score,
      isNewRecord,
      subtitle: `${playerName || winnerName} ${score} puan topladı!`,
      reward: `${gameTitle || 'Oyun'} Şampiyonu 🏆`
    });

    sendPushToRoom(room, {
      title: `🏆 ${gameTitle || 'Oyun'}: ${playerName || winnerName} ${score} Puan Yaptı!`,
      body: `Tebrikler ${winnerName} önde! Rekoru geçmek için hemen oyna! 🎮`,
      fromChar: character
    });

    saveDB(db);
  });

  // Dart Oyunu Hedef Fotoğrafı ve Kafa Noktası Senkronizasyonu
  socket.on('update_dart_target', ({ roomCode, image, headX, headY, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!room.games.dartTarget) room.games.dartTarget = { image: null, headX: 0.5, headY: 0.34 };
    if (image !== undefined) room.games.dartTarget.image = image;
    if (typeof headX === 'number') room.games.dartTarget.headX = headX;
    if (typeof headY === 'number') room.games.dartTarget.headY = headY;
    io.to(room.roomCode).emit('dart_target_updated', room.games.dartTarget);

    if (image) {
      sendPushToRoom(room, {
        title: `🎯 ${fromName || 'Aşkın'} Dart Oyununa Yeni Hedef Fotoğrafı Koydu!`,
        body: 'Tam kafadan 100 puan vurmak için Dart oyununa gir! 🎯💥',
        fromChar
      });
    }
    saveDB(db);
  });

  // Canlı Karşılıklı veya Tek Kişilik XOX
  socket.on('xox_move', ({ roomCode, index, character, reset, reward, mode }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const xox = room.games.xox;
    if (!Array.isArray(xox.rewardHistory)) xox.rewardHistory = [];

    if (reward !== undefined) {
      xox.reward = reward;
      saveDB(db);
      io.to(room.roomCode).emit('xox_state_updated', xox);
      if (index === undefined && !reset) return;
    }

    if (reset) {
      xox.board = [null, null, null, null, null, null, null, null, null];
      xox.winner = null;
      xox.turn = character || 'bubu';
    } else if (typeof index === 'number' && !xox.board[index] && !xox.winner) {
      const currentTurn = xox.turn || 'bubu';
      // Çift olarak oynanıyorsa sadece sırası olan karakter hamle yapabilir!
      if (mode !== 'single' && character !== currentTurn) {
        socket.emit('turn_locked_warning', {
          game: 'xox',
          turn: currentTurn,
          message: `⏳ Şu an sıra sevgilinde (${currentTurn === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'})! O hamlesini yapana kadar beklemelisin.`
        });
        return;
      }

      const moveChar = mode === 'single' ? character : currentTurn;
      xox.board[index] = moveChar;
      const lines = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
      ];
      let foundWinner = null;
      for (const [a,b,c] of lines) {
        if (xox.board[a] && xox.board[a] === xox.board[b] && xox.board[a] === xox.board[c]) {
          foundWinner = xox.board[a];
          break;
        }
      }
      if (foundWinner) {
        xox.winner = foundWinner;
        xox.scores[foundWinner] = (xox.scores[foundWinner] || 0) + 1;
        const winnerName = foundWinner === 'bubu' ? room.coupleInfo.bubuName : room.coupleInfo.duduName;
        const activeRewardText = (xox.reward && xox.reward.trim()) ? xox.reward.trim() : 'Özel XOX Ödülü 🎁';

        // Kazanılan ödülü ve kimin kazandığını kalıcı geçmişe kaydet!
        xox.rewardHistory.unshift({
          id: 'xoxrew-' + Date.now(),
          winnerChar: foundWinner,
          winnerName,
          reward: activeRewardText,
          date: formatDate(new Date()),
          timestamp: new Date().toISOString()
        });

        io.to(room.roomCode).emit('game_winner_card', {
          gameTitle: 'Aşk XOX Oyunu ❌⭕',
          winnerChar: foundWinner,
          winnerName,
          score: xox.scores[foundWinner],
          subtitle: `Tebrikler ${winnerName} Kazandı! 🎉`,
          reward: activeRewardText
        });

        sendPushToRoom(room, {
          title: `🏆 Tebrikler! XOX Oyununu ${winnerName} Kazandı!`,
          body: `Kazanılan Ödül: ${activeRewardText} 🎁`,
          fromChar: character
        });
      } else if (xox.board.every((cell) => cell !== null)) {
        xox.winner = 'draw';
        io.to(room.roomCode).emit('game_winner_card', {
          gameTitle: 'Aşk XOX Oyunu ❌⭕',
          winnerChar: 'draw',
          winnerName: 'Dostluk & Aşk',
          score: 0,
          subtitle: 'Berabere Bitti! İkiniz de Kazandınız 🤝💕',
          reward: (xox.reward && xox.reward.trim()) || 'Birlikte Tatlı Keyfi'
        });
      } else {
        xox.turn = moveChar === 'bubu' ? 'dudu' : 'bubu';
      }
    }
    saveDB(db);
    io.to(room.roomCode).emit('xox_state_updated', xox);
  });

  socket.on('delete_xox_reward', ({ roomCode, rewardId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (room.games?.xox?.rewardHistory) {
      room.games.xox.rewardHistory = room.games.xox.rewardHistory.filter((r) => r.id !== rewardId);
    }
    if (!room.deletedIds.includes(rewardId)) room.deletedIds.push(rewardId);
    saveDB(db);
    io.to(room.roomCode).emit('xox_state_updated', room.games.xox);
  });

  // Canlı Karşılıklı Hafıza Eşleştirme Oyunu (Çift modunda sırayla, tek modunda serbest)
  socket.on('memory_game_action', ({ roomCode, action, index, character, mode }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const mem = room.games.memoryMatch;

    if (action === 'reset') {
      mem.cards = createInitialMemoryDeck();
      mem.turn = character || 'bubu';
      mem.flippedIndices = [];
      mem.scores = { bubu: 0, dudu: 0 };
      mem.winner = null;
      saveDB(db);
      io.to(room.roomCode).emit('memory_game_updated', mem);
      return;
    }

    if (action === 'flip' && typeof index === 'number') {
      const activeTurn = mem.turn || 'bubu';
      // Çift olarak oynanıyorsa sadece sırası olan kişi tıklayabilir!
      if (mode !== 'single' && character !== activeTurn) {
        socket.emit('turn_locked_warning', {
          game: 'memory',
          turn: activeTurn,
          message: `⏳ Şu an sıra sevgilinde (${activeTurn === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'})! O hakkını kullanana kadar beklemelisin.`
        });
        return;
      }

      const card = mem.cards[index];
      if (!card || card.flipped || card.matched || mem.flippedIndices.length >= 2) return;

      const playerChar = mode === 'single' ? (character || 'bubu') : activeTurn;
      card.flipped = true;
      mem.flippedIndices.push(index);
      saveDB(db);
      io.to(room.roomCode).emit('memory_game_updated', mem);

      if (mem.flippedIndices.length === 2) {
        const [i1, i2] = mem.flippedIndices;
        const c1 = mem.cards[i1];
        const c2 = mem.cards[i2];

        if (c1.emoji === c2.emoji) {
          c1.matched = true;
          c2.matched = true;
          mem.flippedIndices = [];
          mem.scores[playerChar] = (mem.scores[playerChar] || 0) + 1;

          // Çift modunda hakkını kullandıktan sonra sıra karşı tarafa geçer!
          if (mode !== 'single') {
            mem.turn = activeTurn === 'bubu' ? 'dudu' : 'bubu';
          }

          if (mem.cards.every((c) => c.matched)) {
            const bScore = mem.scores.bubu || 0;
            const dScore = mem.scores.dudu || 0;
            let winChar = 'draw';
            if (bScore > dScore) winChar = 'bubu';
            else if (dScore > bScore) winChar = 'dudu';
            mem.winner = winChar;

            const winName = winChar === 'bubu'
              ? room.coupleInfo.bubuName
              : (winChar === 'dudu' ? room.coupleInfo.duduName : 'Bubu & Dudu Berabere');

            io.to(room.roomCode).emit('game_winner_card', {
              gameTitle: 'Anı Eşleştirme Oyunu 🃏',
              winnerChar: winChar,
              winnerName: winName,
              score: Math.max(bScore, dScore),
              subtitle: winChar === 'draw'
                ? `Berabere! (${bScore} - ${dScore}) İkiniz de Harikasınız! 💕`
                : `Tebrikler ${winName} Kazandı! (${bScore} - ${dScore}) 🎉`,
              reward: 'Hafıza Şampiyonu Öpücüğü 💋'
            });

            sendPushToRoom(room, {
              title: `🃏 Anı Oyununu ${winName} Kazandı!`,
              body: `Skor: Bubu ${bScore} - Dudu ${dScore} 🎉`,
              fromChar: character
            });
          }
          saveDB(db);
          io.to(room.roomCode).emit('memory_game_updated', mem);
        } else {
          // Eşleşmediyse 850ms sonra kapat ve sırayı karşı tarafa geçir
          setTimeout(() => {
            c1.flipped = false;
            c2.flipped = false;
            mem.flippedIndices = [];
            if (mode !== 'single') {
              mem.turn = activeTurn === 'bubu' ? 'dudu' : 'bubu';
            }
            saveDB(db);
            io.to(room.roomCode).emit('memory_game_updated', mem);
          }, 850);
        }
      }
    }
  });

  // Çift Uyum Kartları: Cevap Gönderme & Yeni Soru Ekleme (Bildirimli!)
  socket.on('submit_quiz_answer', ({ roomCode, questionId, character, userName, answer }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!room.games.quizAnswers) room.games.quizAnswers = {};
    if (!room.games.quizAnswers[questionId]) room.games.quizAnswers[questionId] = {};
    room.games.quizAnswers[questionId][character] = answer;
    io.to(room.roomCode).emit('quiz_updated', {
      quizQuestions: room.games.quizQuestions,
      quizAnswers: room.games.quizAnswers
    });

    const qObj = (room.games.quizQuestions || []).find((q) => q.id === questionId);
    const qAns = room.games.quizAnswers[questionId];

    if (qAns.bubu && qAns.dudu) {
      const isMatch = qAns.bubu === qAns.dudu;
      sendPushToRoom(room, {
        title: isMatch ? '💞 %100 ÇİFT UYUMU! TEBRİKLER!' : '🙈 Çift Uyum Kartı: Bi Dahaki Sefere!',
        body: isMatch
          ? `"${qObj ? qObj.question : 'Uyum sorusu'}" sorusunda ikiniz de aynı cevabı verdiniz! 🥳💖`
          : `"${qObj ? qObj.question : 'Uyum sorusu'}" sorusunda farklı düşündünüz, sıradaki soruyu deneyin! 🍀`,
        fromChar: character
      });
    } else {
      sendPushToRoom(room, {
        title: `💑 ${userName || 'Aşkın'} Çift Uyum Kartını Cevapladı!`,
        body: 'Bakalım %100 uyum yakalayabilecek misiniz? Cevabını seçmek için dokun!',
        fromChar: character
      });
    }
    saveDB(db);
  });

  socket.on('add_quiz_question', ({ roomCode, question, options, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!Array.isArray(room.games.quizQuestions)) room.games.quizQuestions = [];
    const newQ = {
      id: 'q-' + Date.now(),
      question,
      options: options && options.length >= 2 ? options : ['Bubu 🐼', 'Dudu 🐻', 'İkimiz de 💕']
    };
    room.games.quizQuestions.unshift(newQ);
    io.to(room.roomCode).emit('quiz_updated', {
      quizQuestions: room.games.quizQuestions,
      quizAnswers: room.games.quizAnswers
    });

    sendPushToRoom(room, {
      title: `💑 ${fromName || 'Aşkın'} Yeni Bir Çift Uyum Sorusu Ekledi!`,
      body: `"${question}" — Hemen girip cevabını seç!`,
      fromChar
    });
    saveDB(db);
  });

  socket.on('delete_quiz_question', ({ roomCode, questionId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (Array.isArray(room.games.quizQuestions)) {
      room.games.quizQuestions = room.games.quizQuestions.filter((q) => q.id !== questionId);
    }
    if (!room.deletedIds.includes(questionId)) room.deletedIds.push(questionId);
    io.to(room.roomCode).emit('quiz_updated', {
      quizQuestions: room.games.quizQuestions,
      quizAnswers: room.games.quizAnswers
    });
    saveDB(db);
  });

  // 3) AŞK NOTLARI & CANLI MESAJLAŞMA
  socket.on('add_note', ({ roomCode, note }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newNote = {
      id: note.id || ('note-' + Date.now()),
      authorChar: note.authorChar || 'bubu',
      authorName: note.authorName || 'Bubu',
      title: note.title || 'Aşk Notu 💌',
      content: note.content || '',
      color: note.color || 'visne',
      mood: note.mood || 'kiss',
      pinned: true,
      createdAt: new Date().toISOString()
    };
    room.notes.unshift(newNote);
    io.to(room.roomCode).emit('note_added', { note: newNote, notes: room.notes });

    sendPushToRoom(room, {
      title: `💌 ${newNote.authorName} Yeni Bir Aşk Notu Bıraktı!`,
      body: `${newNote.title}: "${newNote.content}"`,
      fromChar: newNote.authorChar
    });
    saveDB(db);
  });

  socket.on('edit_note', ({ roomCode, note, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const idx = room.notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) {
      room.notes[idx] = {
        ...room.notes[idx],
        title: note.title || room.notes[idx].title,
        content: note.content ?? room.notes[idx].content,
        color: note.color || room.notes[idx].color,
        mood: note.mood || room.notes[idx].mood,
        updatedAt: new Date().toISOString()
      };
      io.to(room.roomCode).emit('notes_updated', room.notes);
      sendPushToRoom(room, {
        title: `✏️ ${fromName || 'Aşkın'} Bir Aşk Notunu Düzenledi`,
        body: `${room.notes[idx].title}: "${room.notes[idx].content}"`,
        fromChar
      });
      saveDB(db);
    }
  });

  socket.on('delete_note', ({ roomCode, noteId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.notes = room.notes.filter((n) => n.id !== noteId);
    if (!room.deletedIds.includes(noteId)) room.deletedIds.push(noteId);
    io.to(room.roomCode).emit('notes_updated', room.notes);
    saveDB(db);
  });

  socket.on('send_message', ({ roomCode, message }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newMsg = {
      id: message.id || ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5)),
      senderChar: message.senderChar || 'bubu',
      senderName: message.senderName || 'Bubu',
      text: message.text || '',
      sticker: message.sticker || null,
      image: message.image || null,
      reactions: [],
      timestamp: new Date().toISOString()
    };
    room.messages.push(newMsg);
    if (room.messages.length > 200) {
      room.messages = room.messages.slice(-200);
    }
    io.to(room.roomCode).emit('message_received', { message: newMsg });

    sendPushToRoom(room, {
      title: `💬 ${newMsg.senderName} Mesaj Gönderdi`,
      body: newMsg.text || '📸 Sana bir fotoğraf/çıkartma gönderdi!',
      fromChar: newMsg.senderChar
    });
    saveDB(db);
  });

  socket.on('react_message', ({ roomCode, messageId, emoji, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const target = room.messages.find((m) => m.id === messageId);
    if (target) {
      if (!target.reactions) target.reactions = [];
      if (!target.reactions.includes(emoji)) {
        target.reactions.push(emoji);
      }
      io.to(room.roomCode).emit('message_reacted', { messageId, reactions: target.reactions });

      sendPushToRoom(room, {
        title: `${emoji} ${fromName || 'Aşkın'} Mesajına İfade Bıraktı`,
        body: `"${target.text || 'Fotoğraf'}" mesajına ${emoji} bıraktı!`,
        fromChar
      });
      saveDB(db);
    }
  });

  socket.on('typing', ({ roomCode, character, userName, isTyping }) => {
    const code = (roomCode || currentRoomCode).trim().toUpperCase();
    socket.to(code).emit('partner_typing', { character, userName, isTyping });
  });

  // 4) ORTAK TAKVİM, GÖRSELLİ ANI EKLEME & ETKİNLİK PLANLAMA
  socket.on('add_memory', ({ roomCode, memory }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newMem = {
      id: memory.id || ('mem-' + Date.now()),
      date: memory.date || formatDate(new Date()),
      title: memory.title || 'Unutulmaz Anımız 📸',
      description: memory.description || '',
      authorChar: memory.authorChar || 'bubu',
      authorName: memory.authorName || 'Bubu',
      mood: memory.mood || '🥰 Çok Mutlu',
      location: memory.location || '',
      image: memory.image || null,
      createdAt: new Date().toISOString()
    };
    room.memories.unshift(newMem);
    io.to(room.roomCode).emit('memory_added', { memory: newMem });

    sendPushToRoom(room, {
      title: `📸 ${newMem.authorName} Takvime Yeni Bir Anı Ekledi!`,
      body: `${newMem.title} (${newMem.date}) ${newMem.location ? '• 📍 ' + newMem.location : ''}`,
      fromChar: newMem.authorChar
    });
    saveDB(db);
  });

  socket.on('edit_memory', ({ roomCode, memory, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const idx = room.memories.findIndex((m) => m.id === memory.id);
    if (idx >= 0) {
      room.memories[idx] = {
        ...room.memories[idx],
        date: memory.date || room.memories[idx].date,
        title: memory.title || room.memories[idx].title,
        description: memory.description ?? room.memories[idx].description,
        mood: memory.mood || room.memories[idx].mood,
        location: memory.location ?? room.memories[idx].location,
        image: memory.image !== undefined ? memory.image : room.memories[idx].image,
        updatedAt: new Date().toISOString()
      };
      io.to(room.roomCode).emit('memories_updated', room.memories);
      sendPushToRoom(room, {
        title: `✏️ ${fromName || 'Aşkın'} Bir Anıyı Düzenledi!`,
        body: `${room.memories[idx].title} (${room.memories[idx].date})`,
        fromChar
      });
      saveDB(db);
    }
  });

  socket.on('delete_memory', ({ roomCode, memoryId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.memories = room.memories.filter((m) => m.id !== memoryId);
    if (!room.deletedIds.includes(memoryId)) room.deletedIds.push(memoryId);
    io.to(room.roomCode).emit('memories_updated', room.memories);
    saveDB(db);
  });

  socket.on('add_event', ({ roomCode, event }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newEvt = {
      id: event.id || ('evt-' + Date.now()),
      date: event.date || formatDate(new Date()),
      time: event.time || '20:00',
      title: event.title || 'Özel Planımız 📅',
      description: event.description || '',
      category: event.category || 'date',
      remindBeforeDays: Number(event.remindBeforeDays ?? 1),
      authorChar: event.authorChar || 'bubu',
      authorName: event.authorName || 'Bubu',
      completed: false,
      createdAt: new Date().toISOString()
    };
    room.events.push(newEvt);
    room.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    io.to(room.roomCode).emit('event_added', { event: newEvt, events: room.events });

    sendPushToRoom(room, {
      title: `📅 ${newEvt.authorName} Yeni Bir Plan / Etkinlik Ekledi!`,
      body: `${newEvt.title} • Tarih: ${newEvt.date} Saat: ${newEvt.time}`,
      fromChar: newEvt.authorChar
    });
    saveDB(db);
  });

  socket.on('edit_event', ({ roomCode, event, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const idx = room.events.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      room.events[idx] = {
        ...room.events[idx],
        date: event.date || room.events[idx].date,
        time: event.time || room.events[idx].time,
        title: event.title || room.events[idx].title,
        description: event.description ?? room.events[idx].description,
        category: event.category || room.events[idx].category,
        remindBeforeDays: Number(event.remindBeforeDays ?? room.events[idx].remindBeforeDays ?? 1),
        updatedAt: new Date().toISOString()
      };
      room.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      io.to(room.roomCode).emit('events_updated', room.events);
      sendPushToRoom(room, {
        title: `✏️ ${fromName || 'Aşkın'} Bir Planı / Etkinliği Düzenledi!`,
        body: `${room.events[idx].title} • Tarih: ${room.events[idx].date} Saat: ${room.events[idx].time}`,
        fromChar
      });
      saveDB(db);
    }
  });

  socket.on('toggle_event', ({ roomCode, eventId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const evt = room.events.find((e) => e.id === eventId);
    if (evt) {
      evt.completed = !evt.completed;
      io.to(room.roomCode).emit('events_updated', room.events);
      saveDB(db);
    }
  });

  socket.on('delete_event', ({ roomCode, eventId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.events = room.events.filter((e) => e.id !== eventId);
    if (!room.deletedIds.includes(eventId)) room.deletedIds.push(eventId);
    io.to(room.roomCode).emit('events_updated', room.events);
    saveDB(db);
  });

  // 5) "BİZİM ŞARKILARIMIZ" MÜZİK ÇALAR
  socket.on('add_song', ({ roomCode, song }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newSong = {
      id: song.id || ('song-' + Date.now()),
      title: song.title || 'Bizim Şarkımız 🎵',
      artist: song.artist || 'Bubu & Dudu',
      audioUrl: song.audioUrl || '',
      coverUrl: song.coverUrl || '/assets/budu-icon.png',
      note: song.note || '',
      addedByChar: song.addedByChar || 'bubu',
      addedByName: song.addedByName || 'Bubu',
      createdAt: new Date().toISOString()
    };
    room.songs.unshift(newSong);
    io.to(room.roomCode).emit('song_added', { song: newSong, songs: room.songs });

    sendPushToRoom(room, {
      title: `🎵 ${newSong.addedByName} "Bizim Şarkılarımız"a Şarkı Ekledi!`,
      body: `${newSong.title} - ${newSong.artist} ${newSong.note ? '• "' + newSong.note + '"' : ''}`,
      fromChar: newSong.addedByChar
    });
    saveDB(db);
  });

  socket.on('delete_song', ({ roomCode, songId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.songs = room.songs.filter((s) => s.id !== songId);
    if (!room.deletedIds.includes(songId)) room.deletedIds.push(songId);
    io.to(room.roomCode).emit('songs_updated', room.songs);
    saveDB(db);
  });

  socket.on('play_song_sync', ({ roomCode, song, fromChar, fromName }) => {
    const room = getRoom(roomCode || currentRoomCode);
    socket.to(room.roomCode).emit('partner_playing_song', { song, fromChar, fromName });
    sendPushToRoom(room, {
      title: `🎧 ${fromName || 'Aşkın'} Şu An Bizim Şarkımızı Dinliyor!`,
      body: `🎵 ${song.title} - ${song.artist}`,
      fromChar
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐼💕🐻 BuDuLove Sunucusu Port ${PORT} üzerinde çalışıyor!`);
  startCloudflareTunnel();
});
