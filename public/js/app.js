/* ============================================================================
   BuDuLove • Bubu & Dudu Ortak Sevgili Mobil Uygulaması (v4 - Kalıcı DB & Web Push)
   ============================================================================ */

const urlParams = new URLSearchParams(window.location.search);
const forcedRole = urlParams.get('role');
const storagePrefix = forcedRole ? `budu_${forcedRole}_` : 'budu_';

let myCharacter = forcedRole || localStorage.getItem(storagePrefix + 'myChar') || 'bubu';
let currentRoomCode = (localStorage.getItem('budu_roomCode') || 'BUDU-2026').toUpperCase();

let roomState = null;
let socket = null;
let bcChannel = null;
let swRegistration = null;

// Takvim Durumu
let calNow = new Date();
let currentCalYear = calNow.getFullYear();
let currentCalMonth = calNow.getMonth();
let selectedCalDate = formatDateISO(calNow);
let pendingMemoryImageBase64 = null;

// Müzik Çalar Durumu
let currentSongIndex = 0;
let isAudioPlaying = false;

// Dart Oyunu Durumu
let dartSettingHeadMode = false;
let dartImageElement = null;
let dartImageSrcLoaded = null;

// Renk Temaları Listesi (Vişne Çürüğü Başta Olmak Üzere)
const COLOR_THEMES = [
  'visne-curugu',
  'visne-haki',
  'pink-lilac-khaki',
  'gece-visne',
  'karamel-visne',
  'okyanus-pembe'
];

// Ses Sentezleyici
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
    if (type === 'punch') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.18);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);
      osc.frequency.setValueAtTime(1046.5, now + 0.3);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.start(now);
      osc.stop(now + 0.48);
    } else if (type === 'kiss' || type === 'notif') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.14);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
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
    navigator.vibrate(type === 'punch' ? [80, 40, 90] : (type === 'notif' ? [35, 50, 45] : 18));
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
// KALICI YEREL VERİTABANI YEDEĞİ (Girip çıkınca hiçbir şey silinmesin!)
// ============================================================================
function getBackupKey() {
  return 'budulove_db_v4_' + currentRoomCode;
}

function saveLocalBackup(state) {
  if (!state) return;
  try {
    localStorage.setItem(getBackupKey(), JSON.stringify(state));
  } catch (e) {}
}

function loadLocalBackup() {
  try {
    const raw = localStorage.getItem(getBackupKey());
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

// ============================================================================
// BAŞLANGIÇ & BAĞLANTI
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  // Kayıtlı temayı hemen uygula (Varsayılan: Vişne Çürüğü)
  const savedTheme = localStorage.getItem('budu_theme') || 'visne-curugu';
  applyThemeSelection(savedTheme, false);

  // Önce yerel veritabanı yedeğini yükle
  const cached = loadLocalBackup();
  if (cached) {
    roomState = cached;
    renderAllFromState();
  }

  initServiceWorkerAndPush();
  initBroadcastChannel();
  initSocketConnection();
  initDirectStageTouch();
  initAudioPlayerListeners();
  initDartIdleBoard();
  updateCharacterRoleUI();
  updateTogetherDaysCounter();

  // Her dakika gün sayacını kontrol et (Gece yarısı geçince otomatik +1 gün artsın)
  setInterval(updateTogetherDaysCounter, 60000);

  if (!forcedRole && !localStorage.getItem(storagePrefix + 'charChosenOnce')) {
    openCharSelectModal();
  }
});

// ============================================================================
// 1) GERÇEK ARKA PLAN / UYGULAMA KAPALIYKEN BİLDİRİM SİSTEMİ (WEB PUSH)
// ============================================================================
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function initServiceWorkerAndPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribeDeviceToWebPush(false);
    }
  } catch (e) {}
}

async function subscribeDeviceToWebPush(sendTest = false) {
  try {
    if (!swRegistration) {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
    }
    const res = await fetch('/api/vapid-public-key');
    const { publicKey } = await res.json();

    let sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await fetch(`/api/room/${currentRoomCode}/push-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        character: myCharacter,
        userName: getMyDisplayName()
      })
    });

    const badge = document.getElementById('pushStatusBadge');
    if (badge) badge.textContent = '✅ Arka Plan Bildirimi Açık';

    if (sendTest) {
      await fetch(`/api/room/${currentRoomCode}/push-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: myCharacter,
          userName: getMyDisplayName()
        })
      });
    }
  } catch (err) {
    console.warn('Web Push abonelik uyarısı:', err);
  }
}

function enableBackgroundPushNotifications() {
  if (!('Notification' in window)) {
    showIosBanner('📱🔔', 'iPhone Ana Ekran Kurulumu Gerekli', 'Uygulama kapalıyken bildirim almak için Safari\'de Paylaş -> Ana Ekrana Ekle yapıp oradan açın!');
    return;
  }
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') {
      subscribeDeviceToWebPush(true);
      showIosBanner('🔔💖', 'Arka Plan Bildirimleri Aktif!', 'Artık uygulama kapalıyken bile sevgilinin her dokunuşu, planı ve mesajı telefonuna bildirim olarak düşecek!');
    } else {
      showIosBanner('🔔⚠️', 'Bildirim İzni Verilmedi', 'Telefon ayarlarından BuDuLove için bildirimlere izin verin.');
    }
  });
}

