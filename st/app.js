/**
 * 新幹線 Live Tracker — app.js
 *
 * Data sources:
 *   1. JR Central traininfo API (via CORS proxy)
 *      https://traininfo.jr-central.co.jp/shinkansen/var/train_info/train_info_{type}_{no}.json
 *   2. Station metadata — statically encoded from official JR Central station list
 *      (Tokaido Shinkansen — type 11)
 */

// ── CORS Proxy ─────────────────────────────────────
// Using allorigins as a reliable public CORS proxy
const CORS_PROXY = 'https://api.allorigins.win/get?url=';

// ── Train type map ─────────────────────────────────
// JR Central uses numeric codes for train types on the Tokaido Shinkansen
const TRAIN_TYPES = {
  11: { name: 'Nozomi',  ja: 'のぞみ', color: '#e8c832' },
  12: { name: 'Hikari',  ja: 'ひかり', color: '#4fa8f0' },
  13: { name: 'Kodama',  ja: 'こだま', color: '#4fcb8d' },
   1: { name: 'Nozomi',  ja: 'のぞみ', color: '#e8c832' },
   2: { name: 'Hikari',  ja: 'ひかり', color: '#4fa8f0' },
   3: { name: 'Kodama',  ja: 'こだま', color: '#4fcb8d' },
};

// ── Tokaido Shinkansen station master ─────────────
// Official station order (Tokyo → Shin-Osaka), with Japanese names,
// English names, and km from Tokyo (for reference).
// Station IDs match the station codes used in the JR Central API.
const TOKAIDO_STATIONS = [
  { id:  1, ja: '東京',       en: 'Tokyo',           km: 0 },
  { id:  2, ja: '品川',       en: 'Shinagawa',       km: 6.8 },
  { id:  3, ja: '新横浜',     en: 'Shin-Yokohama',   km: 28.8 },
  { id:  4, ja: '小田原',     en: 'Odawara',         km: 83.9 },
  { id:  5, ja: '熱海',       en: 'Atami',           km: 104.6 },
  { id:  6, ja: '三島',       en: 'Mishima',         km: 120.7 },
  { id:  7, ja: '新富士',     en: 'Shin-Fuji',       km: 146.2 },
  { id:  8, ja: '静岡',       en: 'Shizuoka',        km: 180.2 },
  { id:  9, ja: '掛川',       en: 'Kakegawa',        km: 229.3 },
  { id: 10, ja: '浜松',       en: 'Hamamatsu',       km: 257.1 },
  { id: 11, ja: '豊橋',       en: 'Toyohashi',       km: 293.6 },
  { id: 12, ja: '三河安城',   en: 'Mikawa-Anjo',     km: 325.3 },
  { id: 13, ja: '名古屋',     en: 'Nagoya',          km: 342.0 },
  { id: 14, ja: '岐阜羽島',   en: 'Gifu-Hashima',    km: 367.1 },
  { id: 15, ja: '米原',       en: 'Maibara',         km: 407.9 },
  { id: 16, ja: '京都',       en: 'Kyoto',           km: 476.3 },
  { id: 17, ja: '新大阪',     en: 'Shin-Osaka',      km: 515.4 },
];

// Station ID → object lookup
const STATION_BY_ID = Object.fromEntries(TOKAIDO_STATIONS.map(s => [s.id, s]));

// ── DOM refs ───────────────────────────────────────
const trainTypeSelect  = document.getElementById('train-type');
const trainNoInput     = document.getElementById('train-no');
const fetchBtn         = document.getElementById('fetch-btn');
const trainHeader      = document.getElementById('train-header');
const errorBox         = document.getElementById('error-box');
const errorMsg         = document.getElementById('error-msg');
const loading          = document.getElementById('loading');
const routeSection     = document.getElementById('route-section');
const stationsList     = document.getElementById('stations-list');
const routeLine        = document.getElementById('route-line');

// meta fields
const trainTypeLabel   = document.getElementById('train-type-label');
const trainNumberLabel = document.getElementById('train-number-label');
const metaDirection    = document.getElementById('meta-direction');
const metaStatus       = document.getElementById('meta-status');
const metaUpdated      = document.getElementById('meta-updated');

// ── State ──────────────────────────────────────────
let currentType = 11;
let currentNo   = 754;

// ── Helpers ────────────────────────────────────────
function showEl(el) { el.classList.remove('hidden'); }
function hideEl(el) { el.classList.add('hidden'); }

function showError(msg) {
  hideEl(loading);
  hideEl(routeSection);
  hideEl(trainHeader);
  errorMsg.textContent = msg;
  showEl(errorBox);
}

