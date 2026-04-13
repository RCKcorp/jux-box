const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isLooping: false,
  fxSounds: [],
  currentUploadTab: 'music',
  playlistSearch: '',
  waveformData: [],
  fxAudio: null,
  playingFxIndex: -1,
};

const audio = document.getElementById('audio-player');
const canvas = document.getElementById('waveform-canvas');
const ctx = canvas.getContext('2d');

const els = {
  playlistList: document.getElementById('playlist-list'),
  trackCount: document.getElementById('track-count'),
  trackName: document.getElementById('track-name'),
  trackIndex: document.getElementById('track-index'),
  trackDurationLabel: document.getElementById('track-duration-label'),
  playStatePill: document.getElementById('play-state-pill'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  waveform: document.getElementById('waveform'),
  waveformProgress: document.getElementById('waveform-progress'),
  seekHandle: document.getElementById('seek-handle'),
  vinyl: document.getElementById('vinyl'),
  playBtn: document.getElementById('btn-play'),
  volume: document.getElementById('volume'),
  volumeVal: document.getElementById('volume-val'),
  loopState: document.getElementById('loop-state'),
  loopPill: document.getElementById('loop-pill'),
  fxCount: document.getElementById('fx-count'),
  fxAdminList: document.getElementById('fx-admin-list'),
  fxStripTop: document.getElementById('fx-strip-top'),
  fxStripBottom: document.getElementById('fx-strip-bottom'),
  fxTopCount: document.getElementById('fx-top-count'),
  fxBottomCount: document.getElementById('fx-bottom-count'),
  playlistSearch: document.getElementById('playlist-search'),
  notif: document.getElementById('notif'),
  uploadSheet: document.getElementById('upload-sheet'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  uploadLog: document.getElementById('upload-log'),
  mobileSheet: document.getElementById('mobile-sheet'),
  mobileSheetBody: document.getElementById('mobile-sheet-body'),
  mobileSheetTitle: document.getElementById('mobile-sheet-title'),
  mobileSheetKicker: document.getElementById('mobile-sheet-kicker'),
};

const durationCache = new Map();

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function stripExt(name) {
  return String(name || '').replace(/\.mp3$/i, '');
}

function notify(message, type = 'success') {
  els.notif.textContent = message;
  els.notif.className = `notif ${type} show`;
  clearTimeout(els.notif._timer);
  els.notif._timer = setTimeout(() => els.notif.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fxDefaults(item) {
  return { ...item, volume: item.volume ?? 1, position: item.position ?? 'bottom' };
}

function filteredPlaylist() {
  const q = state.playlistSearch.trim().toLowerCase();
  const list = state.playlist.map((track, absoluteIndex) => ({ track, absoluteIndex }));
  return q ? list.filter(({ track }) => stripExt(track.name).toLowerCase().includes(q)) : list;
}

function updateHeaderState() {
  const count = state.playlist.length;
  els.trackCount.textContent = `${count} titre${count > 1 ? 's' : ''}`;
  els.fxCount.textContent = `${state.fxSounds.length} FX`;
  els.playBtn.textContent = state.isPlaying ? '❚❚' : '▶';
  els.vinyl.classList.toggle('playing', state.isPlaying);
  els.playStatePill.textContent = state.isPlaying ? 'Lecture en cours' : (state.currentIndex >= 0 ? 'En pause' : 'En attente');
  els.loopState.textContent = state.isLooping ? 'ON' : 'OFF';
  els.loopPill.classList.toggle('active', state.isLooping);
}

function lazyResolveDuration(url, el) {
  if (!el) return;
  if (durationCache.has(url)) {
    el.textContent = durationCache.get(url);
    return;
  }
  const a = new Audio();
  a.src = url;
  a.addEventListener('loadedmetadata', () => {
    const value = fmt(a.duration);
    durationCache.set(url, value);
    el.textContent = value;
    if (state.currentIndex >= 0 && state.playlist[state.currentIndex]?.url === url) {
      els.trackDurationLabel.textContent = value;
    }
  }, { once: true });
  a.addEventListener('error', () => { el.textContent = '—'; }, { once: true });
}

function renderPlaylist(target = els.playlistList, mobile = false) {
  const data = filteredPlaylist();
  target.innerHTML = '';

  if (!data.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.playlist.length ? 'Aucun résultat pour cette recherche.' : 'Aucun titre disponible.';
    target.appendChild(empty);
    return;
  }

  data.forEach(({ track, absoluteIndex }, visibleIndex) => {
    const row = document.createElement('div');
    row.className = `track-row ${absoluteIndex === state.currentIndex ? 'active' : ''}`;
    row.innerHTML = `
      <div class="track-badge">${visibleIndex + 1}</div>
      <div class="track-copy">
        <div class="track-name-small">${escapeHtml(stripExt(track.name))}</div>
        <div class="track-sub">${absoluteIndex === state.currentIndex ? 'Titre courant' : 'Cliquer pour charger'}</div>
      </div>
      <div class="track-duration">—</div>
      <button class="icon-btn bad" type="button" title="Supprimer">✕</button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn')) return;
      loadTrack(absoluteIndex, true);
      if (mobile) closeMobileSheet();
    });

    row.querySelector('.icon-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeTrack(absoluteIndex);
      if (mobile) openMobilePlaylist();
    });

    target.appendChild(row);
    lazyResolveDuration(track.url, row.querySelector('.track-duration'));
  });
}

function renderNowPlaying() {
  if (state.currentIndex < 0 || !state.playlist[state.currentIndex]) {
    els.trackName.textContent = 'Aucune piste sélectionnée';
    els.trackIndex.textContent = '—';
    els.trackDurationLabel.textContent = 'Durée inconnue';
    return;
  }
  const track = state.playlist[state.currentIndex];
  els.trackName.textContent = stripExt(track.name);
  els.trackIndex.textContent = `${state.currentIndex + 1} / ${state.playlist.length}`;
  els.trackDurationLabel.textContent = durationCache.get(track.url) || 'Chargement…';
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

function drawWaveform(progress = 0) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * ratio;
  const h = canvas.clientHeight * ratio;
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  const bars = Math.max(32, Math.floor(w / 8));
  const barW = w / bars;
  const middle = h / 2;
  const cutoff = Math.floor(progress * bars);
  const data = state.waveformData;
  const step = data.length ? Math.max(1, Math.floor(data.length / bars)) : 0;

  for (let i = 0; i < bars; i++) {
    let amp = 0.16 + Math.abs(Math.sin(i * 0.22)) * 0.18;
    if (step && data.length) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      amp = Math.max(0.06, sum / step);
    }
    const barH = amp * h * 0.82;
    const x = i * barW + 1;
    const y = middle - barH / 2;
    ctx.fillStyle = i < cutoff ? 'rgba(159,124,255,0.95)' : 'rgba(255,255,255,0.14)';
    roundRect(ctx, x, y, Math.max(2, barW - 2), barH, 4);
  }
}

function generateWaveform(audioBuffer) {
  const raw = audioBuffer.getChannelData(0);
  const samples = 700;
  const block = Math.max(1, Math.floor(raw.length / samples));
  const out = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < block; j++) sum += Math.abs(raw[i * block + j] || 0);
    out.push(sum / block);
  }
  const max = Math.max(...out, 0.0001);
  return out.map(v => v / max);
}

async function analyzeAudio(url) {
  try {
    const buf = await fetch(url).then(r => r.arrayBuffer());
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ac.decodeAudioData(buf.slice(0));
    state.waveformData = generateWaveform(decoded);
    drawWaveform(audio.duration ? audio.currentTime / audio.duration : 0);
    ac.close?.();
  } catch {
    state.waveformData = [];
    drawWaveform(0);
  }
}

async function loadTrack(index, autoPlay = true) {
  if (index < 0 || index >= state.playlist.length) return;
  state.currentIndex = index;
  const track = state.playlist[index];
  audio.src = track.url;
  audio.load();
  renderNowPlaying();
  renderPlaylist();
  if (isMobile()) syncOpenedMobileSheet();
  state.waveformData = [];
  drawWaveform(0);
  els.timeCurrent.textContent = '0:00';
  els.timeTotal.textContent = '0:00';
  els.waveformProgress.style.width = '0%';
  els.seekHandle.style.left = '0%';
  analyzeAudio(track.url);

  if (autoPlay) {
    try {
      await audio.play();
      state.isPlaying = true;
    } catch {}
  } else {
    state.isPlaying = false;
  }
  updateHeaderState();
}

async function togglePlay() {
  if (state.currentIndex === -1 && state.playlist.length) {
    await loadTrack(0, true);
    return;
  }
  if (state.currentIndex === -1) return;

  if (state.isPlaying) {
    audio.pause();
    state.isPlaying = false;
  } else {
    try {
      await audio.play();
      state.isPlaying = true;
    } catch {}
  }
  updateHeaderState();
}

async function removeTrack(index) {
  const track = state.playlist[index];
  if (!track) return;
  try {
    const res = await fetch(`/api/files/music/${encodeURIComponent(track.name)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    state.playlist.splice(index, 1);
    if (state.currentIndex === index) {
      audio.pause();
      state.isPlaying = false;
      state.currentIndex = -1;
      renderNowPlaying();
      drawWaveform(0);
      els.timeCurrent.textContent = '0:00';
      els.timeTotal.textContent = '0:00';
      els.waveformProgress.style.width = '0%';
      els.seekHandle.style.left = '0%';
    } else if (state.currentIndex > index) {
      state.currentIndex -= 1;
    }
    renderPlaylist();
    if (isMobile()) syncOpenedMobileSheet();
    updateHeaderState();
    notify(`"${stripExt(track.name)}" supprimé`);
  } catch {
    notify('Erreur lors de la suppression du titre', 'error');
  }
}

function playFxSound(index) {
  stopFx(true);
  const fx = state.fxSounds[index];
  if (!fx) return;
  state.playingFxIndex = index;
  state.fxAudio = new Audio(fx.url);
  state.fxAudio.volume = fx.volume;
  state.fxAudio.play().catch(() => {});
  state.fxAudio.addEventListener('ended', () => stopFx(true), { once: true });
  renderFxAdmin();
  renderFxStrips();
}

function stopFx(silent = false) {
  if (state.fxAudio) {
    state.fxAudio.pause();
    state.fxAudio.currentTime = 0;
  }
  state.fxAudio = null;
  state.playingFxIndex = -1;
  renderFxAdmin();
  renderFxStrips();
  if (!silent) notify('FX arrêté');
}

function moveFx(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= state.fxSounds.length) return;
  [state.fxSounds[index], state.fxSounds[target]] = [state.fxSounds[target], state.fxSounds[index]];
  if (state.playingFxIndex === index) state.playingFxIndex = target;
  else if (state.playingFxIndex === target) state.playingFxIndex = index;
  renderFxAdmin();
  renderFxStrips();
  if (isMobile()) syncOpenedMobileSheet();
}

function setFxPosition(index, position) {
  state.fxSounds[index].position = position;
  renderFxAdmin();
  renderFxStrips();
  if (isMobile()) syncOpenedMobileSheet();
}

function setFxVolume(index, value) {
  state.fxSounds[index].volume = value;
  if (state.playingFxIndex === index && state.fxAudio) state.fxAudio.volume = value;
  renderFxAdmin();
  renderFxStrips();
  if (isMobile()) syncOpenedMobileSheet();
}

async function removeFxSound(index) {
  const fx = state.fxSounds[index];
  if (!fx) return;
  try {
    const res = await fetch(`/api/files/fx/${encodeURIComponent(fx.name)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    if (state.playingFxIndex === index) stopFx(true);
    else if (state.playingFxIndex > index) state.playingFxIndex -= 1;
    state.fxSounds.splice(index, 1);
    renderFxAdmin();
    renderFxStrips();
    if (isMobile()) syncOpenedMobileSheet();
    notify(`FX "${stripExt(fx.name)}" supprimé`);
  } catch {
    notify('Erreur lors de la suppression du FX', 'error');
  }
}

function buildFxStrip(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted-note';
    empty.textContent = 'Aucun FX ici.';
    container.appendChild(empty);
    return;
  }

  items.forEach(({ fx, index }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `fx-pad ${state.playingFxIndex === index ? 'playing' : ''}`;
    card.innerHTML = `
      <div class="fx-name">${escapeHtml(stripExt(fx.name))}</div>
      <input class="range fx-range" type="range" min="0" max="1" step="0.01" value="${fx.volume}">
      <div class="fx-mini-meta">
        <span>${fx.position.toUpperCase()}</span>
        <span>${Math.round(fx.volume * 100)}%</span>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('fx-range')) return;
      playFxSound(index);
    });
    card.querySelector('.fx-range').addEventListener('input', (e) => {
      e.stopPropagation();
      setFxVolume(index, parseFloat(e.target.value));
    });
    container.appendChild(card);
  });
}

function renderFxStrips() {
  const top = state.fxSounds.map((fx, index) => ({ fx, index })).filter(({ fx }) => fx.position === 'top');
  const bottom = state.fxSounds.map((fx, index) => ({ fx, index })).filter(({ fx }) => fx.position === 'bottom');
  els.fxTopCount.textContent = top.length;
  els.fxBottomCount.textContent = bottom.length;
  buildFxStrip(els.fxStripTop, top);
  buildFxStrip(els.fxStripBottom, bottom);
}

function renderFxAdmin(target = els.fxAdminList, mobile = false) {
  target.innerHTML = '';
  if (!state.fxSounds.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Aucun FX disponible.';
    target.appendChild(empty);
    return;
  }

  state.fxSounds.forEach((fx, index) => {
    const card = document.createElement('div');
    card.className = `fx-card ${state.playingFxIndex === index ? 'playing' : ''}`;
    card.innerHTML = `
      <div class="fx-top">
        <div class="fx-reorder">
          <button class="icon-btn" data-dir="-1" type="button">↑</button>
          <button class="icon-btn" data-dir="1" type="button">↓</button>
        </div>
        <div class="fx-title">${escapeHtml(stripExt(fx.name))}</div>
        <button class="icon-btn bad" data-role="remove" type="button">✕</button>
      </div>
      <div>
        <div class="segmented">
          <button data-pos="top" type="button" class="${fx.position === 'top' ? 'active' : ''}">HAUT</button>
          <button data-pos="bottom" type="button" class="${fx.position === 'bottom' ? 'active' : ''}">BAS</button>
        </div>
      </div>
      <div class="fx-bottom">
        <input class="range" type="range" min="0" max="1" step="0.01" value="${fx.volume}">
        <div class="track-duration">${Math.round(fx.volume * 100)}%</div>
      </div>
    `;

    card.querySelectorAll('[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        moveFx(index, Number(btn.dataset.dir));
        if (mobile) openMobileFx();
      });
    });
    card.querySelectorAll('[data-pos]').forEach(btn => {
      btn.addEventListener('click', () => {
        setFxPosition(index, btn.dataset.pos);
        if (mobile) openMobileFx();
      });
    });
    card.querySelector('[data-role="remove"]').addEventListener('click', async () => {
      await removeFxSound(index);
      if (mobile) openMobileFx();
    });
    card.querySelector('.range').addEventListener('input', (e) => {
      setFxVolume(index, parseFloat(e.target.value));
      if (mobile) openMobileFx();
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      playFxSound(index);
      if (mobile) openMobileFx();
    });
    target.appendChild(card);
  });
}

