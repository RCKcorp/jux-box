// ── State ──
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isLooping: false,
  fxSounds: [],
  currentUploadTab: 'music',
};

const audio = document.getElementById('audio-player');

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
  if (!isFinite(s)) return '0:00';
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
      // placeholder random-ish bars
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
  const max = Math.max(...data);
  return data.map(v => v / max);
}

function analyzeAudio(url) {
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => {
      const ac = new AudioContext();
      return ac.decodeAudioData(buf);
    })
    .then(audioBuf => {
      drawWaveform(generateWaveform(audioBuf));
    })
    .catch(() => redrawWaveform(0));
}

// ── Playback ──
function loadTrack(index, autoPlay = true) {
  if (index < 0 || index >= state.playlist.length) return;
  state.currentIndex = index;
  const track = state.playlist[index];

  audio.src = track.url;
  audio.load();

  elTrackName.textContent = stripExt(track.name);
  elTrackIndex.textContent = `${index + 1} / ${state.playlist.length}`;
  elTimeTotal.textContent = '0:00';
  elTimeCurrent.textContent = '0:00';

  waveformData = [];
  redrawWaveform(0);
  analyzeAudio(track.url);

  renderPlaylist();

  if (autoPlay) {
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayUI();
    }).catch(() => {});
  }
}

function togglePlay() {
  if (state.currentIndex === -1 && state.playlist.length > 0) {
    loadTrack(0, true);
    return;
  }

  if (state.isPlaying) {
    audio.pause();
    state.isPlaying = false;
  } else {
    audio.play().then(() => { state.isPlaying = true; updatePlayUI(); }).catch(() => {});
  }
  updatePlayUI();
}

function updatePlayUI() {
  elPlayIcon.classList.toggle('hidden', state.isPlaying);
  elPauseIcon.classList.toggle('hidden', !state.isPlaying);
  elVinyl.classList.toggle('playing', state.isPlaying);
}

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

    // Load duration
    const dur = li.querySelector('.track-dur');
    const tmp = new Audio();
    tmp.src = t.url;
    tmp.addEventListener('loadedmetadata', () => {
      dur.textContent = fmt(tmp.duration);
    });
  });
}

function removeTrack(index) {
  const track = state.playlist[index];
  fetch(`/api/files/music/${encodeURIComponent(track.name)}`, { method: 'DELETE' })
    .then(() => {
      state.playlist.splice(index, 1);
      if (state.currentIndex === index) {
        audio.pause();
        state.isPlaying = false;
        state.currentIndex = -1;
        elTrackName.textContent = 'Aucune piste';
        elTrackIndex.textContent = '—';
        updatePlayUI();
        if (state.playlist.length > 0) loadTrack(Math.min(index, state.playlist.length - 1), false);
      } else if (state.currentIndex > index) {
        state.currentIndex--;
      }
      renderPlaylist();
    })
    .catch(() => notify('Erreur lors de la suppression', 'error'));
}

// ── FX Sound System ──
let fxAudio = null;
let playingFxIndex = -1;

function fxDefaults(f) {
  if (f.volume === undefined) f.volume = 1;
  if (f.position === undefined) f.position = 'bottom';
  return f;
}

function playFxSound(index) {
  if (fxAudio) { fxAudio.pause(); fxAudio.currentTime = 0; fxAudio = null; }
  playingFxIndex = index;
  const fx = state.fxSounds[index];
  fxAudio = new Audio(fx.url);
  fxAudio.volume = fx.volume;
  fxAudio.play().catch(() => {});
  fxAudio.addEventListener('ended', () => {
    playingFxIndex = -1; fxAudio = null;
    renderFxList(); renderFxStrips();
  });
  renderFxList(); renderFxStrips();
}

function stopFx() {
  if (fxAudio) { fxAudio.pause(); fxAudio.currentTime = 0; fxAudio = null; }
  playingFxIndex = -1;
  renderFxList(); renderFxStrips();
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

function setFxVolume(index, vol) {
  state.fxSounds[index].volume = vol;
  if (playingFxIndex === index && fxAudio) fxAudio.volume = vol;
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
      <div class="fx-item-vol">
        <span class="fx-vol-label">Vol</span>
        <input type="range" class="slider fx-vol-slider" min="0" max="1" step="0.01" value="${f.volume}">
        <span class="fx-vol-val">${Math.round(f.volume * 100)}%</span>
      </div>
    `;
    div.querySelectorAll('.fx-move-btn').forEach(btn => {
      btn.addEventListener('click', () => moveFx(i, parseInt(btn.dataset.dir)));
    });
    div.querySelectorAll('.fx-pos-btn').forEach(btn => {
      btn.addEventListener('click', () => setFxPosition(i, btn.dataset.pos));
    });
    div.querySelector('.btn-remove').addEventListener('click', () => removeFxSound(i));
    const volSlider = div.querySelector('.fx-vol-slider');
    const volVal = div.querySelector('.fx-vol-val');
    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      volVal.textContent = Math.round(v * 100) + '%';
      setFxVolume(i, v);
    });
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
        <div class="fx-deck-vol-wrap" title="Volume">
          <input type="range" class="fx-deck-vol" min="0" max="1" step="0.01" value="${f.volume}">
        </div>
      `;
      btn.addEventListener('click', (e) => {
        if (e.target.classList.contains('fx-deck-vol')) return;
        playFxSound(realIndex);
      });
      const volSlider = btn.querySelector('.fx-deck-vol');
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        setFxVolume(realIndex, parseFloat(e.target.value));
      });
      volSlider.addEventListener('click', e => e.stopPropagation());
      strip.appendChild(btn);
    });
  });
}

