const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const cors = require('cors');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 15 * 1024 * 1024 // 15MB fotoğraf yüklemeleri için
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'couples_db.json');

// Otomatik Cloudflare HTTPS Tünel URL'si (iPhone Safari & 4G/5G Uzaktan Bağlantı için)
let publicTunnelUrl = null;
let tunnelStatus = 'starting'; // 'starting' | 'ready' | 'error'

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDefaultRoomData(roomCode = 'BUDU-2026') {
  const now = new Date();
  const todayStr = formatDate(now);
  const tomorrow = new Date(now.getTime() + 2 * 86400000);
  const tomorrowStr = formatDate(tomorrow);
  const nextWeek = new Date(now.getTime() + 5 * 86400000);
  const nextWeekStr = formatDate(nextWeek);

  return {
    roomCode,
    coupleInfo: {
      appName: 'BUDULOVE',
      startDate: '2024-06-14',
      loveMeter: 88,
      totalInteractions: 142,
      bubuName: 'Bubu (Ben)',
      duduName: 'Dudu (Aşkım)',
      theme: 'pink-lilac-khaki'
    },
    affectionHistory: [
      {
        id: 'aff-1',
        fromChar: 'bubu',
        fromName: 'Bubu',
        toChar: 'dudu',
        type: 'kiss',
        title: 'Sulu Öpücük 💋',
        message: 'Bubu, Dudu\'nun yanağına kocaman tatlı bir öpücük kondurdu!',
        timestamp: new Date(now.getTime() - 15 * 60000).toISOString()
      },
      {
        id: 'aff-2',
        fromChar: 'dudu',
        fromName: 'Dudu',
        toChar: 'bubu',
        type: 'hug',
        title: 'Sıcak Sarılma 🤗',
        message: 'Dudu, Bubu\'ya sımsıkı sarıldı ve hiç bırakmak istemiyor!',
        timestamp: new Date(now.getTime() - 5 * 60000).toISOString()
      }
    ],
    notes: [
      {
        id: 'note-1',
        authorChar: 'bubu',
        authorName: 'Bubu',
        title: 'Günaydın Sevgilim 🌸',
        content: 'Seninle geçen her gün Bubu ve Dudu\'nun masalı gibi... İyi ki hayatımdasın aşkım! 💕',
        color: 'pink',
        mood: 'kiss',
        isEnvelope: false,
        pinned: true,
        createdAt: new Date(now.getTime() - 3600000 * 3).toISOString()
      },
      {
        id: 'note-2',
        authorChar: 'dudu',
        authorName: 'Dudu',
        title: 'Buluşma Notu 🧋',
        content: 'Bu hafta sonu birlikte en sevdiğimiz tatlıyı yiyip bol bol fotoğraf çekilelim mi? Seni çok seviyorum!',
        color: 'khaki',
        mood: 'hug',
        isEnvelope: true,
        pinned: true,
        createdAt: new Date(now.getTime() - 3600000).toISOString()
      }
    ],
    messages: [
      {
        id: 'msg-1',
        senderChar: 'bubu',
        senderName: 'Bubu',
        text: 'Aşkım yeni ortak uygulamamıza hoş geldin! 🐼💕🐻',
        sticker: 'hug',
        image: null,
        reactions: ['❤️'],
        timestamp: new Date(now.getTime() - 1800000).toISOString()
      },
      {
        id: 'msg-2',
        senderChar: 'dudu',
        senderName: 'Dudu',
        text: 'Renkleri de Bubu ile Dudu da harika olmuş! Buradan sana her an öpücük atacağım 💋',
        sticker: 'kiss',
        image: null,
        reactions: ['💋', '🥺'],
        timestamp: new Date(now.getTime() - 900000).toISOString()
      }
    ],
    memories: [
      {
        id: 'mem-1',
        date: todayStr,
        title: 'Bubu & Dudu Dünyamız Kuruldu ✨',
        description: 'İkimizin ortak anılarını, takvimini ve oyunlarını saklayacağımız özel köşemiz.',
        authorChar: 'bubu',
        authorName: 'Bubu & Dudu',
        mood: '🥰 Çok Mutlu',
        location: 'Kalplerimiz',
        image: null,
        illustrationType: 'couple_hug',
        createdAt: now.toISOString()
      }
    ],
    events: [
      {
        id: 'evt-1',
        date: tomorrowStr,
        time: '19:30',
        title: 'Romantik Akşam Yemeği & Tatlı Randevusu 🍰',
        description: 'Bubu ve Dudu gibi el ele yürüyüş ve tatlı keyfi!',
        category: 'date',
        remindBeforeDays: 3,
        authorChar: 'dudu',
        completed: false,
        createdAt: now.toISOString()
      },
      {
        id: 'evt-2',
        date: nextWeekStr,
        time: '15:00',
        title: 'Sinema & Kahve Günü 🎬☕',
        description: 'Birlikte seçtiğimiz filmi izleyip bolca fotoğraf çekileceğiz.',
        category: 'special',
        remindBeforeDays: 7,
        authorChar: 'bubu',
        completed: false,
        createdAt: now.toISOString()
      }
    ],
    games: {
      balloonScores: { bubu: 240, dudu: 210 },
      loveRushScores: { bubu: 185, dudu: 195 },
      memoryScores: { bubu: 14, dudu: 16 },
      xox: {
        board: [null, null, null, null, null, null, null, null, null],
        turn: 'bubu',
        winner: null,
        reward: '100 Öpücük & Kahve Ismarlama 🧋',
        scores: { bubu: 2, dudu: 2 }
      },
      quizAnswers: {
        q0: { bubu: 'Bubu 🐼', dudu: 'Bubu 🐼' },
        q1: { bubu: 'Sarılıp Film İzlemek 🍿', dudu: 'Sarılıp Film İzlemek 🍿' }
      }
    }
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Veritabanı okuma hatası:', e);
  }
  const initial = { 'BUDU-2026': getDefaultRoomData('BUDU-2026') };
  saveDB(initial);
  return initial;
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Veritabanı yazma hatası:', e);
  }
}

