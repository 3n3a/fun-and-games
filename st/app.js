/**
 * 新幹線 Live Tracker — app.js
 *
 * All configuration is fetched dynamically from JR Central's public endpoints:
 *   • common_en.json   → station master, train type names, bound labels
 *   • train_location_info.json → live positions of every running train
 *   • service_status.json      → service disruption alerts
 *   • train_info_{type}_{no}.json → per-train stop schedule (via CORS proxy)
 *
 */

// ─────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────
const BASE   = 'https://traininfo.jr-central.co.jp/shinkansen';
const PROXY_LIST = [ 'https://api.cors.lol/?url=', 'https://api.allorigins.win/get?url=' ];
const PROXY  = PROXY_LIST[1]; // TODO: support others

// Train-type → CSS class & display colour (matches common.Const.TRAIN_CLASS)
// Values are supplemented by what common_en.json returns at runtime
const TYPE_META = {
  '1':  { cls: 'type-hikari',  color: '#4fa8f0' },
  '2':  { cls: 'type-kodama',  color: '#3ecf7a' },
  '6':  { cls: 'type-nozomi',  color: '#e8c832' },
  '10': { cls: 'type-mizuho',  color: '#a78bfa' },
  '11': { cls: 'type-sakura',  color: '#f07ab0' },
  '12': { cls: 'type-tsubame', color: '#f09a4f' },
};

// ─────────────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────────────
let CONFIG       = null;   // parsed common_en.json .constant
let LOCATION     = null;   // latest train_location_info
let selectedTrain = null;  // { trainNumber, train (type code), bound }
let refreshTimer  = null;

// ─────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────
const boundSelect    = document.getElementById('bound-select');
const trainSelect    = document.getElementById('train-select');
const fetchBtn       = document.getElementById('fetch-btn');
const refreshBtn     = document.getElementById('refresh-btn');
const btnSpin        = document.getElementById('btn-spin');
const statusBar      = document.getElementById('status-bar');
const statusText     = document.getElementById('status-text');
const liveList       = document.getElementById('live-list');
const liveCount      = document.getElementById('live-count');
const trainHeader    = document.getElementById('train-header');
const trainTypeLabel = document.getElementById('train-type-label');
const trainNumLabel  = document.getElementById('train-number-label');
const delayBadge     = document.getElementById('delay-badge');
const metaDirection  = document.getElementById('meta-direction');
const metaStatus     = document.getElementById('meta-status');
const metaUpdated    = document.getElementById('meta-updated');
const errorBox       = document.getElementById('error-box');
const errorMsg       = document.getElementById('error-msg');
const loadingEl      = document.getElementById('loading');
const emptyState     = document.getElementById('empty-state');
const routeSection   = document.getElementById('route-section');
const stationsList   = document.getElementById('stations-list');
const routeLine      = document.getElementById('route-line');

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function showEl(el)  { el.classList.remove('hidden'); }
function hideEl(el)  { el.classList.add('hidden'); }

async function proxyFetch(url) {
  const r = await fetch(PROXY + encodeURIComponent(url));
  if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
  const w = await r.json();
  return JSON.parse(w.contents);
}

async function directFetch(url) {
  // For same-origin style calls via proxy (all JR Central endpoints need proxy)
  return proxyFetch(url);
}

function ts() { return Date.now(); }
function jrcUrl(path) { return `${BASE}/${path}?timestamp=${ts()}`; }

function formatTime(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/:/g, '');
  if (s.length >= 4) return `${s.slice(0,2)}:${s.slice(2,4)}`;
  return raw;
}

function typeMeta(code) {
  return TYPE_META[String(code)] || { cls: '', color: '#dce1ec' };
}

function typeName(code) {
  if (!CONFIG) return `Type ${code}`;
  return CONFIG.train[String(code)] || `Type ${code}`;
}

function stationName(id) {
  if (!CONFIG) return `Stn ${id}`;
  return CONFIG.station[String(id)] || `Stn ${id}`;
}

