/* ============================================================================
   BUDULOVE • Bubu & Dudu Ortak Sevgili Mobil Uygulaması (iOS PWA + Real-Time)
   ============================================================================ */

const urlParams = new URLSearchParams(window.location.search);
const forcedRole = urlParams.get('role'); // 'bubu' veya 'dudu' (Yan yana 2 iPhone testi için)
const storagePrefix = forcedRole ? `budu_${forcedRole}_` : 'budu_';

let myCharacter = forcedRole || localStorage.getItem(storagePrefix + 'myChar') || 'bubu';
let currentRoomCode = (localStorage.getItem('budu_roomCode') || 'BUDU-2026').toUpperCase();

let roomState = null;
let socket = null;
let bcChannel = null;

// Takvim Durumu
let calNow = new Date();
let currentCalYear = calNow.getFullYear();
let currentCalMonth = calNow.getMonth();
let selectedCalDate = formatDateISO(calNow);
let pendingMemoryImageBase64 = null;

// Ses Sentezleyici (Web Audio API - Harici ses dosyasına ihtiyaç duymadan çalışır)
let audioCtx = null;
function playCuteSound(type = 'pop') {
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'kiss' || type === 'notif') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.14);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'pop') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch (e) {}
  if (navigator.vibrate) {
    navigator.vibrate(type === 'notif' ? [35, 50, 45] : 18);
  }
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeShort(isoStr) {
  if (!isoStr) return 'Şimdi';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// BAŞLANGIÇ & BAĞLANTI (Socket.io + BroadcastChannel + Service Worker)
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  initBroadcastChannel();
  initSocketConnection();
  initDirectStageTouch();
  initMemoryMatchGame();
  updateCharacterRoleUI();

  if (!forcedRole && !localStorage.getItem(storagePrefix + 'charChosenOnce')) {
    openCharSelectModal();
  }
});

function initBroadcastChannel() {
  if ('BroadcastChannel' in window) {
    bcChannel = new BroadcastChannel('buduverse_live_channel');
    bcChannel.onmessage = (ev) => {
      const data = ev.data;
      if (!data) return;
      if (data.type === 'affection' && data.entry.fromChar !== myCharacter) {
        showIosBanner(
          data.entry.fromChar === 'bubu' ? '🐼💋' : '🐻🤗',
          `${data.entry.fromName}: ${data.entry.title}`,
          data.entry.message
        );
        animateStageCharacters(data.entry.type, data.entry.message);
      }
    };
  }
}

function initSocketConnection() {
  try {
    socket = io();

    socket.on('connect', () => {
      socket.emit('join_room', {
        roomCode: currentRoomCode,
        character: myCharacter,
        userName: getMyDisplayName()
      });
    });

    socket.on('room_state', (room) => {
      roomState = room;
      renderAllFromState();
    });

    socket.on('tunnel_ready', () => {
      refreshQrModalInfo();
    });

    socket.on('affection_received', ({ entry, room }) => {
      roomState = room;
      renderAllFromState();
      animateStageCharacters(entry.type, entry.message);

      if (entry.fromChar !== myCharacter) {
        showIosBanner(
          entry.fromChar === 'bubu' ? '🐼💕' : '🐻💕',
          `${entry.fromName} • ${entry.title}`,
          entry.message
        );
      } else {
        showIosBanner(
          '✨💌',
          `Sevgiline Bildirim Gönderildi!`,
          `${entry.title} karşı tarafın telefonuna iletildi.`
        );
      }
    });

    socket.on('partner_live_touch', (data) => {
      spawnStageParticles(data.emoji || '💕', 4);
      const speech = document.getElementById('stageSpeech');
      if (speech) {
        speech.textContent = `${data.fromName || 'Aşkın'} şu an ${data.targetChar === 'bubu' ? 'Bubu' : 'Dudu'}'yu okşuyor! 🥰`;
      }
    });

    socket.on('note_added', ({ note, room }) => {
      roomState = room;
      renderAllFromState();
      if (note.authorChar !== myCharacter) {
        showIosBanner('💌📌', `${note.authorName} yeni bir Aşk Notu bıraktı!`, `${note.title}: "${note.content}"`);
      }
    });

    socket.on('message_received', ({ message, room }) => {
      roomState = room;
      renderChatMessages();
      if (message.senderChar !== myCharacter) {
        showIosBanner(
          message.senderChar === 'bubu' ? '🐼💬' : '🐻💬',
          `${message.senderName} mesaj gönderdi`,
          message.text || 'Sana sevimli bir çıkartma/fotoğraf gönderdi!'
        );
      }
    });

    socket.on('partner_typing', ({ character, userName, isTyping }) => {
      if (character !== myCharacter) {
        const bar = document.getElementById('typingIndicatorBar');
        if (bar) {
          bar.style.display = isTyping ? 'block' : 'none';
          bar.textContent = `✨ ${userName || 'Aşkım'} yazıyor...`;
        }
      }
    });

    socket.on('memory_added', ({ memory, room }) => {
      roomState = room;
      renderAllFromState();
      if (memory.authorChar !== myCharacter) {
        showIosBanner('📸💖', `${memory.authorName} takvime yeni bir Anı ekledi!`, `${memory.title} (${memory.date})`);
      }
    });

    socket.on('event_added', ({ event, room }) => {
      roomState = room;
      renderAllFromState();
      showIosBanner('📅⏰', `Yeni Etkinlik Planlandı: ${event.title}`, `Tarih: ${event.date} • Saat: ${event.time}`);
    });
  } catch (e) {
    console.warn('Socket bağlantı hatası, API yedek moduna geçiliyor:', e);
    fetch(`/api/room/${currentRoomCode}`)
      .then((r) => r.json())
      .then((room) => {
        roomState = room;
        renderAllFromState();
      });
  }
}

// ============================================================================
// İOS BİLDİRİM BANNERI & WEB PUSH BİLDİRİMLERİ
// ============================================================================
let bannerTimeout = null;
function showIosBanner(avatarEmoji, title, text) {
  playCuteSound('notif');
  const banner = document.getElementById('iosNotificationBanner');
  document.getElementById('notifAvatar').textContent = avatarEmoji || '🐼💕';
  document.getElementById('notifTitle').textContent = title;
  document.getElementById('notifText').textContent = text;

  banner.classList.add('show');
  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    banner.classList.remove('show');
  }, 4300);

  // Arka plandaysa veya izin verilmişse gerçek iOS / Tarayıcı bildirimi de gönder
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, {
        body: text,
        icon: '/assets/budu-icon.png',
        badge: '/assets/budu-icon.png'
      });
    } catch (e) {}
  }
}

