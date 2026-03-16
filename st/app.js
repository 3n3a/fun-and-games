/**
 * 新幹線 Live Tracker — app.js
 *
 * Fetches all config dynamically from JR Central public endpoints.
 * Fallback station names + train type names are embedded for robustness
 * (used only when the API hasn't responded yet / returns unexpected data).
 */

// ─────────────────────────────────────────────────────
// API base & CORS proxy
// ─────────────────────────────────────────────────────
const BASE  = 'https://traininfo.jr-central.co.jp/shinkansen';
const PROXY = 'https://api.allorigins.win/get?url=';

// ─────────────────────────────────────────────────────
// Fallback data (mirrors common_en.json — used when CONFIG not yet loaded)
// ─────────────────────────────────────────────────────
const FB_TRAIN_NAMES = {
  '1': 'HIKARI', '2': 'KODAMA', '6': 'NOZOMI',
  '10': 'MIZUHO', '11': 'SAKURA', '12': 'TSUBAME',
  '8': 'Group', '9': 'Out of Service',
};

const FB_STATIONS = {
  '1':'Tokyo','2':'Shinagawa','3':'Shin-Yokohama',
  '4':'Odawara','5':'Atami','6':'Mishima',
  '32':'Shin-Fuji','7':'Shizuoka','33':'Kakegawa',
  '8':'Hamamatsu','9':'Toyohashi','34':'Mikawa-Anjo',
  '10':'Nagoya','11':'Gifu-Hashima','12':'Maibara',
  '13':'Kyoto','15':'Shin-Osaka','16':'Shin-Kobe',
  '17':'Nishi-Akashi','18':'Himeji','19':'Aioi',
  '20':'Okayama','21':'Shin-Kurashiki','22':'Fukuyama',
  '35':'Shin-Onomichi','23':'Mihara','41':'Higashi-Hiroshima',
  '24':'Hiroshima','25':'Shin-Iwakuni','26':'Tokuyama',
  '27':'Shin-Yamaguchi','42':'Asa','28':'Shin-Shimonoseki',
  '29':'Kokura','30':'Hakata','46':'Shin-Tosu','47':'Kurume',
  '48':'Chikugo-Funagoya','49':'Shin-Omuta','50':'Shin-Tamana',
  '51':'Kumamoto','52':'Shin-Yatsushiro','53':'Shin-Minamata',
  '54':'Izumi','55':'Sendai','56':'Kagoshima-Chuo',
};

// Station order for full route render (from stationOrder in common_en.json)
const FB_ORDER = ['1','2','3','4','5','6','32','7','33','8','9','34',
                  '10','11','12','13','15','16','17','18','19','20',
                  '21','22','35','23','41','24','25','26','27','42',
                  '28','29','30'];

// Train terminus by bound
const TERMINUS = { '1': 'Tokyo', '2': 'Hakata' };

// Type → visual style (names come from CONFIG at runtime, fallback above)
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
let CONFIG        = null;
let LOCATION      = null;
let selectedTrain = null;
let refreshTimer  = null;
let mobileView    = 'list'; // 'list' | 'detail'

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
const livePanel      = document.querySelector('.live-panel');
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
const errorMsgEl     = document.getElementById('error-msg');
const loadingEl      = document.getElementById('loading');
const emptyState     = document.getElementById('empty-state');
const routeSection   = document.getElementById('route-section');
const stationsList   = document.getElementById('stations-list');
const routeLine      = document.getElementById('route-line');
const detailPanel    = document.querySelector('.detail-panel');
const backBtn        = document.getElementById('back-btn');
const tabList        = document.getElementById('tab-list');
const tabDetail      = document.getElementById('tab-detail');

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
const showEl = el => el?.classList.remove('hidden');
const hideEl = el => el?.classList.add('hidden');

async function proxyFetch(url) {
  const r = await fetch(PROXY + encodeURIComponent(url));
  if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
  const w = await r.json();
  return JSON.parse(w.contents);
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
  const k = String(code);
  // Try live config first, then fallback
  return CONFIG?.train?.[k] || FB_TRAIN_NAMES[k] || `Type ${code}`;
}

function stationName(id) {
  const k = String(id);
  return CONFIG?.station?.[k] || FB_STATIONS[k] || `Stn ${k}`;
}