function boundLabel(boundCode) {
  if (!CONFIG) return boundCode == 2 ? 'West bound' : 'East bound';
  return CONFIG.boundLong[String(boundCode)] || CONFIG.bound[String(boundCode)] || `Bound ${boundCode}`;
}

// Collect all trains from location data for a given bound
function getAllTrains(locationData, bound) {
  const trains = [];
  const boundKey = String(bound);
  const data = locationData.trainLocationInfo;
  if (!data) return trains;

  // At-station trains
  const atBound = data.atStation?.bounds?.[boundKey] || [];
  for (const entry of atBound) {
    for (const t of (entry.trains || [])) {
      trains.push({
        trainNumber: t.trainNumber,
        train: String(t.train),
        delay: t.delay || 0,
        bound,
        location: `At ${stationName(entry.station)}`,
        stationId: entry.station,
        between: false,
        sot: t.sot,
      });
    }
  }

  // Between-station trains
  const bwBound = data.betweenStation?.bounds?.[boundKey] || [];
  for (const entry of bwBound) {
    for (const t of (entry.trains || [])) {
      trains.push({
        trainNumber: t.trainNumber,
        train: String(t.train),
        delay: t.delay || 0,
        bound,
        location: `→ ${stationName(entry.station)}`,
        stationId: entry.station,
        between: true,
        sot: false,
      });
    }
  }

  // Sort by station order then train number
  const order = CONFIG?.stationOrder || [];
  trains.sort((a, b) => {
    const ai = order.indexOf(String(a.stationId));
    const bi = order.indexOf(String(b.stationId));
    if (ai !== bi) return ai - bi;
    return parseInt(a.trainNumber) - parseInt(b.trainNumber);
  });

  return trains;
}

// ─────────────────────────────────────────────────────
// Load config + initial location data
// ─────────────────────────────────────────────────────
async function init() {
  try {
    // Load config and live location in parallel
    const [cfg, loc, svc] = await Promise.all([
      directFetch(jrcUrl('common/data/common_en.json')),
      directFetch(jrcUrl('var/train_info/train_location_info.json')),
      directFetch(jrcUrl('var/train_info/service_status.json')),
    ]);

    CONFIG   = cfg.constant;
    LOCATION = loc;

    handleServiceStatus(svc);
    populateLiveList(loc);
    enablePicker();
    scheduleAutoRefresh();

  } catch (err) {
    console.error('Init failed', err);
    liveList.innerHTML = `<div class="live-loading" style="color:var(--red)">⚠ Failed to load live data.<br/>Check network / CORS proxy.</div>`;
  }
}

// ─────────────────────────────────────────────────────
// Service status bar
// ─────────────────────────────────────────────────────
function handleServiceStatus(svc) {
  const info = svc?.serviceStatusInfo;
  if (!info || !info.serviceStatusIsEnabled || !info.data?.length) {
    statusBar.className = 'status-bar ok hidden';
    return;
  }
  // Show first status entry
  const d = info.data[0];
  const screen = {}; // We don't have ti01f loaded; just show raw cause code
  statusText.textContent = `⚠ Service disruption · ${d.area || ''} ${d.status || ''}`;
  statusBar.className = 'status-bar';
  showEl(statusBar);
}