const db = loadDB();

function getRoom(roomCode) {
  const code = (roomCode || 'BUDU-2026').trim().toUpperCase();
  if (!db[code]) {
    db[code] = getDefaultRoomData(code);
    saveDB(db);
  }
  return db[code];
}

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

// Otomatik Cloudflare HTTPS Tüneli Başlatıcı (iPhone Safari + 4G/5G Her Yerden Bağlantı)
function startCloudflareTunnel() {
  const cfBin = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
  if (!fs.existsSync(cfBin)) {
    console.log('⚠️ cloudflared.exe bulunamadı, yalnızca yerel ağ aktif.');
    tunnelStatus = 'error';
    return;
  }

  console.log('🌍 iPhone & Uzaktan 4G/5G Bağlantısı için Güvenli HTTPS Tüneli açılıyor...');
  const cfProc = spawn(cfBin, ['tunnel', '--url', `http://localhost:${PORT}`], {
    windowsHide: true
  });

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !publicTunnelUrl) {
      publicTunnelUrl = match[0];
      tunnelStatus = 'ready';
      console.log('==========================================================');
      console.log(' 🚀 İPHONE & UZAKTAN (4G/5G) HTTPS BAĞLANTISI HAZIR!');
      console.log(` 📱 iPhone Safari Linki: ${publicTunnelUrl}`);
      console.log(' (Bu linki ve QR kodu hem aynı Wi-Fi\'da hem farklı evlerden kullanabilirsiniz!)');
      console.log('==========================================================');
      io.emit('tunnel_ready', { publicTunnelUrl });
    }
  };

  cfProc.stdout.on('data', handleOutput);
  cfProc.stderr.on('data', handleOutput);

  cfProc.on('error', (err) => {
    console.error('Tünel hatası:', err.message);
    tunnelStatus = 'error';
  });
}

// Sunucu bilgisi ve iPhone QR Kodu endpointi
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
      color: {
        dark: '#4A3B5C',
        light: '#FAF7F5'
      }
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

