// ── State ──
const state = {
  playlist: [],         // visible (filtered) music tracks
  fxSounds: [],         // visible (filtered) fx sounds
  allMusic: [],         // master list from server
  allFx: [],            // master list from server
  playlists: [],        // [{ id, name, musicNames: [], fxNames: [] }]
  activePlaylistId: null,
  currentIndex: -1,
  isPlaying: false,
  isLooping: false,
  fxVolume: 1,
  fxRandomMin: 10,
  fxRandomMax: 45,
  currentUploadTab: 'music',
  currentPlaylistsTab: 'select',
};

const RANDOM_FX_KEY = 'juxbox-random-fx-range';
function loadRandomFxStorage() {
  try {
    const raw = localStorage.getItem(RANDOM_FX_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (Number.isFinite(obj.min)) state.fxRandomMin = obj.min;
      if (Number.isFinite(obj.max)) state.fxRandomMax = obj.max;
    }
  } catch (e) {}
}
function saveRandomFxRange() {
  localStorage.setItem(RANDOM_FX_KEY, JSON.stringify({ min: state.fxRandomMin, max: state.fxRandomMax }));
}

// ── Playlists persistence ──
const PLAYLISTS_KEY = 'juxbox-playlists';
const ACTIVE_KEY = 'juxbox-active-playlist';