function formatTime(raw) {
  // raw may be "HHMM" or "HH:MM" or "HHMMss"
  if (!raw) return null;
  const s = String(raw).replace(/:/g, '');
  if (s.length >= 4) {
    return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  }
  return raw;
}

// ── Build API URL ──────────────────────────────────
function buildApiUrl(type, no) {
  const ts = Date.now();
  const base = `https://traininfo.jr-central.co.jp/shinkansen/var/train_info/train_info_${type}_${no}.json?timestamp=${ts}`;
  return `${CORS_PROXY}${encodeURIComponent(base)}`;
}

// ── Fetch & parse ──────────────────────────────────
async function fetchTrainData(type, no) {
  const url = buildApiUrl(type, no);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from proxy`);
  const wrapper = await resp.json();

  let raw;
  // allorigins wraps in { contents: "..." }
  if (wrapper.contents) {
    raw = JSON.parse(wrapper.contents);
  } else {
    raw = wrapper;
  }
  return raw;
}

// ── Determine station states ───────────────────────
/**
 * JR Central API returns a `list` array. Each element represents a station
 * with fields like:
 *   station_no      — numeric station index (1-17 for Tokaido)
 *   arr_time        — arrival time (or departure for terminus)
 *   dep_time        — departure time
 *   stop_flag       — "1" = stops, "0" = passes through
 *   pass_flag       — "1" = already passed
 *   now_flag        — "1" = currently at or between this station
 *
 * The structure can vary slightly between firmware versions, so we
 * do our best to parse what's available.
 */
function parseStations(data) {
  // Try to locate the station list in various known structures
  let list = null;

  if (Array.isArray(data)) {
    list = data;
  } else if (data.list && Array.isArray(data.list)) {
    list = data.list;
  } else if (data.train && data.train.list) {
    list = data.train.list;
  } else if (data.trainInfo && data.trainInfo.list) {
    list = data.trainInfo.list;
  }

  // Try to find a property that looks like a station list
  if (!list) {
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0 &&
          (data[key][0].station_no !== undefined || data[key][0].no !== undefined)) {
        list = data[key];
        break;
      }
    }
  }

  return list;
}

function parseDirection(data) {
  // direction: 1 = Tokyo→Osaka (Kudari/Down), 2 = Osaka→Tokyo (Nobori/Up)
  const d = data.direction || data.train?.direction || data.trainInfo?.direction;
  if (d == 1 || d === 'down')   return '↓  Tokyo → Shin-Osaka';
  if (d == 2 || d === 'up')     return '↑  Shin-Osaka → Tokyo';
  return '—';
}

function parseStatus(data) {
  const s = data.status || data.train?.status || data.trainInfo?.status || '';
  if (!s || s === '0' || s === 0) return 'On time';
  if (s === '1' || s === 1) return 'Delayed';
  return String(s);
}

// ── Render ─────────────────────────────────────────
function renderRoute(stationList, typeInfo) {
  stationsList.innerHTML = '';

  // Update line gradient based on train type
  routeLine.style.background = `linear-gradient(to bottom, var(--muted), ${typeInfo.color}88)`;

  // Find the current/next station index
  let currentIdx = -1;
  stationList.forEach((s, i) => {
    if (s.now_flag == '1' || s.now_flag === 1 || s.now_flag === true) {
      currentIdx = i;
    }
  });

  // If no now_flag, derive from pass_flags: current = first non-passed
  if (currentIdx === -1) {
    currentIdx = stationList.findIndex(s =>
      !(s.pass_flag == '1' || s.pass_flag === 1 || s.pass_flag === true)
    );
  }

  stationList.forEach((s, i) => {
    const stationNo = parseInt(s.station_no ?? s.no ?? (i + 1));
    const master    = STATION_BY_ID[stationNo] || { ja: `駅 ${stationNo}`, en: `Station ${stationNo}` };

    const stops   = !(s.stop_flag == '0' || s.stop_flag === 0 || s.stop_flag === false);
    const passed  = (s.pass_flag == '1' || s.pass_flag === 1 || s.pass_flag === true);
    const isCurr  = (i === currentIdx);

    let state;
    if (!stops) {
      state = 'skip';
    } else if (passed && !isCurr) {
      state = 'passed';
    } else if (isCurr) {
      state = 'current';
    } else {
      state = 'upcoming';
    }

    const arrTime = formatTime(s.arr_time ?? s.arrive_time ?? s.arrival_time);
    const depTime = formatTime(s.dep_time ?? s.departure_time ?? s.depart_time);

    const row = document.createElement('div');
    row.className = `station-row state-${state}`;
    row.title = `${master.en} (${master.ja})`;

    row.innerHTML = `
      <div class="station-dot-wrap">
        <div class="station-dot"></div>
      </div>
      <div class="station-info">
        <span class="station-name-ja">${master.ja}</span>
        <span class="station-name-en">${master.en}</span>
        ${isCurr ? '<span class="current-badge">▶ Now</span>' : ''}
      </div>
      <div class="station-times">
        ${arrTime ? `<span class="station-time arr"><span class="time-label">Arr</span>${arrTime}</span>` : ''}
        ${depTime ? `<span class="station-time dep"><span class="time-label">Dep</span>${depTime}</span>` : ''}
      </div>
    `;

    stationsList.appendChild(row);
  });
}

// ── Main fetch flow ────────────────────────────────
async function trackTrain() {
  const type = parseInt(trainTypeSelect.value);
  const no   = parseInt(trainNoInput.value);

  if (isNaN(no) || no < 1) {
    showError('Please enter a valid train number.');
    return;
  }

  currentType = type;
  currentNo   = no;

  hideEl(errorBox);
  hideEl(trainHeader);
  hideEl(routeSection);
  showEl(loading);
  fetchBtn.disabled = true;

  try {
    const data = await fetchTrainData(type, no);

    // Resolve train type info — prefer API-returned type, fall back to selected
    const apiType  = data.train_type ?? data.trainType ?? data.type ?? type;
    const typeInfo = TRAIN_TYPES[apiType] || TRAIN_TYPES[type] || { name: 'Train', ja: '列車', color: '#dce1ec' };

    // Populate meta
    trainTypeLabel.textContent   = `${typeInfo.ja} ${typeInfo.name}`;
    trainTypeLabel.style.color   = typeInfo.color;
    trainTypeLabel.style.borderColor = typeInfo.color + '55';
    trainTypeLabel.style.background  = typeInfo.color + '18';
    trainNumberLabel.textContent = `No. ${no}`;
    metaDirection.textContent    = parseDirection(data);
    metaStatus.textContent       = parseStatus(data);
    metaUpdated.textContent      = new Date().toLocaleTimeString('en-GB');

    // Parse station list
    const stationList = parseStations(data);

    hideEl(loading);

    if (!stationList || stationList.length === 0) {
      // No structured station list returned — display static fallback
      // with info we know from the train type
      renderStaticFallback(typeInfo, no, data);
    } else {
      renderRoute(stationList, typeInfo);
      showEl(routeSection);
    }

    showEl(trainHeader);

  } catch (err) {
    console.error(err);
    showError(`Could not load data for train ${no} (type ${type}). ${err.message || 'Check the train number and try again.'}`);
  } finally {
    fetchBtn.disabled = false;
  }
}

// ── Static fallback ────────────────────────────────
// When the API doesn't return a structured list, we render the full
// Tokaido line with stop patterns derived from known service patterns.
function renderStaticFallback(typeInfo, no, data) {
  // Derive stop pattern from train number and type
  // Even = Kudari (down, Tokyo→Osaka), Odd = Nobori (up, Osaka→Tokyo)
  const isDown = no % 2 === 0;

  // Nozomi: stops at Tokyo, Shinagawa, Shin-Yokohama, Nagoya, Kyoto, Shin-Osaka
  // Hikari: + some intermediate
  // Kodama: all stations
  const nozomiStops  = new Set([1, 2, 3, 13, 16, 17]);
  const hikariStops  = new Set([1, 2, 3, 8, 10, 13, 16, 17]);

  metaDirection.textContent = isDown ? '↓  Tokyo → Shin-Osaka' : '↑  Shin-Osaka → Tokyo';

  const stations = isDown ? TOKAIDO_STATIONS : [...TOKAIDO_STATIONS].reverse();

  const list = stations.map(st => {
    let stops;
    if (typeInfo.name === 'Nozomi') stops = nozomiStops.has(st.id);
    else if (typeInfo.name === 'Hikari') stops = hikariStops.has(st.id);
    else stops = true; // Kodama stops all

    return {
      station_no: st.id,
      stop_flag:  stops ? '1' : '0',
      pass_flag:  '0',
      now_flag:   '0',
    };
  });

  renderRoute(list, typeInfo);
  showEl(routeSection);

  // Append a notice
  const notice = document.createElement('p');
  notice.style.cssText = 'margin-top:1.5rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--muted);text-align:center;';
  notice.textContent = '⚠ Live position unavailable — showing estimated stop pattern';
  routeSection.appendChild(notice);
}

// ── Init ───────────────────────────────────────────
fetchBtn.addEventListener('click', trackTrain);

trainNoInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') trackTrain();
});

// Auto-load on startup
trackTrain();