function hideIosBanner() {
  document.getElementById('iosNotificationBanner').classList.remove('show');
}

function requestIosNotifications() {
  if (!('Notification' in window)) {
    showIosBanner('📱🔔', 'Uygulama İçi Canlı Bildirim Aktif!', 'iPhone Ana Ekranına eklediğinizde tüm bildirimler anında görünür.');
    return;
  }
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') {
      showIosBanner('🔔💖', 'Bildirimler Açıldı!', 'Artık Bubu ve Dudu\'nun her öpücüğü ve etkinlik hatırlatması anında bildirim olarak gelecek!');
      try {
        new Notification('BUDULOVE Bildirimleri Aktif! 🐼💕🐻', {
          body: 'Sevgilin sana dokunduğunda veya öpücük attığında anında haberdar olacaksın!',
          icon: '/assets/budu-icon.png'
        });
      } catch (e) {}
    } else {
      showIosBanner('🔔✨', 'Canlı Banner Bildirimleri Aktif', 'Uygulama içi Dynamic Island bildirimleri ve ses efektleri devrede!');
    }
  });
}

// ============================================================================
// KARAKTER SEÇİMİ: BEN -> BUBU / DUDU & AŞKIM -> DUDU / BUBU
// ============================================================================
function getMyDisplayName() {
  if (!roomState || !roomState.coupleInfo) {
    return myCharacter === 'bubu' ? 'Bubu' : 'Dudu';
  }
  return myCharacter === 'bubu'
    ? (roomState.coupleInfo.bubuName || 'Bubu')
    : (roomState.coupleInfo.duduName || 'Dudu');
}

function getPartnerCharacter() {
  return myCharacter === 'bubu' ? 'dudu' : 'bubu';
}

function getPartnerDisplayName() {
  if (!roomState || !roomState.coupleInfo) {
    return myCharacter === 'bubu' ? 'Dudu' : 'Bubu';
  }
  return myCharacter === 'bubu'
    ? (roomState.coupleInfo.duduName || 'Dudu')
    : (roomState.coupleInfo.bubuName || 'Bubu');
}

function toggleMyCharacter() {
  const nextChar = myCharacter === 'bubu' ? 'dudu' : 'bubu';
  setMyCharacter(nextChar);
}

function openCharSelectModal() {
  const modal = document.getElementById('charSelectModal');
  if (modal) modal.classList.add('open');
}

function chooseCharacterAndClose(charName) {
  localStorage.setItem(storagePrefix + 'charChosenOnce', '1');
  setMyCharacter(charName);
  closeModal('charSelectModal');
}

function setMyCharacter(charName) {
  myCharacter = charName === 'dudu' ? 'dudu' : 'bubu';
  localStorage.setItem(storagePrefix + 'myChar', myCharacter);
  localStorage.setItem(storagePrefix + 'charChosenOnce', '1');
  updateCharacterRoleUI();
  renderAllFromState();

  const label = myCharacter === 'bubu' ? '🐼 Seçili Karakterin: Bubu' : '🐻 Seçili Karakterin: Dudu';
  showIosBanner(myCharacter === 'bubu' ? '🐼✨' : '🐻✨', 'Karakterin Seçildi!', label);
}

function updateCharacterRoleUI() {
  const isBubu = myCharacter === 'bubu';
  document.getElementById('myCharEmoji').textContent = isBubu ? '🐼' : '🐻';
  document.getElementById('myCharText').textContent = isBubu ? 'Bubu' : 'Dudu';

  const cardMe = document.getElementById('cardRoleMe');
  if (cardMe) {
    cardMe.className = 'char-choice-card ' + (isBubu ? 'active-bubu' : 'active-dudu');
  }

  document.getElementById('meAvatarBox').textContent = isBubu ? '🐼' : '🐻';
  document.getElementById('meCharDisplay').textContent = isBubu ? `${getMyDisplayName()} 🐼` : `${getMyDisplayName()} 🐻`;
  document.getElementById('meNicknameDisplay').textContent = isBubu
    ? 'Bubu • Sevimli Beyaz Panda (Sadece Bubu Gösteriliyor)'
    : 'Dudu • Tatlı Kahve Ayıcık (Sadece Dudu Gösteriliyor)';

  // Sahnede SADECE seçili olan tek karakteri göster, diğerini gizle
  const stageBubu = document.getElementById('stageCharBubu');
  const stageDudu = document.getElementById('stageCharDudu');
  if (stageBubu && stageDudu) {
    stageBubu.style.display = isBubu ? 'flex' : 'none';
    stageDudu.style.display = !isBubu ? 'flex' : 'none';
  }

  const stageSpeech = document.getElementById('stageSpeech');
  if (stageSpeech) {
    stageSpeech.textContent = isBubu
      ? '🐼 Bubu\'ya dokun veya sevgiline (Dudu\'ya) sevgi gönder! 💕'
      : '🐻 Dudu\'ya dokun veya sevgiline (Bubu\'ya) sevgi gönder! 💕';
  }

  const btnBubu = document.getElementById('btnSelectBubu');
  const btnDudu = document.getElementById('btnSelectDudu');
  if (btnBubu && btnDudu) {
    btnBubu.className = isBubu ? 'primary-btn' : 'secondary-btn';
    btnDudu.className = !isBubu ? 'primary-btn' : 'secondary-btn';
  }
}

// ============================================================================
// 1) BUBU & DUDU SEVGİ GÖSTERME, DOKUNMA, ÖPÜCÜK ATMA & BİLDİRİMLER
// ============================================================================
const AFFECTION_TYPES = {
  kiss: {
    emoji: '💋',
    title: 'Sulu Öpücük Gönderdi 💋',
    getMsg: (from, to) => `${from}, ${to}'nun yanağına kocaman tatlı bir öpücük kondurdu! 💋💕`,
    anim: 'anim-kiss'
  },
  hug: {
    emoji: '🤗',
    title: 'Sımsıkı Sarıldı 🤗',
    getMsg: (from, to) => `${from}, ${to}'ya kemikleri ısınana kadar sımsıkı sarıldı! 🤗💖`,
    anim: 'anim-hug'
  },
  pinch: {
    emoji: '🤏',
    title: 'Tatlı Yanaklarını Mıncırdı 🤏',
    getMsg: (from, to) => `${from}, ${to}'nun tombul yanaklarını sevgiyle mıncırdı! ☺️🌸`,
    anim: 'anim-bounce'
  },
  touch: {
    emoji: '👉👈',
    title: 'Seni Özleyip Dokundu 👉👈',
    getMsg: (from, to) => `${from}, "Bana ilgi göster aşkım!" diyerek ${to}'ya tatlıca dokundu! 🥺💕`,
    anim: 'anim-bounce'
  },
  treat: {
    emoji: '🧋🍓',
    title: 'Boba & Çilek İkram Etti 🧋',
    getMsg: (from, to) => `${from}, ${to}'ya en sevdiği çilekli Bubble Tea'yi ikram etti! 🧋🍓`,
    anim: 'anim-hug'
  },
  heartbeat: {
    emoji: '💓',
    title: 'Kalp Atışı Gönderdi 💓',
    getMsg: (from, to) => `${from}'nin kalbi şu an sadece ${to} için küt küt atıyor! 💓✨`,
    anim: 'anim-kiss'
  }
};