function loadPlaylistsStorage() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    state.playlists = raw ? JSON.parse(raw) : [];
  } catch (e) { state.playlists = []; }
  state.activePlaylistId = localStorage.getItem(ACTIVE_KEY) || null;
}
function savePlaylists() {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(state.playlists));
}
function saveActiveId() {
  if (state.activePlaylistId) localStorage.setItem(ACTIVE_KEY, state.activePlaylistId);
  else localStorage.removeItem(ACTIVE_KEY);
}
function getActivePlaylist() {
  return state.playlists.find(p => p.id === state.activePlaylistId) || null;
}
function newPlaylistId() { return 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function applyPlaylistFilter() {
  const pl = getActivePlaylist();
  if (!pl) {
    state.playlist = [...state.allMusic];
    state.fxSounds = state.allFx.map(f => fxDefaults({ ...f }));
  } else {
    state.playlist = state.allMusic.filter(t => pl.musicNames.includes(t.name));
    state.fxSounds = state.allFx.filter(f => pl.fxNames.includes(f.name)).map(f => fxDefaults({ ...f }));
  }
}

// ── DOM refs ──
const elTrackName = document.getElementById('track-name');
const elTrackIndex = document.getElementById('track-index');
const elTrackCount = document.getElementById('track-count');
const elPlaylist = document.getElementById('playlist');
const elVinyl = document.getElementById('vinyl');
const elTimeCurrent = document.getElementById('time-current');
const elTimeTotal = document.getElementById('time-total');
const elWaveformProgress = document.getElementById('waveform-progress');
const elSeekHandle = document.getElementById('seek-handle');
const elPlayIcon = document.getElementById('play-icon');
const elPauseIcon = document.getElementById('pause-icon');
const elFxList = document.getElementById('fx-list');
const elFxCount = document.getElementById('fx-count');
const canvas = document.getElementById('waveform-canvas');
const canvasCtx = canvas.getContext('2d');

// ── Helpers ──
function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function notify(msg, type = 'success') {
  let el = document.querySelector('.notif');
  if (!el) { el = document.createElement('div'); el.className = 'notif'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `notif ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function stripExt(name) {
  return name.replace(/\.mp3$/i, '');
}

// ── Audio engine (Web Audio API) ──
const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC();
const masterGain = ctx.createGain();
masterGain.gain.value = 0.8;
masterGain.connect(ctx.destination);

let unlocked = false;
function unlockAudio() {
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (unlocked) return;
  // iOS unlock trick: play a 1-sample silent buffer inside a user gesture
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    unlocked = true;
  } catch (e) {}
}
['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { passive: true })
);

const bufferCache = new Map(); // url -> AudioBuffer
async function loadBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const arr = await r.arrayBuffer();
  // Safari historically only supports the callback form
  const buf = await new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arr, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) { reject(e); }
  });
  bufferCache.set(url, buf);
  return buf;
}

// ── Music player ──
const music = {
  buffer: null,
  source: null,
  startedAt: 0,        // ctx.currentTime when source started
  offset: 0,           // playback position when last started (in track seconds)
  playbackRate: 1,
  isPlaying: false,
  duration: 0,
  url: null,
};

function getCurrentTime() {
  if (!music.buffer) return 0;
  if (music.isPlaying) {
    return Math.min(music.duration, music.offset + (ctx.currentTime - music.startedAt) * music.playbackRate);
  }
  return music.offset;
}

function stopSource() {
  if (music.source) {
    try { music.source.onended = null; music.source.stop(); } catch (e) {}
    music.source = null;
  }
}

function startSource(offset) {
  if (!music.buffer) return;
  stopSource();
  const off = Math.max(0, Math.min(offset, music.duration));
  const src = ctx.createBufferSource();
  src.buffer = music.buffer;
  src.playbackRate.value = music.playbackRate;
  src.connect(masterGain);
  src.onended = () => {
    if (music.source === src) {
      music.source = null;
      music.isPlaying = false;
      music.offset = music.duration;
      handleTrackEnded();
    }
  };
  src.start(0, off);
  music.source = src;
  music.startedAt = ctx.currentTime;
  music.offset = off;
  music.isPlaying = true;
  state.isPlaying = true;
}

function playMusic() {
  if (!music.buffer || music.isPlaying) return;
  unlockAudio();
  if (music.offset >= music.duration) music.offset = 0;
  startSource(music.offset);
}

function pauseMusic() {
  if (!music.isPlaying) return;
  const pos = getCurrentTime();
  stopSource();
  music.offset = Math.min(pos, music.duration);
  music.isPlaying = false;
  state.isPlaying = false;
}

function seekMusic(t) {
  if (!music.buffer) return;
  const target = Math.max(0, Math.min(t, music.duration));
  if (music.isPlaying) {
    startSource(target);
  } else {
    music.offset = target;
    updateProgressUI(true);
  }
}

function setMusicVolume(v) {
  masterGain.gain.value = v;
}

function setMusicPlaybackRate(v) {
  music.playbackRate = v;
  if (music.source && music.isPlaying) {
    // Re-anchor offset so getCurrentTime stays accurate after rate change
    music.offset = getCurrentTime();
    music.startedAt = ctx.currentTime;
    music.source.playbackRate.value = v;
  }
}

function handleTrackEnded() {
  updatePlayUI();
  if (state.isLooping) {
    startSource(0);
    updatePlayUI();
  } else if (state.currentIndex < state.playlist.length - 1) {
    loadTrack(state.currentIndex + 1, true);
  }
}

// ── Waveform drawing ──
let waveformData = [];

function drawWaveform(data) {
  waveformData = data;
  redrawWaveform(0);
}

function redrawWaveform(progress) {
  const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  canvasCtx.clearRect(0, 0, W, H);

  const bars = Math.floor(W / 3);
  const step = waveformData.length ? Math.floor(waveformData.length / bars) : 0;
  const mid = H / 2;
  const cutoff = Math.floor(progress * bars);

  for (let i = 0; i < bars; i++) {
    let amp = 0.15;
    if (step && waveformData.length) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += waveformData[i * step + j] || 0;
      amp = Math.max(0.05, sum / step);
    } else {
      amp = 0.1 + 0.4 * Math.abs(Math.sin(i * 0.3));
    }
    const bH = amp * H * 0.9;
    const x = i * (W / bars);
    const bW = W / bars - 1.5;
    canvasCtx.fillStyle = i < cutoff ? '#a855f7' : '#2a2a40';
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, mid - bH / 2, bW, bH, 1.5);
    canvasCtx.fill();
  }
}

function generateWaveform(audioBuffer) {
  const raw = audioBuffer.getChannelData(0);
  const samples = 512;
  const step = Math.floor(raw.length / samples);
  const data = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += Math.abs(raw[i * step + j]);
    data.push(sum / step);
  }
  const max = Math.max(...data) || 1;
  return data.map(v => v / max);
}

// ── Playback / Track loading ──
async function loadTrack(index, autoPlay = true) {
  if (index < 0 || index >= state.playlist.length) return;
  state.currentIndex = index;
  const track = state.playlist[index];

  stopSource();
  music.buffer = null;
  music.offset = 0;
  music.isPlaying = false;
  music.duration = 0;
  music.url = track.url;
  state.isPlaying = false;

  elTrackName.textContent = stripExt(track.name);
  elTrackIndex.textContent = `${index + 1} / ${state.playlist.length}`;
  elTimeTotal.textContent = '0:00';
  elTimeCurrent.textContent = '0:00';
  elWaveformProgress.style.width = '0%';
  elSeekHandle.style.left = '0%';
  waveformData = [];
  redrawWaveform(0);
  renderPlaylist();
  updatePlayUI();

  try {
    const buf = await loadBuffer(track.url);
    if (music.url !== track.url) return; // user switched track meanwhile
    music.buffer = buf;
    music.duration = buf.duration;
    elTimeTotal.textContent = fmt(buf.duration);
    drawWaveform(generateWaveform(buf));

    if (autoPlay) {
      startSource(0);
      updatePlayUI();
    }
  } catch (e) {
    notify('Erreur de chargement: ' + e.message, 'error');
  }
}

function togglePlay() {
  unlockAudio();
  if (state.currentIndex === -1) {
    if (state.playlist.length > 0) loadTrack(0, true);
    return;
  }
  if (!music.buffer) {
    loadTrack(state.currentIndex, true);
    return;
  }
  if (music.isPlaying) pauseMusic();
  else playMusic();
  updatePlayUI();
}

function updatePlayUI() {
  elPlayIcon.classList.toggle('hidden', state.isPlaying);
  elPauseIcon.classList.toggle('hidden', !state.isPlaying);
  elVinyl.classList.toggle('playing', state.isPlaying);
}

function updateProgressUI(force) {
  if (!music.duration && !force) return;
  const t = getCurrentTime();
  const p = music.duration ? Math.min(1, t / music.duration) : 0;
  elTimeCurrent.textContent = fmt(t);
  elWaveformProgress.style.width = (p * 100) + '%';
  elSeekHandle.style.left = (p * 100) + '%';
  redrawWaveform(p);
}

function tick() {
  if (music.isPlaying) updateProgressUI();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── Playlist rendering ──
function renderPlaylist() {
  elTrackCount.textContent = `${state.playlist.length} titre${state.playlist.length !== 1 ? 's' : ''}`;
  elPlaylist.innerHTML = '';
  state.playlist.forEach((t, i) => {
    const li = document.createElement('li');
    li.classList.toggle('active', i === state.currentIndex);
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <span class="track-title">${stripExt(t.name)}</span>
      <span class="track-dur" data-url="${t.url}">—</span>
      <button class="btn-remove" title="Supprimer">✕</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove')) return;
      loadTrack(i, true);
    });
    li.querySelector('.btn-remove').addEventListener('click', () => removeTrack(i));
    elPlaylist.appendChild(li);

    // Display duration if buffer already cached (from previous play)
    const dur = li.querySelector('.track-dur');
    if (bufferCache.has(t.url)) {
      dur.textContent = fmt(bufferCache.get(t.url).duration);
    } else {
      // Lightweight fallback: HTMLAudioElement metadata (doesn't play, just reads header)
      const tmp = new Audio();
      tmp.preload = 'metadata';
      tmp.src = t.url;
      tmp.addEventListener('loadedmetadata', () => {
        if (isFinite(tmp.duration)) dur.textContent = fmt(tmp.duration);
      });
    }
  });
}

// ── Playlists UI ──
function setActivePlaylist(id) {
  const playingTrackName = state.currentIndex >= 0 ? state.playlist[state.currentIndex]?.name : null;
  const playingFxName = playingFxIndex >= 0 ? state.fxSounds[playingFxIndex]?.name : null;
  state.activePlaylistId = id;
  saveActiveId();
  applyPlaylistFilter();
  state.currentIndex = playingTrackName
    ? state.playlist.findIndex(t => t.name === playingTrackName)
    : -1;
  playingFxIndex = playingFxName
    ? state.fxSounds.findIndex(f => f.name === playingFxName)
    : -1;
  renderPlaylist();
  renderFxList();
  renderFxStrips();
  renderPlaylistsPanel();
  updateActivePlaylistLabel();
}

function updateActivePlaylistLabel() {
  const pl = getActivePlaylist();
  document.getElementById('playlist-current-label').textContent = pl ? pl.name : 'Tous';
}

function createPlaylist(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const pl = { id: newPlaylistId(), name: trimmed, musicNames: [], fxNames: [] };
  state.playlists.push(pl);
  savePlaylists();
  return pl;
}

function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  savePlaylists();
  if (state.activePlaylistId === id) setActivePlaylist(null);
  else { renderPlaylistsPanel(); }
}

function renamePlaylist(id, name) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return;
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  pl.name = trimmed;
  savePlaylists();
  if (state.activePlaylistId === id) updateActivePlaylistLabel();
}

function togglePlaylistItem(id, kind, name) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return;
  const arr = kind === 'music' ? pl.musicNames : pl.fxNames;
  const idx = arr.indexOf(name);
  if (idx === -1) arr.push(name);
  else arr.splice(idx, 1);
  savePlaylists();
  if (state.activePlaylistId === id) {
    applyPlaylistFilter();
    renderPlaylist(); renderFxList(); renderFxStrips();
  }
}

function renderPlaylistsPanel() {
  // Select tab
  const sel = document.getElementById('pl-select');
  if (!sel) return;
  sel.innerHTML = '';
  const all = document.createElement('button');
  all.className = `pl-choice${!state.activePlaylistId ? ' active' : ''}`;
  all.innerHTML = `<span class="pl-choice-name">Tous</span><span class="pl-choice-count">${state.allMusic.length} musiques · ${state.allFx.length} FX</span>`;
  all.addEventListener('click', () => setActivePlaylist(null));
  sel.appendChild(all);
  state.playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = `pl-choice${state.activePlaylistId === pl.id ? ' active' : ''}`;
    btn.innerHTML = `<span class="pl-choice-name">${pl.name}</span><span class="pl-choice-count">${pl.musicNames.length} musiques · ${pl.fxNames.length} FX</span>`;
    btn.addEventListener('click', () => setActivePlaylist(pl.id));
    sel.appendChild(btn);
  });
  if (state.playlists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-empty';
    empty.textContent = 'Aucune playlist. Crée-en une dans l\'onglet Gérer.';
    sel.appendChild(empty);
  }

  // Manage tab
  const mng = document.getElementById('pl-manage-list');
  mng.innerHTML = '';
  if (state.playlists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-empty';
    empty.textContent = 'Crée ta première playlist ci-dessus.';
    mng.appendChild(empty);
    return;
  }
  state.playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'pl-mng';
    const musicChecks = state.allMusic.length === 0
      ? '<div class="pl-mng-empty">Aucune musique disponible</div>'
      : state.allMusic.map(t => `<label class="pl-check"><input type="checkbox" data-kind="music" data-name="${escapeAttr(t.name)}"${pl.musicNames.includes(t.name) ? ' checked' : ''}><span>${stripExt(t.name)}</span></label>`).join('');
    const fxChecks = state.allFx.length === 0
      ? '<div class="pl-mng-empty">Aucun FX disponible</div>'
      : state.allFx.map(f => `<label class="pl-check"><input type="checkbox" data-kind="fx" data-name="${escapeAttr(f.name)}"${pl.fxNames.includes(f.name) ? ' checked' : ''}><span>${stripExt(f.name)}</span></label>`).join('');
    card.innerHTML = `
      <div class="pl-mng-head">
        <input type="text" class="pl-mng-name" value="${escapeAttr(pl.name)}">
        <button class="pl-mng-edit" data-act="toggle">Contenu</button>
        <button class="pl-mng-del" data-act="del">✕</button>
      </div>
      <div class="pl-mng-content hidden">
        <div><h4>Musiques</h4>${musicChecks}</div>
        <div><h4>FX</h4>${fxChecks}</div>
      </div>
    `;
    const nameInput = card.querySelector('.pl-mng-name');
    nameInput.addEventListener('change', () => renamePlaylist(pl.id, nameInput.value));
    nameInput.addEventListener('blur', () => { if (!nameInput.value.trim()) nameInput.value = pl.name; });
    card.querySelector('[data-act="toggle"]').addEventListener('click', () => {
      card.querySelector('.pl-mng-content').classList.toggle('hidden');
    });
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      askDeleteConfirm(`Playlist "${pl.name}"`, () => deletePlaylist(pl.id));
    });
    card.querySelectorAll('.pl-check input').forEach(cb => {
      cb.addEventListener('change', () => togglePlaylistItem(pl.id, cb.dataset.kind, cb.dataset.name));
    });
    mng.appendChild(card);
  });
}

function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function askDeleteConfirm(name, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const input = document.getElementById('confirm-input');
  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');
  document.getElementById('confirm-name').textContent = name;
  input.value = '';
  ok.disabled = true;
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 50);

  const isValid = () => input.value.trim().toLowerCase() === 'oui';
  const onInput = () => { ok.disabled = !isValid(); };
  const close = () => {
    modal.classList.add('hidden');
    input.removeEventListener('input', onInput);
    ok.removeEventListener('click', confirm);
    cancel.removeEventListener('click', close);
    input.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);
  };
  const confirm = () => {
    if (!isValid()) return;
    close();
    onConfirm();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && isValid()) confirm();
    else if (e.key === 'Escape') close();
  };
  const onBackdrop = (e) => { if (e.target === modal) close(); };
  input.addEventListener('input', onInput);
  ok.addEventListener('click', confirm);
  cancel.addEventListener('click', close);
  input.addEventListener('keydown', onKey);
  modal.addEventListener('click', onBackdrop);
}

function removeTrack(index) {
  const track = state.playlist[index];
  askDeleteConfirm(track.name, () => doRemoveTrack(index));
}

function doRemoveTrack(index) {
  const track = state.playlist[index];
  if (!track) return;
  const playingTrackName = state.currentIndex >= 0 ? state.playlist[state.currentIndex]?.name : null;
  const wasCurrent = state.currentIndex === index;
  fetch(`/api/files/music/${encodeURIComponent(track.name)}`, { method: 'DELETE' })
    .then(() => {
      bufferCache.delete(track.url);
      state.allMusic = state.allMusic.filter(t => t.name !== track.name);
      state.playlists.forEach(p => { p.musicNames = p.musicNames.filter(n => n !== track.name); });
      savePlaylists();
      applyPlaylistFilter();
      if (wasCurrent) {
        stopSource();
        music.buffer = null;
        music.duration = 0;
        music.offset = 0;
        music.isPlaying = false;
        state.isPlaying = false;
        state.currentIndex = -1;
        elTrackName.textContent = 'Aucune piste';
        elTrackIndex.textContent = '—';
        elTimeTotal.textContent = '0:00';
        elTimeCurrent.textContent = '0:00';
        elWaveformProgress.style.width = '0%';
        elSeekHandle.style.left = '0%';
        waveformData = [];
        redrawWaveform(0);
        updatePlayUI();
        if (state.playlist.length > 0) loadTrack(Math.min(index, state.playlist.length - 1), false);
      } else if (playingTrackName) {
        state.currentIndex = state.playlist.findIndex(t => t.name === playingTrackName);
      }
      renderPlaylist();
      renderPlaylistsPanel();
    })
    .catch(() => notify('Erreur lors de la suppression', 'error'));
}

// ── FX Sound System (Web Audio) ──
let fxSource = null;
let fxGainNode = null;
let playingFxIndex = -1;
let autoFxEnabled = false;
let autoFxTimer = null;

function scheduleNextRandomFx() {
  if (!autoFxEnabled) return;
  let lo = Math.max(1, state.fxRandomMin || 1);
  let hi = Math.max(lo, state.fxRandomMax || lo);
  const delay = (lo + Math.random() * (hi - lo)) * 1000;
  autoFxTimer = setTimeout(fireRandomFx, delay);
}

function fireRandomFx() {
  if (!autoFxEnabled) return;
  if (state.fxSounds.length === 0) {
    scheduleNextRandomFx();
    return;
  }
  let candidates = state.fxSounds.map((_, i) => i).filter(i => i !== playingFxIndex);
  if (candidates.length === 0) candidates = state.fxSounds.map((_, i) => i);
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  playFxSound(idx, { toggle: false });
  scheduleNextRandomFx();
}

function startAutoFx() {
  autoFxEnabled = true;
  fireRandomFx();
}

function stopAutoFx() {
  autoFxEnabled = false;
  if (autoFxTimer) { clearTimeout(autoFxTimer); autoFxTimer = null; }
}

function fxDefaults(f) {
  if (f.position === undefined) f.position = 'bottom';
  return f;
}

function stopFx() {
  if (fxSource) {
    try { fxSource.onended = null; fxSource.stop(); } catch (e) {}
    fxSource = null;
    fxGainNode = null;
  }
  playingFxIndex = -1;
}

async function playFxSound(index, { toggle = true } = {}) {
  unlockAudio();
  if (toggle && playingFxIndex === index) {
    stopFx();
    renderFxList(); renderFxStrips();
    return;
  }
  if (fxSource) {
    try { fxSource.onended = null; fxSource.stop(); } catch (e) {}
    fxSource = null;
    fxGainNode = null;
  }
  playingFxIndex = index;
  const fx = state.fxSounds[index];
  renderFxList(); renderFxStrips();
  try {
    const buf = await loadBuffer(fx.url);
    if (playingFxIndex !== index) return; // user changed selection during load
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = state.fxVolume;
    src.connect(g).connect(ctx.destination);
    src.onended = () => {
      if (fxSource === src) {
        fxSource = null;
        fxGainNode = null;
        playingFxIndex = -1;
        renderFxList(); renderFxStrips();
      }
    };
    src.start(0);
    fxSource = src;
    fxGainNode = g;
  } catch (e) {
    playingFxIndex = -1;
    renderFxList(); renderFxStrips();
    notify('Erreur FX: ' + e.message, 'error');
  }
}

function moveFx(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= state.fxSounds.length) return;
  [state.fxSounds[index], state.fxSounds[target]] = [state.fxSounds[target], state.fxSounds[index]];
  if (playingFxIndex === index) playingFxIndex = target;
  else if (playingFxIndex === target) playingFxIndex = index;
  renderFxList(); renderFxStrips();
}

function setFxPosition(index, pos) {
  state.fxSounds[index].position = pos;
  renderFxList(); renderFxStrips();
}

function setFxVolume(vol) {
  state.fxVolume = vol;
  if (fxGainNode) fxGainNode.gain.value = vol;
}

function renderFxList() {
  elFxCount.textContent = `(${state.fxSounds.length})`;
  elFxList.innerHTML = '';
  state.fxSounds.forEach((f, i) => {
    const playing = i === playingFxIndex;
    const div = document.createElement('div');
    div.className = `fx-item${playing ? ' playing' : ''}`;
    div.innerHTML = `
      <div class="fx-item-top">
        <div class="fx-item-reorder">
          <button class="fx-move-btn" data-dir="-1" title="Monter">▲</button>
          <button class="fx-move-btn" data-dir="1" title="Descendre">▼</button>
        </div>
        <span class="fx-item-name">${stripExt(f.name)}</span>
        <div class="fx-pos-toggle">
          <button class="fx-pos-btn${f.position === 'top' ? ' active' : ''}" data-pos="top">HAUT</button>
          <button class="fx-pos-btn${f.position === 'bottom' ? ' active' : ''}" data-pos="bottom">BAS</button>
        </div>
        <button class="btn-remove" title="Supprimer">✕</button>
      </div>
    `;
    div.querySelectorAll('.fx-move-btn').forEach(btn => {
      btn.addEventListener('click', () => moveFx(i, parseInt(btn.dataset.dir)));
    });
    div.querySelectorAll('.fx-pos-btn').forEach(btn => {
      btn.addEventListener('click', () => setFxPosition(i, btn.dataset.pos));
    });
    div.querySelector('.btn-remove').addEventListener('click', () => removeFxSound(i));
    elFxList.appendChild(div);
  });
}

function renderFxStrips() {
  ['top', 'bottom'].forEach(pos => {
    const strip = document.getElementById(`fx-strip-${pos}`);
    strip.innerHTML = '';
    const fxInPos = state.fxSounds.filter(f => f.position === pos);
    if (fxInPos.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    fxInPos.forEach(f => {
      const realIndex = state.fxSounds.indexOf(f);
      const playing = realIndex === playingFxIndex;
      const btn = document.createElement('button');
      btn.className = `fx-deck-btn${playing ? ' playing' : ''}`;
      btn.innerHTML = `
        <span class="fx-deck-name">${stripExt(f.name)}</span>
      `;
      btn.addEventListener('click', () => playFxSound(realIndex));
      strip.appendChild(btn);
    });
  });
}

function removeFxSound(index) {
  const fx = state.fxSounds[index];
  askDeleteConfirm(fx.name, () => doRemoveFxSound(index));
}

function doRemoveFxSound(index) {
  const fx = state.fxSounds[index];
  if (!fx) return;
  const playingFxName = playingFxIndex >= 0 ? state.fxSounds[playingFxIndex]?.name : null;
  fetch(`/api/files/fx/${encodeURIComponent(fx.name)}`, { method: 'DELETE' })
    .then(() => {
      bufferCache.delete(fx.url);
      if (playingFxIndex === index) stopFx();
      state.allFx = state.allFx.filter(f => f.name !== fx.name);
      state.playlists.forEach(p => { p.fxNames = p.fxNames.filter(n => n !== fx.name); });
      savePlaylists();
      applyPlaylistFilter();
      playingFxIndex = playingFxName && playingFxName !== fx.name
        ? state.fxSounds.findIndex(f => f.name === playingFxName)
        : -1;
      renderFxList(); renderFxStrips();
      renderPlaylistsPanel();
    })
    .catch(() => notify('Erreur lors de la suppression', 'error'));
}

// ── Load files from server ──
function loadFiles() {
  Promise.all([
    fetch('/api/files/music').then(r => r.json()),
    fetch('/api/files/fx').then(r => r.json()),
  ]).then(([music, fx]) => {
    state.allMusic = music;
    state.allFx = fx;
    applyPlaylistFilter();
    renderPlaylist();
    renderFxList();
    renderFxStrips();
    renderPlaylistsPanel();
    redrawWaveform(0);
  });
}

// ── Upload ──
async function uploadFile(file, type) {
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch(`/api/upload/${type}`, { method: 'POST', body: fd });
  } catch (e) {
    throw new Error(`Impossible de joindre le serveur (${e.message})`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

async function handleFiles(files) {
  const type = state.currentUploadTab;
  const prog = document.getElementById('upload-progress');
  prog.classList.remove('hidden');
  document.getElementById('progress-fill').style.width = '0%';

  for (const file of files) {
    try {
      const result = await uploadFile(file, type);
      const pl = getActivePlaylist();
      if (type === 'music') {
        if (!state.allMusic.find(t => t.name === result.name)) state.allMusic.push(result);
        if (pl && !pl.musicNames.includes(result.name)) {
          pl.musicNames.push(result.name);
          savePlaylists();
        }
      } else {
        if (!state.allFx.find(f => f.name === result.name)) state.allFx.push(result);
        if (pl && !pl.fxNames.includes(result.name)) {
          pl.fxNames.push(result.name);
          savePlaylists();
        }
      }
      applyPlaylistFilter();
      renderPlaylist(); renderFxList(); renderFxStrips();
      renderPlaylistsPanel();
      notify(`"${stripExt(result.name)}" ajouté`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  prog.classList.add('hidden');
}

// ── Event listeners ──

document.getElementById('btn-play').addEventListener('click', togglePlay);

document.getElementById('btn-prev').addEventListener('click', () => {
  if (state.playlist.length === 0) return;
  const idx = state.currentIndex <= 0 ? state.playlist.length - 1 : state.currentIndex - 1;
  loadTrack(idx, state.isPlaying);
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (state.playlist.length === 0) return;
  const idx = (state.currentIndex + 1) % state.playlist.length;
  loadTrack(idx, state.isPlaying);
});

document.getElementById('btn-rewind').addEventListener('click', () => {
  seekMusic(0);
});

document.getElementById('btn-forward').addEventListener('click', () => {
  seekMusic(getCurrentTime() + 10);
});

// Waveform seek
const waveformEl = document.getElementById('waveform');
waveformEl.addEventListener('click', (e) => {
  if (!music.duration) return;
  const rect = waveformEl.getBoundingClientRect();
  const p = (e.clientX - rect.left) / rect.width;
  seekMusic(p * music.duration);
});

// Volume
document.getElementById('volume').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  setMusicVolume(val);
  document.getElementById('volume-val').textContent = Math.round(val * 100) + '%';
});

// FX Volume (global)
document.getElementById('fx-volume').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  setFxVolume(val);
  document.getElementById('fx-volume-val').textContent = Math.round(val * 100) + '%';
});

// Pitch
document.getElementById('pitch').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  setMusicPlaybackRate(val);
  document.getElementById('pitch-val').textContent = val.toFixed(2) + 'x';
  const pct = ((val - 0.5) / 1.5) * 100;
  e.target.style.background = `linear-gradient(to right, #2a2a40 0%, #2a2a40 ${pct}%, #7c3aed ${pct}%, #7c3aed 100%)`;
});

// Loop
document.getElementById('btn-loop').addEventListener('click', () => {
  state.isLooping = !state.isLooping;
  document.getElementById('btn-loop').textContent = state.isLooping ? 'ON' : 'OFF';
  document.getElementById('btn-loop').classList.toggle('active', state.isLooping);
});

// Random FX (auto)
document.getElementById('btn-random-fx').addEventListener('click', () => {
  const btn = document.getElementById('btn-random-fx');
  if (autoFxEnabled) {
    stopAutoFx();
  } else {
    startAutoFx();
  }
  btn.textContent = autoFxEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', autoFxEnabled);
});

const rfxMinEl = document.getElementById('rfx-min');
const rfxMaxEl = document.getElementById('rfx-max');
function readRandomFxRange() {
  let lo = parseInt(rfxMinEl.value, 10);
  let hi = parseInt(rfxMaxEl.value, 10);
  if (!Number.isFinite(lo) || lo < 1) lo = 1;
  if (!Number.isFinite(hi) || hi < lo) hi = lo;
  state.fxRandomMin = lo;
  state.fxRandomMax = hi;
  saveRandomFxRange();
}
rfxMinEl.addEventListener('change', () => { readRandomFxRange(); rfxMinEl.value = state.fxRandomMin; rfxMaxEl.value = state.fxRandomMax; });
rfxMaxEl.addEventListener('change', () => { readRandomFxRange(); rfxMinEl.value = state.fxRandomMin; rfxMaxEl.value = state.fxRandomMax; });

// Upload UI
document.getElementById('btn-upload-toggle').addEventListener('click', () => {
  document.getElementById('upload-panel').classList.toggle('hidden');
  document.getElementById('settings-panel').classList.add('hidden');
});
document.getElementById('btn-close-upload').addEventListener('click', () => {
  document.getElementById('upload-panel').classList.add('hidden');
});

document.querySelectorAll('#upload-panel .upload-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#upload-panel .upload-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.currentUploadTab = tab.dataset.tab;
  });
});

