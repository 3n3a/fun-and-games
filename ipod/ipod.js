// Virtual iPod: a clean-room rebuild of <web-music-ipod> from
// music.apple.com/includes/ipod/web-music-ipod.esm.js (v2644.1.0).
// The original is a compiled Svelte custom element; behaviour, constants and
// state machines below are re-derived from it and written as plain JS.
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants (names are ours, values are the bundle's)
  // ---------------------------------------------------------------------------
  const VERSION = "2644.1.0";
  const SETTINGS_KEY = "apple-ipod:settings";
  const MIN_LOADING_MS = 2000;

  const DRAG_STEP_DEG = 15; // wheel degrees per list row
  const DEADZONE_RATIO = 0.1; // ignore drags whose segment passes this close to center
  const REVERSE_HYSTERESIS_DEG = 8; // degrees needed before a direction change counts
  const SELECT_RATIO = 100 / 276; // center button / scroll wheel diameter

  const LIST_ACCEL = { minSpeed: 180, tierMs: 500, tiers: [1, 2, 3, 5, 8, 13, 21, 34] };
  const SEEK_ACCEL = { minSpeed: 180, tierMs: 500, tiers: [1, 2, 3, 5] };
  const ACCEL_MAX_SPEED = 400;
  const ACCEL_SMOOTHING = 0.15;
  const ACCEL_GAP_MS = 250;

  const KEY_REPEAT_DELAY_MS = 300;
  const KEY_REPEAT_MS = 80;
  const HOLD_MS = 1000;
  const HOLD_REPEAT_MS = 500;

  const NOW_PLAYING_IDLE_MS = 10000;
  const SEEK_COMMIT_MS = 1000;
  const SEEK_IDLE_MS = 5000;
  const VOLUME_IDLE_MS = 5000;
  const VOLUME_SAVE_MS = 1000;
  const VOLUME_DEG_PER_STEP = (1.25 * 360) / 100;
  const VOLUME_CLICK_DEG = (1.25 * 360) / 22;
  const VOLUME_KEY_STEP = 5;
  const SCAN_STEPS = [5, 5, 5, 10, 10, 10, 20];
  const BRICK_HOLD_MS = 5000;
  const PADDLE_STEER = 0.035;

  const CROSSFADE_S = 2;
  const RESTART_THRESHOLD_S = 3;
  const SLIDE_MS = 240;

  const BACKLIGHT_MODES = [
    { mode: "off", label: "Off" },
    { mode: "1sec", label: "1 second", ms: 1000 },
    { mode: "2sec", label: "2 seconds", ms: 2000 },
    { mode: "3sec", label: "3 seconds", ms: 3000 },
    { mode: "5sec", label: "5 seconds", ms: 5000 },
    { mode: "always_on", label: "Always On" },
  ];
  const VALUE_LABELS = { off: "Off", on: "On", songs: "Songs", one: "One", all: "All" };

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const svg = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  };

  const ICONS = {
    play: '<svg width="17" height="20" viewBox="0 0 17 20"><path d="M16 10 1 19V1z"/></svg>',
    pause: '<svg width="14" height="20" viewBox="0 0 14 20"><path d="M0 0h4.6v20H0zm9 0h4.6v20H9z"/></svg>',
    next: '<svg width="23" height="12" viewBox="0 0 23 12"><path d="M9.58 5.635 0 11.212V.057zm9.623 0-9.58 5.577V.057zm0-5.635H23v11.273h-3.797z"/></svg>',
    playpause: '<svg width="24" height="12" viewBox="0 0 24 12"><path d="M9.58 5.635 0 11.212V.057zM19.578 0h3.796v11.273h-3.796zm-5.793 0h3.797v11.273h-3.797z"/></svg>',
    menu: '<svg width="400" height="150" viewBox="0 0 400 150"><path id="menu-text-curve" d="M31.234 97.495S92.808 41.234 200 41.234c121.84 0 168.766 56.26 168.766 56.26"/><text><textPath href="#menu-text-curve" startOffset="112">menu</textPath></text></svg>',
    repeatAll: '<svg width="18" height="15" viewBox="0 0 18 15"><path d="M3 7a4 4 0 0 1 4-4h7V0l4 4-4 4V5H7a2 2 0 0 0-2 2v1H3zm12 1h2v0a4 4 0 0 1-4 4H6v3l-4-4 4-4v3h7a2 2 0 0 0 2-2z"/></svg>',
    repeatOne: '<svg width="19" height="15" viewBox="0 0 19 15"><path d="M3 7a4 4 0 0 1 4-4h7V0l4 4-4 4V5H7a2 2 0 0 0-2 2v1H3zm12 1h2v0a4 4 0 0 1-4 4H6v3l-4-4 4-4v3h7a2 2 0 0 0 2-2z"/><path d="M9 5.6h1.7v5H9z"/></svg>',
    shuffle: '<svg width="20" height="15" viewBox="0 0 20 15"><path d="M1 3h4l7 8h3V8l4 4-4 4v-3h-4L4 5H1zm0 8h3l2-2.3 1.3 1.5L5 13H1zm10-6h4V2l4 4-4 4V7h-3l-1.7 2-1.3-1.5z"/></svg>',
    volLow: '<svg width="10" height="16" viewBox="0 0 10 16"><path d="M9.5 16V0L4.3 4.5H0v7h4.3z"/></svg>',
    volHigh: '<svg width="18" height="16" viewBox="0 0 18 16"><path d="M9.5 16V0L4.3 4.5H0v7h4.3zM11 4.4c1.4 1 2.3 2.2 2.3 3.6s-.9 2.6-2.3 3.6l-.9-1.1c1-.7 1.6-1.5 1.6-2.5s-.6-1.8-1.6-2.5zm1.6-3c2.4 1.7 3.8 4 3.8 6.6s-1.4 4.9-3.8 6.6l-.9-1.1c2-1.5 3.2-3.3 3.2-5.5S13.7 4 11.7 2.5z"/></svg>',
    note: '<svg width="60" height="72" viewBox="0 0 60 72"><path d="M22 6 58 0v50a10 10 0 1 1-6-9V14L28 18v40a10 10 0 1 1-6-9z"/></svg>',
    sad: '<svg width="72" height="90" viewBox="0 0 72 90"><path d="M6 0h60a6 6 0 0 1 6 6v78a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6zm2 8v34h56V8zm28 46a14 14 0 1 0 0 28 14 14 0 0 0 0-28zm0 9a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM20 20l4 4-4 4 2 2 4-4 4 4 2-2-4-4 4-4-2-2-4 4-4-4zm22 0-2 2 4 4-4 4 2 2 4-4 4 4 2-2-4-4 4-4-2-2-4 4z"/></svg>',
  };

  const RAW = window.IPOD_DATA || { songs: [], artists: [], playlists: [] };
  const DATA = {
    songs: RAW.songs,
    artists: RAW.artists,
    playlists: RAW.playlists,
    byId: new Map(RAW.songs.map((s) => [s.id, s])),
  };
  const songsFor = (ids) => ids.map((id) => DATA.byId.get(id)).filter(Boolean);

  // ---------------------------------------------------------------------------
  // Tiny store
  // ---------------------------------------------------------------------------
  function store(value) {
    const subs = new Set();
    return {
      get: () => value,
      set(v) {
        value = v;
        subs.forEach((f) => f(value));
      },
      update(fn) {
        this.set(fn(value));
      },
      subscribe(f) {
        subs.add(f);
        f(value);
        return () => subs.delete(f);
      },
    };
  }

  function timer(ms, fn) {
    let id;
    return {
      start() {
        clearTimeout(id);
        id = setTimeout(() => ((id = undefined), fn()), ms);
      },
      stop() {
        clearTimeout(id);
        id = undefined;
      },
      flush() {
        if (id !== undefined) {
          this.stop();
          fn();
        }
      },
      get running() {
        return id !== undefined;
      },
    };
  }

  // Fires fn(false) after `delay`, then fn(true) every `interval`.
  // stop() reports whether it had fired, so a release can tell press from hold.
  function holdTimer(fn) {
    let t, iv, fired = false;
    const clear = () => (clearTimeout(t), clearInterval(iv), (t = iv = undefined));
    return {
      start(delay, interval) {
        clear();
        fired = false;
        t = setTimeout(() => {
          t = undefined;
          fired = true;
          fn(false);
          if (fired && interval !== undefined) iv = setInterval(() => fn(true), interval);
        }, delay);
      },
      stop() {
        clear();
        const f = fired;
        fired = false;
        return f;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Settings (persisted the same way as the original)
  // ---------------------------------------------------------------------------
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const systemBacklight = () => (darkQuery.matches ? "always_on" : "off");
  const DEFAULTS = Object.freeze({ shuffle: "off", repeat: "off", clicker: "on", backlight: "off", volume: 50 });
  const ENUMS = {
    shuffle: ["off", "songs"],
    repeat: ["off", "one", "all"],
    clicker: ["on", "off"],
    backlight: BACKLIGHT_MODES.map((m) => m.mode),
  };
  let backlightChosen = false;

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {};
      const s = { ...DEFAULTS };
      for (const k of Object.keys(ENUMS)) if (ENUMS[k].includes(raw[k])) s[k] = raw[k];
      if (typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 100) s.volume = raw.volume;
      backlightChosen = raw.backlightChosen === true && ENUMS.backlight.includes(raw.backlight);
      if (!backlightChosen) s.backlight = systemBacklight();
      return s;
    } catch {
      return { ...DEFAULTS, backlight: systemBacklight() };
    }
  }
  const settings = store(loadSettings());
  settings.subscribe(({ backlight, ...rest }) => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(backlightChosen ? { ...rest, backlight, backlightChosen: true } : rest)
      );
    } catch {}
  });
  darkQuery.addEventListener("change", () => {
    if (!backlightChosen) settings.update((s) => ({ ...s, backlight: systemBacklight() }));
  });
  const chooseBacklight = (mode) => {
    backlightChosen = true;
    settings.update((s) => ({ ...s, backlight: mode }));
  };
  const resetSettings = () => {
    backlightChosen = false;
    settings.set({ ...DEFAULTS, backlight: systemBacklight() });
  };

  // ---------------------------------------------------------------------------
  // Audio: context, click sound, crossfading preview player
  // ---------------------------------------------------------------------------
  let ctx;
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      player.attach(ctx);
    }
    if (ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {});
    return ctx;
  }

  const clicker = (() => {
    let buf, gain, nextAt = 0;
    return {
      play() {
        if (!ctx || ctx.state !== "running") return;
        if (!buf) {
          const len = Math.round(ctx.sampleRate * 0.006);
          buf = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
          gain = ctx.createGain();
          gain.gain.value = 0.3;
          gain.connect(ctx.destination);
        }
        const now = ctx.currentTime;
        if (nextAt - now >= 0.15) return; // don't build an audible backlog
        const at = Math.max(now, nextAt);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start(at);
        nextAt = at + 0.05;
      },
    };
  })();

  const FADE_IN = Float32Array.from({ length: 50 }, (_, i) => Math.cos((1 - i / 49) * Math.PI * 0.5));
  const FADE_OUT = Float32Array.from({ length: 50 }, (_, i) => Math.cos((i / 49) * Math.PI * 0.5));

  // One queue item's audio element. Two exist at a time, like a DJ's turntables.
  class Channel {
    constructor(context, song, dest) {
      this.context = context;
      this.audio = new Audio();
      this.audio.crossOrigin = "anonymous";
      this.audio.preload = "auto";
      this.audio.src = song.previewUrl;
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.source = context.createMediaElementSource(this.audio);
      this.source.connect(this.gain).connect(dest);
    }
    fade(curve, done) {
      clearTimeout(this.doneTimer);
      const g = this.gain.gain;
      g.cancelScheduledValues(this.context.currentTime);
      g.setValueCurveAtTime(curve, this.context.currentTime, CROSSFADE_S);
      if (done) this.doneTimer = setTimeout(done, CROSSFADE_S * 1000);
    }
    cutIn() {
      clearTimeout(this.doneTimer);
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(1, this.context.currentTime);
    }
    destroy() {
      clearTimeout(this.doneTimer);
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.source.disconnect();
      this.gain.disconnect();
    }
  }

  const player = (() => {
    const state = store({
      queue: [],
      currentTrackIndex: 0,
      queuePosition: 0,
      isPlaying: false,
      isLoading: false,
      hasLoadedItem: false,
      currentPlaybackTime: 0,
      currentPlaybackDuration: 0,
      shuffleMode: false,
      repeatMode: "none",
      volume: settings.get().volume / 100,
    });
    const set = (patch) => state.set({ ...state.get(), ...patch });
    const finishedListeners = new Set();
    let context, master, current, next, nextIndex, order = [], faded = false;
    const fading = new Set();

    const S = () => state.get();
    const position = (i) => (S().shuffleMode ? order.indexOf(i) : i);
    function syncChannel(ch) {
      set({
        currentPlaybackTime: ch ? ch.audio.currentTime : 0,
        currentPlaybackDuration: ch && Number.isFinite(ch.audio.duration) ? ch.audio.duration : 0,
        hasLoadedItem: !!ch,
      });
    }
    function adjacent(i, dir) {
      const { queue, shuffleMode, repeatMode } = S();
      if (!shuffleMode) {
        const n = i + dir;
        if (n >= 0 && n < queue.length) return n;
        return repeatMode === "all" ? (dir === 1 ? 0 : queue.length - 1) : undefined;
      }
      const p = order.indexOf(i) + dir;
      if (p >= 0 && p < order.length) return order[p];
      return repeatMode === "all" ? order[dir === 1 ? 0 : order.length - 1] : undefined;
    }
    const autoAdvance = (i) => (S().repeatMode === "one" ? i : adjacent(i, 1));

    function createChannel(i) {
      const song = S().queue[i];
      if (!song || !context) return;
      const ch = new Channel(context, song, master);
      ch.audio.addEventListener("durationchange", () => ch === current && syncChannel(ch));
      ch.audio.addEventListener("timeupdate", () => {
        if (ch !== current) return;
        const { currentTime: t, duration: d } = ch.audio;
        set({ currentPlaybackTime: t, currentPlaybackDuration: Number.isFinite(d) ? d : 0 });
        if (!Number.isFinite(d) || d <= CROSSFADE_S || faded || t < d - CROSSFADE_S) return;
        faded = true;
        next ? crossfade() : ch.fade(FADE_OUT);
      });
      ch.audio.addEventListener("ended", () => {
        if (ch !== current) return;
        next ? crossfade() : endQueue();
      });
      ch.audio.addEventListener("error", () => ch === current && set({ isLoading: false }));
      return ch;
    }
    function clearNext() {
      next && next.destroy();
      next = nextIndex = undefined;
    }
    function prepareNext() {
      if (!current) return;
      const i = autoAdvance(S().currentTrackIndex);
      if (i === nextIndex && next) return;
      clearNext();
      if (i !== undefined) {
        nextIndex = i;
        next = createChannel(i);
      }
    }
    function crossfade() {
      const from = current, to = next;
      if (!from || !to) return;
      from.fade(FADE_OUT, () => {
        from.destroy();
        fading.delete(from);
      });
      fading.add(from);
      to.audio.play().catch(() => set({ isPlaying: false }));
      to.fade(FADE_IN);
      current = to;
      next = undefined;
      faded = false;
      set({ currentTrackIndex: nextIndex, queuePosition: position(nextIndex) });
      nextIndex = undefined;
      syncChannel(current);
      prepareNext();
    }
    function destroyAll() {
      current && current.destroy();
      clearNext();
      fading.forEach((c) => c.destroy());
      fading.clear();
      current = undefined;
    }
    function endQueue() {
      destroyAll();
      set({
        queue: [],
        currentTrackIndex: 0,
        queuePosition: 0,
        isPlaying: false,
        isLoading: false,
        hasLoadedItem: false,
        currentPlaybackTime: 0,
        currentPlaybackDuration: 0,
      });
      finishedListeners.forEach((f) => f());
    }
    async function resume() {
      if (!current) return jumpTo(S().currentTrackIndex, true);
      audio();
      try {
        await current.audio.play();
        current.cutIn();
        faded = false;
        set({ isPlaying: true, isLoading: false });
      } catch (e) {
        console.error("[iPod] Failed to start playback", e);
        set({ isPlaying: false, isLoading: false });
      }
    }
    function pause() {
      current && current.audio.pause();
      fading.forEach((c) => c.audio.pause());
      set({ isPlaying: false });
    }
    function restartInPlace() {
      current.audio.currentTime = 0;
      current.cutIn();
      faded = false;
      syncChannel(current);
    }
    async function jumpTo(i, forceResume = false) {
      const { queue } = S();
      if ((i === S().currentTrackIndex && current) || i < 0 || i >= queue.length) return;
      const resumeAfter = forceResume || S().isPlaying;
      if (i === nextIndex && next) {
        current && current.destroy();
        current = next;
        next = nextIndex = undefined;
      } else {
        current && current.destroy();
        clearNext();
        current = createChannel(i);
      }
      faded = false;
      set({ currentTrackIndex: i, queuePosition: position(i) });
      syncChannel(current);
      prepareNext();
      if (resumeAfter) await resume();
    }
    function buildOrder(first) {
      const rest = S().queue.map((_, i) => i).filter((i) => !first.includes(i));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      order = [...first, ...rest];
    }

    return {
      subscribe: state.subscribe,
      get: S,
      attach(c) {
        context = c;
        master = c.createGain();
        master.gain.value = S().volume;
        master.connect(c.destination);
      },
      onQueueFinished(f) {
        finishedListeners.add(f);
      },
      async play(songs, index) {
        audio();
        destroyAll();
        const start = index ?? (S().shuffleMode ? Math.floor(Math.random() * songs.length) : 0);
        set({ queue: songs, currentTrackIndex: -1, isLoading: true, isPlaying: false });
        // Shuffle pins the chosen song first in the play order.
        if (S().shuffleMode) buildOrder([start]);
        await jumpTo(start, true);
      },
      pause,
      resume,
      async skipNext() {
        if (!current) return;
        if (S().repeatMode === "one") return restartInPlace();
        const n = adjacent(S().currentTrackIndex, 1);
        n !== undefined ? await jumpTo(n) : endQueue();
      },
      async skipPrevious() {
        if (!current) return;
        if (S().repeatMode === "one") return restartInPlace();
        if (S().isPlaying && current.audio.currentTime > RESTART_THRESHOLD_S) return restartInPlace();
        const p = adjacent(S().currentTrackIndex, -1);
        p !== undefined ? await jumpTo(p) : endQueue();
      },
      async seek(t) {
        if (!current) return;
        const d = current.audio.duration;
        const n = autoAdvance(S().currentTrackIndex);
        if (Number.isFinite(d) && d > CROSSFADE_S && t >= d - CROSSFADE_S && n !== undefined) {
          return n === S().currentTrackIndex ? restartInPlace() : this.skipNext();
        }
        current.audio.currentTime = t;
        current.cutIn();
        faded = false;
        set({ currentPlaybackTime: t });
      },
      setVolume(v) {
        v = clamp(v, 0, 1);
        if (master) master.gain.setTargetAtTime(v, context.currentTime, 0.01);
        set({ volume: v });
      },
      setShuffle(on) {
        if (on === S().shuffleMode) return;
        if (on) buildOrder([S().currentTrackIndex]);
        set({ shuffleMode: on });
        set({ queuePosition: position(S().currentTrackIndex) });
        prepareNext();
      },
      setRepeatMode(mode) {
        if (mode === S().repeatMode) return;
        set({ repeatMode: mode });
        prepareNext();
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Brick (game logic, LCD ghosting and renderer ported from the bundle)
  // ---------------------------------------------------------------------------
  const GW = 148, GH = 101, PADDLE_W = 30, PADDLE_H = 4, BALL_R = 1.5, BRICK_H = 4,
    COLS = 12, GAP = 2, ROW_GAP = 4, MARGIN = 3, TOP = 3,
    BRICK_W = (GW - MARGIN * 2 - (COLS - 1) * GAP) / COLS,
    BALL_V = 1.7, BALL_SPEED = Math.hypot(1.7, 1.7), PADDLE_RANGE = GW - PADDLE_W, PADDLE_Y = GH - PADDLE_H;
  const tickMs = (level) => 40 / Math.min(1 + (level - 1) * 0.1, 1.5);
  function bricks(level) {
    const rows = Math.min(2 + level - 1, 5), out = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < COLS; c++)
        out.push({ x: MARGIN + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + ROW_GAP), destroyed: false });
    return out;
  }
  const newBall = () => ({ x: BALL_R, y: GH / 2, dx: BALL_V, dy: BALL_V });
  const newGame = () => ({
    paddleX: PADDLE_RANGE / 2, ball: newBall(), isBallInPlay: false, serveTicks: 0,
    bricks: bricks(1), score: 0, balls: 3, level: 1, isGameOver: false,
  });

  function brickEngine() {
    const s = newGame();
    const serve = () => {
      s.ball = newBall();
      s.isBallInPlay = false;
      s.serveTicks = Math.round(1000 / tickMs(s.level));
    };
    const loseBall = () => {
      s.balls -= 1;
      if (s.balls > 0) serve();
      else (s.isBallInPlay = false), (s.isGameOver = true);
    };
    const levelUp = () => {
      s.level += 1;
      s.bricks = bricks(s.level);
      serve();
    };
    function bounceOffPaddle() {
      const half = PADDLE_W / 2;
      const off = clamp((s.ball.x - (s.paddleX + half)) / half, -1, 1);
      const speed = BALL_SPEED * (1 + Math.abs(off) * 0.25), dx = off * 0.8, len = Math.hypot(dx, 1);
      s.ball.dx = (dx / len) * speed;
      s.ball.dy = -speed / len;
    }
    function hitSide(i) {
      const b = s.ball, { x, y, destroyed } = s.bricks[i], neighbour = i - Math.sign(b.dx);
      if (destroyed || b.x + BALL_R < x || b.x - BALL_R > x + BRICK_W || b.y + BALL_R < y || b.y - BALL_R > y + BRICK_H) return null;
      const px = b.dx > 0 ? b.x + BALL_R - x : x + BRICK_W - b.x + BALL_R;
      const py = b.dy > 0 ? b.y + BALL_R - y : y + BRICK_H - b.y + BALL_R;
      const blocked = Math.floor(neighbour / COLS) === Math.floor(i / COLS) && s.bricks[neighbour]?.destroyed === false;
      if (!blocked && px * Math.abs(b.dy) < py * Math.abs(b.dx))
        return (x + BRICK_W / 2 - b.x) * b.dx > 0 ? "side" : null;
      return (y + BRICK_H / 2 - b.y) * b.dy > 0 ? "face" : null;
    }
    function collide() {
      for (const [i, br] of s.bricks.entries()) {
        const side = hitSide(i);
        if (side) {
          br.destroyed = true;
          s.score += 1;
          side === "face" ? (s.ball.dy = -s.ball.dy) : (s.ball.dx = -s.ball.dx);
          return true;
        }
      }
      return false;
    }
    function tick() {
      const b = s.ball;
      if (s.serveTicks > 0) (s.serveTicks -= 1), (s.isBallInPlay = s.serveTicks === 0);
      if (!s.isBallInPlay) return;
      const abovePaddle = b.y + BALL_R < PADDLE_Y;
      b.x += b.dx;
      b.y += b.dy;
      if ((b.x <= BALL_R && b.dx < 0) || (b.x >= GW - BALL_R && b.dx > 0)) b.dx = -b.dx;
      if (b.y <= BALL_R && b.dy < 0) b.dy = -b.dy;
      if (b.y >= GH) return loseBall();
      if (b.dy > 0 && abovePaddle && b.y + BALL_R >= PADDLE_Y && b.x + BALL_R >= s.paddleX && b.x - BALL_R <= s.paddleX + PADDLE_W)
        bounceOffPaddle();
      if (collide() && s.bricks.every((br) => br.destroyed)) levelUp();
    }
    return {
      state: s,
      tick,
      movePaddle(f) {
        if (!s.isGameOver) s.paddleX = clamp(s.paddleX + f * PADDLE_RANGE, 0, PADDLE_RANGE);
      },
      launch() {
        if (s.isGameOver) Object.assign(s, newGame());
        else (s.isBallInPlay = true), (s.serveTicks = 0);
      },
    };
  }

  // Simulated passive-matrix LCD: pixels darken fast and fade slowly.
  function lcd(w, hgt) {
    const drive = new Uint8Array(w * hgt), a = new Float32Array(w * hgt), ink = new Float32Array(w * hgt), kind = new Uint8Array(w * hgt);
    return {
      drive,
      ink,
      fade(dt) {
        const on = 1 - Math.exp(-dt / 20), off = 1 - Math.exp(-dt / 70), offFast = 1 - Math.exp(-dt / 25);
        let busy = false;
        for (let i = 0; i < ink.length; i++) {
          const target = drive[i] ? 1 : 0;
          kind[i] = drive[i] || kind[i];
          if (Math.abs(target - a[i]) > 1 / 255 || Math.abs(target - ink[i]) > 1 / 255) {
            const rate = kind[i] === 2 ? offFast : off;
            const d1 = target - a[i];
            a[i] += d1 * (d1 > 0 ? on : rate);
            const d2 = a[i] - ink[i];
            ink[i] += d2 * (d2 > 0 ? on : rate);
            busy = true;
          } else {
            busy ||= a[i] !== target || ink[i] !== target;
            a[i] = ink[i] = target;
          }
        }
        return busy;
      },
      settle() {
        for (let i = 0; i < ink.length; i++) (kind[i] = drive[i] || kind[i]), (a[i] = ink[i] = drive[i] ? 1 : 0);
      },
    };
  }

  function lcdRenderer(canvas, screen) {
    const g = canvas.getContext("2d");
    let img, map = new Int32Array(0), shade = new Float32Array(0);
    const gridShade = (p, scale) => {
      const edge = Math.round((p + 0.5) / scale) * scale;
      return 1 - 0.3 * Math.max(0, 1 - Math.abs(p + 0.5 - edge));
    };
    function paint() {
      if (!img) return;
      for (let i = 0; i < map.length; i++) img.data[i * 4 + 3] = screen.ink[map[i]] * shade[i];
      g.putImageData(img, 0, 0);
    }
    function resize() {
      const scaleCss = Number(getComputedStyle(canvas.closest(".ipod-shadow-inner")).scale) || 1;
      const px = Math.round(canvas.clientWidth * scaleCss * devicePixelRatio);
      const W = px >= GW * 3 ? px : GW;
      if (img && W === canvas.width) return;
      canvas.width = W;
      canvas.height = Math.round((W * GH) / GW);
      const k = W / GW, grid = k > 1, H = canvas.height;
      map = new Int32Array(W * H);
      shade = new Float32Array(W * H);
      for (let y = 0; y < H; y++) {
        const sy = Math.min(Math.floor((y + 0.5) / k), GH - 1), ys = grid ? gridShade(y, k) : 1;
        for (let x = 0; x < W; x++) {
          map[y * W + x] = sy * GW + Math.floor((x + 0.5) / k);
          shade[y * W + x] = ys * (grid ? gridShade(x, k) : 1) * 255;
        }
      }
      img = g.createImageData(W, H);
      const [r = 0, gg = 0, b = 0] = (getComputedStyle(canvas).color.match(/\d+/g) || []).map(Number);
      for (let i = 0; i < img.data.length; i += 4) img.data.set([r, gg, b], i);
      paint();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);
    resize();
    return { paint, destroy: () => ro.disconnect() };
  }

  function brickView(onStatus) {
    const engine = brickEngine(), screen = lcd(GW, GH), s = engine.state;
    const root = h("div", "brick-game-screen");
    const canvas = h("canvas", "game-area");
    canvas.width = GW;
    canvas.height = GH;
    root.append(canvas);
    let renderer, raf, last, acc = 0, steer = 0, steered = false, dirty = false, paused = false;

    function rect(x, y, w, hh, v = 1) {
      const x0 = Math.max(Math.round(x), 0), x1 = Math.min(Math.round(x) + w, GW);
      const y0 = Math.max(Math.round(y), 0), y1 = Math.min(Math.round(y) + hh, GH);
      for (let r = y0; r < y1; r++) screen.drive.fill(v, r * GW + x0, r * GW + x1);
    }
    function draw() {
      screen.drive.fill(0);
      for (const b of s.bricks) if (!b.destroyed) rect(b.x, b.y, BRICK_W, BRICK_H);
      rect(s.paddleX, GH - PADDLE_H, PADDLE_W, PADDLE_H, 2);
      rect(s.ball.x - BALL_R, s.ball.y - BALL_R, BALL_R * 2, BALL_R * 2);
      dirty = false;
    }
    function frame(now) {
      const dt = last === undefined ? 0 : now - last, step = tickMs(s.level);
      last = now;
      acc = Math.min(acc + dt, step * 10);
      let ticked = false;
      while (acc >= step) {
        acc -= step;
        ticked = true;
        if (!paused) {
          engine.movePaddle(steer * PADDLE_STEER);
          steered ||= steer !== 0;
          engine.tick();
        }
      }
      if (ticked) draw(), onStatus(s);
      const busy = screen.fade(dt);
      if ((ticked || busy) && renderer) renderer.paint();
      const live = ((s.isBallInPlay || s.serveTicks > 0) && !paused) || dirty || busy || (steer !== 0 && !paused);
      raf = live ? requestAnimationFrame(frame) : undefined;
    }
    const wake = () => {
      if (raf === undefined) (last = undefined), (raf = requestAnimationFrame(frame));
    };
    const move = (f) => (engine.movePaddle(f), (dirty = true), wake());
    return {
      el: root,
      mounted() {
        draw();
        screen.settle();
        renderer = lcdRenderer(canvas, screen);
        onStatus(s);
      },
      move,
      steer(dir) {
        if (dir === 0 && !steered && !paused) move(steer * PADDLE_STEER);
        steer = dir;
        steered = false;
        wake();
      },
      launch() {
        engine.launch();
        dirty = true;
        onStatus(s);
        wake();
      },
      setPaused(p) {
        paused = p;
        if (!p) wake();
      },
      destroy() {
        raf !== undefined && cancelAnimationFrame(raf);
        renderer && renderer.destroy();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  const fmtTime = (t) => {
    const s = Math.max(0, Math.floor(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const fmtRemaining = (t, d) => (!Number.isFinite(d) || d <= 0 ? "" : `-${fmtTime(Math.ceil(d - t))}`);
  const nf = new Intl.NumberFormat("en-US");
  const gb = new Intl.NumberFormat("en-US", { style: "unit", unit: "gigabyte" });

  // ---------------------------------------------------------------------------
  // Screens / menu model
  // ---------------------------------------------------------------------------
  const nav = (id, title, target, extra) => ({ id, title, action: "navigate", target, ...extra });
  const noMusic = () => [{ id: "no-music", title: "No Music", action: "info", centered: true }];
  const orNoMusic = (items) => (items.length ? items : noMusic());
  const trackItems = (songs) => orNoMusic(songs.map((s) => ({ id: s.id, title: s.name, action: "play", songId: s.id })));
  const listSongs = (target, contextId) => {
    if (target === "songs") return DATA.songs;
    const src = target === "playlist-tracks" ? DATA.playlists : DATA.artists;
    return songsFor(src.find((x) => x.id === contextId)?.songIds ?? []);
  };

  const SCREENS = {
    main: {
      view: "list",
      title: () => "iPod",
      items: ({ hasNowPlaying }) => [
        nav("playlists", "Playlists", "playlists"),
        nav("artists", "Artists", "artists"),
        nav("songs", "Songs", "songs"),
        nav("settings", "Settings", "settings"),
        ...(hasNowPlaying ? [nav("now-playing", "Now Playing", "now-playing")] : []),
      ],
    },
    settings: {
      view: "list",
      title: () => "Settings",
      items: () => [
        nav("about", "About", "about"),
        { id: "shuffle", title: "Shuffle", action: "inline-toggle", toggleKey: "shuffle", values: ENUMS.shuffle },
        { id: "repeat", title: "Repeat", action: "inline-toggle", toggleKey: "repeat", values: ENUMS.repeat },
        nav("backlight", "Backlight Timer", "backlight"),
        { id: "clicker", title: "Clicker", action: "inline-toggle", toggleKey: "clicker", values: ENUMS.clicker },
        nav("reset-settings", "Reset All Settings", "reset-settings"),
      ],
    },
    about: {
      view: "list",
      title: () => "About",
      selectHold: { ms: BRICK_HOLD_MS, target: "brick" },
      items: () => [
        { id: "ipod", title: "iPod", action: "info", centered: true },
        { id: "songs-count", title: "Songs", action: "info", value: nf.format(DATA.songs.length) },
        { id: "capacity", title: "Capacity", action: "info", value: gb.format(9.2) },
        { id: "available", title: "Available", action: "info", value: gb.format(4.5) },
        { id: "version", title: "Version", action: "info", value: VERSION },
      ],
    },
    backlight: {
      view: "list",
      title: () => "Backlight Timer",
      items: () => BACKLIGHT_MODES.map((m) => ({ id: m.mode, title: m.label, action: "toggle", target: m.mode })),
    },
    "reset-settings": {
      view: "list",
      title: () => "Reset All Settings",
      forgetsSelection: true,
      items: () => [
        { id: "cancel", title: "Cancel", action: "cancel" },
        { id: "reset-all", title: "Reset", action: "reset-all" },
      ],
    },
    playlists: {
      view: "list",
      title: () => "Playlists",
      items: () => orNoMusic(DATA.playlists.map((p) => nav(p.id, p.name, "playlist-tracks", { contextId: p.id }))),
    },
    artists: {
      view: "list",
      title: () => "Artists",
      items: () => {
        const items = DATA.artists.map((a) => nav(a.id, a.name, "artist-tracks", { contextId: a.id }));
        if (items.length && DATA.songs.length) items.unshift(nav("all", "All", "songs", { screenTitle: "All Songs" }));
        return orNoMusic(items);
      },
    },
    songs: { view: "list", title: () => "Songs", items: () => trackItems(DATA.songs) },
    "playlist-tracks": {
      view: "list",
      title: ({ contextId }) => DATA.playlists.find((p) => p.id === contextId)?.name ?? "Playlists",
      items: ({ contextId }) => trackItems(listSongs("playlist-tracks", contextId)),
    },
    "artist-tracks": {
      view: "list",
      title: ({ contextId }) => DATA.artists.find((a) => a.id === contextId)?.name ?? "Artists",
      items: ({ contextId }) => trackItems(listSongs("artist-tracks", contextId)),
    },
    "now-playing": { view: "now-playing", title: () => "Now Playing", blocksIdleJump: true },
    brick: { view: "brick", title: () => "Brick", blocksIdleJump: true },
  };
  const screenKey = (s) => `${s.key}:${s.contextId ?? ""}`;

  // Index of the playing song in `items`, if `items` is exactly the current queue.
  function playingIndexIn(items, { queue, currentTrackIndex }) {
    const plays = items.filter((i) => i.action === "play");
    const same = plays.length > 0 && plays.length === queue.length && plays.every((p, i) => p.songId === queue[i]?.id);
    return same ? items.indexOf(plays[currentTrackIndex]) : -1;
  }

  // Wheel speed -> rows-per-detent multiplier.
  function accelerator(cfg) {
    let speed = 0, dir, lastAt, since;
    const reset = () => (speed = 0, dir = lastAt = since = undefined);
    return {
      reset,
      next(raw, step, active) {
        if (!active) return reset(), cfg.tiers[0];
        const now = performance.now(), gap = lastAt !== undefined && now - lastAt > ACCEL_GAP_MS;
        lastAt = now;
        const v = Math.min(raw, ACCEL_MAX_SPEED);
        if (step !== dir || gap) (speed = v), (dir = step), (since = undefined);
        else speed += ACCEL_SMOOTHING * (v - speed);
        if (speed <= cfg.minSpeed) return (since = undefined), cfg.tiers[0];
        since ??= now;
        return tierFor(cfg, now - since);
      },
    };
  }
  const tierFor = (cfg, heldMs) => cfg.tiers[Math.min(cfg.tiers.length - 1, Math.floor(heldMs / cfg.tierMs))];

  // ---------------------------------------------------------------------------
  // The device
  // ---------------------------------------------------------------------------
  function mountIPod(host) {
    // ---- DOM skeleton
    const screenEl = h("div", "ipod-screen");
    const menuEl = h("div", "menu hidden");
    const titleBar = h("div", "menu-title");
    const playIcon = h("div", "play-icon");
    const battery = h("div", "battery-indicator");
    const titleText = h("div", "screen-title");
    titleBar.append(playIcon, battery, titleText);
    const body = h("div", "screen-body");
    menuEl.append(titleBar, body);
    const overlay = h("div", "overlay");
    overlay.append(svg(ICONS.note));
    screenEl.append(menuEl, overlay);

    const wheel = h("div", "click-wheel");
    const btn = (cls, icon, label) => {
      const b = h("button", `wheel-button ${cls}`);
      b.setAttribute("aria-label", label);
      b.tabIndex = -1;
      b.append(svg(icon));
      return b;
    };
    const menuBtn = btn("menu-button", ICONS.menu, "Menu");
    const backBtn = btn("back-button", ICONS.next, "Back");
    const fwdBtn = btn("forward-button", ICONS.next, "Forward");
    const ppBtn = btn("playpause-button", ICONS.playpause, "Play");
    const dividers = h("div", "wheel-dividers");
    const scrollWheel = h("div", "scroll-wheel");
    const selectBtn = h("button", "select-button");
    selectBtn.setAttribute("aria-label", "Select");
    selectBtn.tabIndex = -1;
    wheel.append(menuBtn, backBtn, fwdBtn, ppBtn, dividers, scrollWheel, selectBtn);

    const container = h("div", "ipod-container");
    container.append(screenEl, wheel);
    const inner = h("div", "ipod-shadow-inner");
    inner.append(container);
    const shadow = h("div", "ipod-shadow");
    shadow.append(inner);
    const root = h("div", "ipod");
    root.append(shadow);
    host.append(root);

    // ---- state
    let stack = [{ key: "main" }];
    let selected = 0;
    let userMovedSelection = false; // suppress now-playing sync after the user scrolls
    let items = [];
    let currentView; // { kind, el, update?, destroy? , list? }
    let isLoading = true;
    let isOnline = navigator.onLine;
    const remembered = new Map();
    let queueSourceKey;
    const listAccel = accelerator(LIST_ACCEL);
    const seekAccel = accelerator(SEEK_ACCEL);

    const top = () => stack[stack.length - 1];
    const def = (s = top()) => SCREENS[s.key];
    const inert = () => isLoading || !isOnline;
    const P = () => player.get();
    const itemsFor = (s) =>
      def(s).items?.({ contextId: s.contextId, hasNowPlaying: s.key === "main" && P().queue.length > 0 }) ?? [];

    // ---- backlight
    const backlight = (() => {
      let mode = settings.get().backlight, lit = mode === "always_on", manual = false, restore = false, t;
      const apply = () => screenEl.classList.toggle("backlit", lit);
      const clear = () => (clearTimeout(t), (t = undefined));
      settings.subscribe(({ backlight: b }) => {
        if (b === mode) return;
        mode = b;
        manual = restore = false;
        clear();
        lit = mode === "always_on" ? true : mode === "off" ? false : lit;
        apply();
        if (mode !== "always_on" && mode !== "off") activity();
      });
      function activity() {
        if (manual) return;
        if (restore) (restore = false), (lit = mode === "always_on");
        const ms = BACKLIGHT_MODES.find((m) => m.mode === mode)?.ms;
        if (ms !== undefined) {
          clear();
          lit = true;
          t = setTimeout(() => ((lit = false), apply()), ms);
        }
        apply();
      }
      apply();
      return {
        activity,
        toggle() {
          clear();
          const was = lit;
          manual = !was;
          restore = was;
          lit = manual;
          apply();
        },
      };
    })();

    // ---- now-playing idle jump
    const idleJump = timer(NOW_PLAYING_IDLE_MS, () => push({ key: "now-playing" }, true));
    let idleArmed = false;
    // Starts or stops the timer only when armed-ness flips; activity() restarts it.
    const armIdle = () => {
      const armed = P().isPlaying && !def().blocksIdleJump;
      if (armed === idleArmed) return;
      idleArmed = armed;
      armed ? idleJump.start() : idleJump.stop();
    };
    function activity() {
      if (ctx) audio();
      backlight.activity();
      if (idleArmed) idleJump.start();
    }

    // ---- seek & volume modes (Now Playing)
    const mode = { seeking: false, seekPreview: undefined, adjustingVolume: false, dragging: false };
    let pendingSeek;
    const seekCommit = timer(SEEK_COMMIT_MS, commitSeek);
    const seekIdle = timer(SEEK_IDLE_MS, () => exitSeek());
    const volumeIdle = timer(VOLUME_IDLE_MS, () => exitVolume());
    function commitSeek() {
      seekCommit.stop();
      if (pendingSeek === undefined) return;
      const t = pendingSeek;
      pendingSeek = undefined;
      player.seek(t).then(() => {
        mode.seekPreview = undefined;
        renderNowPlaying();
      });
    }
    function enterSeek() {
      exitVolume();
      mode.seeking = true;
      mode.seekPreview = undefined;
      seekIdle.start();
      renderNowPlaying();
    }
    function exitSeek() {
      if (!mode.seeking) return;
      commitSeek();
      seekIdle.stop();
      mode.seeking = false;
      renderNowPlaying();
    }
    function seekBy(delta) {
      const cur = mode.seekPreview ?? Math.floor(P().currentPlaybackTime);
      const d = P().currentPlaybackDuration;
      const t = clamp(Math.round(cur + delta), 0, d > 0 ? d : Infinity);
      seekIdle.start();
      if (t === cur) return false;
      pendingSeek = t;
      mode.seekPreview = t;
      if (!mode.dragging) seekCommit.start();
      renderNowPlaying();
      return true;
    }
    function enterVolume() {
      if (!mode.adjustingVolume) {
        mode.adjustingVolume = true;
        renderNowPlaying();
      }
      volumeIdle.start();
    }
    function exitVolume() {
      volumeIdle.stop();
      if (!mode.adjustingVolume) return;
      mode.adjustingVolume = false;
      renderNowPlaying();
    }
    const saveVolume = timer(VOLUME_SAVE_MS, () => settings.update((s) => ({ ...s, volume: Math.round(P().volume * 100) })));
    function changeVolume(delta) {
      enterVolume();
      const cur = Math.round(P().volume * 100), v = clamp(cur + delta, 0, 100);
      if (v === cur) return false;
      player.setVolume(v / 100);
      saveVolume.start();
      return true;
    }

    // ---- scroll targets
    function scrollTarget() {
      const view = def().view;
      if (view === "now-playing") return mode.seeking ? "seek" : "volume";
      return view; // "list" | "brick"
    }

    // ---- title bar
    let brickStatus = { balls: 3, score: 0 };
    function renderTitle() {
      const s = top();
      titleText.className = "screen-title";
      titleText.replaceChildren();
      if (def().view === "brick") {
        titleText.classList.add("brick-game-title");
        titleText.append(h("span", "balls-left", String(brickStatus.balls)), h("span", "game-score", String(brickStatus.score)));
      } else {
        titleText.textContent = s.screenTitle ?? def().title({ contextId: s.contextId });
      }
      renderPlayIcon();
    }
    let playIconKey;
    function renderPlayIcon() {
      const { hasLoadedItem, isPlaying } = P(), key = `${hasLoadedItem}-${isPlaying}`;
      if (key === playIconKey) return;
      playIconKey = key;
      playIcon.className = `play-icon ${isPlaying ? "play" : "pause"}${hasLoadedItem ? " visible" : ""}`;
      playIcon.replaceChildren(svg(isPlaying ? ICONS.play : ICONS.pause));
      ppBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    }

    // ---- list view
    function listView() {
      const ul = h("ul", "menu-items");
      ul.setAttribute("role", "listbox");
      const lis = items.map((item) => {
        const li = h("li", `menu-item${item.action === "info" && item.centered ? " centered" : ""}`);
        li.dataset.action = item.action;
        li.append(h("span", "item-title", item.title));
        if (item.action === "info" && item.value) li.append(h("span", "item-value", item.value));
        else if (item.action === "inline-toggle") li.append(h("span", "item-value", VALUE_LABELS[settings.get()[item.toggleKey]]));
        else if (item.action === "navigate") li.append(h("span", "chevron"));
        ul.append(li);
        return li;
      });
      let shown = -1;
      function update() {
        if (shown >= 0 && lis[shown]) lis[shown].classList.remove("selected");
        shown = selected;
        const li = lis[selected];
        if (!li) return;
        li.classList.add("selected");
        if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop;
        else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight)
          ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight;
      }
      function refreshValues() {
        items.forEach((item, i) => {
          if (item.action === "inline-toggle")
            lis[i].querySelector(".item-value").textContent = VALUE_LABELS[settings.get()[item.toggleKey]];
        });
      }
      return { kind: "list", el: ul, update, refreshValues, list: ul };
    }

    // ---- now playing view
    function marquee(text) {
      const wrap = h("div", "marquee");
      const track = h("div", "marquee-track");
      const a = h("span", "marquee-copy", text), b = h("span", "marquee-copy dup", text);
      b.setAttribute("aria-hidden", "true");
      track.append(a, b);
      wrap.append(track);
      requestAnimationFrame(() => {
        const overflow = a.offsetWidth - wrap.clientWidth > 1;
        wrap.classList.toggle("scrolling", overflow);
        track.style.setProperty("--marquee-distance", a.offsetWidth + 30);
      });
      return wrap;
    }
    function progressBar(variant) {
      const bar = h("div", `progress-bar${variant === "marker" ? " marker" : ""}`);
      const inner = h("div", variant === "marker" ? "progress-marker" : "progress-fill");
      bar.append(inner);
      return {
        el: bar,
        set(v, max) {
          const pct = max > 0 ? Math.min(100, (v * 100) / max) : 0;
          variant === "marker" ? (inner.style.left = `${pct}%`) : (inner.style.width = `${pct}%`);
        },
      };
    }
    function nowPlayingView() {
      const el = h("div", "now-playing");
      const index = h("div", "now-playing-index");
      const pos = h("span");
      const mods = h("div", "play-modifier");
      index.append(pos, mods);
      const info = h("div", "now-playing-info");
      const progress = h("div", "now-playing-progress");
      const tp = h("div", "time-and-progress");
      const fill = progressBar("fill");
      const labels = h("div", "progress-labels");
      const elapsed = h("span"), remaining = h("span");
      labels.append(elapsed, remaining);
      tp.append(fill.el, labels);
      const scrub = h("div", "scrubbing-indicator inactive");
      const marker = progressBar("marker");
      const labels2 = h("div", "progress-labels");
      const elapsed2 = h("span"), remaining2 = h("span");
      labels2.append(elapsed2, remaining2);
      scrub.append(marker.el, labels2);
      const vol = h("div", "volume-labels inactive");
      const volBar = progressBar("fill");
      vol.append(svg(ICONS.volLow), volBar.el, svg(ICONS.volHigh));
      progress.append(tp, scrub, vol);
      el.append(index, info, progress);

      let songId, indicator = "volume", modsKey;
      function update() {
        const p = P(), song = p.queue[p.currentTrackIndex];
        pos.textContent = `${nf.format(p.queuePosition + 1)} of ${nf.format(p.queue.length)}`;
        const key = `${p.shuffleMode}-${p.repeatMode}`;
        if (key !== modsKey) {
          modsKey = key;
          mods.replaceChildren();
          if (p.repeatMode === "one") mods.append(svg(ICONS.repeatOne));
          if (p.repeatMode === "all") mods.append(svg(ICONS.repeatAll));
          if (p.shuffleMode) mods.append(svg(ICONS.shuffle));
        }
        if (song && song.id !== songId) {
          songId = song.id;
          info.replaceChildren();
          const title = h("div", "song-title");
          const link = h("a");
          link.href = song.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.style.pointerEvents = "auto";
          link.append(marquee(song.name));
          title.append(link);
          info.append(title, h("div", "artist", song.artistName || ""), h("div", "album", song.albumName || ""));
        }
        const d = p.currentPlaybackDuration;
        const shown = mode.seeking && mode.seekPreview !== undefined ? mode.seekPreview : p.currentPlaybackTime;
        fill.set(shown, d);
        marker.set(d > 0 ? Math.floor(shown) : 0, d);
        const el1 = d > 0 ? fmtTime(shown) : "", rem = fmtRemaining(shown, d);
        elapsed.textContent = elapsed2.textContent = el1;
        remaining.textContent = remaining2.textContent = rem;
        volBar.set(Math.round(p.volume * 100), 100);
        const m = mode.adjustingVolume ? "volume" : mode.seeking ? "scrubbing" : "progress";
        progress.dataset.mode = m;
        if (m !== "progress") indicator = m;
        scrub.classList.toggle("inactive", indicator !== "scrubbing");
        vol.classList.toggle("inactive", indicator !== "volume");
      }
      return { kind: "now-playing", el, update };
    }
    function renderNowPlaying() {
      if (currentView?.kind === "now-playing") currentView.update();
    }

    // ---- navigation with slide transitions
    function buildView() {
      const view = def().view;
      if (view === "now-playing") return nowPlayingView();
      if (view === "brick") {
        const b = brickView((s) => {
          brickStatus = { balls: s.balls, score: s.score };
          renderTitle();
        });
        return { kind: "brick", el: b.el, brick: b, mounted: () => b.mounted(), destroy: () => b.destroy() };
      }
      return listView();
    }
    function show(back, instant = false) {
      items = itemsFor(top());
      selected = clamp(selected, 0, Math.max(0, items.length - 1));
      const old = currentView;
      currentView = buildView();
      const wrap = h("div", "screen");
      wrap.append(currentView.el);
      body.append(wrap);
      currentView.wrap = wrap;
      currentView.update?.();
      currentView.mounted?.();
      renderTitle();
      armIdle();
      if (old) {
        old.destroy?.();
        const w = body.clientWidth;
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        body.querySelectorAll(".screen").forEach((s) => s !== wrap && s !== old.wrap && s.remove());
        if (reduce || !w || instant) old.wrap.remove();
        else {
          const dir = back ? -1 : 1, ease = "cubic-bezier(0.37, 0, 0.63, 1)";
          wrap.animate([{ transform: `translateX(${dir * w}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: ease });
          old.wrap
            .animate([{ transform: "none" }, { transform: `translateX(${-dir * w}px)` }], { duration: SLIDE_MS, easing: ease, fill: "forwards" })
            .finished.then(() => old.wrap.remove(), () => old.wrap.remove());
        }
      }
    }
    function rememberSelection(s) {
      if (def(s).forgetsSelection || !items[selected]) return;
      remembered.set(screenKey(s), { id: items[selected].id, index: selected });
    }
    function rememberedIndex(s, list) {
      const r = remembered.get(screenKey(s));
      if (!r) return -1;
      return list[r.index]?.id === r.id ? r.index : list.findIndex((i) => i.id === r.id);
    }
    function initialSelection(s) {
      const list = itemsFor(s);
      if (list[0]?.action === "toggle") return Math.max(0, list.findIndex((i) => i.target === settings.get()[s.key === "backlight" ? "backlight" : s.key]));
      const playing = playingIndexIn(list, P());
      return playing >= 0 ? playing : Math.max(0, rememberedIndex(s, list));
    }
    function screenChanged() {
      const np = def().view === "now-playing";
      if (!np) {
        exitSeek();
        exitVolume();
      }
      listAccel.reset();
    }
    function push(s, idle = false) {
      if (top().key === s.key && !s.contextId) return;
      rememberSelection(top());
      top().selectedIndex = selected;
      top().scrollTop = currentView?.list?.scrollTop;
      top().suppressSync = idle && userMovedSelection;
      stack.push(s);
      selected = initialSelection(s);
      userMovedSelection = false;
      screenChanged();
      show(false);
    }
    function pop() {
      if (stack.length <= 1) return;
      rememberSelection(top());
      stack.pop();
      const s = top();
      userMovedSelection = s.suppressSync ?? false;
      const list = itemsFor(s);
      const playing = playingIndexIn(list, P());
      selected = playing >= 0 && !userMovedSelection ? playing : Math.max(0, rememberedIndex(s, list));
      screenChanged();
      show(true);
      if (currentView.list && selected === s.selectedIndex && s.scrollTop !== undefined) {
        currentView.list.scrollTop = s.scrollTop;
        currentView.update();
      }
    }

    // ---- actions
    function moveSelection(delta) {
      if (!items.length) return false;
      const n = clamp(selected + delta, 0, items.length - 1);
      if (n === selected) return false;
      selected = n;
      userMovedSelection = true;
      currentView.update?.();
      return true;
    }
    function move(step, count) {
      switch (scrollTarget()) {
        case "seek":
          return seekBy(step * count);
        case "volume":
          return changeVolume(step * count);
        case "list":
          return moveSelection(step * count);
        default:
          return false;
      }
    }
    function startQueue(songs, index, source) {
      queueSourceKey = source ? screenKey(source) : undefined;
      player.play(songs, index);
      push({ key: "now-playing" });
    }
    function select() {
      const view = def().view;
      if (view === "brick") return currentView.brick.launch();
      if (view === "now-playing") {
        if (mode.adjustingVolume) return exitVolume();
        if (!P().hasLoadedItem) return;
        return mode.seeking ? exitSeek() : enterSeek();
      }
      const item = items[selected];
      if (!item) return;
      switch (item.action) {
        case "navigate":
          return push({ key: item.target, contextId: item.contextId, screenTitle: item.screenTitle });
        case "inline-toggle": {
          const cur = settings.get()[item.toggleKey];
          const nextVal = item.values[(item.values.indexOf(cur) + 1) % item.values.length];
          settings.update((s) => ({ ...s, [item.toggleKey]: nextVal }));
          return currentView.refreshValues();
        }
        case "toggle":
          chooseBacklight(item.target);
          return pop();
        case "cancel":
          return pop();
        case "reset-all":
          resetSettings();
          player.setVolume(settings.get().volume / 100);
          return pop();
        case "play": {
          const plays = items.filter((i) => i.action === "play");
          const idx = plays.indexOf(item);
          if (playingIndexIn(items, P()) === selected) {
            P().isPlaying || player.resume();
            return push({ key: "now-playing" });
          }
          return startQueue(songsFor(plays.map((p) => p.songId)), idx, top());
        }
      }
    }
    function playPause() {
      const p = P();
      if (p.hasLoadedItem) return p.isPlaying ? player.pause() : player.resume();
      if (p.isLoading) return player.pause();
      const item = items[selected];
      if (item?.action === "navigate" && ["songs", "playlist-tracks", "artist-tracks"].includes(item.target)) {
        const songs = listSongs(item.target, item.contextId);
        if (songs.length) return startQueue(songs, undefined, { key: item.target, contextId: item.contextId });
      }
      if (item?.action === "play") return select();
      if (p.queue.length) player.resume();
    }
    function selectHold() {
      const hold = def().selectHold;
      if (hold) push({ key: hold.target });
    }

    // Seek scanning while back/forward is held.
    const scan = (() => {
      let base, track, count = 0;
      return {
        step(dir, repeat) {
          const p = P();
          if (!repeat) (base = inert() ? undefined : p.currentPlaybackTime), (track = p.currentTrackIndex), (count = 0);
          const d = p.currentPlaybackDuration;
          if (base === undefined || inert() || mode.seeking || !p.hasLoadedItem || d <= 0 || p.currentTrackIndex !== track) return;
          const t = clamp(base + dir * SCAN_STEPS[Math.min(count, SCAN_STEPS.length - 1)], 0, d);
          count += 1;
          base = t > 0 && t < d ? t : undefined;
          activity();
          player.seek(t);
        },
      };
    })();

    // ---- wheel scrolling -> detents -> moves + clicks
    function playClicks(n, target) {
      if (settings.get().clicker !== "on" || target === "seek") return;
      for (let i = 0; i < n; i++) clicker.play();
    }
    const detents = (() => {
      let acc = 0, volAcc = 0, lastStep, lastVolume, movedSinceClick = false;
      const reset = () => ((acc = 0), (volAcc = 0), (movedSinceClick = false));
      return {
        reset,
        scroll({ step, degrees, target, multiplier }) {
          const isVol = target === "volume";
          if (step !== lastStep || isVol !== lastVolume) (lastStep = step), (lastVolume = isVol), reset();
          acc += degrees;
          if (isVol) {
            const n = Math.floor(acc / VOLUME_DEG_PER_STEP);
            acc -= n * VOLUME_DEG_PER_STEP;
            if (n >= 1) movedSinceClick = move(step, n) || movedSinceClick;
            volAcc += degrees;
            const c = Math.floor(volAcc / VOLUME_CLICK_DEG);
            volAcc -= c * VOLUME_CLICK_DEG;
            if (c >= 1 && movedSinceClick) playClicks(c, "volume"), (movedSinceClick = false);
            return;
          }
          const n = Math.floor(acc / DRAG_STEP_DEG);
          acc -= n * DRAG_STEP_DEG;
          if (n >= 1 && move(step, n * multiplier)) playClicks(n, target);
        },
      };
    })();
    function accelerate(speed, step) {
      const target = scrollTarget();
      const s = seekAccel.next(speed, step, mode.seeking);
      const l = listAccel.next(speed, step, target === "list");
      return target === "seek" ? s : l;
    }
    function onWheelScroll({ step, degrees, speed }) {
      activity();
      if (inert()) return;
      const target = scrollTarget();
      if (target === "brick") return currentView.brick.move((step * degrees) / 360);
      if (mode.seeking) seekIdle.start();
      detents.scroll({ step, degrees, target, multiplier: accelerate(speed, step) });
    }
    function onKeyScroll(step, heldMs) {
      activity();
      if (inert()) return;
      const target = scrollTarget();
      let moved = false;
      if (target === "seek") moved = move(step, tierFor(SEEK_ACCEL, heldMs));
      else if (target === "volume") moved = move(step, VOLUME_KEY_STEP);
      else if (target === "list") moved = move(step, tierFor(LIST_ACCEL, heldMs));
      if (moved) playClicks(1, target);
    }

    // Pointer tracking on the scroll ring (angular deltas, deadzone, hysteresis).
    (() => {
      let pointer, prev, prevT, dir, reverseAcc = 0;
      const angle = ({ x, y }) => (Math.atan2(y, x) * 180) / Math.PI;
      const delta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
      const segDist2 = (a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : clamp(-(a.x * dx + a.y * dy) / len, 0, 1);
        const px = a.x + t * dx, py = a.y + t * dy;
        return px * px + py * py;
      };
      const locate = (e) => {
        const r = scrollWheel.getBoundingClientRect();
        const rad = Math.min(r.width, r.height) / 2, x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
        const d2 = x * x + y * y, ex = rad * SELECT_RATIO;
        return { offset: { x, y }, radius: rad, within: d2 <= rad * rad + 1e-6 && d2 >= ex * ex };
      };
      scrollWheel.addEventListener("pointerdown", (e) => {
        if (pointer !== undefined) return;
        const { offset, within } = locate(e);
        if (!within) return;
        audio();
        activity();
        pointer = e.pointerId;
        prev = offset;
        prevT = e.timeStamp;
        scrollWheel.setPointerCapture?.(pointer);
        wheel.classList.add("dragging");
        detents.reset();
        if (!inert()) (mode.dragging = true), seekCommit.stop();
      });
      scrollWheel.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pointer) return;
        const { offset, radius } = locate(e);
        const a = prev, dt = e.timeStamp - prevT, dead = radius * DEADZONE_RATIO;
        prev = offset;
        prevT = e.timeStamp;
        if (segDist2(a, offset) < dead * dead) return;
        const d = delta(angle(a), angle(offset));
        if (d === 0) return;
        const s = d > 0 ? 1 : -1, deg = Math.abs(d);
        if (dir === undefined || s === dir) (dir = s), (reverseAcc = 0);
        else {
          reverseAcc += deg;
          if (reverseAcc < REVERSE_HYSTERESIS_DEG) return;
          dir = s;
          reverseAcc = 0;
        }
        onWheelScroll({ step: dir, degrees: deg, speed: dt > 0 ? (deg / dt) * 1000 : 0 });
      });
      const end = (e) => {
        if (e.pointerId !== pointer) return;
        scrollWheel.releasePointerCapture?.(pointer);
        pointer = prev = prevT = dir = undefined;
        reverseAcc = 0;
        wheel.classList.remove("dragging");
        mode.dragging = false;
        if (pendingSeek !== undefined) seekCommit.start();
      };
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => scrollWheel.addEventListener(t, end));
      // Trackpad / mouse-wheel convenience (not in the original).
      let wheelAcc = 0;
      scrollWheel.addEventListener("wheel", (e) => {
        e.preventDefault();
        wheelAcc += e.deltaY;
        while (Math.abs(wheelAcc) >= 40) {
          const s = Math.sign(wheelAcc);
          wheelAcc -= s * 40;
          onWheelScroll({ step: s, degrees: DRAG_STEP_DEG, speed: 0 });
        }
      }, { passive: false });
    })();

    // Buttons with press vs. long-press (with optional repeat).
    function pressable(el, { press, hold, holdMs = () => HOLD_MS, repeatMs, enabled = () => true }) {
      let pid, held = false;
      const t = holdTimer((repeat) => ((held = true), hold?.(repeat)));
      el.addEventListener("pointerdown", (e) => {
        if (!e.isPrimary || e.button !== 0 || pid !== undefined) return;
        audio();
        activity();
        pid = e.pointerId;
        held = false;
        if (hold && enabled()) t.start(holdMs(), repeatMs);
      });
      const release = (e, fire) => {
        if (e.pointerId !== pid) return;
        pid = undefined;
        const fired = t.stop();
        if (fire && !fired && !held) press?.();
      };
      el.addEventListener("pointerup", (e) => release(e, true));
      el.addEventListener("pointercancel", (e) => release(e, false));
      el.addEventListener("pointerleave", (e) => release(e, false));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    const guarded = (fn) => (...a) => !inert() && fn(...a);
    pressable(menuBtn, { press: guarded(pop), hold: () => backlight.toggle() });
    pressable(backBtn, {
      press: guarded(() => def().view !== "brick" && !mode.seeking && player.skipPrevious()),
      hold: (r) => def().view !== "brick" && scan.step(-1, r),
      repeatMs: HOLD_REPEAT_MS,
    });
    pressable(fwdBtn, {
      press: guarded(() => def().view !== "brick" && !mode.seeking && player.skipNext()),
      hold: (r) => def().view !== "brick" && scan.step(1, r),
      repeatMs: HOLD_REPEAT_MS,
    });
    pressable(ppBtn, { press: guarded(playPause) });
    pressable(selectBtn, {
      press: guarded(select),
      hold: guarded(selectHold),
      holdMs: () => def().selectHold?.ms ?? HOLD_MS,
      enabled: () => !!def().selectHold,
    });

    // Keyboard, mapped the way the original wheel maps it.
    (() => {
      let key, action, startedAt, steering = false;
      const t = holdTimer((repeat) => {
        if (!action) return;
        if (action.kind === "scroll") return onKeyScroll(action.step, performance.now() - startedAt);
        if (action.button === "menu") return backlight.toggle();
        if (action.button === "select") return guarded(selectHold)();
        if (action.button === "back") return scan.step(-1, repeat);
        if (action.button === "forward") return scan.step(1, repeat);
      });
      const pressFns = {
        menu: guarded(pop),
        select: guarded(select),
        playpause: guarded(playPause),
        back: guarded(() => !mode.seeking && player.skipPrevious()),
        forward: guarded(() => !mode.seeking && player.skipNext()),
      };
      function mapKey(k) {
        const target = scrollTarget();
        switch (k) {
          case "ArrowUp":
          case "ArrowDown":
            if (target === "brick") return { kind: "none" };
            return { kind: "scroll", step: k === (target === "list" ? "ArrowDown" : "ArrowUp") ? 1 : -1 };
          case "ArrowLeft":
          case "ArrowRight": {
            const left = k === "ArrowLeft";
            if (target === "seek") return { kind: "scroll", step: left ? -1 : 1 };
            if (target === "brick") return { kind: "steer", step: left ? -1 : 1 };
            if (target === "volume") return { kind: "hold", button: left ? "back" : "forward", repeat: HOLD_REPEAT_MS };
            return { kind: "press", button: left ? "menu" : "select" };
          }
          case "Enter":
            return def().selectHold ? { kind: "hold", button: "select", duration: def().selectHold.ms } : { kind: "press", button: "select" };
          case " ":
            return { kind: "press", button: "playpause" };
          case "Escape":
            return { kind: "hold", button: "menu" };
        }
      }
      function finish(fire) {
        const a = action, fired = t.stop();
        key = action = undefined;
        if (!a) return;
        if (a.kind === "steer") return currentView.brick?.steer(0);
        if ((a.kind === "press" || a.kind === "hold") && fire && !fired) pressFns[a.button]();
      }
      window.addEventListener("keydown", (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return finish(false);
        const a = mapKey(e.key);
        if (!a) return;
        e.preventDefault();
        audio();
        if (e.repeat || e.key === key) return;
        finish(false);
        activity();
        key = e.key;
        action = a;
        startedAt = performance.now();
        if (a.kind === "scroll") onKeyScroll(a.step, 0), t.start(KEY_REPEAT_DELAY_MS, KEY_REPEAT_MS);
        else if (a.kind === "steer") currentView.brick?.steer(a.step);
        else if (a.kind === "hold") t.start(a.duration ?? HOLD_MS, a.repeat);
      });
      window.addEventListener("keyup", (e) => {
        if (e.key === key) e.preventDefault(), finish(true);
      });
      window.addEventListener("blur", () => finish(false));
    })();

    // ---- reactions to playback and settings
    let lastTrack, lastQueue;
    player.subscribe((p) => {
      renderPlayIcon();
      renderNowPlaying();
      armIdle();
      // Track change: keep list selection on the playing song unless the user moved away.
      if (p.queue !== lastQueue || p.currentTrackIndex !== lastTrack) {
        if (mode.seeking && p.queue === lastQueue) exitSeek();
        lastQueue = p.queue;
        lastTrack = p.currentTrackIndex;
        if (currentView?.kind === "list") {
          const i = playingIndexIn(items, p);
          if (i >= 0 && !userMovedSelection) (selected = i), currentView.update();
        }
      }
      if (p.hasLoadedItem && mode.seeking && mode.seekPreview > p.currentPlaybackDuration && p.currentPlaybackDuration > 0)
        mode.seekPreview = p.currentPlaybackDuration;
    });
    player.onQueueFinished(() => {
      remembered.delete(queueSourceKey);
      if (def().view === "now-playing") pop();
      else if (top().key === "main") show(false, true); // drop the Now Playing row
    });
    settings.subscribe((s) => {
      player.setShuffle(s.shuffle === "songs");
      player.setRepeatMode({ off: "none", one: "one", all: "all" }[s.repeat]);
    });

    // ---- loading / offline overlays
    function setOverlay() {
      overlay.replaceChildren();
      if (!isOnline) {
        overlay.append(svg(ICONS.sad), h("div", "", "You are not connected to the internet"));
        overlay.hidden = false;
        menuEl.classList.add("hidden");
        player.pause();
      } else if (isLoading) {
        overlay.append(svg(ICONS.note));
        overlay.hidden = false;
        menuEl.classList.add("hidden");
      } else {
        overlay.hidden = true;
        menuEl.classList.remove("hidden");
      }
      currentView?.brick?.setPaused(inert());
    }
    addEventListener("online", () => ((isOnline = true), setOverlay()));
    addEventListener("offline", () => ((isOnline = false), setOverlay()));

    show(false);
    setOverlay();
    setTimeout(() => {
      isLoading = false;
      setOverlay();
    }, MIN_LOADING_MS);
  }

  mountIPod(document.getElementById("ipod"));
})();