function triggerAffection(type) {
  const spec = AFFECTION_TYPES[type] || AFFECTION_TYPES.kiss;
  const fromName = getMyDisplayName();
  const toName = getPartnerDisplayName();
  const payload = {
    roomCode: currentRoomCode,
    fromChar: myCharacter,
    fromName,
    toChar: getPartnerCharacter(),
    type,
    title: spec.title,
    message: spec.getMsg(fromName, toName)
  };

  playCuteSound('kiss');
  spawnStageParticles(spec.emoji, 10);
  animateStageCharacters(type, payload.message);

  if (socket && socket.connected) {
    socket.emit('send_affection', payload);
  }
  if (bcChannel) {
    bcChannel.postMessage({ type: 'affection', entry: payload });
  }
}

function onCharacterDirectTouch(targetChar, event) {
  if (event) event.stopPropagation();
  const emojiList = ['💕', '💋', '✨', '🌸', '🥰'];
  const pick = emojiList[Math.floor(Math.random() * emojiList.length)];
  playCuteSound('pop');
  spawnStageParticles(pick, 6);

  const charLabel = targetChar === 'bubu' ? 'Bubu 🐼' : 'Dudu 🐻';
  const speech = document.getElementById('stageSpeech');
  speech.textContent = `${charLabel} dokunuşunla çok mutlu oldu ve gülümsüyor! 🥰`;

  const wrapper = document.getElementById('charactersWrapper');
  wrapper.classList.remove('anim-bounce');
  void wrapper.offsetWidth;
  wrapper.classList.add('anim-bounce');

  if (socket && socket.connected) {
    socket.emit('live_touch', {
      roomCode: currentRoomCode,
      fromChar: myCharacter,
      fromName: getMyDisplayName(),
      targetChar,
      emoji: pick
    });
  }

  // Karakterin üzerine dokunulduğunda da sevgi bildirimi gönder
  triggerAffection(targetChar === myCharacter ? 'hug' : 'kiss');
}

function initDirectStageTouch() {
  const stage = document.getElementById('buduStage');
  if (!stage) return;
  let lastEmit = 0;

  stage.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1 && e.pointerType === 'mouse') return;
    const now = Date.now();
    if (now - lastEmit > 220) {
      lastEmit = now;
      spawnStageParticles('💖', 2);
      if (socket && socket.connected) {
        socket.emit('live_touch', {
          roomCode: currentRoomCode,
          fromChar: myCharacter,
          fromName: getMyDisplayName(),
          targetChar: getPartnerCharacter(),
          emoji: '💖'
        });
      }
    }
  });
}

function animateStageCharacters(type, speechText) {
  const wrapper = document.getElementById('charactersWrapper');
  const speech = document.getElementById('stageSpeech');
  if (speech && speechText) {
    speech.textContent = speechText;
  }
  const spec = AFFECTION_TYPES[type] || AFFECTION_TYPES.kiss;
  wrapper.classList.remove('anim-kiss', 'anim-hug', 'anim-bounce');
  void wrapper.offsetWidth;
  wrapper.classList.add(spec.anim);
  spawnStageParticles(spec.emoji, 8);

  setTimeout(() => {
    wrapper.classList.remove('anim-kiss', 'anim-hug', 'anim-bounce');
  }, 1400);
}

function spawnStageParticles(emoji, count = 6) {
  const stage = document.getElementById('buduStage');
  if (!stage) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'floating-particle';
    el.textContent = emoji;
    el.style.left = `${20 + Math.random() * 60}%`;
    el.style.top = `${35 + Math.random() * 40}%`;
    el.style.animationDelay = `${Math.random() * 0.22}s`;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
}

// ============================================================================
// TÜM VERİLERİ EKRANA YANSITMA (RENDER)
// ============================================================================
function renderAllFromState() {
  if (!roomState) return;
  updateCharacterRoleUI();

  // Oda kodu ve çift bilgileri
  const info = roomState.coupleInfo || {};
  document.getElementById('roomCodeBadge').textContent = `Oda: ${roomState.roomCode || currentRoomCode}`;
  document.getElementById('inputBubuName').value = info.bubuName || 'Bubu';
  document.getElementById('inputDuduName').value = info.duduName || 'Dudu';
  document.getElementById('inputRoomCode').value = roomState.roomCode || currentRoomCode;
  if (info.startDate) {
    document.getElementById('inputStartDate').value = info.startDate;
    const start = new Date(info.startDate);
    const diffDays = Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000));
    document.getElementById('togetherDaysCount').textContent = `${diffDays} Gündür Birlikteyiz 💞`;
  }

  // Sevgi barı
  const meter = Math.min(100, Math.max(10, info.loveMeter || 88));
  document.getElementById('loveMeterValue').textContent = `%${meter} Dolu`;
  document.getElementById('loveMeterFill').style.width = `${meter}%`;
  document.getElementById('totalInteractionsBadge').textContent = `${info.totalInteractions || 0} Sevgi Dokunuşu`;

  renderAffectionFeed();
  renderStickyNotes();
  renderChatMessages();
  renderCalendarAndEvents();
  renderGamesState();
}