function stationOrder() {
  return CONFIG?.stationOrder || FB_ORDER;
}

function boundLabel(code) {
  const k = String(code);
  return CONFIG?.boundLong?.[k] || (k === '2' ? 'to Hakata (West bound)' : 'to Tokyo (East bound)');
}

function boundShort(code) {
  const k = String(code);
  return CONFIG?.boundShort?.[k] || (k === '2' ? 'West bound' : 'East bound');
}

// ─────────────────────────────────────────────────────
// Mobile view switching
// ─────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 720; }

function showMobileDetail() {
  mobileView = 'detail';
  livePanel.classList.add('mobile-hidden');
  detailPanel.classList.add('mobile-visible');
  showEl(backBtn);
  tabList.classList.remove('active');
  tabDetail.classList.add('active');
}

function showMobileList() {
  mobileView = 'list';
  livePanel.classList.remove('mobile-hidden');
  detailPanel.classList.remove('mobile-visible');
  hideEl(backBtn);
  tabList.classList.add('active');
  tabDetail.classList.remove('active');
}

backBtn?.addEventListener('click', showMobileList);
tabList?.addEventListener('click', showMobileList);
tabDetail?.addEventListener('click', () => {
  if (selectedTrain) showMobileDetail();
});

// ─────────────────────────────────────────────────────
// Collect all trains from location data
// ─────────────────────────────────────────────────────
function getAllTrains(locationData, bound) {
  const trains = [];
  const bk = String(bound);
  const data = locationData?.trainLocationInfo;
  if (!data) return trains;

  const order = stationOrder();

  // At-station
  for (const entry of (data.atStation?.bounds?.[bk] || [])) {
    for (const t of (entry.trains || [])) {
      trains.push({
        trainNumber: t.trainNumber,
        train: String(t.train),
        delay: t.delay || 0,
        bound,
        currentStation: entry.station,
        location: `At ${stationName(entry.station)}`,
        locationShort: stationName(entry.station),
        between: false,
        sot: t.sot,
        track: t.track,
      });
    }
  }

  // Between stations
  for (const entry of (data.betweenStation?.bounds?.[bk] || [])) {
    for (const t of (entry.trains || [])) {
      trains.push({
        trainNumber: t.trainNumber,
        train: String(t.train),
        delay: t.delay || 0,
        bound,
        currentStation: entry.station,
        location: `→ ${stationName(entry.station)}`,
        locationShort: stationName(entry.station),
        between: true,
        sot: false,
      });
    }
  }

  // Sort by station position in route
  trains.sort((a, b) => {
    const ai = order.indexOf(String(a.currentStation));
    const bi = order.indexOf(String(b.currentStation));
    if (ai !== bi) return ai - bi;
    return parseInt(a.trainNumber) - parseInt(b.trainNumber);
  });

  return trains;
}

// ─────────────────────────────────────────────────────
// Service status bar
// ─────────────────────────────────────────────────────
function handleServiceStatus(svc) {
  const info = svc?.serviceStatusInfo;
  if (!info?.serviceStatusIsEnabled || !info?.data?.length) {
    hideEl(statusBar);
    return;
  }
  statusText.textContent = `⚠ Service disruption — check JR Central for details`;
  showEl(statusBar);
}

// ─────────────────────────────────────────────────────
// Build live sidebar list
// ─────────────────────────────────────────────────────
function populateLiveList(loc) {
  liveList.innerHTML = '';
  let totalCount = 0;

  for (const b of ['2', '1']) {
    const trains = getAllTrains(loc, b);
    if (!trains.length) continue;
    totalCount += trains.length;

    // Section header
    const hdr = document.createElement('div');
    hdr.className = 'bound-group-header';
    const terminus = TERMINUS[b] || '';
    hdr.innerHTML = `<span>${boundShort(b)}</span><span class="bound-terminus">→ ${terminus}</span>`;
    liveList.appendChild(hdr);

    for (const t of trains) {
      const meta = typeMeta(t.train);
      const name = typeName(t.train);
      const row  = document.createElement('div');
      row.className = `live-train-row${t.between ? ' between' : ''}`;
      row.dataset.trainNumber = t.trainNumber;
      row.dataset.trainType   = t.train;
      row.dataset.bound       = b;

      row.innerHTML = `
        <div class="live-train-dot" style="background:${meta.color};${t.between ? 'opacity:0.6' : ''}"></div>
        <div class="live-train-info">
          <div class="live-train-type" style="color:${meta.color}">${name}</div>
          <div class="live-train-num">No. ${t.trainNumber}</div>
          <div class="live-train-loc">${t.location}</div>
        </div>
        ${t.delay > 0 ? `<span class="live-delay-tag">+${t.delay}</span>` : ''}
      `;

      row.addEventListener('click', () => {
        document.querySelectorAll('.live-train-row.active').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        // Sync dropdowns
        boundSelect.value = b;
        populateDropdown(loc);
        selectTrain(t.trainNumber, t.train, b, t.delay);
        if (isMobile()) showMobileDetail();
      });

      liveList.appendChild(row);
    }
  }

  liveCount.textContent = totalCount;
  populateDropdown(loc);
}