// Settings panel
document.getElementById('btn-settings-toggle').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.toggle('hidden');
  document.getElementById('upload-panel').classList.add('hidden');
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.add('hidden');
});
document.querySelectorAll('#settings-panel .upload-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#settings-panel .upload-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.pltab;
    document.getElementById('pl-select').classList.toggle('hidden', target !== 'select');
    document.getElementById('pl-manage').classList.toggle('hidden', target !== 'manage');
    state.currentPlaylistsTab = target;
  });
});
document.getElementById('pl-create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('pl-create-input');
  const pl = createPlaylist(input.value);
  if (pl) {
    input.value = '';
    renderPlaylistsPanel();
  }
});

document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(Array.from(e.target.files));
  e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'LABEL') document.getElementById('file-input').click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.mp3'));
  if (files.length) handleFiles(files);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': seekMusic(getCurrentTime() + 5); break;
    case 'ArrowLeft': seekMusic(getCurrentTime() - 5); break;
    case 'ArrowUp': {
      const v = document.getElementById('volume');
      v.value = Math.min(1, parseFloat(v.value) + 0.05);
      v.dispatchEvent(new Event('input'));
      break;
    }
    case 'ArrowDown': {
      const v = document.getElementById('volume');
      v.value = Math.max(0, parseFloat(v.value) - 0.05);
      v.dispatchEvent(new Event('input'));
      break;
    }
    case 'KeyN': {
      if (state.playlist.length === 0) return;
      loadTrack((state.currentIndex + 1) % state.playlist.length, state.isPlaying);
      break;
    }
    case 'KeyP': {
      if (state.playlist.length === 0) return;
      const idx = state.currentIndex <= 0 ? state.playlist.length - 1 : state.currentIndex - 1;
      loadTrack(idx, state.isPlaying);
      break;
    }
  }
});

window.addEventListener('resize', () => {
  const p = music.duration ? getCurrentTime() / music.duration : 0;
  redrawWaveform(p);
});

// Resume audio context if it gets suspended (iOS backgrounding)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx.state === 'suspended') ctx.resume().catch(() => {});
});

// ── Mobile navigation ──
const isMobile = () => window.innerWidth <= 860;

function setMobilePanel(name) {
  const panels = {
    deck: document.getElementById('panel-deck'),
    playlist: document.getElementById('panel-playlist'),
    fx: document.getElementById('panel-fx'),
  };
  Object.entries(panels).forEach(([key, el]) => {
    el.classList.toggle('mobile-active', key === name);
  });
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.panel === name);
  });
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => setMobilePanel(tab.dataset.panel));
});

if (isMobile()) setMobilePanel('deck');

window.addEventListener('resize', () => {
  if (isMobile()) {
    const hasActive = document.querySelector('.mobile-active');
    if (!hasActive) setMobilePanel('deck');
  }
});

// ── Init ──
loadPlaylistsStorage();
loadRandomFxStorage();
updateActivePlaylistLabel();
rfxMinEl.value = state.fxRandomMin;
rfxMaxEl.value = state.fxRandomMax;
loadFiles();
redrawWaveform(0);