function renderAffectionFeed() {
  const list = document.getElementById('affectionFeedList');
  if (!list || !roomState) return;
  const items = roomState.affectionHistory || [];
  if (items.length === 0) {
    list.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">Henüz sevgi bildirimi yok. Yukarıdan ilk öpücüğü sen gönder! 💋</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 12).map((item) => {
    const spec = AFFECTION_TYPES[item.type] || AFFECTION_TYPES.kiss;
    const charBadge = item.fromChar === 'bubu' ? '🐼' : '🐻';
    return `
      <div class="feed-item">
        <div class="feed-icon">${spec.emoji}</div>
        <div class="feed-info">
          <div class="feed-title">${charBadge} ${escapeHtml(item.title)}</div>
          <div class="feed-desc">${escapeHtml(item.message)}</div>
        </div>
        <div class="feed-time">${formatTimeShort(item.timestamp)}</div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// 2) OYUNLAR: BALON PATLATMA, SNAP LOVE RUSH, CANLI XOX, HAFIZA & ÇİFT UYUMU
// ============================================================================
function selectGame(gameId, btnEl) {
  document.querySelectorAll('.game-selector-btn').forEach((b) => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  document.querySelectorAll('.game-panel').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById('game-' + gameId);
  if (target) target.classList.add('active');
}

function renderGamesState() {
  if (!roomState || !roomState.games) return;
  const g = roomState.games;

  if (g.balloonScores) {
    document.getElementById('balloonScoreBubu').textContent = g.balloonScores.bubu || 0;
    document.getElementById('balloonScoreDudu').textContent = g.balloonScores.dudu || 0;
  }
  if (g.loveRushScores) {
    document.getElementById('rushScoreBubu').textContent = g.loveRushScores.bubu || 0;
    document.getElementById('rushScoreDudu').textContent = g.loveRushScores.dudu || 0;
  }

  renderXoxBoard();
  renderCoupleQuiz();
}

// --- OYUN 1: BALON PATLATMA OYUNU ---
let balloonAnimId = null;
let balloonTimerInt = null;

function startBalloonGame() {
  const canvas = document.getElementById('balloonCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('balloonOverlay');
  overlay.classList.add('hidden');

  if (balloonAnimId) cancelAnimationFrame(balloonAnimId);
  if (balloonTimerInt) clearInterval(balloonTimerInt);

  let score = 0;
  let timeLeft = 30;
  let balloons = [];
  let pops = [];

  const palette = [
    { fill: '#F7C6D9', stroke: '#C85A87', emoji: '💖', pts: 10 },
    { fill: '#D6C7EB', stroke: '#7B5DB8', emoji: '💜', pts: 15 },
    { fill: '#C7D6BF', stroke: '#5C7350', emoji: '🌿', pts: 15 },
    { fill: '#FFE082', stroke: '#F57F17', emoji: '🐼🐻', pts: 30 },
    { fill: '#4A3B5C', stroke: '#2D2238', emoji: '⛈️', pts: -15 }
  ];

  function spawnBalloon() {
    const typeIdx = Math.random() < 0.14 ? 4 : (Math.random() < 0.2 ? 3 : Math.floor(Math.random() * 3));
    const p = palette[typeIdx];
    balloons.push({
      x: 35 + Math.random() * (canvas.width - 70),
      y: canvas.height + 35,
      r: typeIdx === 3 ? 28 : 24,
      speed: 1.5 + Math.random() * 1.9,
      wobble: Math.random() * Math.PI * 2,
      ...p
    });
  }

  for (let i = 0; i < 6; i++) spawnBalloon();

  canvas.onpointerdown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i];
      const dist = Math.hypot(x - b.x, y - b.y);
      if (dist <= b.r + 10) {
        score = Math.max(0, score + b.pts);
        playCuteSound('pop');
        pops.push({ x: b.x, y: b.y, text: (b.pts > 0 ? `+${b.pts}` : `${b.pts}`), alpha: 1 });
        balloons.splice(i, 1);
        spawnBalloon();
        break;
      }
    }
  };

  document.getElementById('balloonTimerBadge').textContent = `⏱️ ${timeLeft} sn • Skor: ${score}`;

  balloonTimerInt = setInterval(() => {
    timeLeft--;
    document.getElementById('balloonTimerBadge').textContent = `⏱️ ${timeLeft} sn • Skor: ${score}`;
    if (timeLeft <= 0) {
      clearInterval(balloonTimerInt);
      cancelAnimationFrame(balloonAnimId);
      overlay.classList.remove('hidden');
      overlay.querySelector('h3').textContent = `Harika! Skorun: ${score} Puan 🎉`;
      if (socket && socket.connected) {
        socket.emit('update_game_score', {
          roomCode: currentRoomCode,
          gameKey: 'balloonScores',
          character: myCharacter,
          score
        });
      }
    }
  }, 1000);

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (Math.random() < 0.05 && balloons.length < 9) spawnBalloon();

    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i];
      b.y -= b.speed;
      b.wobble += 0.04;
      const drawX = b.x + Math.sin(b.wobble) * 8;

      // Balon ipi
      ctx.beginPath();
      ctx.moveTo(drawX, b.y + b.r);
      ctx.lineTo(drawX, b.y + b.r + 18);
      ctx.strokeStyle = 'rgba(118,104,130,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Balon gövdesi
      ctx.beginPath();
      ctx.arc(drawX, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.stroke;
      ctx.stroke();

      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.emoji, drawX, b.y);

      if (b.y < -40) {
        balloons.splice(i, 1);
        spawnBalloon();
      }
    }

    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = `rgba(200, 90, 135, ${p.alpha})`;
      ctx.fillText(p.text, p.x, p.y);
      p.y -= 1.2;
      p.alpha -= 0.03;
      if (p.alpha <= 0) pops.splice(i, 1);
    }

    document.getElementById('balloonTimerBadge').textContent = `⏱️ ${timeLeft} sn • Skor: ${score}`;
    if (timeLeft > 0) {
      balloonAnimId = requestAnimationFrame(loop);
    }
  }
  loop();
}

// --- OYUN 2: SNAPCHAT TARZI ÖPÜCÜK & BOBA YAKALAMA (SNAP LOVE RUSH) ---
let rushAnimId = null;
function startRushGame() {
  const canvas = document.getElementById('rushCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('rushOverlay');
  overlay.classList.add('hidden');
  if (rushAnimId) cancelAnimationFrame(rushAnimId);

  let playerX = canvas.width / 2;
  let score = 0;
  let lives = 3;
  let items = [];
  const myEmoji = myCharacter === 'bubu' ? '🐼' : '🐻';

  const moveHandler = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    playerX = Math.max(30, Math.min(canvas.width - 30, (e.clientX - rect.left) * scaleX));
  };
  canvas.onpointermove = moveHandler;
  canvas.onpointerdown = moveHandler;

  const drops = [
    { emoji: '💋', pts: 15, bad: false },
    { emoji: '🧋', pts: 20, bad: false },
    { emoji: '🍓', pts: 15, bad: false },
    { emoji: '💖', pts: 25, bad: false },
    { emoji: '⛈️', pts: -1, bad: true }
  ];

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (Math.random() < 0.055) {
      const spec = drops[Math.floor(Math.random() * drops.length)];
      items.push({
        x: 25 + Math.random() * (canvas.width - 50),
        y: -20,
        speed: 2.3 + Math.random() * 2,
        ...spec
      });
    }

    // Oyuncu Karakteri
    ctx.fillStyle = 'rgba(247, 198, 217, 0.55)';
    ctx.beginPath();
    ctx.arc(playerX, canvas.height - 34, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(myEmoji, playerX, canvas.height - 34);

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.speed;
      ctx.font = '24px sans-serif';
      ctx.fillText(it.emoji, it.x, it.y);

      const dist = Math.hypot(it.x - playerX, it.y - (canvas.height - 34));
      if (dist < 32) {
        if (it.bad) {
          lives--;
          playCuteSound('notif');
        } else {
          score += it.pts;
          playCuteSound('pop');
        }
        items.splice(i, 1);
        continue;
      }
      if (it.y > canvas.height + 25) {
        items.splice(i, 1);
      }
    }

    document.getElementById('rushScoreLiveBadge').textContent = `❤️x${lives} • Skor: ${score}`;

    if (lives <= 0) {
      overlay.classList.remove('hidden');
      overlay.querySelector('h3').textContent = `Oyun Bitti! Toplam Skorun: ${score} ⚡`;
      if (socket && socket.connected) {
        socket.emit('update_game_score', {
          roomCode: currentRoomCode,
          gameKey: 'loveRushScores',
          character: myCharacter,
          score
        });
      }
      return;
    }
    rushAnimId = requestAnimationFrame(loop);
  }
  loop();
}

// --- OYUN 3: BUBU VS DUDU CANLI XOX ---
function renderXoxBoard() {
  if (!roomState || !roomState.games || !roomState.games.xox) return;
  const xox = roomState.games.xox;
  const boardEl = document.getElementById('xoxBoard');
  if (!boardEl) return;

  document.getElementById('xoxScoreBubu').textContent = xox.scores?.bubu || 0;
  document.getElementById('xoxScoreDudu').textContent = xox.scores?.dudu || 0;

  const badge = document.getElementById('xoxTurnBadge');
  if (xox.winner === 'draw') {
    badge.textContent = '🤝 Berabere! İkiniz de Kazandınız';
  } else if (xox.winner) {
    badge.textContent = `🏆 Kazanan: ${xox.winner === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'}!`;
  } else {
    badge.textContent = `Sıra: ${xox.turn === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'}`;
  }

  boardEl.innerHTML = xox.board.map((cell, idx) => {
    const symbol = cell === 'bubu' ? '🐼' : (cell === 'dudu' ? '🐻' : '');
    return `<div class="xox-cell" onclick="makeXoxMove(${idx})">${symbol}</div>`;
  }).join('');
}

function makeXoxMove(index) {
  if (!roomState || !roomState.games?.xox) return;
  const xox = roomState.games.xox;
  if (xox.board[index] || xox.winner) return;
  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('xox_move', {
      roomCode: currentRoomCode,
      index,
      character: xox.turn || myCharacter
    });
  }
}