// ─────────────────────────────────────────────────────
// Populate header dropdown
// ─────────────────────────────────────────────────────
function populateDropdown(loc) {
  const bound  = boundSelect.value;
  const trains = getAllTrains(loc || LOCATION, bound);

  trainSelect.innerHTML = '';
  if (!trains.length) {
    trainSelect.innerHTML = '<option value="">No trains found</option>';
    fetchBtn.disabled = true;
    return;
  }

  for (const t of trains) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ trainNumber: t.trainNumber, train: t.train, delay: t.delay, bound });
    opt.textContent = `${typeName(t.train)} ${t.trainNumber} — ${t.location}`;
    trainSelect.appendChild(opt);
  }

  trainSelect.disabled = false;
  fetchBtn.disabled    = false;
}

// ─────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────
async function init() {
  try {
    const [cfg, loc, svc] = await Promise.all([
      proxyFetch(jrcUrl('common/data/common_en.json')),
      proxyFetch(jrcUrl('var/train_info/train_location_info.json')),
      proxyFetch(jrcUrl('var/train_info/service_status.json')),
    ]);

    CONFIG   = cfg.constant;
    LOCATION = loc;

    handleServiceStatus(svc);
    populateLiveList(loc);
    boundSelect.addEventListener('change', () => populateDropdown(LOCATION));
    scheduleAutoRefresh();

  } catch (err) {
    console.error('Init failed', err);
    liveList.innerHTML = `<div class="live-loading" style="color:var(--red)">
      ⚠ Could not load live data.<br/>
      <small>CORS proxy may be rate-limited. Try refreshing.</small>
    </div>`;
  }
}

// ─────────────────────────────────────────────────────
// Auto-refresh
// ─────────────────────────────────────────────────────
function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      const loc = await proxyFetch(jrcUrl('var/train_info/train_location_info.json'));
      LOCATION = loc;
      populateLiveList(loc);
      // Re-highlight active
      if (selectedTrain) {
        const r = liveList.querySelector(`[data-train-number="${selectedTrain.trainNumber}"]`);
        if (r) r.classList.add('active');
      }
    } catch(e) { console.warn('Refresh failed', e); }
  }, 60_000);
}