async function loadFiles() {
  try {
    const [music, fx] = await Promise.all([
      fetch('/api/files/music').then(r => r.json()),
      fetch('/api/files/fx').then(r => r.json()),
    ]);
    state.playlist = Array.isArray(music) ? music : [];
    state.fxSounds = Array.isArray(fx) ? fx.map(fxDefaults) : [];
    renderPlaylist();
    renderFxAdmin();
    renderFxStrips();
    renderNowPlaying();
    updateHeaderState();
    drawWaveform(0);
  } catch {
    notify('Impossible de charger les fichiers du serveur', 'error');
  }
}

async function uploadFile(file, type) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/upload/${type}`, { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

function appendUploadRow(name, status) {
  const row = document.createElement('div');
  row.className = 'upload-row';
  row.innerHTML = `<span>${escapeHtml(name)}</span><strong>${escapeHtml(status)}</strong>`;
  els.uploadLog.appendChild(row);
  return row;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.mp3'));
  if (!files.length) {
    notify('Seuls les MP3 sont acceptés', 'error');
    return;
  }
  els.uploadLog.innerHTML = '';
  for (const file of files) {
    const row = appendUploadRow(file.name, 'Envoi...');
    try {
      const result = await uploadFile(file, state.currentUploadTab);
      row.lastElementChild.textContent = 'OK';
      row.lastElementChild.style.color = '#86efac';
      if (state.currentUploadTab === 'music') {
        if (!state.playlist.find(t => t.name === result.name)) state.playlist.push(result);
        renderPlaylist();
      } else {
        if (!state.fxSounds.find(fx => fx.name === result.name)) state.fxSounds.push(fxDefaults(result));
        renderFxAdmin();
        renderFxStrips();
      }
      updateHeaderState();
      notify(`"${stripExt(result.name)}" ajouté`);
    } catch (error) {
      row.lastElementChild.textContent = error.message || 'Erreur';
      row.lastElementChild.style.color = '#fca5a5';
      notify(error.message || 'Erreur pendant l’envoi', 'error');
    }
  }
}

function isMobile() {
  return window.innerWidth <= 920;
}

function openUploadSheet() {
  els.uploadSheet.classList.remove('hidden');
  els.uploadSheet.setAttribute('aria-hidden', 'false');
}
function closeUploadSheet() {
  els.uploadSheet.classList.add('hidden');
  els.uploadSheet.setAttribute('aria-hidden', 'true');
}

function openMobileSheet(title, kicker, renderer) {
  if (!isMobile()) return;
  els.mobileSheetTitle.textContent = title;
  els.mobileSheetKicker.textContent = kicker;
  els.mobileSheet.classList.remove('hidden');
  els.mobileSheet.setAttribute('aria-hidden', 'false');
  renderer(els.mobileSheetBody);
  state._mobileRenderer = renderer;
  state._mobileTitle = title;
  state._mobileKicker = kicker;
}
function closeMobileSheet() {
  els.mobileSheet.classList.add('hidden');
  els.mobileSheet.setAttribute('aria-hidden', 'true');
}
function syncOpenedMobileSheet() {
  if (!els.mobileSheet.classList.contains('hidden') && typeof state._mobileRenderer === 'function') {
    openMobileSheet(state._mobileTitle, state._mobileKicker, state._mobileRenderer);
  }
}
function openMobilePlaylist() {
  openMobileSheet('Playlist', 'Bibliothèque musique', target => renderPlaylist(target, true));
}
function openMobileFx() {
  openMobileSheet('Administration FX', 'Ordre, position, volume', target => renderFxAdmin(target, true));
}

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-prev').addEventListener('click', () => {
  if (!state.playlist.length) return;
  const nextIndex = state.currentIndex <= 0 ? state.playlist.length - 1 : state.currentIndex - 1;
  loadTrack(nextIndex, state.isPlaying);
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (!state.playlist.length) return;
  const nextIndex = state.currentIndex >= state.playlist.length - 1 ? 0 : state.currentIndex + 1;
  loadTrack(nextIndex, state.isPlaying);
});
document.getElementById('btn-rewind').addEventListener('click', () => { audio.currentTime = 0; });
document.getElementById('btn-forward').addEventListener('click', () => {
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
});
document.getElementById('btn-loop').addEventListener('click', () => {
  state.isLooping = !state.isLooping;
  updateHeaderState();
});
document.getElementById('btn-stop-fx').addEventListener('click', () => stopFx());

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const progress = audio.currentTime / audio.duration;
  els.timeCurrent.textContent = fmt(audio.currentTime);
  els.timeTotal.textContent = fmt(audio.duration);
  els.waveformProgress.style.width = `${progress * 100}%`;
  els.seekHandle.style.left = `${progress * 100}%`;
  drawWaveform(progress);
});
audio.addEventListener('loadedmetadata', () => {
  els.timeTotal.textContent = fmt(audio.duration);
  els.trackDurationLabel.textContent = fmt(audio.duration);
});
audio.addEventListener('ended', async () => {
  state.isPlaying = false;
  updateHeaderState();
  if (state.isLooping) {
    audio.currentTime = 0;
    try {
      await audio.play();
      state.isPlaying = true;
    } catch {}
    updateHeaderState();
  } else if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length - 1) {
    loadTrack(state.currentIndex + 1, true);
  }
});

els.waveform.addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = els.waveform.getBoundingClientRect();
  const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  audio.currentTime = percent * audio.duration;
});
els.volume.addEventListener('input', e => {
  const value = parseFloat(e.target.value);
  audio.volume = value;
  els.volumeVal.textContent = `${Math.round(value * 100)}%`;
});
els.playlistSearch.addEventListener('input', e => {
  state.playlistSearch = e.target.value;
  renderPlaylist();
  if (isMobile() && state._mobileTitle === 'Playlist') openMobilePlaylist();
});
document.getElementById('btn-clear-search').addEventListener('click', () => {
  state.playlistSearch = '';
  els.playlistSearch.value = '';
  renderPlaylist();
  if (isMobile() && state._mobileTitle === 'Playlist') openMobilePlaylist();
});

document.getElementById('btn-open-upload').addEventListener('click', openUploadSheet);
document.getElementById('btn-close-upload').addEventListener('click', closeUploadSheet);
els.uploadSheet.addEventListener('click', e => {
  if (e.target === els.uploadSheet) closeUploadSheet();
});
document.querySelectorAll('[data-upload-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-upload-tab]').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    state.currentUploadTab = btn.dataset.uploadTab;
  });
});
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', e => {
  if (e.target.files?.length) handleFiles(e.target.files);
  e.target.value = '';
});
els.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', e => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

document.getElementById('btn-mobile-playlist').addEventListener('click', openMobilePlaylist);
document.getElementById('btn-mobile-fx').addEventListener('click', openMobileFx);
document.getElementById('btn-close-mobile-sheet').addEventListener('click', closeMobileSheet);
els.mobileSheet.addEventListener('click', e => {
  if (e.target === els.mobileSheet) closeMobileSheet();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeUploadSheet();
    closeMobileSheet();
  }
});

window.addEventListener('resize', () => {
  drawWaveform(audio.duration ? audio.currentTime / audio.duration : 0);
  if (!isMobile()) closeMobileSheet();
});

loadFiles();
updateHeaderState();
renderNowPlaying();
drawWaveform(0);