function removeFxSound(index) {
  const fx = state.fxSounds[index];
  fetch(`/api/files/fx/${encodeURIComponent(fx.name)}`, { method: 'DELETE' })
    .then(() => {
      if (playingFxIndex === index) stopFx();
      else if (playingFxIndex > index) playingFxIndex--;
      state.fxSounds.splice(index, 1);
      renderFxList(); renderFxStrips();
    })
    .catch(() => notify('Erreur lors de la suppression', 'error'));
}

// ── Load files from server ──
function loadFiles() {
  Promise.all([
    fetch('/api/files/music').then(r => r.json()),
    fetch('/api/files/fx').then(r => r.json()),
  ]).then(([music, fx]) => {
    state.playlist = music;
    state.fxSounds = fx.map(fxDefaults);
    renderPlaylist();
    renderFxList();
    renderFxStrips();
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
      if (type === 'music') {
        if (!state.playlist.find(t => t.name === result.name)) {
          state.playlist.push(result);
          renderPlaylist();
        }
      } else {
        if (!state.fxSounds.find(f => f.name === result.name)) {
          state.fxSounds.push(fxDefaults(result));
          renderFxList(); renderFxStrips();
        }
      }
      notify(`"${stripExt(result.name)}" ajouté`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  prog.classList.add('hidden');
}

// ── Event listeners ──

// Play/Pause
document.getElementById('btn-play').addEventListener('click', togglePlay);

// Prev
document.getElementById('btn-prev').addEventListener('click', () => {
  if (state.playlist.length === 0) return;
  const idx = state.currentIndex <= 0 ? state.playlist.length - 1 : state.currentIndex - 1;
  loadTrack(idx, state.isPlaying);
});

// Next
document.getElementById('btn-next').addEventListener('click', () => {
  if (state.playlist.length === 0) return;
  const idx = (state.currentIndex + 1) % state.playlist.length;
  loadTrack(idx, state.isPlaying);
});

// Rewind (back to start)
document.getElementById('btn-rewind').addEventListener('click', () => {
  audio.currentTime = 0;
});

// Forward +10s
document.getElementById('btn-forward').addEventListener('click', () => {
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
});

// Audio events
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const p = audio.currentTime / audio.duration;
  elTimeCurrent.textContent = fmt(audio.currentTime);
  elWaveformProgress.style.width = (p * 100) + '%';
  elSeekHandle.style.left = (p * 100) + '%';
  redrawWaveform(p);
});

audio.addEventListener('loadedmetadata', () => {
  elTimeTotal.textContent = fmt(audio.duration);
});

audio.addEventListener('ended', () => {
  state.isPlaying = false;
  updatePlayUI();
  if (state.isLooping) {
    audio.currentTime = 0;
    audio.play().then(() => { state.isPlaying = true; updatePlayUI(); });
  } else if (state.currentIndex < state.playlist.length - 1) {
    loadTrack(state.currentIndex + 1, true);
  }
});

// Waveform seek
const waveformEl = document.getElementById('waveform');
waveformEl.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = waveformEl.getBoundingClientRect();
  const p = (e.clientX - rect.left) / rect.width;
  audio.currentTime = p * audio.duration;
});

// Volume
document.getElementById('volume').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  audio.volume = val;
  document.getElementById('volume-val').textContent = Math.round(val * 100) + '%';
});

// Pitch
document.getElementById('pitch').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  audio.playbackRate = val;
  document.getElementById('pitch-val').textContent = val.toFixed(2) + 'x';
  // Update slider gradient
  const pct = ((val - 0.5) / 1.5) * 100;
  e.target.style.background = `linear-gradient(to right, #2a2a40 0%, #2a2a40 ${pct}%, #7c3aed ${pct}%, #7c3aed 100%)`;
});

// Loop
document.getElementById('btn-loop').addEventListener('click', () => {
  state.isLooping = !state.isLooping;
  document.getElementById('btn-loop').textContent = state.isLooping ? 'ON' : 'OFF';
  document.getElementById('btn-loop').classList.toggle('active', state.isLooping);
});

// Upload toggle
document.getElementById('btn-upload-toggle').addEventListener('click', () => {
  document.getElementById('upload-panel').classList.toggle('hidden');
});
document.getElementById('btn-close-upload').addEventListener('click', () => {
  document.getElementById('upload-panel').classList.add('hidden');
});

// Upload tabs
document.querySelectorAll('.upload-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.currentUploadTab = tab.dataset.tab;
  });
});

// File input
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(Array.from(e.target.files));
  e.target.value = '';
});

// Click on drop zone opens file picker
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
    case 'ArrowRight': audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
    case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); break;
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

// Resize waveform on window resize
window.addEventListener('resize', () => {
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  redrawWaveform(p);
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

// Init mobile panel
if (isMobile()) setMobilePanel('deck');

window.addEventListener('resize', () => {
  if (isMobile()) {
    // ensure one panel is active
    const hasActive = document.querySelector('.mobile-active');
    if (!hasActive) setMobilePanel('deck');
  }
});

// ── Init ──
loadFiles();
redrawWaveform(0);