// ─────────────────────────────────────────────────────
// Select & track a train
// ─────────────────────────────────────────────────────
async function selectTrain(trainNumber, trainType, bound, delay = 0) {
  selectedTrain = { trainNumber, trainType, bound, delay };

  hideEl(errorBox);
  hideEl(emptyState);
  hideEl(routeSection);
  showEl(loadingEl);
  hideEl(trainHeader);
  // Remove any old fallback notice
  detailPanel.querySelectorAll('.fallback-notice').forEach(n => n.remove());

  btnSpin.classList.add('spinning');
  fetchBtn.disabled = true;

  try {
    const data = await proxyFetch(jrcUrl(`var/train_info/train_info_${trainType}_${trainNumber}.json`));
    hideEl(loadingEl);
    renderTrainMeta(trainNumber, trainType, bound, delay, data);
    renderRoute(data, trainType, bound, trainNumber);
    showEl(routeSection);
    showEl(trainHeader);
  } catch (err) {
    console.error(err);
    hideEl(loadingEl);
    renderTrainMeta(trainNumber, trainType, bound, delay, null);
    renderRouteFallback(trainType, bound, trainNumber);
    showEl(routeSection);
    showEl(trainHeader);
    errorMsgEl.textContent = `Timetable unavailable for No. ${trainNumber} — showing live position only.`;
    showEl(errorBox);
  } finally {
    btnSpin.classList.remove('spinning');
    fetchBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────
// Render meta header
// ─────────────────────────────────────────────────────
function renderTrainMeta(trainNumber, trainType, bound, delay, data) {
  const meta = typeMeta(trainType);
  const name = typeName(trainType);

  trainTypeLabel.textContent = name;
  trainTypeLabel.className   = `type-label ${meta.cls}`;
  trainNumLabel.textContent  = `No. ${trainNumber}`;

  const dirCode = data?.trainInfo?.bound ?? data?.bound ?? bound;
  metaDirection.textContent  = boundLabel(dirCode);

  const delayMin = delay || data?.trainInfo?.delay || data?.delay || 0;
  if (delayMin > 0) {
    delayBadge.textContent = `+${delayMin} min`;
    showEl(delayBadge);
    metaStatus.textContent = `+${delayMin} min delay`;
    metaStatus.style.color = 'var(--red)';
  } else {
    hideEl(delayBadge);
    metaStatus.textContent = 'On time';
    metaStatus.style.color = 'var(--green)';
  }

  metaUpdated.textContent = new Date().toLocaleTimeString('en-GB');
}

// ─────────────────────────────────────────────────────
// Render route from timetable API
// ─────────────────────────────────────────────────────
function renderRoute(data, trainType, bound, trainNumber) {
  stationsList.innerHTML = '';
  routeLine.style.background =
    `linear-gradient(to bottom, var(--muted) 0%, ${typeMeta(trainType).color}99 100%)`;

  const list = extractStationList(data);
  if (!list?.length) {
    renderRouteFallback(trainType, bound, trainNumber);
    return;
  }

  // Detect current station
  let currIdx = list.findIndex(s => s.now_flag == 1 || s.now_flag === true || s.now_flag === '1');
  if (currIdx === -1) {
    currIdx = list.findIndex(s => !(s.pass_flag == 1 || s.pass_flag === true || s.pass_flag === '1'));
  }

  list.forEach((s, i) => {
    const stnId  = String(s.station_no ?? s.stationNo ?? s.id ?? (i + 1));
    const enName = stationName(stnId);
    const stops  = !(s.stop_flag == 0 || s.stop_flag === false || s.stop_flag === '0');
    const passed = (s.pass_flag == 1 || s.pass_flag === true || s.pass_flag === '1');
    const isCurr = (i === currIdx);

    let state = 'upcoming';
    if (!stops)     state = 'skip';
    else if (isCurr) state = 'current';
    else if (passed) state = 'passed';

    const arr = formatTime(s.arr_time ?? s.arrTime ?? s.arrive_time);
    const dep = formatTime(s.dep_time ?? s.depTime ?? s.departure_time);
    const trk = s.track_no ?? s.trackNo ?? null;

    stationsList.appendChild(makeStationRow(stnId, enName, state, arr, dep, isCurr, trk));
  });
}

// ─────────────────────────────────────────────────────
// Fallback route: use station order + live location
// ─────────────────────────────────────────────────────
function renderRouteFallback(trainType, bound, trainNumber) {
  stationsList.innerHTML = '';
  routeLine.style.background =
    `linear-gradient(to bottom, var(--muted) 0%, ${typeMeta(trainType).color}99 100%)`;

  const order   = stationOrder();
  const bk      = String(bound);
  const ordered = bk === '2' ? order : [...order].reverse();

  // Find live position from LOCATION
  let currStnId  = null;
  let isBetween  = false;
  let nextStnId  = null;

  if (LOCATION?.trainLocationInfo) {
    const loc = LOCATION.trainLocationInfo;
    for (const [sectionKey, section] of Object.entries({at: loc.atStation, between: loc.betweenStation})) {
      for (const entry of (section?.bounds?.[bk] || [])) {
        for (const t of (entry.trains || [])) {
          if (String(t.trainNumber) === String(trainNumber)) {
            currStnId = String(entry.station);
            isBetween = sectionKey === 'between';
          }
        }
      }
    }
  }

  // If between stations, the next station in the route direction is currStnId
  // The "current" dot = the station before, "next" = currStnId
  const currPosIdx = ordered.indexOf(currStnId);

  ordered.forEach((stnId, i) => {
    const enName = stationName(stnId);
    const passed = currPosIdx >= 0 && (isBetween ? i < currPosIdx : i < currPosIdx);
    const isCurr = !isBetween && stnId === currStnId;
    const isNext = isBetween && stnId === currStnId;
    const isFirst = i === 0;
    const isLast  = i === ordered.length - 1;

    let state = 'upcoming';
    if (passed)  state = 'passed';
    if (isCurr)  state = 'current';

    const row = makeStationRow(stnId, enName, state, null, null, isCurr, null);

    // Override badge for "next" station when between
    if (isNext) {
      const badge = row.querySelector('.current-badge');
      if (badge) { badge.textContent = '→ Next'; badge.style.background = 'var(--blue)'; badge.style.color = '#fff'; }
      else {
        const info = row.querySelector('.station-info');
        const nb = document.createElement('span');
        nb.className = 'current-badge';
        nb.style.cssText = 'background:var(--blue);color:#fff';
        nb.textContent = '→ Next';
        info.appendChild(nb);
      }
    }

    // Terminus labels
    if (isFirst || isLast) {
      const info = row.querySelector('.station-info');
      const tb = document.createElement('span');
      tb.className = 'terminus-badge';
      tb.textContent = isFirst ? 'Origin' : 'Terminus';
      info.appendChild(tb);
    }

    stationsList.appendChild(row);
  });

  // Notice
  const notice = document.createElement('p');
  notice.className = 'fallback-notice';
  notice.textContent = '⚠ No timetable — position from live map only';
  detailPanel.appendChild(notice);
}

// ─────────────────────────────────────────────────────
// Build a single station row element
// ─────────────────────────────────────────────────────
function makeStationRow(stnId, enName, state, arr, dep, isCurr, track) {
  const row = document.createElement('div');
  row.className = `station-row state-${state}`;
  row.dataset.stationId = stnId;

  row.innerHTML = `
    <div class="station-dot-wrap"><div class="station-dot"></div></div>
    <div class="station-info">
      <span class="station-name-en">${enName}</span>
      ${isCurr ? '<span class="current-badge">▶ Now</span>' : ''}
      ${track != null ? `<span class="platform-badge">Track ${track}</span>` : ''}
    </div>
    <div class="station-times">
      ${arr ? `<span class="station-time arr"><span class="time-label">Arr</span>${arr}</span>` : ''}
      ${dep ? `<span class="station-time dep"><span class="time-label">Dep</span>${dep}</span>` : ''}
    </div>
  `;
  return row;
}

// ─────────────────────────────────────────────────────
// Extract station list from API response
// ─────────────────────────────────────────────────────
function extractStationList(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data;
  for (const key of ['list', 'stationList', 'stations', 'stop']) {
    const v = data[key] ?? data.trainInfo?.[key] ?? data.train?.[key];
    if (Array.isArray(v) && v.length) return v;
  }
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (Array.isArray(v) && v.length > 2 &&
        (v[0]?.station_no != null || v[0]?.arr_time != null || v[0]?.dep_time != null)) {
      return v;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────
// Fetch button
// ─────────────────────────────────────────────────────
fetchBtn.addEventListener('click', () => {
  const raw = trainSelect.value;
  if (!raw) return;
  try {
    const { trainNumber, train, delay, bound } = JSON.parse(raw);
    document.querySelectorAll('.live-train-row.active').forEach(r => r.classList.remove('active'));
    const sideRow = liveList.querySelector(`[data-train-number="${trainNumber}"]`);
    if (sideRow) { sideRow.classList.add('active'); sideRow.scrollIntoView({ block: 'nearest' }); }
    selectTrain(trainNumber, train, bound || boundSelect.value, delay);
    if (isMobile()) showMobileDetail();
  } catch(e) { console.error(e); }
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  try {
    const loc = await proxyFetch(jrcUrl('var/train_info/train_location_info.json'));
    LOCATION = loc;
    populateLiveList(loc);
    if (selectedTrain) {
      const r = liveList.querySelector(`[data-train-number="${selectedTrain.trainNumber}"]`);
      if (r) r.classList.add('active');
    }
  } catch(e) { console.warn(e); }
  refreshBtn.disabled = false;
});

// ─────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────
init();