function playXoxBotMove() {
  if (!roomState || !roomState.games?.xox) return;
  const xox = roomState.games.xox;
  if (xox.winner) return;
  const emptyIndices = xox.board.map((v, i) => v === null ? i : null).filter((v) => v !== null);
  if (emptyIndices.length === 0) return;
  const pick = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  makeXoxMove(pick);
}

function resetXoxGame() {
  if (socket && socket.connected) {
    socket.emit('xox_move', {
      roomCode: currentRoomCode,
      reset: true,
      character: myCharacter
    });
  }
}

function changeXoxReward(reward) {
  if (socket && socket.connected) {
    socket.emit('xox_move', {
      roomCode: currentRoomCode,
      reward
    });
  }
}

// --- OYUN 4: HAFIZA KARTLARI & ÇİFT UYUM SORULARI ---
let memCards = [];
let memFlipped = [];
let memMatchedCount = 0;
let memMoves = 0;

function initMemoryMatchGame() {
  const symbols = ['🐼', '🐻', '💋', '🧋', '🍓', '💖'];
  const deck = [...symbols, ...symbols].sort(() => Math.random() - 0.5);
  memCards = deck.map((emoji, idx) => ({ id: idx, emoji, flipped: false, matched: false }));
  memFlipped = [];
  memMatchedCount = 0;
  memMoves = 0;
  renderMemoryGrid();
}

function renderMemoryGrid() {
  const grid = document.getElementById('memoryMatchGrid');
  if (!grid) return;
  grid.innerHTML = memCards.map((c, idx) => {
    const show = c.flipped || c.matched;
    return `
      <div class="mem-card-tile ${show ? 'flipped' : ''}" onclick="flipMemoryCard(${idx})">
        ${show ? c.emoji : '🌸'}
      </div>
    `;
  }).join('');
  document.getElementById('memoryMatchStatus').textContent = `Hamle: ${memMoves} • Eşleşen: ${memMatchedCount} / 6`;
}

function flipMemoryCard(idx) {
  const card = memCards[idx];
  if (!card || card.flipped || card.matched || memFlipped.length >= 2) return;
  card.flipped = true;
  memFlipped.push(card);
  playCuteSound('pop');
  renderMemoryGrid();

  if (memFlipped.length === 2) {
    memMoves++;
    const [a, b] = memFlipped;
    if (a.emoji === b.emoji) {
      a.matched = true;
      b.matched = true;
      memFlipped = [];
      memMatchedCount++;
      renderMemoryGrid();
      if (memMatchedCount === 6) {
        showIosBanner('🃏🎉', 'Tebrikler! Hafıza Oyununu Bitirdin!', `${memMoves} hamlede tüm Bubu & Dudu kartlarını eşleştirdin!`);
      }
    } else {
      setTimeout(() => {
        a.flipped = false;
        b.flipped = false;
        memFlipped = [];
        renderMemoryGrid();
      }, 650);
    }
  }
}

const COUPLE_QUIZ_QUESTIONS = [
  {
    id: 'q0',
    question: '1. Aramızda ilk kim trip atar veya tatlıca küser? 🥺',
    options: ['Bubu 🐼', 'Dudu 🐻', 'İkimiz de Aynı Anda 😂']
  },
  {
    id: 'q1',
    question: '2. İdeal baş başa akşam planımız hangisi? 🌙',
    options: ['Sarılıp Film İzlemek 🍿', 'Dışarıda Tatlı & Kahve 🧋', 'Gece Yürüyüşü & Sohbet 🌌']
  },
  {
    id: 'q2',
    question: '3. Kim daha çok öpücük ve sarılma bağımlısı? 💋',
    options: ['Kesinlikle Bubu 🐼', 'Kesinlikle Dudu 🐻', 'İkimiz de Doyamıyoruz 💖']
  }
];