function initBroadcastChannel() {
  if ('BroadcastChannel' in window) {
    bcChannel = new BroadcastChannel('budulove_live_channel');
    bcChannel.onmessage = (ev) => {
      const data = ev.data;
      if (!data) return;
      if (data.type === 'affection' && data.entry.fromChar !== myCharacter) {
        showIosBanner(
          data.entry.type === 'punch' ? '👊💥' : (data.entry.fromChar === 'bubu' ? '🐼💋' : '🐻🤗'),
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
      const clientBackup = loadLocalBackup();
      socket.emit('join_room', {
        roomCode: currentRoomCode,
        character: myCharacter,
        userName: getMyDisplayName(),
        clientBackup
      });
    });

    socket.on('room_state', (room) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderAllFromState();
    });

    socket.on('tunnel_ready', () => {
      refreshQrModalInfo();
    });

    // Uygulamaya ne eklenirse eklensin karşı tarafa canlı bildirim göster
    socket.on('activity_notification', (notif) => {
      if (notif.fromChar && notif.fromChar !== myCharacter) {
        showIosBanner('🔔💕', notif.title, notif.body);
      }
    });

    // Oyun Kazanan Büyük Tebrik Kartı
    socket.on('game_winner_card', (data) => {
      showWinnerCelebrationCard(data);
    });

    socket.on('affection_received', ({ entry, room }) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderAllFromState();
      animateStageCharacters(entry.type, entry.message);

      if (entry.fromChar !== myCharacter) {
        showIosBanner(
          entry.type === 'punch' ? '👊💥' : (entry.fromChar === 'bubu' ? '🐼💕' : '🐻💕'),
          `${entry.fromName} • ${entry.title}`,
          entry.message
        );
      } else {
        showIosBanner(
          entry.type === 'punch' ? '👊💥' : '✨💌',
          entry.type === 'punch' ? 'Yumruk Gönderildi! (-%8 Enerji)' : 'Sevgiline Bildirim Gönderildi!',
          `${entry.title} sevgilinin telefonuna iletildi.`
        );
      }
    });

    socket.on('partner_live_touch', (data) => {
      spawnStageParticles(data.emoji || '💕', 4);
      const speech = document.getElementById('stageSpeech');
      if (speech) {
        speech.textContent = `${data.fromName || 'Aşkın'} şu an dokunuyor ve seni seviyor! 🥰`;
      }
    });

    socket.on('note_added', ({ note, room }) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderAllFromState();
    });

    socket.on('message_received', ({ message, room }) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderChatMessages();
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
      saveLocalBackup(roomState);
      renderAllFromState();
    });

    socket.on('event_added', ({ event, room }) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderAllFromState();
    });

    socket.on('song_added', ({ song, room }) => {
      roomState = room;
      saveLocalBackup(roomState);
      renderAllFromState();
    });

    socket.on('partner_playing_song', ({ song, fromName }) => {
      showIosBanner('🎧🎵', `${fromName || 'Aşkın'} Bizim Şarkımızı Açtı!`, `${song.title} - ${song.artist}`);
    });
  } catch (e) {
    fetch(`/api/room/${currentRoomCode}`)
      .then((r) => r.json())
      .then((room) => {
        roomState = room;
        saveLocalBackup(roomState);
        renderAllFromState();
      });
  }
}

// ============================================================================
// İOS BİLDİRİM BANNERI & SİSTEM BİLDİRİMİ
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
  }, 4500);

  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, {
        body: text,
        icon: '/apple-touch-icon.png',
        badge: '/apple-touch-icon.png'
      }).catch(() => {});
    }
  }
}

function hideIosBanner() {
  document.getElementById('iosNotificationBanner').classList.remove('show');
}

// ============================================================================
// 8) İLİŞKİ BAŞLANGIÇ TARİHİ (22 EYLÜL 2025) & HER GÜN ARTAN GÜN SAYACI
// ============================================================================
function updateTogetherDaysCounter() {
  const startDateStr = (roomState && roomState.coupleInfo && roomState.coupleInfo.startDate) || '2025-09-22';
  const parts = startDateStr.split('-').map(Number);
  const startYear = parts[0] || 2025;
  const startMonth = (parts[1] || 9) - 1;
  const startDay = parts[2] || 22;

  const now = new Date();
  const startMidnight = new Date(startYear, startMonth, startDay, 0, 0, 0, 0).getTime();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();

  const diffDays = Math.max(1, Math.round((todayMidnight - startMidnight) / 86400000));
  const el = document.getElementById('togetherDaysCount');
  if (el) {
    el.textContent = `${diffDays} Gündür Birlikteyiz 💞`;
  }
}

// ============================================================================
// KARAKTER SEÇİMİ (TEK KARAKTER GÖRÜNÜMÜ)
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
  subscribeDeviceToWebPush(false);

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

  const stageBubu = document.getElementById('stageCharBubu');
  const stageDudu = document.getElementById('stageCharDudu');
  if (stageBubu && stageDudu) {
    stageBubu.style.display = isBubu ? 'flex' : 'none';
    stageDudu.style.display = !isBubu ? 'flex' : 'none';
  }

  const stageSpeech = document.getElementById('stageSpeech');
  if (stageSpeech) {
    stageSpeech.textContent = isBubu
      ? '🐼 Bubu\'ya dokun veya sevgiline (Dudu\'ya) bildirim gönder!'
      : '🐻 Dudu\'ya dokun veya sevgiline (Bubu\'ya) bildirim gönder!';
  }

  const btnBubu = document.getElementById('btnSelectBubu');
  const btnDudu = document.getElementById('btnSelectDudu');
  if (btnBubu && btnDudu) {
    btnBubu.className = isBubu ? 'primary-btn' : 'secondary-btn';
    btnDudu.className = !isBubu ? 'primary-btn' : 'secondary-btn';
  }
}