// ─────────────────────────────────────────────────────
// Populate live side panel
// ─────────────────────────────────────────────────────
function populateLiveList(loc) {
  liveList.innerHTML = '';
  let totalCount = 0;

  const bounds = ['2', '1']; // West-bound first, East-bound second

  for (const b of bounds) {
    const trains = getAllTrains(loc, b);
    if (!trains.length) continue;
    totalCount += trains.length;

    // Section header
    const hdr = document.createElement('div');
    hdr.className = 'bound-group-header';
    hdr.textContent = boundLabel(b);
    liveList.appendChild(hdr);

    for (const t of trains) {
      const meta = typeMeta(t.train);
      const name = typeName(t.train);

      const row = document.createElement('div');
      row.className = `live-train-row${t.between ? ' between' : ''}`;
      row.dataset.trainNumber = t.trainNumber;
      row.dataset.trainType   = t.train;
      row.dataset.bound       = b;

      row.innerHTML = `
        <div class="live-train-dot" style="background:${meta.color}"></div>
        <div class="live-train-info">
          <div class="live-train-type" style="color:${meta.color}">${name}</div>
          <div class="live-train-num">No. ${t.trainNumber}</div>
          <div class="live-train-loc">${t.location}</div>
        </div>
        ${t.delay > 0 ? '<div class="live-delay-dot" title="Delayed"></div>' : ''}
      `;

      row.addEventListener('click', () => {
        document.querySelectorAll('.live-train-row.active').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        selectTrain(t.trainNumber, t.train, b, t.delay);
      });

      liveList.appendChild(row);
    }
  }

  liveCount.textContent = totalCount;
  populateDropdown(loc);
}

// ─────────────────────────────────────────────────────
// Populate header dropdown (filtered by bound)
// ─────────────────────────────────────────────────────
function populateDropdown(loc) {
  const bound  = boundSelect.value;
  const trains = getAllTrains(loc, bound);

  trainSelect.innerHTML = '';
  if (!trains.length) {
    trainSelect.innerHTML = '<option value="">No trains found</option>';
    fetchBtn.disabled = true;
    return;
  }

  for (const t of trains) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ trainNumber: t.trainNumber, train: t.train, delay: t.delay });
    opt.textContent = `${typeName(t.train)} ${t.trainNumber} — ${t.location}`;
    trainSelect.appendChild(opt);
  }

  trainSelect.disabled = false;
  fetchBtn.disabled    = false;
}

function enablePicker() {
  boundSelect.addEventListener('change', () => populateDropdown(LOCATION));
}

// ─────────────────────────────────────────────────────
// Auto-refresh every 60s
// ─────────────────────────────────────────────────────
function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshLocation, 60_000);
}

async function refreshLocation() {
  try {
    const loc = await directFetch(jrcUrl('var/train_info/train_location_info.json'));
    LOCATION = loc;
    populateLiveList(loc);
    // Re-highlight active train if any
    if (selectedTrain) {
      const activeRow = liveList.querySelector(
        `.live-train-row[data-train-number="${selectedTrain.trainNumber}"]`
      );
      if (activeRow) activeRow.classList.add('active');
    }
  } catch (e) {
    console.warn('Location refresh failed', e);
  }
}