function renderCoupleQuiz() {
  const container = document.getElementById('coupleQuizContainer');
  if (!container || !roomState) return;
  const answers = roomState.games?.quizAnswers || {};

  container.innerHTML = COUPLE_QUIZ_QUESTIONS.map((q) => {
    const qAns = answers[q.id] || {};
    const myAns = qAns[myCharacter];
    const isMatch = qAns.bubu && qAns.dudu && qAns.bubu === qAns.dudu;

    return `
      <div style="background:rgba(255,255,255,0.75); padding:12px; border-radius:16px; margin-bottom:10px; border:1px solid var(--lilac-soft);">
        <div style="font-size:13px; font-weight:800; margin-bottom:8px;">${q.question}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
          ${q.options.map((opt) => `
            <button
              class="${myAns === opt ? 'primary-btn' : 'secondary-btn'}"
              style="font-size:11.5px; padding:6px 12px;"
              onclick="submitQuizAnswer('${q.id}', '${opt}')"
            >${opt}</button>
          `).join('')}
        </div>
        <div style="font-size:11.5px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
          <span>🐼 Bubu: <strong>${qAns.bubu || 'Bekleniyor...'}</strong></span>
          <span>🐻 Dudu: <strong>${qAns.dudu || 'Bekleniyor...'}</strong></span>
          ${isMatch ? '<span class="pill-tag pink">💞 %100 Uyum!</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

function submitQuizAnswer(questionId, answer) {
  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('submit_quiz_answer', {
      roomCode: currentRoomCode,
      questionId,
      character: myCharacter,
      answer
    });
  }
}

// ============================================================================
// 3) NOT YAZMA PANOSU & CANLI MESAJLAŞMA
// ============================================================================
function switchCommSubtab(mode) {
  const isChat = mode === 'chat';
  document.getElementById('subBtnChat').classList.toggle('active', isChat);
  document.getElementById('subBtnBoard').classList.toggle('active', !isChat);
  document.getElementById('comm-chat').style.display = isChat ? 'block' : 'none';
  document.getElementById('comm-board').style.display = !isChat ? 'block' : 'none';
}

function createStickyNote() {
  const title = document.getElementById('noteTitleInput').value.trim();
  const content = document.getElementById('noteContentInput').value.trim();
  const color = document.getElementById('noteColorSelect').value;
  const mood = document.getElementById('noteMoodSelect').value;

  if (!content) {
    showIosBanner('✍️💌', 'Not Boş Olmasın Aşkım', 'Lütfen sevgiline göndermek istediğin notu yaz.');
    return;
  }

  if (socket && socket.connected) {
    socket.emit('add_note', {
      roomCode: currentRoomCode,
      note: {
        authorChar: myCharacter,
        authorName: getMyDisplayName(),
        title: title || 'Sevgilime Notum 💌',
        content,
        color,
        mood
      }
    });
  }

  document.getElementById('noteTitleInput').value = '';
  document.getElementById('noteContentInput').value = '';
  showIosBanner('📌💖', 'Aşk Notun Panoya Eklendi!', 'Sevgilinin ekranında da anında görüntülendi.');
}

function deleteStickyNote(noteId) {
  if (socket && socket.connected) {
    socket.emit('delete_note', { roomCode: currentRoomCode, noteId });
  }
}

function renderStickyNotes() {
  const grid = document.getElementById('stickyNotesGrid');
  if (!grid || !roomState) return;
  const notes = roomState.notes || [];
  document.getElementById('notesCountBadge').textContent = `${notes.length} Not`;

  const moodIcons = { kiss: '💋', hug: '🤗', heart: '💖', coffee: '🧋' };
  grid.innerHTML = notes.map((n) => `
    <div class="sticky-note-card note-${n.color || 'pink'}">
      <div>
        <div class="note-title">${moodIcons[n.mood] || '💌'} ${escapeHtml(n.title)}</div>
        <div class="note-body">${escapeHtml(n.content)}</div>
      </div>
      <div class="note-footer">
        <span>${n.authorChar === 'bubu' ? '🐼' : '🐻'} ${escapeHtml(n.authorName)}</span>
        <button class="delete-mini-btn" onclick="deleteStickyNote('${n.id}')" title="Notu Sil">🗑️</button>
      </div>
    </div>
  `).join('');
}

// --- CANLI MESAJLAŞMA ---
let typingTimer = null;
function notifyTyping() {
  if (!socket || !socket.connected) return;
  socket.emit('typing', {
    roomCode: currentRoomCode,
    character: myCharacter,
    userName: getMyDisplayName(),
    isTyping: true
  });
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('typing', {
      roomCode: currentRoomCode,
      character: myCharacter,
      userName: getMyDisplayName(),
      isTyping: false
    });
  }, 1400);
}

function sendChatMessage() {
  const input = document.getElementById('chatTextInput');
  const text = input.value.trim();
  if (!text) return;

  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('send_message', {
      roomCode: currentRoomCode,
      message: {
        senderChar: myCharacter,
        senderName: getMyDisplayName(),
        text
      }
    });
  }
  input.value = '';
}

function sendQuickSticker(stickerKey, textLabel) {
  playCuteSound('kiss');
  if (socket && socket.connected) {
    socket.emit('send_message', {
      roomCode: currentRoomCode,
      message: {
        senderChar: myCharacter,
        senderName: getMyDisplayName(),
        text: textLabel,
        sticker: stickerKey
      }
    });
  }
}

function sendChatPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  compressImageFile(file, 750, 0.82, (base64) => {
    if (socket && socket.connected) {
      socket.emit('send_message', {
        roomCode: currentRoomCode,
        message: {
          senderChar: myCharacter,
          senderName: getMyDisplayName(),
          text: '📸 Bir fotoğraf gönderdi',
          image: base64
        }
      });
    }
  });
}

function reactToChatMessage(messageId, emoji) {
  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('react_message', {
      roomCode: currentRoomCode,
      messageId,
      emoji
    });
  }
}

function renderChatMessages() {
  const list = document.getElementById('chatMessagesList');
  if (!list || !roomState) return;
  const msgs = roomState.messages || [];

  list.innerHTML = msgs.map((m) => {
    const isMine = m.senderChar === myCharacter;
    const avatar = m.senderChar === 'bubu' ? '🐼' : '🐻';
    const reactionsHtml = (m.reactions || []).map((r) => `<span class="reaction-chip">${r}</span>`).join('');
    return `
      <div class="chat-bubble-row ${isMine ? 'mine' : 'theirs'}">
        <div class="chat-sender-label">${avatar} ${escapeHtml(m.senderName)} • ${formatTimeShort(m.timestamp)}</div>
        <div class="chat-bubble" onclick="reactToChatMessage('${m.id}', '❤️')">
          ${m.image ? `<img src="${m.image}" class="chat-photo" alt="Sohbet Fotoğrafı" />` : ''}
          <div>${escapeHtml(m.text)}</div>
        </div>
        <div class="chat-reactions-bar">
          ${reactionsHtml}
          <span class="reaction-chip" onclick="reactToChatMessage('${m.id}', '💋')">+💋</span>
          <span class="reaction-chip" onclick="reactToChatMessage('${m.id}', '❤️')">+❤️</span>
        </div>
      </div>
    `;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

// ============================================================================
// 4) ORTAK TAKVİM, MANUEL GÖRSELLİ ANI EKLEME & ETKİNLİK HATIRLATICISI
// ============================================================================
const MONTH_NAMES_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

function changeCalendarMonth(delta) {
  currentCalMonth += delta;
  if (currentCalMonth > 11) {
    currentCalMonth = 0;
    currentCalYear++;
  } else if (currentCalMonth < 0) {
    currentCalMonth = 11;
    currentCalYear--;
  }
  renderCalendarAndEvents();
}

function selectCalendarDate(dateStr) {
  selectedCalDate = dateStr;
  document.getElementById('selectedDateLabel').textContent = `Seçili: ${dateStr}`;
  renderCalendarAndEvents();
}

function renderCalendarAndEvents() {
  if (!roomState) return;
  document.getElementById('calendarMonthTitle').textContent = `${MONTH_NAMES_TR[currentCalMonth]} ${currentCalYear}`;

  const firstDay = new Date(currentCalYear, currentCalMonth, 1);
  const lastDay = new Date(currentCalYear, currentCalMonth + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7; // Pazartesi = 0
  const totalDays = lastDay.getDate();

  const memories = roomState.memories || [];
  const events = roomState.events || [];
  const todayStr = formatDateISO(new Date());

  let html = '';
  for (let i = 0; i < startOffset; i++) {
    html += `<div></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${currentCalYear}-${String(currentCalMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hasMem = memories.some((m) => m.date === dateStr);
    const hasEvt = events.some((e) => e.date === dateStr);
    const isToday = dateStr === todayStr;
    const isSel = dateStr === selectedCalDate;

    html += `
      <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" onclick="selectCalendarDate('${dateStr}')">
        <span>${d}</span>
        <div class="cal-dots">
          ${hasMem ? '<span class="cal-dot memory-dot"></span>' : ''}
          ${hasEvt ? '<span class="cal-dot event-dot"></span>' : ''}
        </div>
      </div>
    `;
  }
  document.getElementById('calendarDaysGrid').innerHTML = html;

  renderUpcomingEventsAndReminders(events);
  renderMemoriesAlbum(memories);
}

function renderUpcomingEventsAndReminders(events) {
  const container = document.getElementById('eventsListContainer');
  const reminderBarText = document.getElementById('upcomingReminderText');
  const reminderBarBadge = document.getElementById('upcomingReminderBadge');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let nearestEvent = null;
  let nearestDaysDiff = 9999;

  if (events.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:10px;">Henüz planlanmış etkinlik yok. "+ Yeni Plan" ile ilk buluşmanızı ekleyin!</div>`;
  } else {
    container.innerHTML = events.map((ev) => {
      const evDate = new Date(ev.date + 'T00:00:00');
      const diffDays = Math.round((evDate.getTime() - today.getTime()) / 86400000);

      if (!ev.completed && diffDays >= 0 && diffDays < nearestDaysDiff) {
        nearestDaysDiff = diffDays;
        nearestEvent = ev;
      }

      let countdownText = '';
      if (diffDays === 0) countdownText = '🔔 BUGÜN!';
      else if (diffDays === 1) countdownText = '⏳ Yarın (1 Gün Kaldı)';
      else if (diffDays > 1) countdownText = `⏳ ${diffDays} Gün Kaldı`;
      else countdownText = '✅ Geçmiş Tarih';

      return `
        <div class="feed-item" style="border-color:var(--khaki-soft);">
          <div class="feed-icon" style="background:var(--khaki-light); cursor:pointer;" onclick="toggleEventDone('${ev.id}')">
            ${ev.completed ? '✅' : '📅'}
          </div>
          <div class="feed-info">
            <div class="feed-title" style="${ev.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">
              ${escapeHtml(ev.title)}
            </div>
            <div class="feed-desc">
              🗓️ ${ev.date} • ⏰ ${ev.time || '20:00'} • <strong>${countdownText}</strong>
            </div>
            ${ev.description ? `<div class="feed-desc">${escapeHtml(ev.description)}</div>` : ''}
          </div>
          <button class="delete-mini-btn" onclick="deleteEventItem('${ev.id}')">🗑️</button>
        </div>
      `;
    }).join('');
  }

  // Üst Hatırlatma Şeridi Güncelleme
  if (nearestEvent) {
    const dayLabel = nearestDaysDiff === 0 ? 'BUGÜN!' : `${nearestDaysDiff} Gün Kaldı`;
    reminderBarText.textContent = `🔔 Yaklaşan Plan: ${nearestEvent.title} (${nearestEvent.date} • ${nearestEvent.time})`;
    reminderBarBadge.textContent = dayLabel;
  } else {
    reminderBarText.textContent = `📅 Ortak Takvim: Yeni buluşma veya yıldönümü planlamak için dokun!`;
    reminderBarBadge.textContent = 'Takvim';
  }
}

function renderMemoriesAlbum(memories) {
  const container = document.getElementById('memoriesListContainer');
  if (!container) return;

  if (memories.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">Henüz anı fotoğrafı eklenmedi. "+ Fotoğraf Ekle" ile ilk anınızı yükleyin! 📸</div>`;
    return;
  }

  container.innerHTML = memories.map((m) => {
    const mediaHtml = m.image
      ? `<img src="${m.image}" alt="${escapeHtml(m.title)}" />`
      : `<div style="text-align:center; padding:20px;">
           <div style="font-size:54px;">🐼💕🐻</div>
           <div style="font-size:12px; font-weight:700; color:var(--lilac-deep); margin-top:4px;">Bubu & Dudu Özel Anısı</div>
         </div>`;

    return `
      <div class="polaroid-card">
        <div class="polaroid-img-wrap">
          ${mediaHtml}
          <span class="polaroid-date-badge">🗓️ ${m.date}</span>
          <span class="polaroid-mood-badge">${escapeHtml(m.mood || '🥰 Mutlu')}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <h4 style="font-size:14.5px; font-weight:800; margin-bottom:4px;">${escapeHtml(m.title)}</h4>
            <p style="font-size:12.5px; color:var(--text-muted); line-height:1.4; margin-bottom:6px;">
              ${escapeHtml(m.description || '')}
            </p>
            <div style="font-size:11px; font-weight:700; color:var(--khaki-deep);">
              ${m.authorChar === 'bubu' ? '🐼' : '🐻'} ${escapeHtml(m.authorName)} ${m.location ? `• 📍 ${escapeHtml(m.location)}` : ''}
            </div>
          </div>
          <button class="delete-mini-btn" onclick="deleteMemoryItem('${m.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openMemoryModal() {
  document.getElementById('memDateInput').value = selectedCalDate || formatDateISO(new Date());
  document.getElementById('memTitleInput').value = '';
  document.getElementById('memDescInput').value = '';
  document.getElementById('memLocationInput').value = '';
  document.getElementById('memPhotoPreview').style.display = 'none';
  pendingMemoryImageBase64 = null;
  document.getElementById('memoryModal').classList.add('open');
}

function previewMemoryPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  compressImageFile(file, 900, 0.84, (base64) => {
    pendingMemoryImageBase64 = base64;
    const prev = document.getElementById('memPhotoPreview');
    prev.src = base64;
    prev.style.display = 'block';
  });
}

function saveNewMemory() {
  const date = document.getElementById('memDateInput').value || formatDateISO(new Date());
  const title = document.getElementById('memTitleInput').value.trim() || 'Güzel Bir Anımız 💕';
  const mood = document.getElementById('memMoodInput').value;
  const location = document.getElementById('memLocationInput').value.trim();
  const description = document.getElementById('memDescInput').value.trim();

  const memory = {
    date,
    title,
    mood,
    location,
    description,
    authorChar: myCharacter,
    authorName: getMyDisplayName(),
    image: pendingMemoryImageBase64
  };

  if (socket && socket.connected) {
    socket.emit('add_memory', { roomCode: currentRoomCode, memory });
  } else {
    fetch(`/api/room/${currentRoomCode}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory)
    });
  }

  closeModal('memoryModal');
  showIosBanner('📸💖', 'Anı Takvime Kaydedildi!', `${title} görseliyle birlikte ortak albüme eklendi.`);
}

function deleteMemoryItem(memoryId) {
  if (socket && socket.connected) {
    socket.emit('delete_memory', { roomCode: currentRoomCode, memoryId });
  }
}

function openEventModal() {
  document.getElementById('evtDateInput').value = selectedCalDate || formatDateISO(new Date());
  document.getElementById('evtTitleInput').value = '';
  document.getElementById('evtDescInput').value = '';
  document.getElementById('eventModal').classList.add('open');
}

function saveNewEvent() {
  const date = document.getElementById('evtDateInput').value || formatDateISO(new Date());
  const time = document.getElementById('evtTimeInput').value || '19:30';
  const title = document.getElementById('evtTitleInput').value.trim();
  const category = document.getElementById('evtCategoryInput').value;
  const remindBeforeDays = Number(document.getElementById('evtRemindInput').value);
  const description = document.getElementById('evtDescInput').value.trim();

  if (!title) {
    showIosBanner('📅⚠️', 'Etkinlik Başlığı Girin', 'Lütfen planladığınız etkinliğin adını yazın.');
    return;
  }

  if (socket && socket.connected) {
    socket.emit('add_event', {
      roomCode: currentRoomCode,
      event: {
        date,
        time,
        title,
        category,
        remindBeforeDays,
        description,
        authorChar: myCharacter,
        authorName: getMyDisplayName()
      }
    });
  }

  closeModal('eventModal');
}

function toggleEventDone(eventId) {
  if (socket && socket.connected) {
    socket.emit('toggle_event', { roomCode: currentRoomCode, eventId });
  }
}

function deleteEventItem(eventId) {
  if (socket && socket.connected) {
    socket.emit('delete_event', { roomCode: currentRoomCode, eventId });
  }
}

// ============================================================================
// 5) AYARLAR, TEMA (PEMBE-LİLA-HAKİ) & IPHONE QR KODU
// ============================================================================
function applyThemeSelection(themeVal) {
  document.body.classList.remove('theme-lilac-khaki', 'theme-romantic-pink');
  if (themeVal === 'lilac-khaki') document.body.classList.add('theme-lilac-khaki');
  if (themeVal === 'romantic-pink') document.body.classList.add('theme-romantic-pink');
}

function saveCoupleSettings() {
  const bubuName = document.getElementById('inputBubuName').value.trim() || 'Bubu';
  const duduName = document.getElementById('inputDuduName').value.trim() || 'Dudu';
  const newRoomCode = (document.getElementById('inputRoomCode').value.trim() || 'BUDU-2026').toUpperCase();
  const startDate = document.getElementById('inputStartDate').value;
  const theme = document.getElementById('selectColorTheme').value;

  currentRoomCode = newRoomCode;
  localStorage.setItem('budu_roomCode', currentRoomCode);

  if (socket && socket.connected) {
    socket.emit('join_room', {
      roomCode: currentRoomCode,
      character: myCharacter,
      userName: myCharacter === 'bubu' ? bubuName : duduName
    });
    socket.emit('update_couple_info', {
      roomCode: currentRoomCode,
      coupleInfo: { bubuName, duduName, startDate, theme }
    });
  }
  showIosBanner('💾💕', 'Çift Ayarları Kaydedildi!', `Oda: ${currentRoomCode} • ${bubuName} & ${duduName}`);
}

function refreshQrModalInfo() {
  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      const img = document.getElementById('qrCodeImg');
      const urlEl = document.getElementById('qrUrlDisplay');
      if (img) img.src = info.qrDataUrl;
      if (urlEl) urlEl.textContent = info.primaryUrl;
      if (!info.publicTunnelUrl) {
        setTimeout(refreshQrModalInfo, 2000);
      }
    })
    .catch(() => {});
}

function openQrModal() {
  document.getElementById('qrModal').classList.add('open');
  refreshQrModalInfo();
}

function openStoryModal() {
  document.getElementById('storyModal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.ios-tabbar .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === tabId);
  });
}

// Fotoğraf sıkıştırma yardımcısı (iPhone yüksek çözünürlüklü fotoğraflarını hızlı senkronize etmek için)
function compressImageFile(file, maxWidth, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