// ============================================================================
// SEVGİ GÖSTERME + YUMRUK ATMA (YUMRUK SEVGİ ENERJİSİNİ DÜŞÜRÜR!)
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
  },
  punch: {
    emoji: '👊💥',
    title: 'Yumruk Attı! (-%8 Sevgi Enerjisi) 👊💥',
    getMsg: (from, to) => `${from}, ${to}'ya tatlı-sert bir yumruk attı! Günlük Bubu & Dudu sevgi enerjimiz %8 düştü! 👊💢`,
    anim: 'anim-punch'
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

  playCuteSound(type === 'punch' ? 'punch' : 'kiss');
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

  if (socket && socket.connected) {
    socket.emit('live_touch', {
      roomCode: currentRoomCode,
      fromChar: myCharacter,
      fromName: getMyDisplayName(),
      targetChar,
      emoji: pick
    });
  }
  triggerAffection('kiss');
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
  wrapper.classList.remove('anim-kiss', 'anim-hug', 'anim-bounce', 'anim-punch');
  void wrapper.offsetWidth;
  wrapper.classList.add(spec.anim);
  spawnStageParticles(spec.emoji, 8);

  setTimeout(() => {
    wrapper.classList.remove('anim-kiss', 'anim-hug', 'anim-bounce', 'anim-punch');
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
// TÜM VERİLERİ EKRANA YANSITMA
// ============================================================================
function renderAllFromState() {
  if (!roomState) return;
  updateCharacterRoleUI();

  const info = roomState.coupleInfo || {};
  document.getElementById('roomCodeBadge').textContent = `Oda: ${roomState.roomCode || currentRoomCode}`;
  document.getElementById('inputBubuName').value = info.bubuName || 'Bubu';
  document.getElementById('inputDuduName').value = info.duduName || 'Dudu';
  document.getElementById('inputRoomCode').value = roomState.roomCode || currentRoomCode;

  const startDate = info.startDate || '2025-09-22';
  document.getElementById('inputStartDate').value = startDate;
  updateTogetherDaysCounter();

  if (info.theme) {
    applyThemeSelection(info.theme, false);
    const themeSel = document.getElementById('selectColorTheme');
    if (themeSel) themeSel.value = info.theme;
  }

  const meter = Math.min(100, Math.max(0, info.loveMeter ?? 100));
  document.getElementById('loveMeterValue').textContent = `%${meter} Dolu`;
  document.getElementById('loveMeterFill').style.width = `${meter}%`;
  document.getElementById('totalInteractionsBadge').textContent = `${info.totalInteractions || 0} Dokunuş`;

  renderAffectionFeed();
  renderStickyNotes();
  renderChatMessages();
  renderCalendarAndEvents();
  renderGamesState();
  renderSavedSongsList();
}

function renderAffectionFeed() {
  const list = document.getElementById('affectionFeedList');
  if (!list || !roomState) return;
  const items = roomState.affectionHistory || [];
  if (items.length === 0) {
    list.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">Henüz sevgi veya yumruk bildirimi yok. İlk hareketi yukarıdan sen gönder! 💋👊</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 15).map((item) => {
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
// 2) OYUN KAZANAN BÜYÜK TEBRİK KARTI ("TEBRİKLER BUBU / DUDU KAZANDI!")
// ============================================================================
function showWinnerCelebrationCard({ gameTitle, winnerChar, winnerName, subtitle, reward }) {
  playCuteSound('win');
  const modal = document.getElementById('winnerCelebrationModal');
  const emojiEl = document.getElementById('winnerEmojiHero');
  const gameEl = document.getElementById('winnerGameLabel');
  const headEl = document.getElementById('winnerMainHeading');
  const subEl = document.getElementById('winnerSubText');
  const rewEl = document.getElementById('winnerRewardText');

  if (winnerChar === 'draw') {
    emojiEl.textContent = '🤝🐼💕🐻';
    headEl.textContent = '🎉 BERABERE! İKİNİZ DE KAZANDINIZ!';
  } else {
    const charIcon = winnerChar === 'bubu' ? '🐼' : '🐻';
    const displayWinner = winnerName || (winnerChar === 'bubu' ? 'Bubu' : 'Dudu');
    emojiEl.textContent = `🏆${charIcon}🎉`;
    headEl.textContent = `🎉 TEBRİKLER! ${displayWinner.toUpperCase()} KAZANDI!`;
  }

  gameEl.textContent = gameTitle || 'Çift Oyunu';
  subEl.textContent = subtitle || 'Muhteşem bir zafer!';
  rewEl.textContent = reward || '100 Öpücük & Kahve Ismarlama 🧋';

  modal.classList.add('open');
}

// ============================================================================
// OYUNLAR SEKMESİ (5 OYUN)
// ============================================================================
function selectGame(gameId, btnEl) {
  document.querySelectorAll('.game-selector-btn').forEach((b) => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  document.querySelectorAll('.game-panel').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById('game-' + gameId);
  if (target) target.classList.add('active');
  if (gameId === 'dart') {
    initDartIdleBoard();
  }
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
  if (g.dartScores) {
    document.getElementById('dartScoreBubu').textContent = g.dartScores.bubu || 0;
    document.getElementById('dartScoreDudu').textContent = g.dartScores.dudu || 0;
  }

  renderXoxBoard();
  renderMultiplayerMemoryGrid();
  renderCoupleQuiz();
  loadDartTargetFromState();
}

// --- OYUN 1: BALON PATLATMA ---
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
    { fill: '#8E213B', stroke: '#5B1022', emoji: '🍒', pts: 15 },
    { fill: '#F7C6D9', stroke: '#C85A87', emoji: '💖', pts: 10 },
    { fill: '#C7D6BF', stroke: '#5C7350', emoji: '🌿', pts: 15 },
    { fill: '#FFE082', stroke: '#F57F17', emoji: '🐼🐻', pts: 30 },
    { fill: '#3A2846', stroke: '#1E1426', emoji: '⛈️', pts: -15 }
  ];

  function spawnBalloon() {
    const typeIdx = Math.random() < 0.14 ? 4 : (Math.random() < 0.2 ? 3 : Math.floor(Math.random() * 3));
    const p = palette[typeIdx];
    balloons.push({
      x: 35 + Math.random() * (canvas.width - 70),
      y: canvas.height + 35,
      r: typeIdx === 3 ? 28 : 24,
      speed: 1.3 + Math.random() * 1.5,
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
      if (dist <= b.r + 12) {
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
          gameTitle: 'Kalp Balon Patlatma 🎈',
          character: myCharacter,
          playerName: getMyDisplayName(),
          score
        });
      }
    }
  }, 1000);

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (Math.random() < 0.045 && balloons.length < 8) spawnBalloon();

    for (let i = balloons.length - 1; i >= 0; i--) {
      const b = balloons[i];
      b.y -= b.speed;
      b.wobble += 0.035;
      const drawX = b.x + Math.sin(b.wobble) * 7;

      ctx.beginPath();
      ctx.moveTo(drawX, b.y + b.r);
      ctx.lineTo(drawX, b.y + b.r + 18);
      ctx.strokeStyle = 'rgba(118,104,130,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

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
      ctx.fillStyle = `rgba(142, 33, 59, ${p.alpha})`;
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

// --- OYUN 2: SNAP ÖPÜCÜK (YAVAŞLATILMIŞ EMOJİ HIZI) ---
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

    // Yukarıdan gelen emojilerin sıklığı ve hızı rahat oynanacak şekilde yavaşlatıldı!
    if (Math.random() < 0.025 && items.length < 5) {
      const spec = drops[Math.floor(Math.random() * drops.length)];
      items.push({
        x: 28 + Math.random() * (canvas.width - 56),
        y: -20,
        speed: 0.85 + Math.random() * 0.65, // Çok daha yumuşak ve yavaş iniş hızı
        ...spec
      });
    }

    ctx.fillStyle = 'rgba(229, 179, 192, 0.55)';
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
          playCuteSound('punch');
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
          gameTitle: 'Snap Öpücük Oyunu ⚡',
          character: myCharacter,
          playerName: getMyDisplayName(),
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
    badge.textContent = '🤝 Berabere!';
  } else if (xox.winner) {
    badge.textContent = `🏆 Kazanan: ${xox.winner === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'}`;
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

// --- OYUN 4A: KARŞILIKLI CANLI HAFIZA KARTLARI (XOX GİBİ İKİ TELEFONDAN SIRAYLA) ---
function renderMultiplayerMemoryGrid() {
  const grid = document.getElementById('memoryMatchGrid');
  if (!grid || !roomState || !roomState.games || !roomState.games.memoryMatch) return;

  const mem = roomState.games.memoryMatch;
  const cards = mem.cards || [];
  const bScore = mem.scores?.bubu || 0;
  const dScore = mem.scores?.dudu || 0;

  document.getElementById('memScoreBubu').textContent = bScore;
  document.getElementById('memScoreDudu').textContent = dScore;

  const turnBadge = document.getElementById('memoryTurnBadge');
  if (mem.winner) {
    turnBadge.textContent = mem.winner === 'draw'
      ? '🤝 Berabere!'
      : `🏆 Kazanan: ${mem.winner === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'}`;
  } else {
    turnBadge.textContent = `Sıra: ${mem.turn === 'bubu' ? '🐼 Bubu' : '🐻 Dudu'}`;
  }

  const matchedPairs = cards.filter((c) => c.matched).length / 2;
  document.getElementById('memoryMatchStatus').textContent = `Toplam Eşleşen: ${matchedPairs} / 6`;

  grid.innerHTML = cards.map((c, idx) => {
    const show = c.flipped || c.matched;
    return `
      <div class="mem-card-tile ${show ? 'flipped' : ''}" onclick="flipMultiplayerMemoryCard(${idx})">
        ${show ? c.emoji : '🍒'}
      </div>
    `;
  }).join('');
}

function flipMultiplayerMemoryCard(idx) {
  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('memory_game_action', {
      roomCode: currentRoomCode,
      action: 'flip',
      index: idx,
      character: myCharacter
    });
  }
}

function resetMultiplayerMemoryGame() {
  playCuteSound('pop');
  if (socket && socket.connected) {
    socket.emit('memory_game_action', {
      roomCode: currentRoomCode,
      action: 'reset',
      character: myCharacter
    });
  }
}

// --- OYUN 4B: SNAPCHAT ÇİFT UYUM KARTLARI (CEVAPLAR GİZLİ + UYUM SONUÇ KARTI) ---
function renderCoupleQuiz() {
  const container = document.getElementById('coupleQuizContainer');
  if (!container || !roomState) return;
  const questions = roomState.games?.quizQuestions || [];
  const answers = roomState.games?.quizAnswers || {};

  container.innerHTML = questions.map((q) => {
    const qAns = answers[q.id] || {};
    const myAns = qAns[myCharacter];
    const bubuAnswered = !!qAns.bubu;
    const duduAnswered = !!qAns.dudu;
    const bothAnswered = bubuAnswered && duduAnswered;
    const isMatch = bothAnswered && qAns.bubu === qAns.dudu;

    let resultCardHtml = '';
    if (bothAnswered) {
      if (isMatch) {
        resultCardHtml = `
          <div class="quiz-result-match">
            🎉💖 %100 UYUM! TEBRİKLER! 🐼💕🐻<br/>
            <span style="font-size:11.5px; font-weight:600;">Ruh ikizi gibisiniz, ikiniz de aynı cevabı verdiniz! 🥳✨</span>
          </div>
        `;
      } else {
        resultCardHtml = `
          <div class="quiz-result-mismatch">
            🙈💭 Uyum Olmadı, Bi Dahaki Sefere! 🍀<br/>
            <span style="font-size:11.5px; font-weight:600;">Bu soruda farklı düşündünüz, bir sonraki soruda şansınızı deneyin!</span>
          </div>
        `;
      }
    }

    return `
      <div style="background:rgba(255,255,255,0.82); padding:13px; border-radius:18px; margin-bottom:11px; border:1.5px solid var(--pink-soft);">
        <div style="font-size:13px; font-weight:800; margin-bottom:9px;">${escapeHtml(q.question)}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
          ${(q.options || []).map((opt) => `
            <button
              class="${myAns === opt ? 'primary-btn' : 'secondary-btn'}"
              style="font-size:11.5px; padding:7px 12px;"
              onclick="submitQuizAnswer('${q.id}', '${escapeHtml(opt)}')"
            >${escapeHtml(opt)}</button>
          `).join('')}
        </div>
        <!-- Kimin hangi cevabı verdiği GİZLİDİR, sadece cevaplayıp cevaplamadığı görünür -->
        <div style="font-size:11.5px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
          <span>🐼 Bubu: <strong>${bubuAnswered ? '✅ Cevapladı (Gizli)' : '⏳ Bekleniyor...'}</strong></span>
          <span>🐻 Dudu: <strong>${duduAnswered ? '✅ Cevapladı (Gizli)' : '⏳ Bekleniyor...'}</strong></span>
        </div>
        ${resultCardHtml}
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
      userName: getMyDisplayName(),
      answer
    });
  }
}

function openAddQuizModal() {
  document.getElementById('newQuizQuestionInput').value = '';
  document.getElementById('addQuizModal').classList.add('open');
}

function saveNewQuizQuestion() {
  const question = document.getElementById('newQuizQuestionInput').value.trim();
  const o1 = document.getElementById('newQuizOpt1').value.trim() || 'Bubu 🐼';
  const o2 = document.getElementById('newQuizOpt2').value.trim() || 'Dudu 🐻';
  const o3 = document.getElementById('newQuizOpt3').value.trim() || 'İkimiz de 💞';

  if (!question) {
    showIosBanner('💑⚠️', 'Soru Yazın', 'Lütfen eklemek istediğiniz çift uyum sorusunu yazın.');
    return;
  }

  if (socket && socket.connected) {
    socket.emit('add_quiz_question', {
      roomCode: currentRoomCode,
      question,
      options: [o1, o2, o3],
      fromChar: myCharacter,
      fromName: getMyDisplayName()
    });
  }
  closeModal('addQuizModal');
  showIosBanner('💑💖', 'Yeni Uyum Sorusu Eklendi!', 'Sevgiline bildirim gönderildi.');
}

// --- OYUN 5: FOTOĞRAFLI KAFA HEDEFLİ DART OYUNU ---
let dartAnimId = null;

function loadDartTargetFromState() {
  if (!roomState || !roomState.games?.dartTarget) return;
  const dt = roomState.games.dartTarget;
  if (dt.image && dt.image !== dartImageSrcLoaded) {
    dartImageSrcLoaded = dt.image;
    const img = new Image();
    img.onload = () => {
      dartImageElement = img;
      initDartIdleBoard();
    };
    img.src = dt.image;
  }
}

function uploadDartTargetPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  compressImageFile(file, 700, 0.84, (base64) => {
    dartImageSrcLoaded = base64;
    const img = new Image();
    img.onload = () => {
      dartImageElement = img;
      initDartIdleBoard();
    };
    img.src = base64;

    if (socket && socket.connected) {
      socket.emit('update_dart_target', {
        roomCode: currentRoomCode,
        image: base64,
        headX: 0.5,
        headY: 0.34,
        fromChar: myCharacter,
        fromName: getMyDisplayName()
      });
    }
    showIosBanner('🎯📸', 'Dart Hedef Fotoğrafı Yüklendi!', 'İstersen "🎯 Kafa Noktasını Seç" butonuna basıp fotoğraftaki kafanın tam üstüne dokunabilirsin!');
  });
}

function toggleDartHeadPositionMode() {
  dartSettingHeadMode = !dartSettingHeadMode;
  const btn = document.getElementById('btnSetHeadMode');
  const overlay = document.getElementById('dartOverlay');

  if (dartSettingHeadMode) {
    overlay.classList.add('hidden');
    btn.className = 'primary-btn';
    btn.textContent = '👆 Fotoğrafta Kafaya Dokun';
    initDartIdleBoard();
  } else {
    btn.className = 'secondary-btn';
    btn.textContent = '🎯 Kafa Noktasını Seç';
    overlay.classList.remove('hidden');
  }
}

function drawDartTargetBoard(ctx, canvas, headX, headY) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (dartImageElement) {
    ctx.drawImage(dartImageElement, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#F8E5EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '82px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(myCharacter === 'bubu' ? '🐻' : '🐼', headX, headY);
  }

  // Kafa Hedef Halkaları (Tam Kafa İsabeti = 100 Puan!)
  const rings = [
    { r: 72, color: 'rgba(142, 33, 59, 0.25)', stroke: '#8E213B', label: '20' },
    { r: 46, color: 'rgba(232, 139, 174, 0.32)', stroke: '#C85A87', label: '50' },
    { r: 22, color: 'rgba(255, 215, 0, 0.45)', stroke: '#D50000', label: '100' }
  ];

  rings.forEach((ring) => {
    ctx.beginPath();
    ctx.arc(headX, headY, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = ring.color;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = ring.stroke;
    ctx.stroke();
  });

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('🎯 KAFA (100)', headX, headY - 26);
}

function initDartIdleBoard() {
  const canvas = document.getElementById('dartCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dt = (roomState && roomState.games?.dartTarget) || { headX: 0.5, headY: 0.34 };
  const hx = (dt.headX || 0.5) * canvas.width;
  const hy = (dt.headY || 0.34) * canvas.height;
  drawDartTargetBoard(ctx, canvas, hx, hy);

  canvas.onpointerdown = (e) => {
    if (!dartSettingHeadMode) return;
    const rect = canvas.getBoundingClientRect();
    const normX = Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0.1, Math.min(0.9, (e.clientY - rect.top) / rect.height));

    if (!roomState.games.dartTarget) roomState.games.dartTarget = {};
    roomState.games.dartTarget.headX = normX;
    roomState.games.dartTarget.headY = normY;

    if (socket && socket.connected) {
      socket.emit('update_dart_target', {
        roomCode: currentRoomCode,
        headX: normX,
        headY: normY,
        fromChar: myCharacter,
        fromName: getMyDisplayName()
      });
    }
    toggleDartHeadPositionMode();
    showIosBanner('🎯✅', 'Kafa Hedef Noktası Ayarlandı!', 'Şimdi tam kafaya dart isabet ettirdiğinde +100 TAM PUAN alacaksın!');
  };
}

function startDartGame() {
  const canvas = document.getElementById('dartCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('dartOverlay');
  overlay.classList.add('hidden');
  dartSettingHeadMode = false;
  if (dartAnimId) cancelAnimationFrame(dartAnimId);

  let dartsLeft = 5;
  let totalScore = 0;
  let thrownDarts = [];
  let t = 0;

  const dt = (roomState && roomState.games?.dartTarget) || { headX: 0.5, headY: 0.34 };
  const headX = (dt.headX || 0.5) * canvas.width;
  const headY = (dt.headY || 0.34) * canvas.height;

  // Gezen nişangah koordinatları
  let aimX = canvas.width / 2;
  let aimY = canvas.height / 2;

  document.getElementById('dartLiveScoreBadge').textContent = `🎯 ${dartsLeft} Ok • ${totalScore} Puan`;

  canvas.onpointerdown = (e) => {
    if (dartsLeft <= 0) return;
    // Parmağın dokunduğu noktayla gezen nişangahın ortalamasına dart saplanır
    const rect = canvas.getBoundingClientRect();
    const tapX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const tapY = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hitX = (aimX * 0.55) + (tapX * 0.45);
    const hitY = (aimY * 0.55) + (tapY * 0.45);

    const dist = Math.hypot(hitX - headX, hitY - headY);
    let pts = 0;
    let label = 'Iska (0)';
    if (dist <= 24) {
      pts = 100;
      label = '💥 TAM KAFA! +100';
      playCuteSound('win');
    } else if (dist <= 48) {
      pts = 50;
      label = '🎯 Kafa Çevresi +50';
      playCuteSound('pop');
    } else if (dist <= 75) {
      pts = 20;
      label = '✨ İsabet +20';
      playCuteSound('pop');
    } else {
      playCuteSound('punch');
    }

    dartsLeft--;
    totalScore += pts;
    thrownDarts.push({ x: hitX, y: hitY, label, pts });
    document.getElementById('dartLiveScoreBadge').textContent = `🎯 ${dartsLeft} Ok • ${totalScore} Puan`;

    if (dartsLeft <= 0) {
      setTimeout(() => {
        cancelAnimationFrame(dartAnimId);
        overlay.classList.remove('hidden');
        overlay.querySelector('h3').textContent = `Dart Tamamlandı! Toplam: ${totalScore} Puan 🎯`;
        if (socket && socket.connected) {
          socket.emit('update_game_score', {
            roomCode: currentRoomCode,
            gameKey: 'dartScores',
            gameTitle: 'Fotoğraflı Kafa Dart Oyunu 🎯',
            character: myCharacter,
            playerName: getMyDisplayName(),
            score: totalScore
          });
        }
      }, 650);
    }
  };

  function loop() {
    t += 0.042;
    aimX = (canvas.width / 2) + Math.sin(t * 1.3) * 125;
    aimY = (canvas.height / 2) + Math.cos(t * 1.7) * 95;

    drawDartTargetBoard(ctx, canvas, headX, headY);

    // Atılan dart okları
    thrownDarts.forEach((d) => {
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎯', d.x, d.y);

      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = d.pts === 100 ? '#D50000' : '#331520';
      ctx.fillText(d.label, d.x, d.y - 18);
    });

    // Gezen Nişangah (+)
    if (dartsLeft > 0) {
      ctx.beginPath();
      ctx.arc(aimX, aimY, 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#FF1744';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(aimX - 22, aimY);
      ctx.lineTo(aimX + 22, aimY);
      ctx.moveTo(aimX, aimY - 22);
      ctx.lineTo(aimX, aimY + 22);
      ctx.stroke();
    }

    if (dartsLeft > 0) {
      dartAnimId = requestAnimationFrame(loop);
    }
  }
  loop();
}

// ============================================================================
// 9) "BİZİM ŞARKILARIMIZ" MÜZİK ÇALAR
// ============================================================================
function initAudioPlayerListeners() {
  const audio = document.getElementById('mainAudioElement');
  if (!audio) return;

  audio.addEventListener('play', () => {
    isAudioPlaying = true;
    document.getElementById('btnPlayPauseMain').textContent = '⏸';
    document.getElementById('nowPlayingCover').classList.add('playing');
  });

  audio.addEventListener('pause', () => {
    isAudioPlaying = false;
    document.getElementById('btnPlayPauseMain').textContent = '▶';
    document.getElementById('nowPlayingCover').classList.remove('playing');
  });

  audio.addEventListener('ended', () => {
    playNextSong();
  });
}

async function searchMusicCatalog() {
  const query = document.getElementById('musicSearchInput').value.trim();
  const resultsBox = document.getElementById('musicSearchResults');
  if (!query) return;

  resultsBox.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px;">🔍 "${escapeHtml(query)}" aranıyor...</div>`;
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&country=TR&limit=5`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      resultsBox.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px;">Sonuç bulunamadı. MP3 yükleyebilir veya farklı bir şarkı adı deneyebilirsiniz.</div>`;
      return;
    }

    resultsBox.innerHTML = data.results.map((item, idx) => {
      const safeTitle = escapeHtml(item.trackName || 'Şarkı');
      const safeArtist = escapeHtml(item.artistName || 'Sanatçı');
      const cover = item.artworkUrl100 || '/assets/budu-icon.png';
      const preview = item.previewUrl || '';
      return `
        <div class="feed-item" style="margin-bottom:6px;">
          <img src="${cover}" alt="Kapak" style="width:42px; height:42px; border-radius:10px; object-fit:cover;" />
          <div class="feed-info">
            <div class="feed-title">${safeTitle}</div>
            <div class="feed-desc">${safeArtist}</div>
          </div>
          <button class="primary-btn" style="padding:7px 12px; font-size:11.5px;" onclick='addSearchedSongToPlaylist(${JSON.stringify({
            title: item.trackName,
            artist: item.artistName,
            audioUrl: preview,
            coverUrl: cover
          }).replace(/'/g, "&#39;")})'>+ Ekle & Çal</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    resultsBox.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px;">Arama sırasında bağlantı hatası oluştu.</div>`;
  }
}

function addSearchedSongToPlaylist(songData) {
  if (socket && socket.connected) {
    socket.emit('add_song', {
      roomCode: currentRoomCode,
      song: {
        ...songData,
        addedByChar: myCharacter,
        addedByName: getMyDisplayName()
      }
    });
  }
  document.getElementById('musicSearchResults').innerHTML = '';
  document.getElementById('musicSearchInput').value = '';
  showIosBanner('🎵💖', 'Bizim Şarkılarımıza Eklendi!', `${songData.title} - ${songData.artist} listeye kaydedildi ve sevgiline bildirim gönderildi!`);
  setTimeout(() => playSongByIndex(0), 350);
}

function uploadCustomAudioFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    showIosBanner('🎵⚠️', 'Dosya Boyutu Çok Büyük', 'Lütfen 15 MB altındaki bir MP3/ses dosyası seçin.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    if (socket && socket.connected) {
      socket.emit('add_song', {
        roomCode: currentRoomCode,
        song: {
          title: cleanName,
          artist: `${getMyDisplayName()} Yükledi`,
          audioUrl: e.target.result,
          coverUrl: '/assets/budu-icon.png',
          addedByChar: myCharacter,
          addedByName: getMyDisplayName()
        }
      });
    }
    showIosBanner('🎵📁', 'Şarkı Yüklendi!', `${cleanName} "Bizim Şarkılarımız" listesine eklendi!`);
    setTimeout(() => playSongByIndex(0), 400);
  };
  reader.readAsDataURL(file);
}

function openManualSongModal() {
  document.getElementById('songTitleInput').value = '';
  document.getElementById('songArtistInput').value = '';
  document.getElementById('songUrlInput').value = '';
  document.getElementById('songNoteInput').value = '';
  document.getElementById('manualSongModal').classList.add('open');
}

function saveManualSong() {
  const title = document.getElementById('songTitleInput').value.trim();
  const artist = document.getElementById('songArtistInput').value.trim() || 'Bizim Şarkımız';
  const audioUrl = document.getElementById('songUrlInput').value.trim();
  const note = document.getElementById('songNoteInput').value.trim();

  if (!title) {
    showIosBanner('🎵⚠️', 'Şarkı Adı Girin', 'Lütfen şarkının adını yazın.');
    return;
  }

  if (socket && socket.connected) {
    socket.emit('add_song', {
      roomCode: currentRoomCode,
      song: {
        title,
        artist,
        audioUrl,
        note,
        coverUrl: '/assets/budu-icon.png',
        addedByChar: myCharacter,
        addedByName: getMyDisplayName()
      }
    });
  }
  closeModal('manualSongModal');
  showIosBanner('🎵💖', 'Şarkı Listeye Eklendi!', `${title} kaydedildi ve sevgiline bildirim gitti!`);
}

function renderSavedSongsList() {
  const container = document.getElementById('savedSongsList');
  if (!container || !roomState) return;
  const songs = roomState.songs || [];
  document.getElementById('songsCountBadge').textContent = `${songs.length} Şarkı`;

  if (songs.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:14px;">Henüz "Bizim Şarkılarımız" listesine şarkı eklenmedi. Yukarıdan şarkı arayıp veya telefondan MP3 seçip ilk şarkınızı ekleyin! 🎵</div>`;
    return;
  }

  container.innerHTML = songs.map((s, idx) => `
    <div class="feed-item" style="${idx === currentSongIndex ? 'border:2px solid var(--pink-main); background:var(--pink-light);' : ''}">
      <img src="${s.coverUrl || '/assets/budu-icon.png'}" alt="Kapak" style="width:44px; height:44px; border-radius:11px; object-fit:cover; cursor:pointer;" onclick="playSongByIndex(${idx})" />
      <div class="feed-info" style="cursor:pointer;" onclick="playSongByIndex(${idx})">
        <div class="feed-title">🎵 ${escapeHtml(s.title)}</div>
        <div class="feed-desc">${escapeHtml(s.artist)} • ${s.addedByChar === 'bubu' ? '🐼' : '🐻'} ${escapeHtml(s.addedByName)}</div>
        ${s.note ? `<div class="feed-desc" style="color:var(--pink-main); font-weight:700;">"${escapeHtml(s.note)}"</div>` : ''}
      </div>
      <button class="primary-btn" style="padding:7px 11px; font-size:11.5px;" onclick="playSongByIndex(${idx})">▶ Çal</button>
      <button class="delete-mini-btn" onclick="deleteSongItem('${s.id}')">🗑️</button>
    </div>
  `).join('');
}

function playSongByIndex(idx) {
  const songs = (roomState && roomState.songs) || [];
  if (songs.length === 0 || !songs[idx]) return;
  currentSongIndex = idx;
  const song = songs[idx];

  document.getElementById('nowPlayingTitle').textContent = song.title;
  document.getElementById('nowPlayingArtist').textContent = `${song.artist} (${song.addedByName} ekledi)`;
  document.getElementById('nowPlayingCover').src = song.coverUrl || '/assets/budu-icon.png';

  const audio = document.getElementById('mainAudioElement');
  if (song.audioUrl) {
    audio.src = song.audioUrl;
    audio.play().catch(() => {});
  } else {
    showIosBanner('🎵ℹ️', song.title, 'Bu şarkı ses dosyası olmadan not olarak eklendi. Sesli çalmak için yukarıdaki arama kutusundan şarkıyı arayıp ekleyebilirsiniz!');
  }

  renderSavedSongsList();

  if (socket && socket.connected) {
    socket.emit('play_song_sync', {
      roomCode: currentRoomCode,
      song,
      fromChar: myCharacter,
      fromName: getMyDisplayName()
    });
  }
}

function togglePlayCurrentSong() {
  const audio = document.getElementById('mainAudioElement');
  const songs = (roomState && roomState.songs) || [];
  if (!audio.src && songs.length > 0) {
    playSongByIndex(0);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function playNextSong() {
  const songs = (roomState && roomState.songs) || [];
  if (songs.length === 0) return;
  currentSongIndex = (currentSongIndex + 1) % songs.length;
  playSongByIndex(currentSongIndex);
}

function playPrevSong() {
  const songs = (roomState && roomState.songs) || [];
  if (songs.length === 0) return;
  currentSongIndex = (currentSongIndex - 1 + songs.length) % songs.length;
  playSongByIndex(currentSongIndex);
}

function deleteSongItem(songId) {
  if (socket && socket.connected) {
    socket.emit('delete_song', { roomCode: currentRoomCode, songId });
  }
}

// ============================================================================
// NOT YAZMA PANOSU & CANLI MESAJLAŞMA
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
  showIosBanner('📌💖', 'Aşk Notun Kaydedildi!', 'Sevgilinin telefonuna bildirim gönderildi.');
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

  if (notes.length === 0) {
    grid.innerHTML = `<div style="grid-column:span 2; font-size:12px; color:var(--text-muted); text-align:center; padding:14px;">Henüz aşk notu eklenmedi. Yukarıdan sevgiline ilk notu sen bırak! 💌</div>`;
    return;
  }

  const moodIcons = { kiss: '💋', hug: '🤗', heart: '💖', coffee: '🧋' };
  grid.innerHTML = notes.map((n) => `
    <div class="sticky-note-card note-${n.color || 'visne'}">
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
      emoji,
      fromChar: myCharacter,
      fromName: getMyDisplayName()
    });
  }
}

function renderChatMessages() {
  const list = document.getElementById('chatMessagesList');
  if (!list || !roomState) return;
  const msgs = roomState.messages || [];

  if (msgs.length === 0) {
    list.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; margin:auto; padding:20px;">Sohbetiniz tertemiz hazır! Aşkına ilk mesajı veya çıkartmayı gönder 💬💕</div>`;
    return;
  }

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
// ORTAK TAKVİM, MANUEL GÖRSELLİ ANI EKLEME & ETKİNLİK HATIRLATICISI
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
  const startOffset = (firstDay.getDay() + 6) % 7;
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
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:10px;">Henüz planlanmış etkinlik yok. "+ Yeni Plan" ile ilk buluşmanızı ekleyin! 📅</div>`;
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
        <div class="feed-item">
          <div class="feed-icon" style="cursor:pointer;" onclick="toggleEventDone('${ev.id}')">
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

  if (nearestEvent) {
    const dayLabel = nearestDaysDiff === 0 ? 'BUGÜN!' : `${nearestDaysDiff} Gün Kaldı`;
    reminderBarText.textContent = `🔔 Yaklaşan Plan: ${nearestEvent.title} (${nearestEvent.date} • ${nearestEvent.time})`;
    reminderBarBadge.textContent = dayLabel;
  } else {
    reminderBarText.textContent = `📅 Ortak Takvim: Yeni buluşma veya anı eklemek için dokun!`;
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
           <div style="font-size:12px; font-weight:700; color:var(--pink-main); margin-top:4px;">Bubu & Dudu Özel Anısı</div>
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
            <div style="font-size:11px; font-weight:700; color:var(--pink-main);">
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
  }

  closeModal('memoryModal');
  showIosBanner('📸💖', 'Anı Takvime Kaydedildi!', `${title} ortak albüme eklendi ve sevgiline bildirim gönderildi.`);
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
  showIosBanner('📅⏰', 'Etkinlik Planlandı!', `${title} takvime eklendi ve sevgiline bildirim gönderildi!`);
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
// 7) VİŞNE ÇÜRÜĞÜ & ÇEŞİTLİ RENK KOMBİNASYONLARI + AYARLAR
// ============================================================================
function applyThemeSelection(themeVal, notify = true) {
  document.body.classList.remove(
    'theme-visne-haki',
    'theme-pink-lilac-khaki',
    'theme-gece-visne',
    'theme-karamel-visne',
    'theme-okyanus-pembe'
  );
  if (themeVal && themeVal !== 'visne-curugu') {
    document.body.classList.add('theme-' + themeVal);
  }
  localStorage.setItem('budu_theme', themeVal || 'visne-curugu');
  const sel = document.getElementById('selectColorTheme');
  if (sel) sel.value = themeVal || 'visne-curugu';
}

function cycleQuickTheme() {
  const current = localStorage.getItem('budu_theme') || 'visne-curugu';
  const idx = COLOR_THEMES.indexOf(current);
  const next = COLOR_THEMES[(idx + 1) % COLOR_THEMES.length];
  applyThemeSelection(next);

  const names = {
    'visne-curugu': '🍒 Vişne Çürüğü & Gül Kurusu',
    'visne-haki': '🍒🌿 Vişne Çürüğü & Adaçayı Haki',
    'pink-lilac-khaki': '🌸💜🌿 Toz Pembe & Lila & Haki',
    'gece-visne': '🌙🍒 Gece Vişnesi & Lavanta',
    'karamel-visne': '🧸🍒 Dudu Karamel & Vişne Çürüğü',
    'okyanus-pembe': '🌊🌸 Okyanus Mavisi & Vişne'
  };
  showIosBanner('🎨🍒', 'Renk Kombinasyonu Değişti!', names[next] || next);
}

function saveCoupleSettings() {
  const bubuName = document.getElementById('inputBubuName').value.trim() || 'Bubu';
  const duduName = document.getElementById('inputDuduName').value.trim() || 'Dudu';
  const newRoomCode = (document.getElementById('inputRoomCode').value.trim() || 'BUDU-2026').toUpperCase();
  const startDate = document.getElementById('inputStartDate').value || '2025-09-22';
  const theme = document.getElementById('selectColorTheme').value || 'visne-curugu';

  currentRoomCode = newRoomCode;
  localStorage.setItem('budu_roomCode', currentRoomCode);
  applyThemeSelection(theme, false);

  if (socket && socket.connected) {
    socket.emit('join_room', {
      roomCode: currentRoomCode,
      character: myCharacter,
      userName: myCharacter === 'bubu' ? bubuName : duduName
    });
    socket.emit('update_couple_info', {
      roomCode: currentRoomCode,
      fromChar: myCharacter,
      coupleInfo: { bubuName, duduName, startDate, theme }
    });
  }
  updateTogetherDaysCounter();
  showIosBanner('💾💕', 'Çift Ayarları Kalıcı Kaydedildi!', `Oda: ${currentRoomCode} • ${bubuName} & ${duduName}`);
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