// Oda verisini çekme
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  res.json(room);
});

// REST üzerinden fotoğraf/anı veya aksiyon yedek endpointi
app.post('/api/room/:code/memory', (req, res) => {
  const room = getRoom(req.params.code);
  const memory = {
    id: 'mem-' + Date.now(),
    date: req.body.date || formatDate(new Date()),
    title: req.body.title || 'Güzel Bir Anımız 💕',
    description: req.body.description || '',
    authorChar: req.body.authorChar || 'bubu',
    authorName: req.body.authorName || 'Bubu',
    mood: req.body.mood || '🥰 Çok Mutlu',
    location: req.body.location || '',
    image: req.body.image || null,
    illustrationType: req.body.illustrationType || 'couple_hug',
    createdAt: new Date().toISOString()
  };
  room.memories.unshift(memory);
  saveDB(db);
  io.to(room.roomCode).emit('state_updated', { type: 'memory_added', room, payload: memory });
  res.json({ success: true, memory, room });
});

// Socket.io Canlı İki Taraf Senkronizasyonu
io.on('connection', (socket) => {
  let currentRoomCode = 'BUDU-2026';

  if (publicTunnelUrl) {
    socket.emit('tunnel_ready', { publicTunnelUrl });
  }

  socket.on('join_room', ({ roomCode, character, userName }) => {
    currentRoomCode = (roomCode || 'BUDU-2026').trim().toUpperCase();
    socket.join(currentRoomCode);
    const room = getRoom(currentRoomCode);

    if (character === 'bubu' && userName) {
      room.coupleInfo.bubuName = userName;
    } else if (character === 'dudu' && userName) {
      room.coupleInfo.duduName = userName;
    }
    saveDB(db);

    socket.emit('room_state', room);
    socket.to(currentRoomCode).emit('partner_online', {
      character,
      userName,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('update_couple_info', ({ roomCode, coupleInfo }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.coupleInfo = { ...room.coupleInfo, ...coupleInfo };
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('send_affection', ({ roomCode, fromChar, fromName, toChar, type, title, message }) => {
    const room = getRoom(roomCode || currentRoomCode);
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
    if (room.affectionHistory.length > 40) {
      room.affectionHistory = room.affectionHistory.slice(0, 40);
    }
    room.coupleInfo.loveMeter = Math.min(100, (room.coupleInfo.loveMeter || 80) + 4);
    room.coupleInfo.totalInteractions = (room.coupleInfo.totalInteractions || 0) + 1;
    saveDB(db);

    io.to(room.roomCode).emit('affection_received', { entry, room });
  });

  socket.on('live_touch', (data) => {
    const code = (data.roomCode || currentRoomCode).trim().toUpperCase();
    socket.to(code).emit('partner_live_touch', data);
  });

  socket.on('update_game_score', ({ roomCode, gameKey, character, score }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!room.games[gameKey]) room.games[gameKey] = { bubu: 0, dudu: 0 };
    if (score > (room.games[gameKey][character] || 0)) {
      room.games[gameKey][character] = score;
    }
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('xox_move', ({ roomCode, index, character, reset, reward }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const xox = room.games.xox;
    if (reward) {
      xox.reward = reward;
    }
    if (reset) {
      xox.board = [null, null, null, null, null, null, null, null, null];
      xox.winner = null;
      xox.turn = character || 'bubu';
    } else if (typeof index === 'number' && !xox.board[index] && !xox.winner) {
      xox.board[index] = character;
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
      } else if (xox.board.every((cell) => cell !== null)) {
        xox.winner = 'draw';
      } else {
        xox.turn = character === 'bubu' ? 'dudu' : 'bubu';
      }
    }
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('submit_quiz_answer', ({ roomCode, questionId, character, answer }) => {
    const room = getRoom(roomCode || currentRoomCode);
    if (!room.games.quizAnswers) room.games.quizAnswers = {};
    if (!room.games.quizAnswers[questionId]) room.games.quizAnswers[questionId] = {};
    room.games.quizAnswers[questionId][character] = answer;
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('add_note', ({ roomCode, note }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newNote = {
      id: 'note-' + Date.now(),
      authorChar: note.authorChar || 'bubu',
      authorName: note.authorName || 'Bubu',
      title: note.title || 'Aşk Notu 💌',
      content: note.content || '',
      color: note.color || 'pink',
      mood: note.mood || 'kiss',
      isEnvelope: !!note.isEnvelope,
      pinned: true,
      createdAt: new Date().toISOString()
    };
    room.notes.unshift(newNote);
    saveDB(db);
    io.to(room.roomCode).emit('note_added', { note: newNote, room });
  });

  socket.on('delete_note', ({ roomCode, noteId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.notes = room.notes.filter((n) => n.id !== noteId);
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('send_message', ({ roomCode, message }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newMsg = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      senderChar: message.senderChar || 'bubu',
      senderName: message.senderName || 'Bubu',
      text: message.text || '',
      sticker: message.sticker || null,
      image: message.image || null,
      reactions: [],
      timestamp: new Date().toISOString()
    };
    room.messages.push(newMsg);
    if (room.messages.length > 150) {
      room.messages = room.messages.slice(-150);
    }
    saveDB(db);
    io.to(room.roomCode).emit('message_received', { message: newMsg, room });
  });

  socket.on('react_message', ({ roomCode, messageId, emoji }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const target = room.messages.find((m) => m.id === messageId);
    if (target) {
      if (!target.reactions) target.reactions = [];
      if (!target.reactions.includes(emoji)) {
        target.reactions.push(emoji);
      }
      saveDB(db);
      io.to(room.roomCode).emit('room_state', room);
    }
  });

  socket.on('typing', ({ roomCode, character, userName, isTyping }) => {
    const code = (roomCode || currentRoomCode).trim().toUpperCase();
    socket.to(code).emit('partner_typing', { character, userName, isTyping });
  });

  socket.on('add_memory', ({ roomCode, memory }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newMem = {
      id: 'mem-' + Date.now(),
      date: memory.date || formatDate(new Date()),
      title: memory.title || 'Unutulmaz Anımız 📸',
      description: memory.description || '',
      authorChar: memory.authorChar || 'bubu',
      authorName: memory.authorName || 'Bubu',
      mood: memory.mood || '🥰 Çok Mutlu',
      location: memory.location || '',
      image: memory.image || null,
      illustrationType: memory.illustrationType || 'couple_hug',
      createdAt: new Date().toISOString()
    };
    room.memories.unshift(newMem);
    saveDB(db);
    io.to(room.roomCode).emit('memory_added', { memory: newMem, room });
  });

  socket.on('delete_memory', ({ roomCode, memoryId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.memories = room.memories.filter((m) => m.id !== memoryId);
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });

  socket.on('add_event', ({ roomCode, event }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const newEvt = {
      id: 'evt-' + Date.now(),
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
    saveDB(db);
    io.to(room.roomCode).emit('event_added', { event: newEvt, room });
  });

  socket.on('toggle_event', ({ roomCode, eventId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    const evt = room.events.find((e) => e.id === eventId);
    if (evt) {
      evt.completed = !evt.completed;
      saveDB(db);
      io.to(room.roomCode).emit('room_state', room);
    }
  });

  socket.on('delete_event', ({ roomCode, eventId }) => {
    const room = getRoom(roomCode || currentRoomCode);
    room.events = room.events.filter((e) => e.id !== eventId);
    saveDB(db);
    io.to(room.roomCode).emit('room_state', room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('==========================================================');
  console.log(' 🐼💕🐻 BuDuLove (Bubu & Dudu Ortak Mobil Uygulama) Hazır!');
  console.log('==========================================================');
  console.log(` 💻 Bilgisayar / iPhone Stüdyosu: http://localhost:${PORT}/studio.html`);
  ips.forEach((ip) => {
    console.log(` 🏠 Yerel Ağ (Aynı Ev Wi-Fi): http://${ip}:${PORT}`);
  });
  console.log('==========================================================');
  startCloudflareTunnel();
});