// ─────────────────────────────────────────────────────
// Select + track a train
// ─────────────────────────────────────────────────────
async function selectTrain(trainNumber, trainType, bound, delay = 0) {
  selectedTrain = { trainNumber, train: trainType, bound, delay };

  hideEl(errorBox);
  hideEl(emptyState);
  hideEl(routeSection);
  showEl(loadingEl);
  hideEl(trainHeader);

  btnSpin.classList.add('spinning');

  try {
    const url = jrcUrl(`var/train_info/train_info_${trainType}_${trainNumber}.json`);
    const data = await directFetch(url);

    hideEl(loadingEl);
    renderTrainMeta(data, trainNumber, trainType, bound, delay);
    renderRoute(data, trainType);
    showEl(routeSection);
    showEl(trainHeader);

  } catch (err) {
    console.error('Train fetch failed', err);
    hideEl(loadingEl);
    showEl(emptyState);
    errorMsg.textContent = `Could not load data for train ${trainNumber}. ${err.message || ''}`;
    showEl(errorBox);
  } finally {
    btnSpin.classList.remove('spinning');
    fetchBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────
// Render train meta header
// ─────────────────────────────────────────────────────
function renderTrainMeta(data, trainNumber, trainType, bound, delay) {
  const meta = typeMeta(trainType);
  const name = typeName(trainType);

  trainTypeLabel.textContent = name;
  trainTypeLabel.className   = `type-label ${meta.cls}`;
  trainNumLabel.textContent  = `No. ${trainNumber}`;

  // Direction from API or infer from train number parity
  const apiDir = data?.trainInfo?.bound ?? data?.bound;
  const dirCode = apiDir || (parseInt(trainNumber) % 2 === 0 ? 2 : 1);
  metaDirection.textContent = boundLabel(dirCode);

  // Delay
  const delayMin = delay || data?.trainInfo?.delay || data?.delay || 0;
  if (delayMin > 0) {
    delayBadge.textContent = `+${delayMin} min`;
    showEl(delayBadge);
    metaStatus.textContent = `Delayed +${delayMin} min`;
    metaStatus.style.color = 'var(--red)';
  } else {
    hideEl(delayBadge);
    metaStatus.textContent = 'On time';
    metaStatus.style.color = 'var(--green)';
  }

  metaUpdated.textContent = new Date().toLocaleTimeString('en-GB');
}

// ─────────────────────────────────────────────────────
// Render route line
// ─────────────────────────────────────────────────────
function renderRoute(data, trainType) {
  stationsList.innerHTML = '';

  const meta = typeMeta(trainType);

  // Update line colour
  routeLine.style.background =
    `linear-gradient(to bottom, var(--muted) 0%, ${meta.color}88 100%)`;

  // Extract station list from various possible response shapes
  const stationList = extractStationList(data);
  if (!stationList || stationList.length === 0) {
    renderLocationFallback(trainType);
    return;
  }

  // Detect current position
  let currentIdx = stationList.findIndex(s =>
    s.now_flag == 1 || s.now_flag === true || s.now_flag === '1'
  );
  if (currentIdx === -1) {
    currentIdx = stationList.findIndex(s =>
      !(s.pass_flag == 1 || s.pass_flag === true || s.pass_flag === '1')
    );
  }

  for (let i = 0; i < stationList.length; i++) {
    const s      = stationList[i];
    const stnId  = String(s.station_no ?? s.stationNo ?? s.id ?? i + 1);
    const enName = stationName(stnId);

    const stops   = !(s.stop_flag == 0 || s.stop_flag === false || s.stop_flag === '0');
    const passed  = (s.pass_flag == 1 || s.pass_flag === true || s.pass_flag === '1');
    const isCurr  = (i === currentIdx);

    let state;
    if (!stops)          state = 'skip';
    else if (isCurr)     state = 'current';
    else if (passed)     state = 'passed';
    else                 state = 'upcoming';

    const arrTime = formatTime(s.arr_time ?? s.arrTime ?? s.arrive_time);
    const depTime = formatTime(s.dep_time ?? s.depTime ?? s.departure_time);

    // Platform from trackNo in config if available
    const track = s.track_no ?? s.trackNo ?? null;

    const row = document.createElement('div');
    row.className = `station-row state-${state}`;

    row.innerHTML = `
      <div class="station-dot-wrap">
        <div class="station-dot"></div>
      </div>
      <div class="station-info">
        <span class="station-name-ja">${enName}</span>
        <span class="station-name-en">STN ${stnId}</span>
        ${isCurr ? '<span class="current-badge">▶ Now</span>' : ''}
        ${track != null ? `<span class="platform-badge">Track ${track}</span>` : ''}
      </div>
      <div class="station-times">
        ${arrTime ? `<span class="station-time arr"><span class="time-label">Arr</span>${arrTime}</span>` : ''}
        ${depTime ? `<span class="station-time dep"><span class="time-label">Dep</span>${depTime}</span>` : ''}
      </div>
    `;

    stationsList.appendChild(row);
  }
}

// ─────────────────────────────────────────────────────
// Fallback: render from location data (if train_info returns no list)
// Uses stationOrder from config + current location from LOCATION data
// ─────────────────────────────────────────────────────
function renderLocationFallback(trainType) {
  if (!CONFIG || !selectedTrain) return;

  const stationOrder = CONFIG.stationOrder || [];
  const bound        = String(selectedTrain.bound);
  const ordered      = bound === '2' ? stationOrder : [...stationOrder].reverse();

  // Find where this train is in the location data
  const locData = LOCATION?.trainLocationInfo;
  let currentStnId = null;
  let isBetween = false;

  for (const section of [locData?.atStation, locData?.betweenStation]) {
    const entries = section?.bounds?.[bound] || [];
    for (const entry of entries) {
      for (const t of (entry.trains || [])) {
        if (String(t.trainNumber) === String(selectedTrain.trainNumber)) {
          currentStnId = String(entry.station);
          isBetween    = section === locData?.betweenStation;
        }
      }
    }
  }

  // Commercial train stop patterns (from config)
  const commercialTypes = CONFIG.commercialTrains || [];

  for (const stnId of ordered) {
    const enName = stationName(stnId);
    const stnIdx = ordered.indexOf(stnId);
    const currIdx = ordered.indexOf(currentStnId);

    const passed  = currIdx >= 0 && stnIdx < currIdx;
    const isCurr  = stnId === currentStnId && !isBetween;
    const isBefore = isBetween && stnIdx === currIdx; // train is approaching next

    let state = 'upcoming';
    if (isCurr)         state = 'current';
    else if (isBefore)  state = 'current';  // approaching
    else if (passed)    state = 'passed';

    const row = document.createElement('div');
    row.className = `station-row state-${state}`;
    row.innerHTML = `
      <div class="station-dot-wrap"><div class="station-dot"></div></div>
      <div class="station-info">
        <span class="station-name-ja">${enName}</span>
        <span class="station-name-en">STN ${stnId}</span>
        ${isCurr ? '<span class="current-badge">▶ Now</span>' : ''}
        ${isBetween && stnIdx === currIdx + 1 ? '<span class="current-badge" style="background:var(--blue);color:#fff">→ Next</span>' : ''}
      </div>
      <div class="station-times"></div>
    `;
    stationsList.appendChild(row);
  }

  // Add notice
  const notice = document.createElement('p');
  notice.style.cssText = 'margin-top:1rem;font-family:var(--font-mono);font-size:0.68rem;color:var(--muted);text-align:center;';
  notice.textContent = '⚠ Timetable unavailable — showing live position only';
  routeSection.appendChild(notice);
}

// ─────────────────────────────────────────────────────
// Extract station list from various API response shapes
// ─────────────────────────────────────────────────────
function extractStationList(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data;

  // Common keys observed in JR Central API
  for (const key of ['list', 'stationList', 'stations', 'stop']) {
    const v = data[key] ?? data.trainInfo?.[key] ?? data.train?.[key];
    if (Array.isArray(v) && v.length) return v;
  }

  // Search all top-level arrays
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (Array.isArray(v) && v.length > 2 &&
        (v[0].station_no != null || v[0].stationNo != null ||
         v[0].arr_time != null   || v[0].dep_time != null)) {
      return v;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────
// Event: fetch button
// ─────────────────────────────────────────────────────
fetchBtn.addEventListener('click', () => {
  const raw = trainSelect.value;
  if (!raw) return;
  try {
    const { trainNumber, train, delay } = JSON.parse(raw);
    const bound = boundSelect.value;

    // Highlight in sidebar
    document.querySelectorAll('.live-train-row.active').forEach(r => r.classList.remove('active'));
    const sideRow = liveList.querySelector(`[data-train-number="${trainNumber}"]`);
    if (sideRow) { sideRow.classList.add('active'); sideRow.scrollIntoView({ block: 'nearest' }); }

    selectTrain(trainNumber, train, bound, delay);
  } catch (e) { console.error(e); }
});

// Event: manual refresh
refreshBtn.addEventListener('click', async () => {
  refreshBtn.textContent = '↻';
  refreshBtn.disabled = true;
  await refreshLocation();
  refreshBtn.textContent = '↺';
  refreshBtn.disabled = false;
});

// ─────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────
init();