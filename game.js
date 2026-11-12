(() => {
  'use strict';
  const canvas = document.getElementById('game');
  // alpha:false: the game fills the full frame every tick, so the compositor
  // gets an opaque fast path (measurable on phones).
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = id => document.getElementById(id);
  const W = 960, H = 540;
  const CHARACTERS = window.SofaCharacters;
  const CHARACTER_IDS = Object.keys(CHARACTERS);
  const RULES = window.SofaRules;
  const RULE_IDS = Object.keys(RULES);
  const requestedRule = new URLSearchParams(location.search).get('rule');
  const forcedRule = Object.prototype.hasOwnProperty.call(RULES, requestedRule) ? requestedRule : null;
  const keys = new Set();
  const mobile = { x: 0, y: 0 };
  const CAPTURE_SECONDS = 1.6;
  const ROUND_SECONDS = 18;
  const WIN_SCORE = 3;
  const HIGHLIGHT_FPS = 12;
  const HIGHLIGHT_SECONDS = 2.4;
  const HIGHLIGHT_FRAME_COUNT = Math.round(HIGHLIGHT_FPS * HIGHLIGHT_SECONDS);
  // One sofa stays in the visible middle band; extra sofas use mirror-symmetric layouts
  // so both players start equally far away. Multi-sofa matches switch mobile to the
  // full 16:9 view (body.multi-sofa) so every sofa is on screen.
  const SINGLE_SEAT_SPOTS = [[480, 312], [480, 258], [480, 368]];
  const TWO_SEAT_LAYOUTS = [
    [[268, 252], [692, 252]],
    [[268, 312], [692, 312]],
    [[268, 374], [692, 374]]
  ];
  const THREE_SEAT_LAYOUTS = [
    [[480, 250], [288, 374], [672, 374]],
    [[480, 374], [288, 250], [672, 250]],
    [[480, 312], [268, 252], [692, 252]]
  ];
  const MULTI_SEAT_SPOTS = [[480, 312], [480, 250], [480, 374], [268, 252], [692, 252], [268, 312], [692, 312], [268, 374], [692, 374]];
  const SEAT_MIN_GAP = 200;
  const CAPTURE_RADIUS = 89;
  const narrowScreen = () => window.matchMedia('(max-width: 760px)').matches;
  const isDesktop = () => !narrowScreen() && !('ontouchstart' in window) && window.innerWidth > 760;
  const playArea = () => {
    // Online simulation must be identical on every screen. The mobile online view
    // renders the full arena instead of applying the single-player crop bounds.
    if (game.mode === 'online' || !narrowScreen()) return [41, W - 41];
    // Single sofa keeps the tight 4:5 crop; several sofas widen to a 4:3 crop so
    // the outer seats stay visible, and players stay inside that band.
    return document.body.classList.contains('multi-sofa') ? [150, W - 150] : [300, 660];
  };
  // Apply desktop fullscreen mode automatically
  if (isDesktop()) {
    document.body.classList.add('desktop-mode');
  }
  // Listen for resize to toggle desktop mode
  window.addEventListener('resize', () => {
    if (isDesktop()) {
      document.body.classList.add('desktop-mode');
    } else {
      document.body.classList.remove('desktop-mode');
    }
  });
  let players = [makePlayer(0), makePlayer(1)];
  const highlightPool = Array.from({ length: HIGHLIGHT_FRAME_COUNT }, () => {
    const frame = document.createElement('canvas');
    frame.width = 480; frame.height = 270;
    return frame;
  });
  let musicOn = true;
  let sfxOn = true;
  let musicStyle = 'cheerful';
  try {
    musicOn = localStorage.getItem('sofa-duel-audio-music') !== 'off';
    sfxOn = localStorage.getItem('sofa-duel-audio-sfx') !== 'off';
    musicStyle = localStorage.getItem('sofa-duel-music-style') || 'cheerful';
  } catch (_) {}
  const game = { mode: 'cpu', difficulty: 'normal', lastCpuPick: null, phase: 'menu', manualPicks: ['dash', 'guard'], picks: ['dash', 'guard'], scores: [0, 0], capture: [0, 0], time: ROUND_SECONDS, seats: [], sofaCount: 1, matchSofas: 1, lastSeatLayout: '', rule: null, previousRule: null, ruleHistory: [], ruleTarget: null, ruleMove: null, rulePhase: 'idle', elapsed: 0, round: 0, tiedRounds: 0, wait: 0, bannerTime: 0, bannerSeq: 0, playTipTime: 0, bannerText: '', particles: [], shake: 0, hitStop: 0, paused: false, audio: (() => { try { return localStorage.getItem('sofa-duel-audio') !== 'off'; } catch (_) { return true; } })(), audioContext: null, replay: null, highlightFrames: [], highlightClock: 0, lastImpact: null, standoff: false, combo: [0, 0], maxCombo: [0, 0], mashCounts: [0, 0], stats: loadStats(), music: null, musicGain: null, achievementQueue: [], currentAchievement: null };
  let last = performance.now();
  let lastBumpAt = 0;  // throttle the body-squeeze thud
  let lastCaptureTickAt = 0;  // throttle the capture heartbeat
  function makePlayer(i) {
    return {
      i, characterId: i ? 'guard' : 'dash', x: i ? 740 : 220, y: 360,
      vx: 0, vy: 0, facingX: i ? -1 : 1, facingY: 0,
      dashLeft: 0, dashHit: false, shieldLeft: 0, shieldHit: false,
      pulseLeft: 0, pullLeft: 0, warpLeft: 0,
      reboundLeft: 0, reboundX: 0, reboundY: 0, reboundPower: 0,
      trap: null, skillCooldown: 0, stunned: 0, blink: 0, walk: 0,
      aiDecision: 0, wantsSkill: false, anim: i * 1.7,
      emotion: 'neutral', emotionLeft: 0, castLeft: 0, castTotal: .4,
      impactLeft: 0, celebrateLeft: 0,
      vampireLeft: 0, knightLeft: 0, knightHitCooldowns: [],
      knightRadius: 0, knightStun: 0, knightPower: 0,
      ninjaLeft: 0, ninjaClone: null, ninjaTrail: [], speedBoost: 0, boostFactor: 1,
      mageProjectile: null
    };
  }
  function nearestOpponent(p) {
    let best = null, bestDistance = Infinity;
    for (const q of players) {
      if (q === p) continue;
      const distance = dist(p, q);
      if (distance < bestDistance) { bestDistance = distance; best = q; }
    }
    return best;
  }
  function tone(frequency = 440, duration = .09, type = 'sine', volume = .055, slide = 1) {
    if (!sfxOn) return;
    if (!game.audio) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = game.audioContext || (game.audioContext = new AC());
      if (ac.state === 'suspended') ac.resume();
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type; osc.frequency.setValueAtTime(frequency, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * slide), ac.currentTime + duration);
      gain.gain.setValueAtTime(Math.min(1, volume * 2.5), ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + duration);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + duration);
    } catch (_) { /* Audio is optional. */ }
  }
  function characterSound(p, event) {
    const character = CHARACTERS[p.characterId];
    const settings = {
      skill: [1.2, .13, 1.45, .035],
      hit: [.72, .12, .68, .045],
      block: [1.55, .16, 1.2, .05],
      win: [1.25, .2, 1.5, .055],
      lose: [.82, .2, .72, .035]
    }[event] || [1, .1, 1, .035];
    const [pitch, duration, slide, volume] = settings;
    tone(character.pitch * pitch, duration, character.wave, volume, slide);
    if (event === 'win') setTimeout(() => tone(character.pitch * 1.8, .16, 'triangle', .04, 1.12), 85);
  }
  function loadStats() {
    try {
      const saved = localStorage.getItem('sofa-duel-stats');
      return saved ? JSON.parse(saved) : { matches: 0, wins: 0, totalScore: 0, maxCombo: 0, achievements: [], fastestWin: Infinity };
    } catch (_) { return { matches: 0, wins: 0, totalScore: 0, maxCombo: 0, achievements: [], fastestWin: Infinity }; }
  }
  function saveStats() {
    try { localStorage.setItem('sofa-duel-stats', JSON.stringify(game.stats)); } catch (_) {}
  }
  function updateStats(winner, localIndex = 0) {
    const iWon = winner === localIndex;
    game.stats.matches++;
    if (iWon) game.stats.wins++;
    game.stats.totalScore += game.scores[localIndex];
    game.stats.maxCombo = Math.max(game.stats.maxCombo, game.maxCombo[localIndex]);
    const matchTime = game.round * ROUND_SECONDS + (ROUND_SECONDS - game.time);
    if (iWon && matchTime < game.stats.fastestWin) game.stats.fastestWin = matchTime;
    checkAchievements();
    saveStats();
  }
  function checkAchievements() {
    const newAchievements = [];
    if (game.stats.matches >= 1 && !game.stats.achievements.includes('first-match')) newAchievements.push({ id: 'first-match', title: '初出茅庐', desc: '完成第一场比赛' });
    if (game.stats.matches >= 10 && !game.stats.achievements.includes('regular-player')) newAchievements.push({ id: 'regular-player', title: '常客', desc: '完成 10 场比赛' });
    if (game.stats.wins >= 5 && !game.stats.achievements.includes('sofa-king')) newAchievements.push({ id: 'sofa-king', title: '沙发之王', desc: '赢得 5 场比赛' });
    if (game.stats.maxCombo >= 3 && !game.stats.achievements.includes('combo-master')) newAchievements.push({ id: 'combo-master', title: '连击大师', desc: '达成 3 连击' });
    if (game.stats.fastestWin < Infinity && game.stats.fastestWin < 60 && !game.stats.achievements.includes('speed-demon')) newAchievements.push({ id: 'speed-demon', title: '闪电战', desc: '60 秒内赢得比赛' });
    if (game.stats.totalScore >= 30 && !game.stats.achievements.includes('high-scorer')) newAchievements.push({ id: 'high-scorer', title: '得分高手', desc: '累计得到 30 分' });
    for (const ach of newAchievements) {
      game.stats.achievements.push(ach.id);
      game.achievementQueue.push(ach);
    }
    if (!game.currentAchievement && game.achievementQueue.length > 0) showNextAchievement();
  }
  function showNextAchievement() {
    if (game.achievementQueue.length === 0) { game.currentAchievement = null; return; }
    const ach = game.achievementQueue.shift();
    game.currentAchievement = ach;
    const el = $('achievement-popup');
    el.querySelector('.ach-title').textContent = ach.title;
    el.querySelector('.ach-desc').textContent = ach.desc;
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => showNextAchievement(), 400);
    }, 2800);
  }
  function startBackgroundMusic() {
    if (!game.audio || !musicOn || game.music) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = game.audioContext || (game.audioContext = new AC());
      // Resume audio context on user interaction (browser autoplay policy)
      if (ac.state === 'suspended') {
        ac.resume().then(() => {
          if (ac.state === 'running') startBackgroundMusic();
        });
        return;
      }
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(.28, ac.currentTime + 1.2);
      gain.connect(ac.destination);
      game.musicGain = gain;
      // Music styles: cheerful (轻快), energetic (激情), relaxed (舒缓)
      const styles = {
        cheerful: {
          tempo: 140, // BPM
          scale: [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25], // C major pentatonic + octave
          chordProg: [[0,2,4], [3,5,7], [4,6,1], [0,2,4]], // I-IV-V-I
          bassPattern: [1, 0, 1, 0, 1, 0, 1, 0],
          melodyPattern: [1, 0, 1, 1, 0, 1, 0, 1],
          wave: 'sine',
          bassWave: 'triangle'
        },
        energetic: {
          tempo: 160,
          scale: [329.63, 369.99, 415.30, 440.00, 493.88, 554.37, 622.25, 659.25], // E major
          chordProg: [[0,2,4], [2,4,6], [3,5,7], [0,2,4]],
          bassPattern: [1, 1, 0, 1, 1, 0, 1, 1],
          melodyPattern: [1, 1, 1, 0, 1, 1, 1, 1],
          wave: 'square',
          bassWave: 'sawtooth'
        },
        relaxed: {
          tempo: 90,
          scale: [220.00, 246.94, 277.18, 293.66, 329.63, 369.99, 415.30, 440.00], // A minor
          chordProg: [[0,2,4], [4,6,1], [5,0,2], [0,2,4]],
          bassPattern: [1, 0, 0, 1, 0, 0, 1, 0],
          melodyPattern: [1, 0, 1, 0, 1, 0, 1, 0],
          wave: 'sine',
          bassWave: 'sine'
        }
      };
      const style = styles[musicStyle] || styles.cheerful;
      const beatDuration = 60 / style.tempo;
      let beatIndex = 0;
      let chordIndex = 0;
      const playNote = (freq, startTime, duration, type = 'sine', volume = .3) => {
        const osc = ac.createOscillator();
        const oscGain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        oscGain.gain.setValueAtTime(volume, startTime);
        oscGain.gain.exponentialRampToValueAtTime(.001, startTime + duration);
        osc.connect(oscGain);
        oscGain.connect(gain);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      const loopMusic = () => {
        if (!game.music) return;
        const now = ac.currentTime;
        const chord = style.chordProg[chordIndex % style.chordProg.length];
        // Play 8 beats per loop
        for (let i = 0; i < 8; i++) {
          const beatTime = now + i * beatDuration;
          // Bass line
          if (style.bassPattern[i]) {
            const bassFreq = style.scale[chord[0]] / 2;
            playNote(bassFreq, beatTime, beatDuration * .8, style.bassWave, .35);
          }
          // Chord pads
          if (i === 0) {
            for (const noteIdx of chord) {
              playNote(style.scale[noteIdx], beatTime, beatDuration * 7.5, style.wave, .15);
            }
          }
          // Melody
          if (style.melodyPattern[i]) {
            const melodyIdx = (chord[i % chord.length] + i) % style.scale.length;
            const melodyFreq = style.scale[melodyIdx] * 2;
            playNote(melodyFreq, beatTime, beatDuration * .6, style.wave, .22);
          }
        }
        chordIndex++;
        beatIndex += 8;
        // Dynamic tempo based on game state
        const heat = Math.max(game.combo[0], game.combo[1]);
    const suddenDeath = game.scores.filter(s => s === WIN_SCORE - 1).length >= 2;
        const tempoMult = suddenDeath ? .75 : heat >= 3 ? .8 : heat >= 2 ? .9 : 1;
        const loopDuration = beatDuration * 8 * 1000 * tempoMult;
        game.music = setTimeout(loopMusic, loopDuration);
      };
      game.music = 'playing';
      loopMusic();
    } catch (_) { game.music = null; }
  }
  function stopBackgroundMusic() {
    if (game.music) { clearTimeout(game.music); game.music = null; }
    if (game.musicGain) {
      try {
        const ac = game.musicGain.context;
        game.musicGain.gain.linearRampToValueAtTime(0, ac.currentTime + .5);
        setTimeout(() => { game.musicGain = null; }, 600);
      } catch (_) { game.musicGain = null; }
    }
  }
  function react(p, emotion, seconds = .65, celebrate = false) {
    p.emotion = emotion;
    p.emotionLeft = seconds;
    if (celebrate) p.celebrateLeft = seconds;
  }
  function showBanner(text, seconds = 1) {
    game.bannerText = text;
    game.bannerTime = seconds;
    game.bannerSeq++;
    const el = $('round-banner');
    el.textContent = text;
    el.classList.add('show');
  }
  function resetPlayers() {
    const multi = game.seats.length > 1;
    const count = players.length;
    const spawn = multi
      ? Array.from({ length: count }, (_, i) => 150 + i * (660 / Math.max(1, count - 1)))
      : game.mode === 'online' || !narrowScreen()
        ? Array.from({ length: count }, (_, i) => 230 + i * (500 / Math.max(1, count - 1)))
        : Array.from({ length: count }, (_, i) => 340 + i * (280 / Math.max(1, count - 1)));
    const spawnY = multi ? 470 : 355;
    for (let i = 0; i < count; i++) {
      const p = players[i];
      Object.assign(p, {
        characterId: game.picks[i], x: spawn[i], y: spawnY,
        vx: 0, vy: 0, facingX: i < count / 2 ? 1 : -1, facingY: 0,
        dashLeft: 0, dashHit: false, shieldLeft: 0, shieldHit: false,
        pulseLeft: 0, pullLeft: 0, warpLeft: 0,
        reboundLeft: 0, reboundX: 0, reboundY: 0, reboundPower: 0,
        trap: null, skillCooldown: 0, stunned: 0, blink: 0, walk: 0,
        aiDecision: i ? .5 + Math.random() * .6 : 0, wantsSkill: false,
        aiDeceived: false, mashTimer: 0,
        anim: i * 1.7, emotion: 'neutral', emotionLeft: 0,
        castLeft: 0, castTotal: .4, impactLeft: 0, celebrateLeft: 0,
        // Every transient skill must end at the round boundary. Otherwise a
        // clone, sword or projectile can leak into the next round and hit early.
        vampireLeft: 0, knightLeft: 0, knightHitCooldowns: [],
        knightRadius: 0, knightStun: 0, knightPower: 0,
        ninjaLeft: 0, ninjaClone: null, ninjaTrail: [], speedBoost: 0, boostFactor: 1,
        mageProjectile: null
      });
    }
  }
  function updateRuleHud() {
    const hud = $('rule-hud');
    const mashBar = $('mash-bar');
    if (mashBar) mashBar.hidden = !(game.rule && game.rule.id === 'mash' && game.rulePhase === 'active' && game.phase === 'playing');
    if (!game.rule) {
      hud.textContent = '';
      delete hud.dataset.rule;
      delete hud.dataset.phase;
      hud.classList.remove('warning');
      return;
    }
    const rule = game.rule;
    if (rule.id === 'mash' && game.rulePhase === 'active') {
      const li = localPlayerIndex();
      hud.textContent = `${rule.icon} ${rule.name} · 你 ${game.mashCounts[li]} : ${game.mashCounts[1 - li]} 对手（先到 ${rule.mashGoal} 次）`;
      if (mashBar) {
        $('mash-bar-you').style.width = Math.min(100, game.mashCounts[li] / rule.mashGoal * 100) + '%';
        $('mash-bar-foe').style.width = Math.min(100, game.mashCounts[1 - li] / rule.mashGoal * 100) + '%';
      }
      hud.dataset.rule = rule.id;
      hud.dataset.phase = game.rulePhase;
      return;
    }
    const suffix = game.rulePhase === 'warning' ? '马上生效！' :
      game.rulePhase === 'moving' ? '正在搬家！' :
      game.rulePhase === 'triggered' ? '已触发' : rule.description;
    hud.textContent = `${rule.icon} ${rule.name} · ${suffix}`;
    hud.dataset.rule = rule.id;
    hud.dataset.phase = game.rulePhase;
    hud.classList.toggle('warning', game.rulePhase === 'warning');
  }
  function clearHighlight() {
    game.replay = null;
    game.highlightFrames = [];
    game.highlightClock = 0;
    $('replay-ui').hidden = true;
  }
  function skipReplay() {
    if (!game.replay) return;
    game.replay = null;
    $('replay-ui').hidden = true;
    game.wait = Math.min(game.wait, .9);
  }
  function highlightTitle(winner, reason) {
    const name = CHARACTERS[game.picks[winner]].name;
    if (reason === 'mash') return `${name}手速碾压！`;
    if (reason === 'draw') return `${name}赢得了这场幸运对决！`;
    if (reason === 'closest') return '只差一步，也是胜利！';
    if (reason === 'timeout') return '最后一秒，守住了！';
    const impact = game.lastImpact;
    if (impact && impact.side === winner && impact.time - game.time < 2.4) {
      return {
        dash: '这一撞值回票价！', shield: '这一挡，反击漂亮！', pulse: '一下震开，机会来了！',
        blink: '这一闪，刚刚好！', pull: '拉回来，再弹走！', trap: '抱枕立大功！',
        vampire: '这一口，吸得刚刚好！', knight: '剑刃一转，胜局已定！',
        ninja: '真身抢座，分身有功！', mage: '隔空一弹，正中要害！'
      }[impact.kind] || `${name}抢到了关键位置！`;
    }
    return `${name}抢到了关键位置！`;
  }
  function startHighlight(winner, reason) {
    if (game.highlightFrames.length < 2) return;
    game.replay = { elapsed: 0, duration: HIGHLIGHT_SECONDS, title: highlightTitle(winner, reason) };
    $('replay-title').textContent = game.replay.title;
    $('replay-ui').hidden = false;
  }
  function seatLayout(count) {
    if (count <= 1) return [SINGLE_SEAT_SPOTS[Math.floor(Math.random() * SINGLE_SEAT_SPOTS.length)]];
    const layouts = count === 2 ? TWO_SEAT_LAYOUTS : THREE_SEAT_LAYOUTS;
    return layouts[Math.floor(Math.random() * layouts.length)].map(spot => [...spot]);
  }
  function seatSignature(spots) {
    return spots.map(spot => `${spot[0]}:${spot[1]}`).sort().join('|');
  }
  function nearestSeat(point) {
    let best = null, bestDistance = Infinity;
    for (const seat of game.seats) {
      const distance = dist(point, seat);
      if (distance < bestDistance) { best = seat; bestDistance = distance; }
    }
    return best;
  }
  function seatTargetAwayFrom(index) {
    const pool = game.seats.length > 1 ? MULTI_SEAT_SPOTS : SINGLE_SEAT_SPOTS;
    const seat = game.seats[index];
    const free = pool.filter(([x, y]) => {
      if (Math.hypot(seat.x - x, seat.y - y) < 40) return false;
      return game.seats.every((other, i) => i === index || Math.hypot(other.x - x, other.y - y) >= SEAT_MIN_GAP);
    });
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    let best = [seat.x, seat.y], bestGap = -1;
    for (const spot of pool) {
      let gap = Infinity;
      for (let i = 0; i < game.seats.length; i++) {
        if (i === index) continue;
        gap = Math.min(gap, Math.hypot(game.seats[i].x - spot[0], game.seats[i].y - spot[1]));
      }
      if (gap > bestGap) { bestGap = gap; best = spot; }
    }
    return best;
  }
  function newRound() {
    game.round++;
    clearHighlight();
    game.lastImpact = null;
    game.playTipTime = game.round === 1 && game.mode !== 'demo' ? 4 : 0;
    $('play-tip').classList.toggle('show', game.playTipTime > 0);
    game.capture = Array(players.length).fill(0);
    game.mashCounts = Array(players.length).fill(0);
    game.morphT = 0;
    game.morphPhase = -1;
    game.standoff = false;
    game.standoffTime = 0;
    game.standoffShown = false;
    game.time = ROUND_SECONDS;
    game.phase = 'countdown';
    game.wait = document.body.classList.contains('record-mode') ? .55 : 1.8;
    let spots = seatLayout(game.matchSofas);
    for (let attempt = 0; attempt < 4 && game.matchSofas > 1 && seatSignature(spots) === game.lastSeatLayout; attempt++) spots = seatLayout(game.matchSofas);
    game.lastSeatLayout = seatSignature(spots);
    game.seats = spots.map(([x, y]) => ({ x, y, capture: Array(players.length).fill(0), scale: 1 }));
    const choices = RULE_IDS.filter(id => id !== game.previousRule && !(players.length > 2 && id === 'mash'));
    const ruleId = forcedRule || choices[Math.floor(Math.random() * choices.length)];
    game.rule = RULES[ruleId];
    game.previousRule = ruleId;
    game.ruleHistory.push(ruleId);
    game.rulePhase = ruleId === 'frenzy' || ruleId === 'mash' || ruleId === 'morph' ? 'active' : 'idle';
    game.ruleMove = null;
    game.elapsed = 0;
    if (game.mode === 'online') {
      onlineOpponentInput = { x: 0, y: 0, skill: false };
      onlinePendingSkill = false;
    }
    if (ruleId === 'shuffle') {
      const index = Math.floor(Math.random() * game.seats.length);
      const destination = seatTargetAwayFrom(index);
      game.ruleTarget = { index, x: destination[0], y: destination[1] };
    } else {
      game.ruleTarget = null;
    }
    $('record-hook').textContent = {
      shuffle: '室友抢沙发，沙发先跑了！',
      spring: '抢沙发，沙发把人弹飞了！',
      frenzy: '室友抢沙发，技能突然加速！',
      mash: '室友抢沙发，贴身角力开始了！',
      morph: '室友抢沙发，沙发开始变形！',
      chaos: '混沌模式：所有机制随机砸下来！'
    }[ruleId] || '';
    resetPlayers();
    const suddenDeath = game.scores.filter(s => s === WIN_SCORE - 1).length >= 2;
    showBanner(`第 ${game.round} 回合 · ${game.rule.name}${suddenDeath ? ' · 决胜分！' : ''}`, suddenDeath ? 1.6 : 1.1);
    if (suddenDeath) tone(520, .2, 'triangle', .06, 1.35);
    updateRuleHud();
    updateHud();
  }
  function startMatch() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    keys.clear();
    stickEnd();
    document.body.classList.add('in-match');
    document.body.classList.remove('match-finished');
    document.body.classList.toggle('demo-mode', game.mode === 'demo');
    document.body.classList.toggle('online-match', game.mode === 'online');
    if (game.mode === 'demo') {
      const picks = [...CHARACTER_IDS];
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const picked = picks[i];
        picks[i] = picks[j];
        picks[j] = picked;
      }
      game.picks = picks.slice(0, 2);
    } else if (game.mode === 'cpu' || game.mode === 'chaos') {
      const candidates = CHARACTER_IDS.filter(id => id !== game.manualPicks[0]);
      // Avoid handing the CPU the same character two matches in a row when possible,
      // so players don't keep facing the same skill (e.g. 冲撞) repeatedly.
      const fresh = candidates.filter(id => id !== game.lastCpuPick);
      const pool = fresh.length ? fresh : candidates;
      const cpuPick = pool[Math.floor(Math.random() * pool.length)];
      game.lastCpuPick = cpuPick;
      const aiPicks = [cpuPick];
      const aiPool = [...pool];
      const wantedCount = Math.max(2, Math.min(4, game.localPlayerCount || 2));
      while (aiPicks.length < wantedCount - 1 && aiPool.length) {
        aiPicks.push(aiPool.splice(Math.floor(Math.random() * aiPool.length), 1)[0]);
      }
      game.picks = [game.manualPicks[0], ...aiPicks];
    } else {
      game.picks = [...game.manualPicks];
    }
    syncMode();
    const matchPlayers = game.mode === 'cpu' || game.mode === 'chaos' ? Math.max(2, Math.min(4, game.localPlayerCount || 2)) : game.mode === 'online' ? Math.max(2, Math.min(4, onlineRoomSize || 2)) : 2;
    // Demo matches rotate the sofa count so the showcase shows off every layout.
    // Chaos mode always uses a single sofa, only the sofa state changes.
    game.matchSofas = game.mode === 'demo' ? 1 + Math.floor(Math.random() * 3) : game.mode === 'chaos' ? 1 : game.sofaCount;
    document.body.classList.toggle('multi-sofa', game.matchSofas > 1);
    players = Array.from({ length: matchPlayers }, (_, i) => players[i] || makePlayer(i));
    game.playerCount = matchPlayers;
    game.scores = Array(matchPlayers).fill(0);
    game.combo = Array(matchPlayers).fill(0);
    game.maxCombo = Array(matchPlayers).fill(0);
    game.round = 0;
    game.tiedRounds = 0;
    game.ruleHistory = [];
    game.mashCounts = Array(matchPlayers).fill(0);
    game.morphT = 0; game.morphPhase = -1;
    game.chaosTimer = 0; game.chaosNext = 0;
    game.mashWins = Array(matchPlayers).fill(0);
    game.morphT = 0; game.morphPhase = -1;
    game.previousRule = null;
    game.lastSeatLayout = '';
    game.seats = [];
    game.particles = [];
    game.hitStop = 0;
    game.paused = false;
    $('pause-btn').textContent = '⏸';
    $('pause-btn').setAttribute('aria-label', '暂停游戏');
    $('pause-screen').classList.remove('visible');
    $('start-screen').classList.remove('visible');
    $('result-screen').classList.remove('visible');
    newRound();
    tone(450, .13);
    startBackgroundMusic();
  }
  function scorePoint(winner, reason, seat) {
    if (game.phase !== 'playing') return;
    game.standoff = false;
    game.standoffTime = 0;
    const spot = seat || nearestSeat(players[winner]) || { x: 480, y: 312 };
    game.playTipTime = 0;
    $('play-tip').classList.remove('show');
    game.scores[winner]++;
    game.combo[winner]++;
    for (let j = 0; j < players.length; j++) if (j !== winner) game.combo[j] = 0;
    game.maxCombo[winner] = Math.max(game.maxCombo[winner], game.combo[winner]);
    if (game.combo[winner] >= 2) {
      showBanner(`${CHARACTERS[game.picks[winner]].name} ${game.combo[winner]} 连击！`, 1.2);
      burst(spot.x, spot.y - 35, winner, 15 + game.combo[winner] * 5);
      tone(600 + game.combo[winner] * 80, .15, 'triangle', .05);
    }
    game.tiedRounds = 0;
    game.phase = 'roundEnd';
    startHighlight(winner, reason);
    game.wait = game.replay ? 3.3 : 2.15;
    game.shake = .18;
    burst(spot.x, spot.y - 35, winner, 30);
    react(players[winner], 'happy', 2.8, true);
    for (const p of players) if (p.i !== winner) react(p, 'sad', 2.2);
    const name = CHARACTERS[game.picks[winner]].name;
    showBanner(reason === 'draw' ? `${name}赢得平局抽签！` : reason === 'mash' ? `${name}手速碾压！` : reason === 'closest' ? `${name}更近一步！` : reason === 'timeout' ? `${name}险胜！` : `${name}抢到了！`, 1.65);
    characterSound(players[winner], 'win');
    for (const p of players) if (p.i !== winner) characterSound(p, 'lose');
    updateHud();
  }
  function finishMatch() {
    game.phase = 'finished';
    document.body.classList.add('match-finished');
    const winner = game.scores.indexOf(Math.max(...game.scores));
    updateStats(winner);
    stopBackgroundMusic();
    // Keep the host snapshot loop alive for the final result, but never queue old input into a rematch.
    if (game.mode === 'online') {
      $('online-game-hud').hidden = true;
      onlineOpponentInput = { x: 0, y: 0, skill: false };
      onlinePendingSkill = false;
      keys.clear();
      stickEnd();
      $('again-btn').disabled = false;
    }
    const localWinner = game.mode === 'online' ? onlinePlayerNumber : 0;
    $('result-title').textContent = `${CHARACTERS[game.picks[winner]].name}霸占沙发！`;
    $('result-subtitle').textContent = game.mode === 'demo' ? '自动演示即将重新开始。' : winner === localWinner ? '这张沙发，今晚归你。' : game.mode === 'online' ? '惜败！点“再来一局”马上重赛。' : '再抢一次？';
    $('result-rule').textContent = `最近规则：${game.ruleHistory.slice(-3).map(id => RULES[id].name).join(' → ')}`;
    const statsEl = $('result-stats');
    if (statsEl) {
      const best = Math.max(...game.maxCombo);
      statsEl.textContent = `本局之最：最高连击 ×${best}${players.length > 2 ? ' · ' + game.scores.map((s, i) => `${CHARACTERS[game.picks[i]].name} ${s}分`).join(' · ') : game.mashWins ? ' · 角力 ' + (game.mashWins[0] + game.mashWins[1]) + ' 胜' : ''}`;
    }
    $('result-icon').textContent = winner === localWinner ? '🏆' : '🛋️';
    $('result-screen').classList.add('visible');
    if (game.mode === 'demo') game.wait = 3.5;
  }
  function syncMode() {
    document.querySelectorAll('.mode').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === game.mode));
    const waitingForOpponent = (game.mode === 'cpu' || game.mode === 'chaos') && !document.body.classList.contains('in-match');
    $('start-btn').firstChild.textContent = game.mode === 'demo' ? '开始观看演示 ' : game.mode === 'online' ? '进入联网模式 ' : game.mode === 'chaos' ? '开始混沌抢沙发 ' : '开始人机抢沙发 ';
    $('count-selector').hidden = !(game.mode === 'cpu' || game.mode === 'chaos');
    const local = localPlayerIndex();
    // Never dereference a partial network pick array while a lobby/match transition is rendering.
    const displayed = players.map((_, i) => CHARACTERS[game.picks[i]] || CHARACTERS[game.manualPicks[i]] || CHARACTERS[CHARACTER_IDS[i % CHARACTER_IDS.length]] || CHARACTERS[CHARACTER_IDS[0]]);
    const ownCharacter = CHARACTERS[game.picks[localPlayerIndex()]] || displayed[0];
    const firstOpponent = CHARACTERS[game.picks[1 - localPlayerIndex()]] || displayed[1];
    $('player-a-label').textContent = game.mode === 'online'
      ? (waitingForOpponent ? '你' : `你·${ownCharacter.name}`)
      : `${game.mode === 'demo' ? '电脑' : '玩家一'}·${displayed[0].name}`;
    $('player-b-label').textContent = waitingForOpponent ? '随机对手'
      : game.mode === 'online'
        ? (onlineRoomSize > 2 ? `对手 ×${onlineRoomSize - 1}` : `对手·${firstOpponent.name}`)
        : `${game.mode === 'demo' || game.mode === 'cpu' || game.mode === 'chaos' ? '电脑' : '玩家二'}·${displayed[1].name}`;
    const enemySkill = displayed[1].skill;
    $('player-b-label').title = waitingForOpponent ? '本局对手角色随机' : `技能：${enemySkill.name} · ${enemySkill.description}`;
    for (let i = 0; i < 2; i++) {
      const character = displayed[i];
      const avatar = document.querySelector(i ? '.team-b .avatar' : '.team-a .avatar');
      const unknownOpponent = i === 1 && waitingForOpponent;
      avatar.textContent = unknownOpponent ? '?' : character.name.slice(0, 1);
      avatar.style.background = unknownOpponent ? '#b9b0b2' : character.color;
      avatar.style.boxShadow = `0 4px 0 ${unknownOpponent ? '#91878b' : character.dark}`;
      avatar.setAttribute('aria-label', unknownOpponent ? '随机对手' : character.name);
      $(i ? 'cap-b' : 'cap-a').style.background = character.color;
    }
    const touchCharacter = displayed[local];
    $('dash-touch').firstChild.textContent = touchCharacter.skill.name;
    $('dash-touch').style.background = touchCharacter.color;
    $('dash-touch').style.borderBottomColor = touchCharacter.dark;
    // 更新闪闪技能切换按钮
    if (typeof updateSkillToggleUI === 'function') updateSkillToggleUI();
    $('picker-b-row').hidden = game.mode !== 'duo';
    document.querySelector('.pickers').hidden = game.mode === 'demo' || game.mode === 'online';
    const diffSelector = $('difficulty-selector');
    if (diffSelector) diffSelector.hidden = !(game.mode === 'cpu' || game.mode === 'chaos');
    renderPickers();
    // Career strip: a little "one more game" pull from the saved stats.
    const strip = $('stats-strip');
    if (strip) {
      const s = game.stats;
      if (s && s.matches > 0) {
        strip.textContent = `已玩 ${s.matches} 局 · 胜 ${s.wins} · 最高连击 ${s.maxCombo || 0}${s.achievements && s.achievements.length ? ' · 成就 ' + s.achievements.length : ''}`;
        strip.hidden = false;
      } else {
        strip.hidden = true;
      }
    }
  }
  function renderPickers() {
    for (let side = 0; side < 2; side++) {
      const container = $(side ? 'picker-b' : 'picker-a');
      container.textContent = '';
      for (const id of CHARACTER_IDS) {
        const character = CHARACTERS[id];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `character-choice${game.manualPicks[side] === id ? ' selected' : ''}`;
        button.setAttribute('aria-pressed', String(game.manualPicks[side] === id));
        button.title = `${character.name}：${character.skill.description}；冷却 ${character.skill.cooldown} 秒`;
        button.setAttribute('aria-label', `${character.name}，技能${character.skill.name}，${character.skill.description}`);
        button.innerHTML = `<span class="choice-avatar" style="background:${character.color};box-shadow:inset 0 -3px 0 ${character.dark}">${character.name.slice(0, 1)}</span><span>${character.name}<small>${character.skill.name}</small></span>`;
        button.addEventListener('click', () => {
          game.manualPicks[side] = id;
          game.picks[side] = id;
          syncMode();
        });
        container.append(button);
      }
    }
    const first = CHARACTERS[game.manualPicks[0]];
    const second = CHARACTERS[game.manualPicks[1]];
    const describe = character => {
      let text = `${character.name} · ${character.personality}；${character.skill.name}：${character.skill.description}（移动 ${character.speed} · 冷却 ${character.skill.cooldown} 秒）`;
      if (character.skillAlt) {
        text += `\n${character.skillAlt.name}：${character.skillAlt.description}（冷却 ${character.skillAlt.cooldown} 秒）· Q键切换`;
      }
      return text;
    };
    $('skill-note').textContent = describe(first);
    $('skill-note-b').textContent = describe(second);
    $('skill-note-b').hidden = game.mode !== 'duo';
  }
  function returnToMenu(mode) {
    game.mode = mode;
    game.picks = [...game.manualPicks];
    game.phase = 'menu';
    game.paused = false;
    game.scores = [0, 0];
    game.combo = [0, 0];
    game.maxCombo = [0, 0];
    game.capture = [0, 0];
    game.time = ROUND_SECONDS;
    game.round = 0;
    game.rule = null;
    game.rulePhase = 'idle';
    game.ruleHistory = [];
    game.mashCounts = [0, 0];
    game.morphT = 0; game.morphPhase = -1;
    game.chaosTimer = 0; game.chaosNext = 0;
    game.mashWins = [0, 0];
    game.morphT = 0; game.morphPhase = -1;
    game.ruleTarget = null;
    game.ruleMove = null;
    game.seats = [];
    game.lastSeatLayout = '';
    document.body.classList.remove('multi-sofa');
    game.wait = 0;
    game.bannerTime = 0;
    game.playTipTime = 0;
    game.particles = [];
    game.shake = 0;
    game.hitStop = 0;
    game.lastImpact = null;
    clearHighlight();
    stopBackgroundMusic();
    stickEnd();
    updateRuleHud();
    keys.clear();
    document.body.classList.remove('in-match', 'demo-mode', 'presentation', 'match-finished', 'online-match');
    $('pause-btn').textContent = '⏸';
    $('pause-btn').setAttribute('aria-label', '暂停游戏');
    $('result-screen').classList.remove('visible');
    $('pause-screen').classList.remove('visible');
    $('online-screen').classList.remove('visible');
    $('online-game-hud').hidden = true;
    $('start-screen').classList.add('visible');
    $('round-banner').classList.remove('show');
    $('play-tip').classList.remove('show');
    syncMode();
    resetPlayers();
    updateHud();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function stopDemo() { returnToMenu('cpu'); }
  function togglePause() {
    if (game.mode === 'online' || !['playing', 'countdown', 'roundEnd'].includes(game.phase)) return;
    game.paused = !game.paused;
    game.shake = 0;
    if (game.paused) { keys.clear(); stickEnd(); }
    $('pause-btn').textContent = game.paused ? '▶' : '⏸';
    $('pause-btn').setAttribute('aria-label', game.paused ? '继续游戏' : '暂停游戏');
    $('pause-help').textContent = narrowScreen() ? '点击按钮继续。' : '按 P 或点击按钮继续。';
    $('pause-screen').classList.toggle('visible', game.paused);
    updateHud();
  }
  function enterFullscreen() {
    if (document.fullscreenElement) return;
    const wrap = document.querySelector('.game-wrap');
    const request = wrap.requestFullscreen ? wrap.requestFullscreen() : null;
    if (request && typeof request.catch === 'function') request.catch(() => document.body.classList.add('presentation'));
    else document.body.classList.add('presentation');
  }
  function exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove('presentation');
  }
  function makePoster() {
    const poster = document.createElement('canvas');
    poster.width = 1080; poster.height = 1440;
    const g = poster.getContext('2d');
    const winner = game.scores.indexOf(Math.max(...game.scores));
    const winningName = CHARACTERS[game.picks[winner]].name;
    const title = winner === 0 ? '今晚沙发归我！' : `${winningName}抢到了沙发！`;
    const fillRound = (x, y, w, h, r, color) => { g.fillStyle = color; g.beginPath(); roundedPath(g, x, y, w, h, r); g.fill(); };
    g.fillStyle = '#faf3e9'; g.fillRect(0, 0, 1080, 1440);
    g.fillStyle = '#ffe3d3'; g.beginPath(); g.arc(994, 95, 260, 0, 7); g.fill();
    g.fillStyle = '#e6f0ee'; g.beginPath(); g.arc(27, 1320, 255, 0, 7); g.fill();
    fillRound(76, 72, 66, 66, 20, '#ff6d53');
    g.fillStyle = '#fff'; g.font = '900 44px sans-serif'; g.fillText('✳', 88, 121);
    g.fillStyle = '#2b3140'; g.font = '900 42px sans-serif'; g.fillText('沙发只能坐一个', 165, 123);
    g.fillStyle = '#e9775e'; g.font = '800 25px sans-serif'; g.fillText('SOFA SHOWDOWN  ·  战绩卡', 80, 200);
    g.fillStyle = '#2b3140'; g.font = '900 74px sans-serif'; g.fillText(title, 76, 319);
    g.fillStyle = '#807f87'; g.font = '600 29px sans-serif'; g.fillText(`最近规则：${game.ruleHistory.slice(-3).map(id => RULES[id].name).join(' → ')}`, 80, 378);
    fillRound(76, 430, 928, 128, 28, '#fff');
    const panelCount = players.length;
    if (panelCount <= 2) {
      g.fillStyle = CHARACTERS[game.picks[0]].color; g.font = '900 66px sans-serif'; g.fillText(`${CHARACTERS[game.picks[0]].name}  ${game.scores[0]}`, 96, 510);
      g.fillStyle = '#cbbfba'; g.font = '900 42px sans-serif'; g.fillText('VS', 510, 510);
      g.fillStyle = CHARACTERS[game.picks[1]].color; g.font = '900 66px sans-serif'; g.textAlign = 'right'; g.fillText(`${game.scores[1]}  ${CHARACTERS[game.picks[1]].name}`, 984, 510); g.textAlign = 'left';
    } else {
      // Party match: one column per player, the current leader gets the crown.
      const bestScore = Math.max(...game.scores);
      game.picks.forEach((id, idx) => {
        const character = CHARACTERS[id];
        const cx = 76 + 928 * (idx + .5) / panelCount;
        g.textAlign = 'center';
        g.fillStyle = character.color; g.font = '900 54px sans-serif';
        g.fillText(`${game.scores[idx]}  ${character.name}${game.scores[idx] === bestScore ? ' 👑' : ''}`, cx, 495);
        g.fillStyle = '#9e8d83'; g.font = '600 24px sans-serif';
        g.fillText(idx === 0 ? '你' : '电脑', cx, 533);
      });
      g.textAlign = 'left';
    }
    g.save(); g.beginPath(); roundedPath(g, 76, 607, 928, 522, 30); g.clip(); g.drawImage(canvas, 0, 0, W, H, 76, 607, 928, 522); g.restore();
    fillRound(76, 1185, 928, 135, 28, '#ff6d53');
    g.fillStyle = '#fff'; g.font = '900 50px sans-serif'; g.fillText('你敢来抢吗？', 115, 1267);
    g.font = '600 27px sans-serif'; g.fillText('18 秒一局  ·  同屏对决', 570, 1265);
    g.fillStyle = '#aa9e97'; g.font = '500 23px sans-serif'; g.fillText('SOFA SHOWDOWN  /  三分定胜负，再来一局', 80, 1385);
    g.fillStyle = '#9e8d83'; g.font = '600 22px sans-serif'; g.fillText(`最后一回合：${game.rule.name}`, 80, 1420);
    const image = poster.toDataURL('image/png');
    $('poster-image').src = image;
    $('poster-download').href = image;
    const miniTool = window.xhs && window.xhs.miniTool;
    const saveToAlbum = miniTool && typeof miniTool.saveImageToPhotosAlbum === 'function';
    $('poster-download').hidden = Boolean(saveToAlbum);
    $('poster-save').hidden = !saveToAlbum;
    $('poster-dialog').querySelector('p').textContent = saveToAlbum ? '点击下方按钮保存到手机相册。' : '长按图片保存，或点击下方按钮下载。';
    $('poster-status').textContent = '';
    $('poster-dialog').showModal();
  }
  function updateHud() {
    $('score-a').textContent = game.scores[0];
    $('score-b').textContent = game.scores[1];
    $('timer').textContent = Math.max(0, Math.ceil(game.time));
    $('cap-a').style.width = `${Math.min(100, game.capture[0] / CAPTURE_SECONDS * 100)}%`;
    $('cap-b').style.width = `${Math.min(100, game.capture[1] / CAPTURE_SECONDS * 100)}%`;
    const extra = $('score-extra');
    if (extra) {
      if (players.length > 2) {
        extra.hidden = false;
        while (extra.children.length < players.length - 2) {
          const chip = document.createElement('div');
          chip.className = 'score-chip';
          chip.innerHTML = '<span class="dot"></span><small></small><strong>0</strong><div class="capture-track"><span></span></div>';
          extra.appendChild(chip);
        }
        for (let i = 2; i < players.length; i++) {
          const chip = extra.children[i - 2];
          const character = CHARACTERS[game.picks[i]] || CHARACTERS[CHARACTER_IDS[0]];
          chip.querySelector('.dot').style.background = character.color;
          chip.querySelector('small').textContent = (game.mode === 'online' ? '对手' : '电脑') + '·' + character.name;
          chip.querySelector('strong').textContent = game.scores[i] ?? 0;
          chip.querySelector('.capture-track span').style.width = Math.min(100, (game.capture[i] || 0) / CAPTURE_SECONDS * 100) + '%';
        }
      } else {
        extra.hidden = true;
      }
    }
    const localPlayer = players[localPlayerIndex()];
    $('dash-touch').classList.toggle('cooling', localPlayer.skillCooldown > 0);
    $('dash-touch').querySelector('small').textContent = localPlayer.skillCooldown > 0 ? `${localPlayer.skillCooldown.toFixed(1)}s` : '↗';
    $('status-label').textContent = game.paused ? '已暂停' : game.replay ? '高光回放' : game.phase === 'playing' ? '抢沙发中' : game.phase === 'countdown' ? '准备开战' : game.phase === 'roundEnd' ? '本回合结束' : game.mode === 'demo' ? '自动演示' : '先到 3 分获胜';
    // Guest watchdog: the local timer keeps ticking between snapshots, so a
    // silent host stall (locked screen, dropped network) must be visible.
if (game.mode === 'online' && onlinePlayerNumber !== 0 && onlinePlayerNumber !== null && onlineState === 'playing'
        && onlineLastSnapshotAt && performance.now() - onlineLastSnapshotAt > 3000) {
      $('status-label').textContent = '对方网络不稳定…';
} else if (game.mode === 'online' && onlinePlayerNumber !== 0 && onlinePlayerNumber !== null && onlineHostReplaying) {
      $('status-label').textContent = '对手精彩回放中…';
    }
  }
  // All instructions live in one help dialog so the start screen and mobile layout stay clean.
  function renderHelp() {
    const ruleItems = RULE_IDS.map(id => {
      const rule = RULES[id];
      return `<div class="help-item"><span class="help-icon">${rule.icon}</span><div><strong>${rule.name}</strong><p>${rule.description}</p></div></div>`;
    }).join('');
    const characterItems = CHARACTER_IDS.map(id => {
      const character = CHARACTERS[id];
      return `<div class="help-item"><span class="help-dot" style="background:${character.color}"></span><div><strong>${character.name} · ${character.skill.name}</strong><p>${character.skill.description} · 冷却 ${character.skill.cooldown} 秒</p></div></div>`;
    }).join('');
    const controls = narrowScreen()
      ? '<p>左侧摇杆移动，右侧圆形按钮放技能，按钮文字就是你的技能。</p>'
      : '<p>玩家一：W A S D 移动，空格放技能。玩家二：方向键移动，回车放技能。</p>';
    const pauseTip = narrowScreen()
      ? '<p>右上角 ⏸ 暂停，? 随时打开本帮助。</p>'
      : '<p>P 暂停，Esc 退出大屏；右上角 ? 随时打开本帮助。</p>';
    $('help-body').innerHTML = `
      <section><h3>目标</h3>
        <p>独占一张沙发 <b>1.6 秒</b>得 1 分，先拿 <b>3 分</b>获胜。每回合 18 秒，时间到按占领进度判定。</p>
        <p>两人挤在同一张沙发上时都无法占领。多张沙发时，如果对手已经坐上另一张，你的进度会冻结 —— 先去把他逼起身。</p>
      </section>
      <section><h3>操作</h3>${controls}${pauseTip}<p>开局前可选 1–3 张沙发。沙发越多，越要判断先抢哪一张、什么时候换位。</p></section>
      <section><h3>房间规则 · 每回合随机</h3>${ruleItems}</section>
      <section><h3>角色技能 · 每人只能用自己的技能</h3>${characterItems}</section>`;
  }
  function pushAway(attacker, victim, power, stun) {
    const distance = dist(attacker, victim);
    const dx = distance > 1 ? (victim.x - attacker.x) / distance : attacker.facingX;
    const dy = distance > 1 ? (victim.y - attacker.y) / distance : attacker.facingY;
    let hit = false;
    if (victim.shieldLeft > 0 && !victim.shieldHit) {
      victim.shieldHit = true;
      // Each block burns shield time: multi-block stays possible, but one
      // activation can no longer counter every attack for its full duration.
      victim.shieldLeft = Math.max(0, victim.shieldLeft - 0.75);
      attacker.dashLeft = 0;
      const counterPower = CHARACTERS[victim.characterId].skill.counterPower || 400;
      const counterVx = -dx * counterPower, counterVy = -dy * counterPower;
      const firstBlock = !victim.shieldCountered;
      victim.shieldCountered = true;
      if (firstBlock) {
        attacker.stunned = Math.max(attacker.stunned, .3);
        attacker.blink = .42;
        attacker.impactLeft = .32;
        attacker.vx = counterVx;
        attacker.vy = counterVy;
      } else {
        // Repeat blocks still deflect, but without the full counter punch.
        attacker.blink = .3;
        attacker.vx = -dx * 240;
        attacker.vy = -dy * 240;
      }
      react(victim, 'smug', .9);
      react(attacker, 'surprised', .5);
      burst(victim.x, victim.y - 15, victim.i, 22);
      burst(victim.x, victim.y - 10, victim.i, 14);
      game.lastImpact = { side: victim.i, kind: 'shield', time: game.time };
      game.hitStop = Math.max(game.hitStop, .1);
      characterSound(victim, 'block');
    } else {
      victim.dashLeft = 0;
      victim.reboundLeft = 0;
      victim.stunned = Math.max(victim.stunned, stun);
      victim.blink = .42;
      victim.impactLeft = .3;
      victim.vx = dx * power;
      victim.vy = dy * power;
      react(victim, 'dizzy', Math.max(.45, stun));
      react(attacker, 'happy', .35);
      burst(victim.x, victim.y - 15, attacker.i, 20);
      burst(victim.x, victim.y - 10, attacker.i, 12);
      game.lastImpact = { side: attacker.i, kind: CHARACTERS[attacker.characterId].skill.kind, time: game.time };
      game.hitStop = Math.max(game.hitStop, .08);
      characterSound(victim, 'hit');
      hit = true;
    }
    game.shake = .28;
    game.impactFlash = .2;
    tone(160, .15, 'square', .05, .7);
    tone(120, .1, 'sawtooth', .03, .5);
    // Sync the impact to the online guest: particles/shake/sound are local,
    // so without this the guest would feel none of the punch.
    if (game.mode === 'online') {
      onlineImpactQueue.push({ side: victim.i, kind: CHARACTERS[attacker.characterId].skill.kind, x: victim.x, y: victim.y });
      if (onlineImpactQueue.length > 8) onlineImpactQueue.shift();
    }
    return hit;
  }
  // Register one handler per skill kind; character balance lives in characters.js.
  const skillHandlers = {
    dash(p, skill) {
      p.dashLeft = skill.duration;
      p.dashHit = false;
      p.vx = p.facingX * skill.power;
      p.vy = p.facingY * skill.power;
      burst(p.x, p.y + 12, p.i, 7);
      tone(390, .08, 'sawtooth', .028);
    },
    shield(p, skill) {
      p.shieldLeft = skill.duration;
      p.shieldCountered = false;
      p.shieldHit = false;
      burst(p.x, p.y - 10, p.i, 8);
      tone(570, .14, 'sine', .055);
    },
    pulse(p, skill) {
      p.pulseLeft = .32;
      for (const other of players) {
        if (other === p) continue;
        if (dist(p, other) <= skill.radius) pushAway(p, other, skill.power, skill.stun);
      }
      burst(p.x, p.y, p.i, 20);
      tone(230, .2, 'triangle', .06);
    },
    blink(p, skill) {
      const from = { x: p.x, y: p.y };
      const other = nearestOpponent(p);
      const otherDistance = dist(p, other);
      const travel = otherDistance < skill.distance + 30 ? Math.max(0, otherDistance - 28) : skill.distance;
      const edge = playArea();
      p.x = Math.max(edge[0], Math.min(edge[1], p.x + p.facingX * travel));
      p.y = Math.max(142, Math.min(H - 39, p.y + p.facingY * travel));
      p.vx = 0;
      p.vy = 0;
      p.warpLeft = .34;
      if (dist(p, other) <= skill.radius) pushAway(p, other, skill.power, skill.stun);
      burst(from.x, from.y, p.i, 10);
      burst(p.x, p.y, p.i, 14);
      tone(760, .12, 'sine', .05);
    },
    blinkSpeed(p, skill) {
      // 闪闪加速模式：大幅提升移动速度
      p.speedBoost = skill.duration;
      p.boostFactor = skill.boost;
      burst(p.x, p.y - 10, p.i, 12);
      burst(p.x, p.y + 10, p.i, 12);
      tone(820, .1, 'sine', .06, 1.2);
      tone(920, .08, 'sine', .05, 1.4);
    },
    pull(p, skill) {
      p.pullLeft = .34;
      for (const other of players) {
        if (other === p) continue;
        if (dist(p, other) <= skill.radius && pushAway(p, other, -skill.power, skill.stun)) {
          const distance = dist(p, other) || 1;
          other.reboundLeft = skill.rebound;
          other.reboundX = (other.x - p.x) / distance;
          other.reboundY = (other.y - p.y) / distance;
          other.reboundPower = skill.reboundPower;
        }
      }
      },
      trap(p, skill) {
      p.trap = { x: p.x, y: p.y + 12, left: skill.duration, arm: skill.arm, radius: skill.radius, stun: skill.stun };
      burst(p.x, p.y + 12, p.i, 10);
      tone(480, .11, 'triangle', .045);
    },
    vampire(p, skill) {
      // Vampire: lifesteal + brief invulnerability (bat form)
      p.vampireLeft = skill.duration;
      p.shieldLeft = Math.max(p.shieldLeft, skill.duration * 0.6); // Partial invulnerability
      const other = nearestOpponent(p);
      if (dist(p, other) <= 80) {
        // Lifesteal bite: blockable like every other disable, and it drains
        // part of the opponent's sofa-capture progress (吸取活力).
        if (pushAway(p, other, 320, skill.stun)) {
          let drained = 0;
          for (const seat of game.seats) {
            drained += seat.capture[other.i] * .5;
            seat.capture[other.i] *= .5;
          }
          if (drained > 0) burst(p.x, p.y - 24, p.i, 10);
        }
        tone(280, .18, 'sawtooth', .06, .7);
      }
      burst(p.x, p.y - 15, p.i, 12);
      tone(220, .22, 'sine', .05, .6);
    },
    knight(p, skill) {
      // Knight: rotating sword that stuns opponents on contact
      p.knightLeft = skill.duration;
      p.knightRadius = skill.radius;
      p.knightStun = skill.stun;
      p.knightPower = skill.power;
      p.knightHitCooldowns = players.map(() => 0);
      burst(p.x, p.y, p.i, 14);
      tone(180, .15, 'square', .06, .8);
    },
    ninja(p, skill) {
      // Ninja: shadow clone + speed boost. speedBoost is seconds, not a multiplier.
      p.ninjaLeft = skill.duration;
      p.ninjaClone = { x: p.x, y: p.y, life: skill.duration };
      p.speedBoost = skill.duration;
      p.boostFactor = skill.boost;
      burst(p.x, p.y, p.i, 18);
      burst(p.x + 20, p.y, p.i, 10);
      burst(p.x - 20, p.y, p.i, 10);
      tone(620, .1, 'sine', .05, 1.3);
    },
    mage(p, skill) {
      // Mage: ranged magic projectile
      const other = nearestOpponent(p);
      const dx = other.x - p.x, dy = other.y - p.y;
      const distance = Math.hypot(dx, dy) || 1;
      p.mageProjectile = {
        x: p.x, y: p.y,
        vx: (dx / distance) * 400,
        vy: (dy / distance) * 400,
        life: skill.radius / 400,
        power: skill.power,
        stun: skill.stun
      };
      burst(p.x, p.y - 10, p.i, 8);
      tone(520, .14, 'triangle', .055, 1.2);
    }
  };
  function isAiPlayer(p) {
    if (game.mode === 'online') return false;
    return game.mode === 'demo' || ((game.mode === 'cpu' || game.mode === 'chaos') && p.i >= 1 && p.i < (game.playerCount || 2));
  }
  // AI uses skills on a longer cooldown on lower difficulties, giving players more breathing room.
  function aiCooldownFactor(p) {
    if (!isAiPlayer(p)) return 1;
    const difficulty = game.difficulty || 'normal';
    return difficulty === 'easy' ? 1.45 : difficulty === 'normal' ? 1.2 : 1;
  }
  function useSkill(p, simultaneous = false) {
    if (game.phase !== 'playing' || game.paused || p.skillCooldown > 0 || (!simultaneous && p.stunned > 0)) return;
    const character = CHARACTERS[p.characterId];
    // 闪闪双技能切换：根据当前模式选择技能
    let skill = character.skill;
    if (p.characterId === 'blink' && p.useAltSkill && character.skillAlt) {
      skill = character.skillAlt;
    }
    const handler = skillHandlers[skill.kind];
    if (!handler) return;
    p.skillCooldown = skill.cooldown * (game.rule && game.rule.id === 'frenzy' ? game.rule.cooldownFactor : 1) * aiCooldownFactor(p);
    p.castTotal = skill.kind === 'trap' ? .5 : skill.kind === 'pull' ? .46 : .38;
    p.castLeft = p.castTotal;
    react(p, 'focused', p.castTotal);
    characterSound(p, 'skill');
    handler(p, skill);
  }
  const ruleHandlers = {
    shuffle(rule) {
      const index = game.ruleTarget && game.seats[game.ruleTarget.index] ? game.ruleTarget.index : Math.floor(Math.random() * game.seats.length);
      const seat = game.seats[index];
      if (!seat) return;
      let target = game.ruleTarget && game.ruleTarget.index === index ? game.ruleTarget : null;
      if (!target) {
        const spot = seatTargetAwayFrom(index);
        target = { index, x: spot[0], y: spot[1] };
      }
      game.ruleTarget = target;
      game.ruleMove = { index, fromX: seat.x, fromY: seat.y, toX: target.x, toY: target.y, elapsed: 0, duration: rule.moveDuration };
      burst(seat.x, seat.y, 0, 18);
      game.shake = .14;
      showBanner('沙发搬家！', .65);
      tone(510, .17, 'triangle', .06);
    },
    spring(rule) {
      for (const p of players) {
        const seat = nearestSeat(p);
        if (!seat) continue;
        const distance = dist(p, seat);
        if (distance > rule.radius) continue;
        if (p.shieldLeft > 0 && !p.shieldHit) {
          p.shieldHit = true;
          react(p, 'smug', .75);
          characterSound(p, 'block');
        } else {
          const dx = distance > 1 ? (p.x - seat.x) / distance : (p.i ? 1 : -1);
          const dy = distance > 1 ? (p.y - seat.y) / distance : 0;
          p.dashLeft = 0;
          p.stunned = Math.max(p.stunned, rule.stun);
          p.blink = .38;
          p.impactLeft = .28;
          react(p, 'dizzy', .65);
          characterSound(p, 'hit');
          p.vx = dx * rule.power;
          p.vy = dy * rule.power;
        }
        burst(p.x, p.y - 12, p.i, 14);
      }
      game.shake = .2;
      showBanner('沙发弹起！', .65);
      tone(190, .23, 'square', .045);
    }
  };
  // 贴身角力 (mash rule): while the rule is active and both players touch,
  // every skill-button press counts; the first side to reach the goal scores
  // a point and blasts the opponent away. Counting is authoritative on the
  // host (local presses + guest input flags), never on the guest client.
  function registerMash(p) {
    if (game.phase !== 'playing' || !game.rule || game.rule.id !== 'mash' || game.rulePhase !== 'active') return;
    const other = nearestOpponent(p);
    if (!other || dist(p, other) > game.rule.contactRange) return;
    game.mashCounts[p.i]++;
    burst(p.x, p.y - 26, p.i, 3);
    tone(300 + Math.min(game.mashCounts[p.i], 14) * 26, .05, 'triangle', .035, 1.08);
    updateRuleHud();
    if (game.mashCounts[p.i] >= game.rule.mashGoal) {
      // 手速奖励：领先越多，把对手撞得越远（撞到墙为止）。
      const lead = Math.max(0, game.mashCounts[p.i] - game.mashCounts[1 - p.i]);
      game.mashCounts = [0, 0];
      game.mashWins = game.mashWins || [0, 0];
      game.mashWins[p.i]++;
      pushAway(p, other, 420 + lead * 130, .32);
      scorePoint(p.i, 'mash');
      // Victory arpeggio: a rising three-note confirm on top of the score sounds.
      [1, 1.25, 1.5].forEach((mult, i) => setTimeout(() => tone(523 * mult, .12, 'triangle', .05, 1.02), i * 90));
    }
  }
  function updateRoomRule(dt) {
if (game.mode === 'online' && onlinePlayerNumber !== 0 && onlinePlayerNumber !== null) return; // The host owns sofa movement in online matches.
    if (!game.rule || game.rule.id === 'frenzy' || game.rule.id === 'mash' || game.rulePhase === 'triggered') return;
    if (game.rule.id === 'morph') {
      // 沙发变变变: cycle the sofa between small and large; the capture ring
      // and its hitbox follow the visual scale (host animates, guest mirrors).
      game.morphT = (game.morphT || 0) + dt;
      const phaseIndex = Math.floor(game.morphT / game.rule.morphCycle) % 2;
      if (game.morphPhase !== phaseIndex) {
        game.morphPhase = phaseIndex;
        showBanner(phaseIndex === 0 ? '沙发缩小！' : '沙发变大！', .8);
        tone(phaseIndex === 0 ? 320 : 460, .16, 'triangle', .05, phaseIndex === 0 ? .8 : 1.25);
        for (const seat of game.seats) burst(seat.x, seat.y - 10, 0, 8);
      }
      const target = phaseIndex === 0 ? game.rule.minScale : game.rule.maxScale;
      for (const seat of game.seats) {
        if (seat.scale === undefined) seat.scale = 1;
        seat.scale += (target - seat.scale) * Math.min(1, dt * 2.4);
      }
      updateRuleHud();
      return;
    }
    game.elapsed += dt;
    if (game.rulePhase === 'moving') {
      const move = game.ruleMove;
      const seat = move && game.seats[move.index];
      if (!move || !seat) { game.rulePhase = 'triggered'; updateRuleHud(); return; }
      move.elapsed = Math.min(move.duration, move.elapsed + dt);
      const t = move.elapsed / move.duration;
      const eased = t * t * (3 - 2 * t);
      seat.x = move.fromX + (move.toX - move.fromX) * eased;
      seat.y = move.fromY + (move.toY - move.fromY) * eased;
      if (t >= 1) {
        seat.x = move.toX;
        seat.y = move.toY;
        game.ruleMove = null;
        game.rulePhase = 'triggered';
        burst(seat.x, seat.y, 1, 18);
        game.shake = .18;
        updateRuleHud();
      }
      return;
    }
    if (game.rulePhase === 'idle' && game.elapsed >= game.rule.warningAt) {
      game.rulePhase = 'warning';
      updateRuleHud();
      showBanner(game.rule.id === 'shuffle' ? '沙发要搬家！' : '沙发要弹起！', .7);
    }
    if (game.elapsed >= game.rule.triggerAt) {
      ruleHandlers[game.rule.id](game.rule);
      game.rulePhase = game.rule.id === 'shuffle' ? 'moving' : 'triggered';
      updateRuleHud();
    }
  }
  function inputFor(p, dt) {
    p.wantsSkill = false;
    if (isAiPlayer(p)) {
      const other = nearestOpponent(p);
      const skill = CHARACTERS[p.characterId].skill;
      const enemyDistance = dist(p, other);
      const nearOther = enemyDistance < 145;
      const mySeat = nearestSeat(p);
      let targetSeat = mySeat;
      // If the opponent is already lounging on another sofa, nobody can score until
      // someone breaks the standoff, so contest their sofa instead of camping.
      const enemySeat = other.stunned <= 0 ? game.seats.find(seat => dist(other, seat) < CAPTURE_RADIUS) : null;
      if (enemySeat) {
        targetSeat = enemySeat;
      } else if (game.seats.length > 1 && mySeat && dist(other, mySeat) + 70 < dist(p, mySeat)) {
        // With several sofas, contest the one we can reach first instead of always rushing the same spot.
        let best = mySeat, bestGap = -Infinity;
        for (const seat of game.seats) {
          const gap = dist(other, seat) - dist(p, seat);
          if (gap > bestGap) { bestGap = gap; best = seat; }
        }
        targetSeat = best;
      }
      const emptySeats = game.seats.filter(seat => !players.some(q => q !== p && dist(q, seat) < CAPTURE_RADIUS));
      if (emptySeats.length && !emptySeats.includes(targetSeat) && Math.random() < .5) {
        // Commit to an empty sofa half the time so a herd of AIs splits up
        // instead of oscillating together and freezing every seat.
        targetSeat = emptySeats[Math.floor(Math.random() * emptySeats.length)];
      }
      if (game.seats.length > 1 && players.length > 2 && targetSeat) {
        const matesOnTarget = players.filter(q => q !== p && q.i !== 0 && dist(q, targetSeat) < CAPTURE_RADIUS).length;
        if (matesOnTarget >= 1) {
          let bestSeat = targetSeat, bestCount = Infinity;
          for (const seat of game.seats) {
            const count = players.filter(q => q !== p && dist(q, seat) < CAPTURE_RADIUS).length;
            if (count < bestCount) { bestCount = count; bestSeat = seat; }
          }
          if (bestSeat && bestSeat !== targetSeat) targetSeat = bestSeat;
        }
      }
      const seatDistance = targetSeat ? dist(p, targetSeat) : 999;
      const nearSeat = Boolean(targetSeat) && seatDistance < 86;
      const contested = Boolean(targetSeat) && dist(other, targetSeat) < CAPTURE_RADIUS;
      const hostileTrap = other.trap;
      // Difficulty-based parameters
      const difficulty = game.difficulty || 'normal';
      const reactionTime = difficulty === 'easy' ? 1 : difficulty === 'normal' ? .75 : .4;
      const aggression = difficulty === 'easy' ? 0.3 : difficulty === 'normal' ? 0.5 : 0.7;
      // Trap avoidance (all difficulties)
      if (hostileTrap && hostileTrap.arm <= 0 && dist(p, hostileTrap) < hostileTrap.radius + 24) {
        let avoidX = p.x - hostileTrap.x, avoidY = p.y - hostileTrap.y;
        const avoidLength = Math.hypot(avoidX, avoidY) || 1;
        if (avoidLength === 1 && avoidX === 0 && avoidY === 0) avoidX = p.i ? 1 : -1;
        return { x: avoidX / avoidLength, y: avoidY / avoidLength };
      }
      // Hard difficulty: predict opponent blink/teleport and place trap
      if (difficulty === 'hard' && other.warpLeft > 0 && p.characterId === 'trap' && !p.trap && p.skillCooldown <= 0) {
        const otherSkill = CHARACTERS[other.characterId].skill;
        const otherBlinkDistance = otherSkill.kind === 'blink' ? otherSkill.distance : 0;
        if (otherBlinkDistance > 0) {
          const predictX = other.x + other.facingX * otherBlinkDistance;
          const predictY = other.y + other.facingY * otherBlinkDistance;
          const predictDist = Math.hypot(predictX - p.x, predictY - p.y);
          if (predictDist < 150) {
            p.facingX = (predictX - p.x) / predictDist;
            p.facingY = (predictY - p.y) / predictDist;
            p.wantsSkill = true;
            p.aiDecision = reactionTime;
          }
        }
      }
      // Ninja shadow clone: bots sometimes mistake the clone for the real player
      // and chase it until it fades (re-rolled per decision window, not per frame).
      let chaseTarget = other;
      if (other.ninjaClone && (nearOther || contested)) {
        if (p.aiDecision <= 0) p.aiDeceived = Math.random() < 0.4;
        if (p.aiDeceived) chaseTarget = { x: other.ninjaClone.x, y: other.ninjaClone.y };
      }
      const target = nearSeat && (nearOther || contested) ? chaseTarget : (targetSeat || other);
      let dx = target.x - p.x, dy = target.y - p.y;
      // 多人模式下添加随机偏移，避免AI聚集在一起
      if (players.length > 2 && Math.random() < 0.15) {
        const angle = Math.random() * Math.PI * 2;
        const offset = 60;
        dx += Math.cos(angle) * offset;
        dy += Math.sin(angle) * offset;
      }
      const length = Math.hypot(dx, dy);
      if (nearSeat && !nearOther && !contested) return { x: 0, y: 0 };
      // Contested sofa: bump the nearest rival instead of standing idle —
      // body pressure pushes them out of the capture circle over time.
      if (nearSeat && contested) {
        let rival = null, rivalDistance = Infinity;
        for (const q of players) {
          if (q === p || q.stunned > 0) continue;
          const d2 = dist(q, targetSeat);
          if (d2 < CAPTURE_RADIUS && d2 < rivalDistance) { rivalDistance = d2; rival = q; }
        }
        if (rival) {
          const rdx = rival.x - p.x, rdy = rival.y - p.y;
          const rLen = Math.hypot(rdx, rdy) || 1;
          return { x: rdx / rLen, y: rdy / rLen };
        }
      }
      if (length > 1) { dx /= length; dy /= length; }
      // Easy difficulty: add slight movement noise
      if (difficulty === 'easy' && Math.random() < 0.1) {
        dx += (Math.random() - 0.5) * 0.3;
        dy += (Math.random() - 0.5) * 0.3;
      }
      p.aiDecision -= dt;
      const opposingSkill = CHARACTERS[other.characterId].skill.kind;
      // Per-difficulty skill attempt chance (checked once per decision window, not per frame)
      const attemptChance = difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.35 : 0.7;
      // Smarter skill usage based on difficulty
      let useNow = false;
      if (p.aiDecision <= 0 && other.stunned <= 0 && p.skillCooldown <= 0) {
        if (skill.kind === 'dash') {
          // Only dash when it pays off: the enemy is contesting the sofa or closer to it than we are,
          // is roughly in front, and we roll below the attempt chance.
          const enemyOnSeat = game.seats.some(seat => dist(other, seat) < CAPTURE_RADIUS);
          const enemyCloser = Boolean(targetSeat) && dist(other, targetSeat) < seatDistance;
          const inFront = (dx * p.facingX + dy * p.facingY) > 0.3;
          useNow = enemyDistance > 45 && enemyDistance < 145 && inFront && (enemyOnSeat || enemyCloser) && Math.random() < attemptChance;
        } else if (skill.kind === 'shield') {
          const enemyClose = enemyDistance < (opposingSkill === 'blink' ? 180 : opposingSkill === 'dash' ? 160 : 125);
          const enemyCommitting = other.dashLeft > 0 || other.castLeft > 0;
          useNow = enemyClose && (difficulty === 'hard' ? enemyCommitting && Math.random() < attemptChance + .2 : Math.random() < attemptChance);
        } else if (skill.kind === 'pull') {
          useNow = enemyDistance < skill.radius && Math.random() < attemptChance;
        } else if (skill.kind === 'blink') {
          const shouldBlink = seatDistance > 150 || (enemyDistance < 170 && aggression > 0.4);
          useNow = shouldBlink && Math.random() < attemptChance;
        } else if (skill.kind === 'trap') {
          const goodSpot = nearSeat || enemyDistance < 115;
          useNow = !p.trap && goodSpot && Math.random() < attemptChance;
        } else if (skill.kind === 'vampire') {
          // The bite only lands within its 80px lifesteal range.
          useNow = enemyDistance < 70 && Math.random() < attemptChance;
        } else if (skill.kind === 'ninja') {
          // Clone + boost: race a distant sofa or slip away from a close fight.
          useNow = (seatDistance > 90 || enemyDistance < 140) && Math.random() < attemptChance;
        } else {
          useNow = skill.radius != null && enemyDistance < skill.radius && Math.random() < attemptChance;
        }
        if (useNow) {
          const faceTarget = skill.kind === 'blink' ? target : other;
          const faceDistance = dist(p, faceTarget) || 1;
          p.facingX = (faceTarget.x - p.x) / faceDistance;
          p.facingY = (faceTarget.y - p.y) / faceDistance;
          p.wantsSkill = true;
          p.aiDecision = reactionTime;
        } else {
          // No good opportunity right now: re-evaluate later instead of every frame,
          // so the AI never fires skills with frame-perfect timing.
          const baseWait = difficulty === 'easy' ? .5 : difficulty === 'normal' ? .38 : .2;
          const extraWait = difficulty === 'hard' ? .3 : .5;
          p.aiDecision = baseWait + Math.random() * extraWait;
        }
      }
      return { x: dx, y: dy };
    }
    if (game.mode === 'online' && p.i >= 1) {
      if (onlinePlayerNumber === 0) {
        // Host: every guest character walks with that guest's latest input,
        // frozen (watchdog) when their device goes quiet mid-match.
        const input = onlineGuestInputs[p.i - 1] || { x: 0, y: 0, skill: false };
        const last = onlineLastInputAts[p.i - 1] || 0;
        const stale = last && performance.now() - last > 250;
        if (stale) input.skill = false;
        p.wantsSkill = stale ? false : input.skill;
        input.skill = false;
        return stale ? { x: 0, y: 0 } : { x: input.x, y: input.y };
      }
      if (p.i === onlinePlayerNumber) {
        // Guest predicts its own movement locally.
        let x, y;
        x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + mobile.x;
        y = Number(keys.has('KeyS')) - Number(keys.has('KeyW')) + mobile.y;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        return { x, y };
      }
      // Other guests are snapshot-interpolated; no local input.
      p.wantsSkill = false;
      return { x: 0, y: 0 };
    }
    let x, y;
    if (p.i === 0) {
      x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + mobile.x;
      y = Number(keys.has('KeyS')) - Number(keys.has('KeyW')) + mobile.y;
    } else {
      x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
    }
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function updatePlayer(p, dt, move, simulateCombat = true) {
    p.skillCooldown = Math.max(0, p.skillCooldown - dt);
    p.shieldLeft = Math.max(0, p.shieldLeft - dt);
    // Reset shield hit flag each frame so shield can block multiple attacks during its duration
    if (p.shieldLeft > 0) p.shieldHit = false;
    p.pulseLeft = Math.max(0, p.pulseLeft - dt);
    p.pullLeft = Math.max(0, p.pullLeft - dt);
    p.warpLeft = Math.max(0, p.warpLeft - dt);
    p.stunned = Math.max(0, p.stunned - dt);
    p.blink = Math.max(0, p.blink - dt);
    if (p.trap) {
      p.trap.left -= dt;
      p.trap.arm = Math.max(0, p.trap.arm - dt);
      if (p.trap.left <= 0) p.trap = null;
    }
    // New skill updates
    if (p.vampireLeft > 0) p.vampireLeft = Math.max(0, p.vampireLeft - dt);
    if (p.knightLeft > 0) {
      p.knightLeft = Math.max(0, p.knightLeft - dt);
      if (!Array.isArray(p.knightHitCooldowns) || p.knightHitCooldowns.length !== players.length) {
        p.knightHitCooldowns = players.map(() => 0);
      }
      for (let i = 0; i < p.knightHitCooldowns.length; i++) {
        p.knightHitCooldowns[i] = Math.max(0, p.knightHitCooldowns[i] - dt);
      }
      // The online guest animates the sword but never resolves authoritative hits.
      if (simulateCombat) {
        for (const other of players) {
          if (other === p) continue;
          const distance = dist(p, other);
          if (distance <= p.knightRadius && p.knightHitCooldowns[other.i] <= 0) {
            const hit = pushAway(p, other, p.knightPower || 380, p.knightStun || 0.6);
            // Cooldowns are per target, so swords on both sides can land together.
            p.knightHitCooldowns[other.i] = hit ? 0.8 : 0.3;
          }
        }
      }
    }
    if (p.ninjaLeft > 0) {
      p.ninjaLeft = Math.max(0, p.ninjaLeft - dt);
      // Delayed ghost: the clone mirrors where the ninja was ~0.5s ago,
      // so opponents (bots and humans) must guess which shadow is real.
      if (!Array.isArray(p.ninjaTrail)) p.ninjaTrail = [];
      p.ninjaTrail.push({ x: p.x, y: p.y });
      const trailDelay = 15; // ~0.5s at 30fps stepping
      while (p.ninjaTrail.length > trailDelay) p.ninjaTrail.shift();
      if (p.ninjaClone) {
        p.ninjaClone.life -= dt;
        const ghost = p.ninjaTrail[0] || { x: p.x, y: p.y };
        p.ninjaClone.x = ghost.x; p.ninjaClone.y = ghost.y;
        if (p.ninjaClone.life <= 0) p.ninjaClone = null;
      }
    }
    if (p.speedBoost > 0) {
      p.speedBoost = Math.max(0, p.speedBoost - dt);
    }
    if (p.mageProjectile) {
      const proj = p.mageProjectile;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.life -= dt;
      if (simulateCombat) {
        for (const other of players) {
          if (other === p) continue;
          if (dist({ x: proj.x, y: proj.y }, other) <= 30) {
            // Route through pushAway so shields can block the bolt like any other hit.
            pushAway(p, other, proj.power, proj.stun);
            p.mageProjectile = null;
            break;
          }
        }
      }
      if (p.mageProjectile && p.mageProjectile.life <= 0) {
        p.mageProjectile = null;
      }
    }
    if (p.reboundLeft > 0) {
      p.reboundLeft = Math.max(0, p.reboundLeft - dt);
      if (p.reboundLeft === 0) {
        p.vx = p.reboundX * p.reboundPower;
        p.vy = p.reboundY * p.reboundPower;
        burst(p.x, p.y, p.i, 9);
      }
    }
    if (p.dashLeft > 0) {
      p.dashLeft = Math.max(0, p.dashLeft - dt);
      p.vx *= Math.pow(.93, dt * 60);
      p.vy *= Math.pow(.93, dt * 60);
    } else if (p.stunned > 0) {
      p.vx *= Math.pow(.9, dt * 60);
      p.vy *= Math.pow(.9, dt * 60);
    } else {
      let speed = CHARACTERS[p.characterId].speed;
      // 忍者加速效果
      if (p.speedBoost > 0) speed *= (p.boostFactor || 1.5);
      // Rubber band: the trailing player gets a gentle boost so matches stay
      // tense until the last point (applies identically on host and guest).
      if (game.phase === 'playing' && players.some(q => q !== p && game.scores[q.i] > game.scores[p.i])) speed *= 1.08;
      p.vx = move.x * speed;
      p.vy = move.y * speed;
      if (Math.hypot(move.x, move.y) > .15) {
        p.facingX = move.x; p.facingY = move.y;
        p.walk += dt * 11;
      }
    }
    const edge = playArea();
    const targetX = p.x + p.vx * dt, targetY = p.y + p.vy * dt;
    const wallHitX = (targetX < edge[0] || targetX > edge[1]) && Math.abs(p.vx) > 220;
    const wallHitY = (targetY < 142 || targetY > H - 39) && Math.abs(p.vy) > 220;
    p.x = Math.max(edge[0], Math.min(edge[1], targetX));
    p.y = Math.max(142, Math.min(H - 39, targetY));
    // A hard knock into a wall bounces with stars and a thud: the payoff for
    // 贴身角力's 撞得远 and for every big knockback.
    if ((p.stunned > 0 || p.dashLeft > 0) && (wallHitX || wallHitY)) {
      if (wallHitX) p.vx = -p.vx * .45;
      if (wallHitY) p.vy = -p.vy * .45;
      p.blink = Math.max(p.blink, .3);
      burst(p.x, p.y - 10, p.i, 10);
      tone(120, .1, 'square', .05, .6);
      game.shake = Math.max(game.shake, .14);
    }
  }
  function collide() {
    for (let pi = 0; pi < players.length; pi++) {
      for (let pj = pi + 1; pj < players.length; pj++) {
        const a = players[pi], b = players[pj];
        const d = dist(a, b);
        // AI之间的排斥力，防止聚集
        if (d < 80 && isAiPlayer(a) && isAiPlayer(b) && players.length > 2) {
          const nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1);
          const repulsion = (80 - d) * 2;
          a.vx -= nx * repulsion; a.vy -= ny * repulsion;
          b.vx += nx * repulsion; b.vy += ny * repulsion;
        }
        if (d >= 50) continue;
        const nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1);
        const overlap = (50 - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        // Juice for plain body squeezes: thud + shake + sparkle only. Physics
        // stay byte-identical to the authored collision (a per-frame correction
        // cap here was tried and nerfed dashing hard, so it stays untouched).
        if (overlap > 6 && performance.now() - lastBumpAt > 280) {
          lastBumpAt = performance.now();
          tone(150 + Math.random() * 40, .07, 'square', .04, .7);
          game.shake = Math.max(game.shake, .09);
          burst((a.x + b.x) / 2, (a.y + b.y) / 2 - 10, a.i, 5);
        }
        const dashHits = [[a, b], [b, a]].filter(([attacker]) => attacker.dashLeft > 0 && !attacker.dashHit);
        for (const [attacker, victim] of dashHits) {
          attacker.dashHit = true;
          pushAway(attacker, victim, CHARACTERS[attacker.characterId].skill.power, .36);
        }
        for (const [guard, other] of [[a, b], [b, a]]) {
          if (guard.shieldLeft > 0 && !guard.shieldHit && other.dashLeft <= 0 && !(other.shieldLeft > 0 && !other.shieldHit)) {
            guard.shieldHit = true;
            pushAway(guard, other, CHARACTERS[guard.characterId].skill.counterPower, .26);
          }
        }
      }
    }
  }
  function updateTraps() {
    for (const owner of players) {
      const trap = owner.trap;
      if (!trap || trap.arm > 0) continue;
      for (const victim of players) {
        if (victim.i === owner.i) continue;
        if (dist(victim, trap) > trap.radius) continue;
              if (victim.shieldLeft > 0 && !victim.shieldHit) {
                victim.shieldHit = true;
                react(victim, 'smug', .8);
                game.lastImpact = { side: victim.i, kind: 'shield', time: game.time };
                characterSound(victim, 'block');
              } else {
                victim.dashLeft = 0;
                victim.vx = 0;
                victim.vy = 0;
                victim.stunned = Math.max(victim.stunned, trap.stun);
                victim.blink = .45;
                victim.impactLeft = .3;
                react(victim, 'dizzy', trap.stun);
                react(owner, 'happy', .7);
                game.lastImpact = { side: owner.i, kind: 'trap', time: game.time };
                characterSound(victim, 'hit');
              }
        break;
      }
      owner.trap = null;
      game.shake = .1;
      game.hitStop = Math.max(game.hitStop, .055);
      burst(trap.x, trap.y, owner.i, 18);
      tone(205, .16, 'square', .04, .8);
    }
  }
  function burst(x, y, side, count) {
    // Mobile perf guard: cap the particle pool so long chaotic fights never
    // accumulate thousands of draw calls.
    if (game.particles.length > 240) game.particles.splice(0, game.particles.length - 240);
    const character = CHARACTERS[game.picks[side]];
    const colors = [character.color, character.light, '#fff', '#ffd064'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 45 + Math.random() * 175;
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80, life: .45 + Math.random() * .5, max: 1, size: 3 + Math.random() * 5, color: colors[i % colors.length] });
    }
  }
  function updatePresentation(dt) {
    for (const p of players) {
      p.anim += dt;
      p.castLeft = Math.max(0, p.castLeft - dt);
      p.impactLeft = Math.max(0, p.impactLeft - dt);
      p.celebrateLeft = Math.max(0, p.celebrateLeft - dt);
      p.emotionLeft = Math.max(0, p.emotionLeft - dt);
      if (!p.emotionLeft && p.emotion !== 'neutral') p.emotion = 'neutral';
    }
  }
  function update(dt) {
if (game.mode === 'online' && onlinePlayerNumber !== 0 && onlinePlayerNumber !== null && onlineState === 'playing') {
      updateOnlineClient(dt);
      return;
    }
    if (game.paused) return;
    updatePresentation(dt);
    updateRemoteInterpolation(dt);
    game.bannerTime = Math.max(0, game.bannerTime - dt);
    if (!game.bannerTime) $('round-banner').classList.remove('show');
    game.shake = Math.max(0, game.shake - dt);
    game.particles = game.particles.filter(p => p.life > 0);
    for (const p of game.particles) { p.life -= dt; p.vy += 210 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    // 混沌模式: every 3-5 seconds the room rule mutates into a different one,
    // so all sofa mechanics show up randomly within a single match.
    // This runs early to ensure mutations happen even during hitStop.
    if (game.mode === 'chaos' && (game.phase === 'playing' || game.phase === 'countdown' || game.phase === 'roundEnd')) {
      game.chaosTimer = (game.chaosTimer || 0) + dt;
      if (!game.chaosNext) game.chaosNext = 3 + Math.random() * 2;
      if (game.chaosTimer >= game.chaosNext) {
        game.chaosTimer = 0;
        game.chaosNext = 3 + Math.random() * 2;
        const pool = RULE_IDS.filter(id => id !== (game.rule && game.rule.id) && !(players.length > 2 && id === 'mash'));
        const newId = pool[Math.floor(Math.random() * pool.length)];
        game.rule = RULES[newId];
        game.previousRule = newId;
        game.ruleHistory.push(newId);
        game.rulePhase = (newId === 'frenzy' || newId === 'mash' || newId === 'morph') ? 'active' : 'idle';
        game.elapsed = 0;
        game.ruleMove = null;
        game.ruleTarget = null;
        game.morphT = 0;
        game.morphPhase = -1;
        game.mashCounts = Array(players.length).fill(0);
        for (const p of players) p.mashTimer = 0;
        // A rule mutation replaces the old mechanic instead of leaving its
        // hitbox behind. In particular, morph scale must not survive as a
        // hidden capture-radius modifier under the next rule.
        if (newId !== 'morph') for (const seat of game.seats) seat.scale = 1;
        showBanner(`⚡ 机制突变：${RULES[newId].name}！`, 1.5);
        // Strong visual and audio feedback for chaos mutation
        game.shake = .25;
        game.impactFlash = .18;
        burst(W / 2, H / 2, 0, 24);
        burst(W / 2, H / 2, 1, 24);
        tone(420 + Math.random() * 180, .22, 'sawtooth', .08, 1.5);
        tone(280 + Math.random() * 120, .18, 'square', .06, .8);
        updateRuleHud();
      }
    }
    if (game.hitStop > 0 && game.phase === 'playing') {
      game.hitStop = Math.max(0, game.hitStop - dt);
      updateHud();
      return;
    }
    if (game.phase === 'countdown') {
      game.wait -= dt;
      if (game.wait <= 0) { game.phase = 'playing'; showBanner('开抢！', .55); tone(700, .1); }
      updateHud();
      return;
    }
    if (game.phase === 'roundEnd') {
      if (game.replay) {
        game.replay.elapsed += dt;
        if (game.replay.elapsed >= game.replay.duration) skipReplay();
      }
      game.wait -= dt;
      if (game.wait <= 0) game.scores.some(s => s >= WIN_SCORE) ? finishMatch() : newRound();
      updateHud();
      return;
    }
    if (game.phase === 'finished' && game.mode === 'demo') {
      if (!$('poster-dialog').open) game.wait -= dt;
      if (game.wait <= 0) startMatch();
      return;
    }
    if (game.phase !== 'playing') return;
    if (game.playTipTime > 0) {
      game.playTipTime = Math.max(0, game.playTipTime - dt);
      if (!game.playTipTime) $('play-tip').classList.remove('show');
    }
    game.time = Math.max(0, game.time - dt);
    updateRoomRule(dt);
    const moves = players.map(p => inputFor(p, dt));
    const casts = players.filter(p => p.wantsSkill && p.stunned <= 0 && p.skillCooldown <= 0);
    // Resolve simultaneous shields first so a same-frame shockwave can be blocked.
    casts.sort((a, b) => Number(CHARACTERS[b.characterId].skill.kind === 'shield') - Number(CHARACTERS[a.characterId].skill.kind === 'shield'));
    for (const p of casts) useSkill(p, true);
    for (let i = 0; i < players.length; i++) updatePlayer(players[i], dt, moves[i]);
    collide();
    // 贴身角力: the AI mashes at a human-random pace when in contact, scaled
    // by the chosen difficulty (easy = leisurely, hard = relentless).
    if (game.rule && game.rule.id === 'mash' && game.rulePhase === 'active') {
      for (const p of players) {
        const isAi = isAiPlayer(p);
        if (!isAi) continue;
        const other = players[1 - p.i];
        if (!other || dist(p, other) > (game.rule.contactRange || 52)) { p.mashTimer = 0; continue; }
        p.mashTimer = (p.mashTimer || 0) + dt;
        const tapsPerSec = game.difficulty === 'hard' ? 4.5 : game.difficulty === 'easy' ? 1.5 : 2.7;
        const pace = 1 / (tapsPerSec * (0.75 + Math.random() * 0.5));
        if (p.mashTimer >= pace) { p.mashTimer = 0; registerMash(p); }
      }
    }
    updateTraps();
    // With several sofas, two campers on separate seats would otherwise both fill up
    // at the same moment and the array order would decide the round. When the opponent
    // is lounging on a different sofa, progress freezes until someone breaks the standoff.
    const seated = players.map(p => game.seats.some(seat => dist(p, seat) < CAPTURE_RADIUS * (seat.scale || 1) && p.stunned <= 0));
    let standoff = false;
    for (const seat of game.seats) {
      const insideIdx = players.map((p, i) => dist(p, seat) < CAPTURE_RADIUS * (seat.scale || 1) && p.stunned <= 0 ? i : -1).filter(i => i >= 0);
      if (players.length > 2) {
        // Party mode: no cross-seat freeze — concurrent capture, first sofa filled wins.
        if (insideIdx.length === 0) {
          for (let j = 0; j < players.length; j++) seat.capture[j] = Math.max(0, seat.capture[j] - dt * .13);
          continue;
        }
        if (insideIdx.length > 1) {
          // Contested sofa: while rivals share it, nobody's fill advances —
          // stand your ground to deny, or knock them off to resume capturing.
          game.standoff = true;
          for (const j of insideIdx) seat.capture[j] = Math.max(0, seat.capture[j] - dt * 1.2);
          continue;
        }
        seat.capture[insideIdx[0]] += dt;
        for (let j = 0; j < players.length; j++) if (!insideIdx.includes(j)) seat.capture[j] = Math.max(0, seat.capture[j] - dt * .13);
        const filled = insideIdx.filter(i => seat.capture[i] >= CAPTURE_SECONDS);
        if (filled.length) { scorePoint(filled[Math.floor(Math.random() * filled.length)], 'capture', seat); break; }
        continue;
      }
      if (insideIdx.length === 1) {
        const i = insideIdx[0];
        if (players.some((_, j) => j !== i && seated[j])) { standoff = true; continue; }
        seat.capture[i] += dt;
        for (let j = 0; j < players.length; j++) if (j !== i) seat.capture[j] = Math.max(0, seat.capture[j] - dt * .35);
        if (seat.capture[i] >= CAPTURE_SECONDS) { scorePoint(i, 'capture', seat); break; }
      } else if (insideIdx.length === 0) {
        for (let j = 0; j < players.length; j++) seat.capture[j] = Math.max(0, seat.capture[j] - dt * .13);
      } else {
        standoff = true;
      }
    }
    game.standoff = standoff;
    game.standoffTime = standoff ? game.standoffTime + dt : 0;
    if (standoff && !game.standoffShown && game.standoffTime > .5 && game.seats.length > 1) {
      game.standoffShown = true;
      showBanner('沙发对峙 · 先把对手逼起身', 1.1);
    }
    game.capture = players.map((_, j) => Math.max(...game.seats.map(seat => seat.capture[j] || 0)));
    // Capture heartbeat: as someone closes in on a point, a soft tick speeds up
    // the tension (throttled; audio only, zero gameplay effect).
    const closingIn = Math.max(...game.capture);
    if (closingIn > .9 && performance.now() - lastCaptureTickAt > (closingIn > 1.3 ? 260 : 420)) {
      lastCaptureTickAt = performance.now();
      tone(760 + Math.round(closingIn * 120), .045, 'square', .028);
    }
    if (game.time <= 0 && game.phase === 'playing' && game.seats.length) {
      const totals = players.map((_, i) => game.seats.reduce((sum, seat) => sum + seat.capture[i], 0));
      const maxTotal = Math.max(...totals);
      const leaders = totals.map((t, i) => ({ t, i })).filter(x => Math.abs(x.t - maxTotal) <= .01);
      if (leaders.length === 1) {
        scorePoint(leaders[0].i, 'timeout');
      } else {
        const distances = players.map(p => Math.min(...game.seats.map(seat => dist(p, seat))));
        const minDistance = Math.min(...distances);
        const closest = distances.map((d, i) => ({ d, i })).filter(x => Math.abs(x.d - minDistance) <= 1);
        if (closest.length === 1) {
          scorePoint(closest[0].i, 'closest');
        } else {
          game.tiedRounds++;
          if (game.tiedRounds >= 2) {
            const fallback = closest.length ? closest[Math.floor(Math.random() * closest.length)].i : Math.floor(Math.random() * players.length);            scorePoint(fallback, 'draw');
          } else {
            game.phase = 'roundEnd'; game.wait = 1.5;
            game.playTipTime = 0;
            $('play-tip').classList.remove('show');
            showBanner('完全平局！再抢一次', 1.2);
            tone(210, .1);
          }
        }
      }
    }
    updateHud();
  }
  function roundedPath(g, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }
  function roundRect(x, y, w, h, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); roundedPath(ctx, x, y, w, h, r); ctx.fill(); }
  function drawRoom(now) {
    ctx.fillStyle = '#e8d7bb'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff3dc'; ctx.fillRect(0, 0, W, 116);
    ctx.fillStyle = '#e3c6a9'; ctx.fillRect(0, 112, W, 8);
    ctx.fillStyle = '#d0a886'; ctx.fillRect(0, 120, W, 5);
    ctx.fillStyle = '#e9d6bb'; ctx.fillRect(0, 125, W, H - 125);
    for (let y = 125; y < H; y += 48) {
      for (let x = 0; x < W; x += 88) {
        ctx.fillStyle = ((Math.floor(x / 88) + Math.floor((y - 125) / 48)) % 2) ? '#eddcc3' : '#e5d0b2';
        ctx.fillRect(x, y, 88, 48);
      }
    }
    ctx.strokeStyle = '#d7bfa5'; ctx.globalAlpha = .4; ctx.lineWidth = 1;
    for (let y = 125; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // Window and bright outside sky.
    roundRect(123, 19, 144, 76, 9, '#cfaf92');
    roundRect(130, 25, 130, 63, 4, '#9fd3e7');
    ctx.fillStyle = '#fff5d2'; ctx.beginPath(); ctx.arc(226, 44, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#77b8a0'; ctx.beginPath(); ctx.ellipse(149, 93, 42, 24, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(218, 94, 50, 30, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff9ee'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(195, 25); ctx.lineTo(195, 88); ctx.moveTo(130, 61); ctx.lineTo(260, 61); ctx.stroke();
    // Wall art and shelf.
    roundRect(423, 16, 102, 79, 6, '#d1a98c');
    roundRect(429, 22, 90, 66, 4, '#f2b486');
    ctx.fillStyle = '#fff0cf'; ctx.beginPath(); ctx.arc(481, 48, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d37f72'; ctx.beginPath(); ctx.moveTo(430, 88); ctx.lineTo(465, 58); ctx.lineTo(483, 74); ctx.lineTo(501, 51); ctx.lineTo(519, 88); ctx.fill();
    roundRect(736, 69, 138, 9, 4, '#ad7b59');
    roundRect(756, 34, 20, 35, 4, '#e58a6e');
    roundRect(782, 43, 17, 26, 3, '#86b9a9');
    roundRect(807, 28, 22, 41, 3, '#e4b866');
    ctx.fillStyle = '#547c6b'; ctx.beginPath(); ctx.arc(851, 56, 16, 0, Math.PI * 2); ctx.fill();
    // Rug.
    ctx.fillStyle = '#c09b8e'; ctx.beginPath(); ctx.ellipse(480, 346, 342, 150, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9b9a3'; ctx.beginPath(); ctx.ellipse(480, 339, 335, 143, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f7dbc5'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(480, 339, 312, 127, 0, 0, Math.PI * 2); ctx.stroke();
    // Side furniture.
    drawPlant(82, 210); drawPlant(880, 205);
    roundRect(65, 439, 126, 55, 12, '#b78665');
    roundRect(70, 433, 116, 45, 9, '#d2a27b');
    ctx.fillStyle = '#f5e2c1'; ctx.beginPath(); ctx.arc(111, 452, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#f5e2c1'; ctx.beginPath(); ctx.arc(144, 452, 11, 0, 7); ctx.fill();
    roundRect(794, 440, 110, 12, 4, '#aa7858');
    roundRect(801, 451, 12, 39, 3, '#aa7858');
    roundRect(887, 451, 12, 39, 3, '#aa7858');
    roundRect(830, 425, 36, 16, 8, '#faf3db');
    ctx.fillStyle = '#81a9a5'; ctx.beginPath(); ctx.arc(849, 418, 11, 0, 7); ctx.fill();
    // A little floor shine.
    ctx.globalAlpha = .1; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(380, 190, 180, 30, -.15, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawPlant(x, y) {
    roundRect(x - 23, y + 28, 46, 48, 5, '#c78361');
    roundRect(x - 26, y + 25, 52, 12, 5, '#e29b73');
    ctx.fillStyle = '#679a7c';
    for (const [dx, dy, tilt] of [[-29, -10, -.8], [24, -21, .75], [-6, -33, -.15], [8, 2, .3]]) {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, 15, 34, tilt, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#7eaa86'; ctx.beginPath(); ctx.ellipse(x - 4, y - 14, 18, 39, -.15, 0, 7); ctx.fill();
  }
  function drawSofa(now) {
    const ordered = game.seats.map((seat, index) => ({ seat, index })).sort((a, b) => a.seat.y - b.seat.y);
    for (const { seat, index } of ordered) drawSeat(seat, index, now);
  }
  function drawSeat(seat, index, now) {
    const { x, y } = seat;
    const pulse = Math.sin(now / 250 + index * .8) * 2;
    if (game.rule && game.rule.id === 'shuffle' && ['warning', 'moving'].includes(game.rulePhase) && game.ruleTarget && game.ruleTarget.index === index) {
      const target = game.ruleTarget;
      ctx.save();
      ctx.strokeStyle = '#fff9d5'; ctx.lineWidth = 6; ctx.setLineDash([12, 9]);
      ctx.beginPath(); ctx.ellipse(target.x, target.y + 12, 106, 63, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      if (game.rulePhase === 'warning') {
        ctx.fillStyle = '#524d47'; ctx.font = '900 17px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('下一站', target.x, target.y - 67);
      }
      ctx.restore();
    }
    if (game.rule && game.rule.id === 'spring' && game.rulePhase === 'warning') {
      ctx.strokeStyle = '#fff8a2'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(x, y + 12, 116 + Math.sin(now / 75) * 7, 0, 7); ctx.stroke();
    }
    const k = seat.scale || 1;
    ctx.save();
    ctx.translate(x, y + 12); ctx.scale(k, k); ctx.translate(-x, -(y + 12));
    ctx.fillStyle = '#725e6040'; ctx.beginPath(); ctx.ellipse(x, y + 58, 111, 28, 0, 0, 7); ctx.fill();
    // Occupation aura and progress arcs, one per sofa.
    ctx.save(); ctx.translate(x, y + 12);
    ctx.strokeStyle = '#fff9dfaa'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, CAPTURE_RADIUS + pulse, 0, 7); ctx.stroke();
    for (let i = 0; i < 2; i++) {
      if (seat.capture[i] <= 0) continue;
      ctx.strokeStyle = CHARACTERS[game.picks[i]].color; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, 96, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, seat.capture[i] / CAPTURE_SECONDS), false); ctx.stroke();
    }
    ctx.restore();
    roundRect(x - 87, y + 26, 174, 39, 15, '#986751');
    roundRect(x - 97, y - 36, 194, 73, 24, '#d8876b');
    roundRect(x - 85, y - 27, 170, 57, 19, '#f6a183');
    roundRect(x - 86, y + 9, 172, 42, 17, '#e88e75');
    roundRect(x - 98, y - 17, 31, 62, 14, '#d97c62');
    roundRect(x + 67, y - 17, 31, 62, 14, '#d97c62');
    roundRect(x - 55, y - 13, 52, 26, 9, '#f7bd8e');
    roundRect(x + 4, y - 13, 52, 26, 9, '#f7bd8e');
    ctx.strokeStyle = '#c16f59'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x, y + 18); ctx.stroke();
    roundRect(x - 75, y + 49, 15, 11, 3, '#935b48'); roundRect(x + 59, y + 49, 15, 11, 3, '#935b48');
    const frozen = game.standoff && game.seats.length > 1 && seat.capture[0] + seat.capture[1] > .05;
    ctx.fillStyle = frozen ? '#ffe0a8' : '#fff8ed'; ctx.font = '800 12px DM Sans, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(game.seats.length > 1 ? `SEAT ${index + 1}${frozen ? ' · 对峙' : ''}` : 'ONLY ONE SEAT', x, y - 54);
    ctx.restore();
  }
  function drawTraps(now) {
    for (const owner of players) {
      const trap = owner.trap;
      if (!trap) continue;
      const character = CHARACTERS[owner.characterId];
      const armed = trap.arm <= 0;
      ctx.save();
      ctx.globalAlpha = Math.min(1, trap.left) * (armed ? .8 : .45 + Math.sin(now / 70) * .15);
      ctx.strokeStyle = character.dark;
      ctx.lineWidth = 3;
      ctx.setLineDash(armed ? [] : [7, 6]);
      ctx.beginPath();
      ctx.arc(trap.x, trap.y, trap.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      roundRect(trap.x - 21, trap.y - 15, 42, 30, 10, character.dark);
      roundRect(trap.x - 18, trap.y - 17, 36, 28, 9, character.light);
      ctx.strokeStyle = character.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trap.x - 10, trap.y - 8);
      ctx.lineTo(trap.x + 10, trap.y + 3);
      ctx.moveTo(trap.x + 10, trap.y - 8);
      ctx.lineTo(trap.x - 10, trap.y + 3);
      ctx.stroke();
      ctx.restore();
    }
  }
  function playerMood(p) {
    if (p.stunned > 0) return 'dizzy';
    if (p.emotionLeft > 0) return p.emotion;
    if (game.phase === 'playing') {
      const onSeat = game.seats.some(seat => dist(p, seat) < CAPTURE_RADIUS);
      if (players.some(q => q !== p && game.capture[q.i] > .55) && !onSeat) return 'worried';
      if (game.capture[p.i] > .55) return 'happy';
      if (game.time < 5 && players.some(q => q !== p && game.scores[q.i] > game.scores[p.i])) return 'worried';
    }
    return 'neutral';
  }
  function drawFace(p, mood) {
    const eyeY = -10;
    const lookX = Math.max(-1, Math.min(1, p.facingX)) * 1.2;
    const lookY = Math.max(-1, Math.min(1, p.facingY)) * .7;
    const eyeBlink = mood === 'neutral' && (p.anim + p.i * 1.3) % 3.6 > 3.46;
    ctx.strokeStyle = '#27333d';
    ctx.fillStyle = '#27333d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (mood === 'dizzy') {
      for (const x of [-8, 8]) {
        ctx.beginPath(); ctx.moveTo(x - 3, eyeY - 3); ctx.lineTo(x + 3, eyeY + 3); ctx.moveTo(x + 3, eyeY - 3); ctx.lineTo(x - 3, eyeY + 3); ctx.stroke();
      }
    } else if (mood === 'happy' || mood === 'smug' || eyeBlink) {
      for (const x of [-8, 8]) {
        ctx.beginPath();
        if (mood === 'smug' && x === 8) { ctx.moveTo(x - 3, eyeY); ctx.lineTo(x + 3, eyeY); }
        else ctx.arc(x, eyeY + 1, 3.3, Math.PI + .18, Math.PI * 2 - .18);
        ctx.stroke();
      }
    } else if (mood === 'surprised') {
      for (const x of [-8, 8]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, eyeY, 4.3, 0, 7); ctx.fill(); ctx.fillStyle = '#27333d'; ctx.beginPath(); ctx.arc(x + lookX, eyeY + lookY, 2.2, 0, 7); ctx.fill(); }
    } else {
      for (const x of [-8, 8]) { ctx.beginPath(); ctx.ellipse(x + lookX, eyeY + lookY, 2.4, mood === 'worried' || mood === 'sad' ? 3.1 : 2.6, 0, 0, 7); ctx.fill(); }
    }
    if (['worried', 'sad', 'focused'].includes(mood)) {
      ctx.beginPath();
      if (mood === 'focused') {
        ctx.moveTo(-12, -17); ctx.lineTo(-5, -14); ctx.moveTo(12, -17); ctx.lineTo(5, -14);
      } else {
        ctx.moveTo(-12, -15); ctx.lineTo(-5, -17); ctx.moveTo(12, -15); ctx.lineTo(5, -17);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#743d3b';
    ctx.beginPath();
    if (mood === 'happy' || mood === 'smug') ctx.arc(mood === 'smug' ? 1 : 0, -5, mood === 'happy' ? 5 : 4, .08, Math.PI - .08);
    else if (mood === 'sad' || mood === 'worried') ctx.arc(0, 2, 4, Math.PI + .2, Math.PI * 2 - .2);
    else if (mood === 'surprised') { ctx.arc(0, -2, 3.2, 0, 7); ctx.stroke(); return; }
    else if (mood === 'dizzy') { ctx.moveTo(-4, -2); ctx.lineTo(-1, -4); ctx.lineTo(2, -1); ctx.lineTo(5, -3); }
    else ctx.arc(0, -4, 3.5, .15, Math.PI - .15);
    ctx.stroke();
  }
  function drawAccessory(p) {
    const { dark, light } = CHARACTERS[p.characterId];
    if (p.characterId === 'dash') {
      ctx.strokeStyle = '#fff3dc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -13, 23, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-22, -18); ctx.lineTo(-31, -23); ctx.moveTo(-22, -16); ctx.lineTo(-30, -13); ctx.stroke();
    } else if (p.characterId === 'guard') {
      ctx.strokeStyle = '#e9fbff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 4, 6, Math.PI, 0); ctx.lineTo(6, 7); ctx.lineTo(0, 12); ctx.lineTo(-6, 7); ctx.closePath(); ctx.stroke();
    } else if (p.characterId === 'pulse') {
      ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(0, -34, 5, 10, .45, 0, 7); ctx.fill();
    } else if (p.characterId === 'blink') {
      ctx.fillStyle = '#fff7c2'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3 : 7; const x = 19 + Math.cos(a) * r, y = -27 + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill();
    } else if (p.characterId === 'magnet') {
      ctx.strokeStyle = light; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(15, 2, 5, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = light; ctx.fillRect(9, -2, 4, 5); ctx.fillRect(17, -2, 4, 5);
    } else if (p.characterId === 'trap') {
      ctx.fillStyle = light; ctx.beginPath(); ctx.moveTo(15, -29); ctx.lineTo(6, -35); ctx.lineTo(7, -24); ctx.closePath(); ctx.moveTo(17, -29); ctx.lineTo(27, -35); ctx.lineTo(26, -24); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(16, -29, 3.5, 0, 7); ctx.fill();
    } else if (p.characterId === 'vampire') {
      // Vampire: bat wings
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(-18, -20); ctx.quadraticCurveTo(-28, -28, -25, -15); ctx.quadraticCurveTo(-22, -18, -18, -20); ctx.fill();
      ctx.beginPath(); ctx.moveTo(18, -20); ctx.quadraticCurveTo(28, -28, 25, -15); ctx.quadraticCurveTo(22, -18, 18, -20); ctx.fill();
    } else if (p.characterId === 'knight') {
      // Knight: helmet visor
      ctx.strokeStyle = light; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-8, -22); ctx.lineTo(8, -22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -18); ctx.lineTo(6, -18); ctx.stroke();
    } else if (p.characterId === 'ninja') {
      // Ninja: mask strap
      ctx.strokeStyle = light; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-20, -15); ctx.lineTo(20, -15); ctx.stroke();
    } else if (p.characterId === 'mage') {
      // Mage: wizard hat
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(-12, -25); ctx.lineTo(12, -25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(0, -38, 3, 0, 7); ctx.fill();
    }
  }
  function drawPlayer(p, now) {
    const character = CHARACTERS[p.characterId];
    const { color, dark, light } = character;
    const speed = Math.hypot(p.vx, p.vy);
    const moving = speed > 18 && p.stunned <= 0;
    const mood = playerMood(p);
    const celebration = p.celebrateLeft > 0 ? -Math.abs(Math.sin(p.anim * 10)) * 13 : 0;
    const bounce = (p.dashLeft > 0 ? -5 : moving ? Math.sin(p.walk) * 2.4 : Math.sin(p.anim * 2.2 + p.i) * 1.1) + celebration;
    const x = p.x, y = p.y + bounce;
    const castProgress = p.castLeft > 0 ? 1 - p.castLeft / p.castTotal : 0;
    const castPulse = p.castLeft > 0 ? Math.sin(castProgress * Math.PI) : 0;
    const impact = Math.min(1, p.impactLeft / .26);
    const scaleX = 1 + impact * .2 - castPulse * .05;
    const scaleY = 1 - impact * .16 + castPulse * .09;
    const lean = p.dashLeft > 0 ? p.facingX * .13 : moving ? Math.max(-1, Math.min(1, p.vx / 220)) * .075 : 0;
    ctx.save();
    if (p.blink > 0 && Math.floor(now / 65) % 2) ctx.globalAlpha = .58;
    ctx.fillStyle = '#55473c42'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 23, 26 - celebration * .25, 10, 0, 0, 7); ctx.fill();
    if (p.dashLeft > 0) {
      for (let i = 3; i >= 1; i--) {
        ctx.fillStyle = `${light}${i === 3 ? '44' : '77'}`;
        ctx.beginPath(); ctx.arc(x - p.facingX * i * 17, y - 8 - p.facingY * i * 17, 24 - i * 3, 0, 7); ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.scale(scaleX, scaleY);
    const earSize = character.ears === 'round' ? [12, 11] : character.ears === 'leaf' ? [12, 17] : [10, 19];
    const earLag = moving ? Math.sin(p.walk - .8) * .12 : Math.sin(p.anim * 1.7 + p.i) * .04;
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-15, -30, earSize[0], earSize[1], -.28 + earLag, 0, 7); ctx.ellipse(15, -30, earSize[0], earSize[1], .28 - earLag, 0, 7); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(-15, -31, earSize[0] * .5, earSize[1] * .58, -.28 + earLag, 0, 7); ctx.ellipse(15, -31, earSize[0] * .5, earSize[1] * .58, .28 - earLag, 0, 7); ctx.fill();
    const step = moving ? Math.sin(p.walk) * 3.5 : 0;
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(-16, 16 + step, 10, 7, 0, 0, 7); ctx.ellipse(16, 16 - step, 10, 7, 0, 0, 7); ctx.fill();
    let hands = [[-27, -2], [27, -2]];
    if (p.celebrateLeft > 0) hands = [[-25, -24], [25, -24]];
    else if (mood === 'sad') hands = [[-23, 8], [23, 8]];
    else if (p.castLeft > 0) {
      const kind = character.skill.kind;
      if (kind === 'shield') hands = [[-25, -17], [25, -17]];
      else if (kind === 'pulse' || kind === 'pull') hands = [[-34, -8], [34, -8]];
      else if (kind === 'trap') hands = [[-22, 3], [23, -24]];
      else if (kind === 'dash') hands = [[-25, 5], [25, 5]];
      else if (kind === 'blink') hands = [[-29, -14], [29, -14]];
      else if (kind === 'vampire') hands = [[-28, -10], [28, -10]];
      else if (kind === 'knight') hands = [[-30, -5], [30, -5]];
      else if (kind === 'ninja') hands = [[-26, -12], [26, -12]];
      else if (kind === 'mage') hands = [[-32, -15], [32, -15]];
    }
    ctx.fillStyle = dark;
    for (const hand of hands) { ctx.beginPath(); ctx.ellipse(hand[0], hand[1], 8, 7, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, -5, 27, 0, 7); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -8, 26, 0, 7); ctx.fill();
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(-8, -19, 10, 6, -.3, 0, 7); ctx.fill();
    ctx.fillStyle = `${light}aa`; ctx.beginPath(); ctx.ellipse(-18, -2, 4, 2.5, 0, 0, 7); ctx.ellipse(18, -2, 4, 2.5, 0, 0, 7); ctx.fill();
    drawAccessory(p);
    drawFace(p, mood);
    ctx.restore();
    if (p.shieldLeft > 0) {
      ctx.strokeStyle = '#d7f9ff'; ctx.lineWidth = 5; ctx.globalAlpha = .82;
      ctx.beginPath(); ctx.arc(x, y - 7, 35 + Math.sin(now / 80) * 2, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (p.warpLeft > 0) {
      const progress = 1 - p.warpLeft / .34;
      ctx.strokeStyle = light; ctx.lineWidth = 6 * (1 - progress); ctx.globalAlpha = 1 - progress;
      ctx.beginPath(); ctx.arc(x, y - 7, 28 + progress * 62, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (p.pullLeft > 0) {
      const progress = 1 - p.pullLeft / .34;
      ctx.strokeStyle = light; ctx.lineWidth = 4;
      for (let ring = 0; ring < 3; ring++) {
        const t = (progress + ring / 3) % 1;
        ctx.globalAlpha = 1 - t; ctx.beginPath(); ctx.arc(x, y - 7, 30 + (1 - t) * character.skill.radius, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (p.pulseLeft > 0) {
      const progress = 1 - p.pulseLeft / .32;
      ctx.strokeStyle = light; ctx.lineWidth = 8 * (1 - progress); ctx.globalAlpha = 1 - progress;
      ctx.beginPath(); ctx.arc(x, y - 7, 28 + progress * character.skill.radius, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (p.impactLeft > 0) {
      ctx.strokeStyle = '#fff8c7'; ctx.lineWidth = 3; ctx.globalAlpha = impact;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 34, y - 7 + Math.sin(a) * 34); ctx.lineTo(x + Math.cos(a) * 44, y - 7 + Math.sin(a) * 44); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (p.stunned > 0) { ctx.fillStyle = '#fff3a2'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✦', x + 25, y - 32); }
    if (mood === 'worried' || mood === 'surprised') { ctx.fillStyle = '#fffaf0'; ctx.font = '900 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', x - 29, y - 29); }
    // Vampire skill effect: dark aura
    if (p.vampireLeft > 0) {
      const progress = p.vampireLeft / CHARACTERS[p.characterId].skill.duration;
      ctx.strokeStyle = '#8b45a6'; ctx.lineWidth = 3; ctx.globalAlpha = progress * 0.6;
      ctx.beginPath(); ctx.arc(x, y - 7, 32 + Math.sin(now / 60) * 3, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Knight skill effect: rotating sword
    if (p.knightLeft > 0) {
      const angle = (now / 80) % (Math.PI * 2);
      const radius = p.knightRadius || 65;
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 4; ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * 20, y - 7 + Math.sin(angle) * 20);
      ctx.lineTo(x + Math.cos(angle) * radius, y - 7 + Math.sin(angle) * radius);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle + Math.PI) * 20, y - 7 + Math.sin(angle + Math.PI) * 20);
      ctx.lineTo(x + Math.cos(angle + Math.PI) * radius, y - 7 + Math.sin(angle + Math.PI) * radius);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Ninja skill effect: shadow clone
    if (p.ninjaClone && p.ninjaClone.life > 0) {
      const alpha = Math.min(1, p.ninjaClone.life / 0.5) * 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#4a4a4a';
      ctx.beginPath(); ctx.arc(p.ninjaClone.x, p.ninjaClone.y - 7, 24, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Mage skill effect: magic projectile
    if (p.mageProjectile) {
      const proj = p.mageProjectile;
      ctx.fillStyle = '#6b8de3';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(proj.x, proj.y, 4, 0, 7); ctx.fill();
    }
    // 闪闪加速模式效果：速度线
    if (p.speedBoost > 0 && p.characterId === 'blink') {
      ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 50) {
        const angle = Math.atan2(p.vy, p.vx);
        for (let i = 1; i <= 3; i++) {
          const offset = i * 15;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(angle) * offset, y - 7 - Math.sin(angle) * offset);
          ctx.lineTo(x - Math.cos(angle) * (offset + 20), y - 7 - Math.sin(angle) * (offset + 20));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    roundRect(x - 27, y - 65, 54, 21, 9, '#fffaf0');
    ctx.fillStyle = dark; ctx.font = '800 12px Noto Sans SC, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(character.name, x, y - 49);
    if (p.skillCooldown > 0) {
      const cooldown = character.skill.cooldown * (game.rule && game.rule.id === 'frenzy' ? game.rule.cooldownFactor : 1) * aiCooldownFactor(p);
      roundRect(x - 22, y + 29, 44, 5, 3, '#fff9');
      roundRect(x - 22, y + 29, 44 * (1 - p.skillCooldown / cooldown), 5, 3, light);
    }
    ctx.restore();
  }
  function captureHighlight(now) {
    // The online guest never plays replays (only the host scores points), so
    // recording frames there is pure wasted CPU on the latency-sensitive device.
if (game.mode === 'online' && onlinePlayerNumber !== 0 && onlinePlayerNumber !== null) return;
    if (game.phase !== 'playing' || now - game.highlightClock < 1000 / HIGHLIGHT_FPS) return;
    game.highlightClock = now;
    const frame = game.highlightFrames.length >= HIGHLIGHT_FRAME_COUNT ? game.highlightFrames.shift() : highlightPool[game.highlightFrames.length];
    frame.getContext('2d').drawImage(canvas, 0, 0, frame.width, frame.height);
    game.highlightFrames.push(frame);
  }
  let replayShade = null; // cached: identical every frame, allocation-free replays
  function renderHighlight() {
    const frames = game.highlightFrames;
    const position = Math.min(frames.length - 1, game.replay.elapsed / game.replay.duration * frames.length);
    const frame = frames[Math.max(0, Math.floor(position))];
    ctx.fillStyle = '#202534'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(frame, 0, 0, W, H);
    if (!replayShade) replayShade = ctx.createLinearGradient(0, 0, 0, H);
    const shade = replayShade;
    shade.addColorStop(0, '#20253455'); shade.addColorStop(.25, '#20253400'); shade.addColorStop(.75, '#20253400'); shade.addColorStop(1, '#20253466');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  }
  // Mobile online players see the full arena squeezed into a tiny strip; a
  // player-following camera zooms the world drawing without touching physics,
  // inputs, or host sync. Desktop and local modes keep the plain full view.
  function onlineCamera() {
    if (game.mode !== 'online' || !narrowScreen()) return null;
    const me = players[localPlayerIndex()];
    if (!me) return null;
    const scale = 1.45;
    const viewW = W / scale, viewH = H / scale;
    // Frame both the player and the nearest sofa when possible, biased
    // towards the player, so round start never stares at empty floor.
    const seat = nearestSeat(me) || me;
    const targetX = seat.x + (me.x - seat.x) * .7;
    const targetY = seat.y + (me.y - seat.y) * .7;
    const x = Math.max(viewW / 2, Math.min(W - viewW / 2, targetX));
    const y = Math.max(viewH / 2, Math.min(H - viewH / 2, targetY));
    return { scale, x, y };
  }
  function render(now) {
    ctx.clearRect(0, 0, W, H);
    if (game.replay && game.highlightFrames.length) {
      renderHighlight();
      return;
    }
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - .5) * 8, (Math.random() - .5) * 8);
    const cam = onlineCamera();
    if (cam) { ctx.translate(W / 2, H / 2); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x, -cam.y); }
    drawRoom(now);
    drawSofa(now);
    drawTraps(now);
    [...players].sort((a, b) => a.y - b.y).forEach(p => drawPlayer(p, now));
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.7));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (game.impactFlash > 0) {
      // One-two punch of juice: a brief white flash over the whole arena.
      ctx.fillStyle = `rgba(255, 246, 224, ${Math.min(.45, game.impactFlash * 3)})`;
      ctx.fillRect(0, 0, W, H);
      game.impactFlash = Math.max(0, game.impactFlash - .016);
    }
    captureHighlight(now);
  }
  function frame(now) {
    const dt = Math.min(.033, (now - last) / 1000 || .016);
    last = now;
    update(dt);
    render(now);
    requestAnimationFrame(frame);
  }
  document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => {
    if (game.mode === 'online' && btn.dataset.mode !== 'online') {
      // The mode switch is an exit affordance: honor it even mid-match,
      // otherwise a live online game offers no way out on some layouts.
      const target = btn.dataset.mode;
      // 离开房间可能卡在 WebRTC close 上：给它 1.2 秒，超时也把界面切回来，
      // 否则玩家会觉得"点了单人却没反应，只能再去点返回模式"。
      (async () => {
        try {
          await Promise.race([
            leaveOnlineRoom('你已离开房间'),
            new Promise(resolve => setTimeout(resolve, 1200)),
          ]);
        } finally {
          returnToMenu(target);
        }
      })();
      return;
    }
    if (game.phase !== 'menu' && game.phase !== 'finished') return;
    game.mode = btn.dataset.mode;
    syncMode();
    if (game.mode === 'online') showOnlineScreen();
  }));
  $('fullscreen-btn').addEventListener('click', enterFullscreen);
  $('exit-fullscreen-btn').addEventListener('click', exitFullscreen);
  $('demo-btn').addEventListener('click', () => {
    // Clean up online connection before entering demo mode
    if (game.mode === 'online' && onlineConnected()) {
      leaveOnlineRoom('你已离开房间');
    }
    game.mode = 'demo';
    syncMode();
    startMatch();
    enterFullscreen();
  });
  $('stop-demo-btn').addEventListener('click', stopDemo);
  $('start-btn').addEventListener('click', () => {
    if (game.mode === 'online') {
      showOnlineScreen();
      return;
    }
    // First-time players get a 3-step primer; demo/bench skip it.
    if (game.mode !== 'demo' && new URLSearchParams(location.search).get('bench') !== '1') {
      let seen = true;
      try { seen = localStorage.getItem('sofa-duel-seen') === '1'; } catch (_) {}
      const howto = $('howto');
      if (!seen && howto && !howto.dataset.done) {
        howto.hidden = false;
        howto.dataset.done = '1';
        return;
      }
    }
    startMatch();
  });
  const howtoOk = $('howto-ok-btn');
  if (howtoOk) howtoOk.addEventListener('click', () => {
    const h = $('howto');
    if (h) h.hidden = true;
    try { localStorage.setItem('sofa-duel-seen', '1'); } catch (_) {}
    startMatch();
  });
  $('again-btn').addEventListener('click', () => game.mode === 'online' ? requestOnlineRematch() : startMatch());
  $('change-btn').addEventListener('click', () => game.mode === 'online' ? backToOnlineSelect(true) : returnToMenu(game.mode));
  $('resume-btn').addEventListener('click', togglePause);
  $('restart-btn').addEventListener('click', () => { if (game.mode !== 'online') startMatch(); });
  $('menu-btn').addEventListener('click', () => game.mode === 'online' ? leaveOnlineRoom() : returnToMenu(game.mode));
  $('pause-btn').addEventListener('click', togglePause);
  $('poster-btn').addEventListener('click', makePoster);
  $('poster-save').addEventListener('click', async () => {
    const miniTool = window.xhs && window.xhs.miniTool;
    if (!miniTool || typeof miniTool.saveImageToPhotosAlbum !== 'function') return;
    const status = $('poster-status');
    const button = $('poster-save');
    button.disabled = true;
    status.textContent = '正在保存…';
    try {
      let filePath = $('poster-image').src;
      if (typeof miniTool.writeTempFile === 'function') {
        const result = await miniTool.writeTempFile({ data: filePath });
        filePath = result.filePath;
      }
      await miniTool.saveImageToPhotosAlbum({ filePath });
      status.textContent = '已保存到相册';
    } catch (_) {
      status.textContent = '保存失败，请重试';
    } finally {
      button.disabled = false;
    }
  });
  $('poster-close').addEventListener('click', () => $('poster-dialog').close());
  $('poster-dialog').addEventListener('click', event => { if (event.target === $('poster-dialog')) $('poster-dialog').close(); });
  $('help-btn').addEventListener('click', () => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    renderHelp();
    $('help-dialog').showModal();
  });
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) $('help-dialog').close(); });
  $('skip-replay').addEventListener('click', skipReplay);
  canvas.addEventListener('pointerdown', () => { if (game.replay) skipReplay(); });
  const refreshAudioSettings = () => {
    const musicBtn = $('toggle-music-btn');
    const sfxBtn = $('toggle-sfx-btn');
    if (musicBtn) { musicBtn.textContent = `背景音乐：${musicOn ? '开' : '关'}`; musicBtn.classList.toggle('off', !musicOn); }
    if (sfxBtn) { sfxBtn.textContent = `碰撞音效：${sfxOn ? '开' : '关'}`; sfxBtn.classList.toggle('off', !sfxOn); }
  };
  $('audio-settings-btn')?.addEventListener('click', () => { refreshAudioSettings(); $('audio-dialog').showModal(); });
  $('toggle-music-btn')?.addEventListener('click', () => {
    musicOn = !musicOn;
    try { localStorage.setItem('sofa-duel-audio-music', musicOn ? 'on' : 'off'); } catch (_) {}
    if (!musicOn) stopBackgroundMusic();
    else if (document.body.classList.contains('in-match') && !game.paused && game.audio) startBackgroundMusic();
    refreshAudioSettings();
    if (sfxOn) tone(560, .08);
  });
  $('toggle-sfx-btn')?.addEventListener('click', () => {
    sfxOn = !sfxOn;
    try { localStorage.setItem('sofa-duel-audio-sfx', sfxOn ? 'on' : 'off'); } catch (_) {}
    refreshAudioSettings();
    if (sfxOn) tone(620, .08);
  });
  // Music style selection
  const refreshMusicStyleUI = () => {
    document.querySelectorAll('.music-style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === musicStyle);
    });
  };
  document.querySelectorAll('.music-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      musicStyle = btn.dataset.style;
      try { localStorage.setItem('sofa-duel-music-style', musicStyle); } catch (_) {}
      refreshMusicStyleUI();
      // Restart music with new style if playing
      if (document.body.classList.contains('in-match') && !game.paused && game.audio && musicOn) {
        stopBackgroundMusic();
        startBackgroundMusic();
      }
      if (sfxOn) tone(520 + Math.random() * 80, .08);
    });
  });
  refreshMusicStyleUI();
  $('audio-close-btn')?.addEventListener('click', () => $('audio-dialog').close());
  $('audio-dialog')?.addEventListener('click', event => { if (event.target === $('audio-dialog')) $('audio-dialog').close(); });
  $('sound-btn').addEventListener('click', () => {
    game.audio = !game.audio;
    $('sound-btn').textContent = game.audio ? '♪' : '×';
    $('sound-btn').setAttribute('aria-label', game.audio ? '关闭声音' : '打开声音');
    try { localStorage.setItem('sofa-duel-audio', game.audio ? 'on' : 'off'); } catch (_) {}
    if (!game.audio) stopBackgroundMusic();
    else if (document.body.classList.contains('in-match') && !game.paused) startBackgroundMusic();
    tone(620, .09);
  });
  // Resume audio context on first user interaction (browser autoplay policy)
  const resumeAudioOnInteraction = () => {
    if (game.audioContext && game.audioContext.state === 'suspended') {
      game.audioContext.resume();
    }
  };
  document.addEventListener('click', resumeAudioOnInteraction, { once: true, capture: true });
  document.addEventListener('touchstart', resumeAudioOnInteraction, { once: true, capture: true });
  // Auto-rotate to landscape fullscreen on mobile when match starts
  const tryAutoLandscape = () => {
    if (!narrowScreen()) return; // Only on mobile
    // Try to request fullscreen
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(() => {});
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen().catch(() => {});
    }
    // Try to lock orientation to landscape
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  };
  // Trigger on match start
  const originalStartMatch = startMatch;
  startMatch = function() {
    originalStartMatch();
    if (game.phase === 'countdown' || game.phase === 'playing') {
      setTimeout(tryAutoLandscape, 100);
    }
  };
  document.addEventListener('keydown', event => {
    if ($('poster-dialog').open || $('help-dialog').open) return;
    if (game.replay && ['Space', 'Enter', 'Escape'].includes(event.code)) {
      event.preventDefault();
      skipReplay();
      return;
    }
    const activeRound = ['playing', 'countdown', 'roundEnd'].includes(game.phase);
    if (activeRound && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.code)) event.preventDefault();
    if (activeRound) keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyP' && game.mode !== 'online') togglePause();
    if (event.code === 'Escape') exitFullscreen();
    if (event.code === 'KeyR' && game.phase !== 'menu' && game.mode !== 'online') startMatch();
    if (event.code === 'Space' && game.mode !== 'demo') useLocalSkill();
    if (event.code === 'Enter' && game.mode === 'duo') { registerMash(players[1]); useSkill(players[1]); }
    // Q键切换闪闪技能模式
    if (event.code === 'KeyQ' && game.mode !== 'demo') {
      const localIdx = localPlayerIndex();
      const player = players[localIdx];
      if (player && player.characterId === 'blink') {
        player.useAltSkill = !player.useAltSkill;
        updateSkillToggleUI();
        updateDashTouchUI();
        tone(680, .08, 'sine', .04);
      }
    }
  });
  document.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); stickEnd(); });
  const stick = $('joystick'), knob = $('joystick-knob');
  function stickMove(e) {
    if (game.paused || !['playing', 'countdown'].includes(game.phase)) return;
    const rect = stick.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2), dy = e.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy), max = rect.width * .3;
    mobile.x = length > 0 ? dx / Math.max(length, max) : 0;
    mobile.y = length > 0 ? dy / Math.max(length, max) : 0;
    knob.style.left = `${50 + mobile.x * 30}%`;
    knob.style.top = `${50 + mobile.y * 30}%`;
  }
  stick.addEventListener('pointerdown', e => { e.preventDefault(); stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', e => { if (stick.hasPointerCapture(e.pointerId)) stickMove(e); });
  function stickEnd() { mobile.x = 0; mobile.y = 0; knob.style.left = '50%'; knob.style.top = '50%'; }
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  stick.addEventListener('lostpointercapture', stickEnd);
  $('dash-touch').addEventListener('pointerdown', e => { e.preventDefault(); useLocalSkill(); });
  // 闪闪技能切换按钮
  $('skill-toggle')?.addEventListener('pointerdown', e => {
    e.preventDefault();
    const localIdx = localPlayerIndex();
    const player = players[localIdx];
    if (player && player.characterId === 'blink') {
      player.useAltSkill = !player.useAltSkill;
      updateSkillToggleUI();
      tone(680, .08, 'sine', .04);
    }
  });
  // 更新技能切换按钮UI
  function updateSkillToggleUI() {
    const btn = $('skill-toggle');
    if (!btn) return;
    const localIdx = localPlayerIndex();
    const player = players[localIdx];
    const isBlink = player && player.characterId === 'blink';
    btn.hidden = !isBlink || game.mode === 'demo';
    if (isBlink) {
      const skillName = player.useAltSkill ? '加速' : '闪现';
      btn.firstChild.textContent = skillName;
      btn.style.background = player.useAltSkill ? '#10b981' : '#4a5568';
      btn.style.borderColor = player.useAltSkill ? '#059669' : '#2d3748';
    }
  }
  // 更新技能按钮文本（移动端）
  function updateDashTouchUI() {
    const btn = $('dash-touch');
    if (!btn) return;
    const localIdx = localPlayerIndex();
    const player = players[localIdx];
    if (!player) return;
    const character = CHARACTERS[player.characterId];
    let skillName = character.skill.name;
    if (player.characterId === 'blink' && player.useAltSkill && character.skillAlt) {
      skillName = character.skillAlt.name;
    }
    btn.firstChild.textContent = skillName;
    btn.style.background = character.color;
    btn.style.borderBottomColor = character.dark;
  }
  // Online Multiplayer (PeerJS WebRTC)
  // The host runs the real match; the guest sends its input and renders host snapshots.
  let network = null;
  let onlineState = 'menu'; // menu | waiting | select | playing
  let onlineRoomCode = null;
  let onlinePlayerNumber = null; // 0 = host, 1 = guest
let GAME_VERSION = '15.8.9';      // handshake: mismatched versions between devices break the protocol
let onlineRoomSize = 2;         // total seats including the host (2-4)
let onlineCharacters = [];      // indexed by playerNumber: null | characterId
let onlineReady = [];           // indexed by playerNumber
let onlineGuestInputs = [];     // host side: per-guest input, indexed by playerNumber - 1
let onlineRematchVotes = new Set();
let onlineRematchForceTimer = null; // host: start anyway if a player stalls on the result screen
let onlineSeatConfirmed = false; // guest: welcome (seat assignment) received
  let onlineLobbyEpoch = 0;
  let onlineMatchId = 0;
  let onlineOperation = 0;
  let onlineGameInterval = null;
  let onlineOpponentInput = { x: 0, y: 0, skill: false };
  let onlinePendingSkill = false;
  let onlineLastBannerSeq = 0;
  let networkLag = 0;
  let onlineEchoTimestamp = 0;   // latest guest input timestamp, echoed by the host
  let onlineEchoAt = -Infinity;  // host-side arrival time of that input
  let onlineLastSnapshotAt = 0;  // guest-side: last time a host snapshot arrived
  let onlineImpactQueue = [];    // host-side: impact events waiting to be synced
let onlineLastInputAts = [];     // host-side: last input arrival per guest seat (watchdog)
  let guestHitStop = 0;          // guest-side: brief freeze on synced impacts
  let onlineHostReplaying = false; // guest-side: host is showing a highlight replay
  let onlineReconnectTimer = null; // host-side grace window for a dropped guest
let remoteInterpolations = []; // guest side: one interpolation state per remote player index
  function freshInterpolation() {
    return {
      prevX: 0, prevY: 0, prevVX: 0, prevVY: 0,
      targetX: 0, targetY: 0, targetVX: 0, targetVY: 0,
      interpTime: 0, interpDuration: .06, lastUpdateTime: 0
    };
  }
  function localPlayerIndex() { return game.mode === 'online' && onlinePlayerNumber ? onlinePlayerNumber : 0; }
  function onlineConnected() { return Boolean(network && network.isConnected()); }
  function localMoveVector() {
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + mobile.x;
    const y = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + mobile.y;
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }
  function sendOnlineInput(skill = false) {
    if (!onlineConnected() || onlinePlayerNumber === 0 || onlinePlayerNumber === null || onlineState !== 'playing') return false;
    if (!['playing', 'countdown'].includes(game.phase)) return false;
    const move = localMoveVector();
    network.send('input', { x: move.x, y: move.y, skill: Boolean(skill), matchId: onlineMatchId, seat: onlinePlayerNumber });
    return true;
  }
  function useLocalSkill() {
    if (game.mode === 'demo') return;
    // 贴身角力: human presses count as mashes (host side counts its own; the
    // online guest's presses are counted by the host from the input message).
    if (!(game.mode === 'online' && onlinePlayerNumber)) registerMash(players[localPlayerIndex()]);
    if (game.mode === 'online' && onlinePlayerNumber) {
      // Send a skill press immediately instead of adding another input-tick of latency.
      if (game.phase === 'playing') {
        const me = players[onlinePlayerNumber];
        const skill = CHARACTERS[me.characterId] && CHARACTERS[me.characterId].skill;
        if (skill && me.skillCooldown <= 0 && me.stunned <= 0) {
          // Optimistic cast feedback: show the gesture and play the sound now.
          // Physics stay host-authoritative; the next snapshot (<=50ms) replaces
          // cooldown/cast state with the host's decision, so a rejected press
          // self-corrects instead of desyncing.
          me.castTotal = skill.kind === 'trap' ? .5 : skill.kind === 'pull' ? .46 : .38;
          me.castLeft = me.castTotal;
          me.skillCooldown = skill.cooldown;
          react(me, 'focused', me.castTotal);
          characterSound(me, 'skill');
        }
        // 贴身角力: the host counts authoritatively, but the guest should still
        // hear its own taps instantly (audio is per-device).
        if (game.rule && game.rule.id === 'mash' && game.rulePhase === 'active' && me.stunned <= 0) {
          const other = nearestOpponent(me);
          if (other && dist(me, other) <= (game.rule.contactRange || 52)) {
            tone(300 + Math.min((game.mashCounts[onlinePlayerNumber] || 0) + 1, 14) * 26, .05, 'triangle', .035, 1.08);
            // Optimistic meter: bump locally for instant feedback; the next
            // snapshot reconciles with the host's authoritative count.
            game.mashCounts[onlinePlayerNumber] = Math.min((game.mashCounts[onlinePlayerNumber] || 0) + 1, game.rule.mashGoal);
            updateRuleHud();
          }
        }
        onlinePendingSkill = true;
        if (sendOnlineInput(true)) onlinePendingSkill = false;
      }
      return;
    }
    useSkill(players[0]);
  }
  function updateConnectionStatus(status) {
    const el = $('connection-status');
    if (!el) return;
    el.className = 'connection-status ' + status;
    const small = el.querySelector('small');
    if (small) small.textContent = status === 'connected' ? '已连接' : status === 'connecting' ? '连接中...' : '未连接';
    const dot = el.querySelector('.status-dot');
    if (dot) dot.className = 'status-dot ' + (status === 'connected' ? '' : status);
    const lagEl = $('lag-indicator');
    if (lagEl) lagEl.hidden = status !== 'connected';
  }
  function showOnlineScreen(message) {
    // If we're already in an online session (waiting/select/playing), clean up first
    if (onlineState !== 'menu' && onlineConnected()) {
      leaveOnlineRoom();
    }
    hideAllScreens();
    stopBackgroundMusic();
    document.body.classList.remove('in-match', 'match-finished', 'online-match');
    $('online-screen').classList.add('visible');
    $('online-menu').hidden = false;
    $('online-waiting').hidden = true;
    $('online-character-select').hidden = true;
    $('back-to-menu-btn').hidden = false;
    $('back-to-menu-btn').textContent = '返回模式选择';
    $('online-title').textContent = '联网对战';
    $('online-game-hud').hidden = true;
    $('online-error').textContent = message || '';
    $('again-btn').disabled = false;
    onlineState = 'menu';
    updateConnectionStatus('disconnected');
  }
  function hideAllScreens() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
  }
  function onlineErrorText(error, fallback) {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    const messages = {
      'unavailable-id': '房间号被占用，请再试一次',
      network: '联机服务器连接失败，请检查网络后重试',
      'server-error': '联机服务器暂时不可用，请稍后重试',
      'socket-error': '联机服务器连接异常，请检查网络后重试',
      'socket-closed': '联机服务器连接已关闭，请重试',
      webrtc: '浏览器无法建立联机连接，请切换网络后重试',
      'browser-incompatible': '当前浏览器不支持联机，请使用最新版浏览器'
    };
    return messages[error.type] || error.message || fallback;
  }
  function prepareOnlineLobby() {
    const operation = ++onlineOperation;
    const previous = network;
    if (previous) {
      previous.onData = null;
      previous.onPlayerJoin = null;
      previous.onPlayerLeave = null;
      previous.leaveRoom().catch(() => {});
    }
    const session = new window.SofaNetwork();
    network = session;
    session.onData = handleOnlineMessage;
    session.onPlayerLeave = handlePeerLeave;
    session.onPlayerJoin = null;
    $('online-menu').hidden = true;
    $('online-waiting').hidden = false;
    $('online-character-select').hidden = true;
    $('back-to-menu-btn').hidden = false;
    $('back-to-menu-btn').textContent = '取消并返回';
    $('online-error').textContent = '';
    $('copy-code-btn').disabled = true;
    onlineState = 'waiting';
    updateConnectionStatus('connecting');
    return { operation, session };
  }
  function isCurrentOnlineOperation(operation, session) {
    return operation === onlineOperation && network === session;
  }
  async function createRoom(preferredCode) {
    if (typeof preferredCode !== 'string' || preferredCode.length !== 6) preferredCode = undefined;  // click events etc.
    const { operation, session } = prepareOnlineLobby();
    $('room-code').textContent = preferredCode || '------';
    document.querySelector('.waiting-text').textContent = preferredCode ? '正在恢复房间…' : '正在创建房间…';
    try {
      const result = await session.createRoom(preferredCode, onlineRoomSize);
      if (!isCurrentOnlineOperation(operation, session)) {
        await session.leaveRoom();
        return;
      }
      onlineRoomCode = result.roomCode;
      onlinePlayerNumber = result.playerNumber;
      $('room-code').textContent = onlineRoomCode;
      $('copy-code-btn').disabled = false;
      document.querySelector('.waiting-text').textContent = preferredCode ? '房间已恢复，等待对手重连…' : '把 6 位房间号发给好友，等待加入…';
      try { sessionStorage.setItem('sofa-host-room', onlineRoomCode); } catch (_) {}
      updateConnectionStatus('connected');
      session.onPlayerJoin = seat => {
        if (!isCurrentOnlineOperation(operation, session)) return;
        if (onlineState !== 'waiting' && onlineState !== 'select') return;
        if (onlineReconnectTimer) { clearTimeout(onlineReconnectTimer); onlineReconnectTimer = null; }
        enterOnlineSelect();
        // Assign the seat, then publish the authoritative lobby to everyone.
        network.sendTo(seat, 'welcome', { playerNumber: seat, size: onlineRoomSize, epoch: onlineLobbyEpoch, v: GAME_VERSION });
        broadcastOnlineLobby();
      };
    } catch (error) {
      if (!isCurrentOnlineOperation(operation, session)) return;
      leaveOnlineRoom(onlineErrorText(error, '创建房间失败，请重试'));
    }
  }
  async function joinRoom() {
    const input = $('room-code-input').value;
    if (!input.trim()) {
      $('online-error').textContent = '请先输入好友发来的 6 位房间号';
      return;
    }
    await joinRoomByCode(input);
  }
  async function joinRoomByCode(input) {
    const { operation, session } = prepareOnlineLobby();
    $('room-code').textContent = '------';
    document.querySelector('.waiting-text').textContent = '正在加入房间…';
    try {
      const result = await session.joinRoom(input);
      if (!isCurrentOnlineOperation(operation, session)) {
        await session.leaveRoom();
        return;
      }
      onlineRoomCode = result.roomCode;
      onlinePlayerNumber = result.playerNumber;
      $('room-code').textContent = onlineRoomCode;
      $('copy-code-btn').disabled = false;
      updateConnectionStatus('connected');
      enterOnlineSelect();
      // Ask the host for its lobby epoch so reconnects (fresh page or same
      // page) converge on the host's counter instead of lockstep increments.
      network.send('hello', {});
    } catch (error) {
      if (!isCurrentOnlineOperation(operation, session)) {
        await session.leaveRoom().catch(() => {});
        return;
      }
      leaveOnlineRoom(onlineErrorText(error, '加入房间失败，请重试'));
    }
  }
  function enterOnlineSelect(epoch) {
    if (Number.isInteger(epoch)) onlineLobbyEpoch = Math.max(onlineLobbyEpoch, epoch);
    else onlineLobbyEpoch++;
    onlineState = 'select';
    onlineCharacters = Array(onlineRoomSize).fill(null);
    onlineReady = Array(onlineRoomSize).fill(false);
    onlineGuestInputs = Array(Math.max(0, onlineRoomSize - 1)).fill(null).map(() => ({ x: 0, y: 0, skill: false }));
    onlineRematchVotes = new Set();
    onlineSeatConfirmed = onlinePlayerNumber === 0;
    onlineOpponentInput = { x: 0, y: 0, skill: false };
    onlinePendingSkill = false;
    game.phase = 'menu';
    game.paused = false;
    game.seats = [];
    stopOnlineLoop();
    hideAllScreens();
    stopBackgroundMusic();
    clearHighlight();
    keys.clear();
    stickEnd();
    document.body.classList.remove('in-match', 'match-finished', 'online-match', 'multi-sofa');
    $('online-screen').classList.add('visible');
    $('online-menu').hidden = true;
    $('online-waiting').hidden = true;
    $('online-character-select').hidden = false;
    $('back-to-menu-btn').hidden = false;
    $('back-to-menu-btn').textContent = '离开房间';
    $('online-title').textContent = '选择角色并准备';
    $('online-game-hud').hidden = true;
    $('result-screen').classList.remove('visible');
    $('again-btn').disabled = false;
    buildOnlinePicker();
    updateOnlineLobby();
    $('online-title').focus({ preventScroll: true });
  }
  function buildOnlinePicker() {
    const picker = $('online-picker');
    picker.innerHTML = '';
    CHARACTER_IDS.forEach(id => {
      const char = CHARACTERS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-choice';
      btn.dataset.character = id;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${char.name}，技能${char.skill.name}`);
      btn.innerHTML = `<span class="choice-avatar" style="background:${char.color};box-shadow:inset 0 -3px 0 ${char.dark}">${char.name.slice(0, 1)}</span><div><strong>${char.name}</strong><small>${char.skill.name}</small></div>`;
      btn.addEventListener('click', () => selectOnlineCharacter(id));
      picker.appendChild(btn);
    });
  }
  function onlineConnectedSeats() {
    const seats = [0];
    if (network && network.playerNumber === 0) {
      for (const entry of network.conns) if (entry.conn.open) seats.push(entry.playerNumber);
    } else if (onlinePlayerNumber !== 0) {
      seats.push(onlinePlayerNumber);
    }
    return seats;
  }
  function onlineLobbyReadyToStart() {
    if (onlinePlayerNumber !== 0 || onlineState !== 'select') return false;
    const connected = new Set(onlineConnectedSeats());
    for (let seat = 0; seat < onlineRoomSize; seat++) {
      if (!connected.has(seat)) return false;
      if (!onlineCharacters[seat] || !onlineReady[seat]) return false;
    }
    return true;
  }
  function broadcastOnlineLobby() {
    if (onlinePlayerNumber !== 0 || !onlineConnected()) return;
    network.send('lobby', {
      epoch: onlineLobbyEpoch,
      size: onlineRoomSize,
      characters: [...onlineCharacters],
      ready: [...onlineReady],
      connected: onlineConnectedSeats(),
      v: GAME_VERSION
    });
  }
  function updateOnlineLobby() {
    const myCharacter = onlineCharacters[onlinePlayerNumber];
    const myReady = Boolean(onlineReady[onlinePlayerNumber]);
    const container = $('online-lobby-players');
    if (container) {
      container.innerHTML = '';
      const connected = new Set(onlineConnectedSeats());
      for (let seat = 0; seat < onlineRoomSize; seat++) {
        const mine = seat === onlinePlayerNumber;
        const character = onlineCharacters[seat] && CHARACTERS[onlineCharacters[seat]] ? CHARACTERS[onlineCharacters[seat]].name : '未选择';
        const ready = Boolean(onlineReady[seat]);
        const row = document.createElement('div');
        row.className = 'status-player' + (ready ? ' ready' : '');
        const label = mine ? '你' : seat === 0 ? '房主' : `玩家${seat + 1}`;
        const state = connected.has(seat) || mine ? '' : '（等待加入…）';
        row.innerHTML = `<span>${ready ? '●' : '○'}</span><small>${label}${state}：<span>${character}</span></small><em>${ready ? '已准备' : '未准备'}</em>`;
        container.appendChild(row);
      }
    }
    document.querySelectorAll('#online-picker .character-choice').forEach(btn => {
      const selected = btn.dataset.character === myCharacter;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
      btn.disabled = myReady;
    });
    const readyButton = $('online-ready-btn');
    readyButton.disabled = !myCharacter || !onlineConnected() || !onlineSeatConfirmed;
    readyButton.classList.toggle('is-ready', myReady);
    readyButton.innerHTML = myReady ? '取消准备 <span>×</span>' : '准备好 <span>✓</span>';
    const connectedCount = onlineConnectedSeats().length;
    const everyoneReady = onlineCharacters.every((c, idx) => c && onlineReady[idx]);
    document.querySelector('.select-hint').textContent = !onlineSeatConfirmed
      ? '正在同步房间信息…'
      : connectedCount < onlineRoomSize
        ? `等待玩家加入（${connectedCount}/${onlineRoomSize}）…`
        : everyoneReady
          ? '全员已准备，即将开局…'
          : myReady
            ? '你已准备，等待其他人点击“准备好”…'
            : onlineCharacters.some((c, idx) => idx !== onlinePlayerNumber && c)
              ? '其他人已选好角色，点击“准备好”锁定你的选择'
              : '请先选择角色，再点击“准备好”';
  }
  function selectOnlineCharacter(characterId) {
    if (onlineState !== 'select' || onlineReady[onlinePlayerNumber] || !CHARACTERS[characterId] || !onlineSeatConfirmed) return;
    onlineCharacters[onlinePlayerNumber] = characterId;
    game.manualPicks[localPlayerIndex()] = characterId;
    game.picks[localPlayerIndex()] = characterId;
    if (onlineConnected()) network.send('characterSelect', { character: characterId, epoch: onlineLobbyEpoch, seat: onlinePlayerNumber });
    if (onlinePlayerNumber === 0) broadcastOnlineLobby();
    updateOnlineLobby();
  }
  function toggleOnlineReady() {
    if (onlineState !== 'select' || !onlineConnected() || !onlineSeatConfirmed) return;
    if (!onlineCharacters[onlinePlayerNumber]) return;
    onlineReady[onlinePlayerNumber] = !onlineReady[onlinePlayerNumber];
    network.send('playerReady', { ready: onlineReady[onlinePlayerNumber], character: onlineCharacters[onlinePlayerNumber], epoch: onlineLobbyEpoch, seat: onlinePlayerNumber });
    if (onlinePlayerNumber === 0) broadcastOnlineLobby();
    updateOnlineLobby();
    maybeStartOnlineMatch();
  }
  function maybeStartOnlineMatch() {
    if (onlineLobbyReadyToStart()) startOnlineMatch();
  }
  function startOnlineMatch() {
    if (onlinePlayerNumber !== 0 || !onlineConnected()) return;
    const fromLobby = onlineState === 'select' && onlineLobbyReadyToStart();
    const fromResult = onlineState === 'playing' && game.phase === 'finished';
    if (!fromLobby && !fromResult) return;
    stopOnlineLoop();
    onlineMatchId++;
    onlineState = 'playing';
    onlineRematchVotes = new Set();
    if (onlineRematchForceTimer) { clearTimeout(onlineRematchForceTimer); onlineRematchForceTimer = null; }
    game.mode = 'online';
    game.manualPicks = [...onlineCharacters];
    game.picks = [...game.manualPicks];
    hideAllScreens();
    $('online-game-hud').hidden = false;
    $('online-opponent-name').textContent = onlineRoomSize > 2 ? `对手 ×${onlineRoomSize - 1}` : `对手 · ${CHARACTERS[onlineCharacters[1]] ? CHARACTERS[onlineCharacters[1]].name : ''}`;
    $('again-btn').disabled = false;
    onlineOpponentInput = { x: 0, y: 0, skill: false };
    startMatch();
    network.send('gameStart', { picks: game.picks, sofaCount: game.matchSofas, matchId: onlineMatchId, epoch: onlineLobbyEpoch });
    network.send('gameState', { state: buildOnlineSnapshot() });
    onlineGameInterval = setInterval(() => {
      if (onlineConnected() && onlineState === 'playing') network.send('gameState', { state: buildOnlineSnapshot() });
    }, 50);
  }
  function beginOnlineClientMatch(picks, sofaCount, matchId, epoch) {
    if (onlinePlayerNumber === 0 || onlinePlayerNumber === null || !Array.isArray(picks) || picks.length < 2 || picks.length > 4 || !picks.every(id => typeof id === 'string' && CHARACTERS[id])) return;
    if (!Number.isInteger(matchId) || matchId <= onlineMatchId || epoch !== onlineLobbyEpoch) return;
    onlineRoomSize = Math.max(2, Math.min(4, picks.length));
    const fromLobby = onlineState === 'select' && onlineSeatConfirmed && Boolean(onlineCharacters[onlinePlayerNumber]);
    const fromResult = onlineState === 'playing' && game.phase === 'finished';
    // Accept new match even if we haven't reached finished yet (fast rematch race)
    const fromPlaying = onlineState === 'playing' && matchId > onlineMatchId + 1;
    if (!fromLobby && !fromResult && !fromPlaying) return;
    // Accept gameStart even if we cancelled ready (race condition): host already started
    if (fromLobby && !onlineReady[onlinePlayerNumber]) {
      // Auto-ready to sync with host's state
      onlineReady[onlinePlayerNumber] = true;
    }
    onlineMatchId = matchId;
    onlineState = 'playing';
    game.mode = 'online';
    game.picks = [...picks];
    game.manualPicks = [...picks];
    game.sofaCount = Math.max(1, Math.min(3, Number(sofaCount) || 1));
    game.matchSofas = game.sofaCount;
    const matchPlayers = picks.length;
    players = Array.from({ length: matchPlayers }, (_, i2) => players[i2] || makePlayer(i2));
    game.playerCount = matchPlayers;
    game.scores = Array(matchPlayers).fill(0);
    game.combo = Array(matchPlayers).fill(0);
    game.maxCombo = Array(matchPlayers).fill(0);
    game.round = 0;
    game.ruleHistory = [];
    game.mashCounts = Array(matchPlayers).fill(0);
    game.morphT = 0; game.morphPhase = -1;
    game.chaosTimer = 0; game.chaosNext = 0;
    game.mashWins = Array(matchPlayers).fill(0);
    game.morphT = 0; game.morphPhase = -1;
    game.rule = null;
    game.rulePhase = 'idle';
    game.ruleTarget = null;
    game.ruleMove = null;
    game.seats = [];
    game.capture = Array(matchPlayers).fill(0);
    game.standoff = false;
    game.standoffTime = 0;
    game.standoffShown = false;
    game.time = ROUND_SECONDS;
    game.phase = 'countdown';
    game.paused = false;
    game.particles = [];
    game.shake = 0;
    game.hitStop = 0;
    game.lastImpact = null;
    game.playTipTime = 0;
    onlinePendingSkill = false;
    onlineLastBannerSeq = 0;
    onlineLastSnapshotAt = 0;
    guestHitStop = 0;
    onlineHostReplaying = false;
    remoteInterpolations = Array.from({ length: matchPlayers }, () => freshInterpolation());
    clearHighlight();
    resetPlayers();
    hideAllScreens();
    document.body.classList.add('in-match');
    document.body.classList.remove('match-finished', 'demo-mode');
    document.body.classList.toggle('multi-sofa', game.matchSofas > 1);
    document.body.classList.add('online-match');
    $('online-game-hud').hidden = false;
    $('online-opponent-name').textContent = `对手 · ${CHARACTERS[game.picks[0]].name}`;
    $('result-screen').classList.remove('visible');
    $('pause-screen').classList.remove('visible');
    $('play-tip').classList.remove('show');
    $('again-btn').disabled = false;
    syncMode();
    updateRuleHud();
    updateHud();
    startBackgroundMusic();
    stopOnlineLoop();
    onlineGameInterval = setInterval(() => {
      if (sendOnlineInput(onlinePendingSkill)) onlinePendingSkill = false;
    }, 33);
  }
  function buildOnlineSnapshot() {
    return {
      matchId: onlineMatchId,
      phase: game.phase,
      round: game.round,
      scores: [...game.scores],
      mash: [...game.mashCounts],
      time: game.time,
      capture: [...game.capture],
      standoff: game.standoff,
      rule: game.rule ? game.rule.id : null,
      rulePhase: game.rulePhase,
      ruleTarget: game.ruleTarget,
      ruleHistory: game.ruleHistory.slice(-3),
      sofaCount: game.matchSofas,
      seats: game.seats.map(seat => ({ x: seat.x, y: seat.y, capture: [...seat.capture], scale: seat.scale || 1 })),
      players: players.map(p => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        characterId: p.characterId,
        skillCooldown: p.skillCooldown,
        stunned: p.stunned,
        shieldLeft: p.shieldLeft,
        dashLeft: p.dashLeft,
        pulseLeft: p.pulseLeft,
        pullLeft: p.pullLeft,
        warpLeft: p.warpLeft,
        vampireLeft: p.vampireLeft,
        knightLeft: p.knightLeft,
        knightRadius: p.knightRadius,
        ninjaLeft: p.ninjaLeft,
        ninjaClone: p.ninjaClone ? { ...p.ninjaClone } : null,
        speedBoost: p.speedBoost,
        boostFactor: p.boostFactor || 1,
        mageProjectile: p.mageProjectile ? { ...p.mageProjectile } : null,
        castLeft: p.castLeft,
        castTotal: p.castTotal,
        facingX: p.facingX,
        facingY: p.facingY,
        emotion: p.emotion,
        impactLeft: p.impactLeft,
        blink: p.blink,
        trap: p.trap ? { x: p.trap.x, y: p.trap.y, radius: p.trap.radius, left: p.trap.left, arm: p.trap.arm, stun: p.trap.stun } : null,
        ninjaClone: p.ninjaClone ? { x: p.ninjaClone.x, y: p.ninjaClone.y, life: p.ninjaClone.life } : null
      })),
      banner: { seq: game.bannerSeq, text: game.bannerText, time: game.bannerTime },
      echo: performance.now() - onlineEchoAt < 600 ? onlineEchoTimestamp : null,
      replaying: Boolean(game.replay),
      impacts: onlineImpactQueue.splice(0, onlineImpactQueue.length),
      result: game.phase === 'finished' ? { winner: game.scores.indexOf(Math.max(...game.scores)) } : null
    };
  }
  function applySnapshotSkillState(p, snap) {
    // Visual state is host-owned too: guests must see the same aura, swords,
    // clones and projectiles instead of only a moving character sprite.
    p.pulseLeft = snap.pulseLeft || 0;
    p.pullLeft = snap.pullLeft || 0;
    p.warpLeft = snap.warpLeft || 0;
    p.vampireLeft = snap.vampireLeft || 0;
    p.knightLeft = snap.knightLeft || 0;
    p.knightRadius = snap.knightRadius || 0;
    p.ninjaLeft = snap.ninjaLeft || 0;
    p.ninjaClone = snap.ninjaClone ? { ...snap.ninjaClone } : null;
    p.speedBoost = snap.speedBoost || 0;
    p.boostFactor = snap.boostFactor || 1;
    p.mageProjectile = snap.mageProjectile ? { ...snap.mageProjectile } : null;
  }
  function applyOnlineSnapshot(state) {
    const rejectSnap = why => { if (window.__snapRejects) window.__snapRejects.push(why); };
    if (!state || onlineState !== 'playing' || state.matchId !== onlineMatchId) return rejectSnap('R1:if (!state || onlineState !== playing || state.matchId !==');
    if (!['countdown', 'playing', 'roundEnd', 'finished'].includes(state.phase)) return rejectSnap('R2:if (![countdown, playing, roundEnd, finished].includ');
    if (!Number.isInteger(state.round) || !Number.isFinite(state.time)) return rejectSnap('R3:if (!Number.isInteger(state.round) || !Number.isFinite(state');
    if (!Array.isArray(state.scores) || state.scores.length !== state.players.length || !state.scores.every(Number.isFinite)) return rejectSnap('R4:if (!Array.isArray(state.scores) || state.scores.length !== ');
    if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 4) return rejectSnap('R5:if (!Array.isArray(state.players) || state.players.length < ');
    if (state.rule && !RULES[state.rule]) return rejectSnap('R6:if (state.rule && !RULES[state.rule]) return;');
    if (state.seats && (!Array.isArray(state.seats) || state.seats.length > 3 || !state.seats.every(seat => seat && Number.isFinite(seat.x) && Number.isFinite(seat.y) && Array.isArray(seat.capture) && seat.capture.length === state.players.length))) return rejectSnap('R7:if (state.seats && (!Array.isArray(state.seats) || state.sea');
    if (state.result && (!Number.isInteger(state.result.winner) || state.result.winner < 0 || state.result.winner >= state.players.length)) return rejectSnap('R8:if (state.result && (!Number.isInteger(state.result.winner) ');
    if (state.sofaCount) {
      game.matchSofas = Math.max(1, Math.min(3, Number(state.sofaCount) || 1));
      document.body.classList.toggle('multi-sofa', game.matchSofas > 1);
    }
    const roundChanged = state.round !== game.round;
    game.round = state.round;
    game.phase = state.phase;
    game.scores = [...state.scores];
    if (Array.isArray(state.mash) && state.mash.length === state.players.length) game.mashCounts = [...state.mash];
    if (Array.isArray(state.impacts)) {
      for (const imp of state.impacts) {
        if (!imp || !Number.isFinite(imp.x) || !Number.isFinite(imp.y)) continue;
        burst(imp.x, imp.y, imp.side, 22);
        game.shake = Math.max(game.shake, .18);
        game.impactFlash = .14;
        tone(160, .13, 'square', .035, .75);
        guestHitStop = .08;
      }
    }
    game.capture = state.capture || game.capture;
    game.standoff = Boolean(state.standoff);
    game.rule = state.rule ? RULES[state.rule] : null;
    game.rulePhase = state.rulePhase || 'idle';
    game.ruleTarget = state.ruleTarget || null;
    if (Array.isArray(state.ruleHistory)) game.ruleHistory = state.ruleHistory;
    if (Array.isArray(state.seats)) {
      if (game.seats.length !== state.seats.length) {
        game.seats = state.seats.map(seat => ({ x: seat.x, y: seat.y, capture: [...seat.capture], scale: seat.scale || 1 }));
      } else {
        state.seats.forEach((seat, i) => {
          game.seats[i].x = seat.x;
          game.seats[i].y = seat.y;
          game.seats[i].scale = seat.scale || 1;
          game.seats[i].capture = [...seat.capture];
        });
      }
    }
    if (roundChanged) {
      clearHighlight();
      game.particles = [];
      game.standoffTime = 0;
      onlinePendingSkill = false;
      resetPlayers();
      remoteInterpolations = Array.from({ length: state.players.length }, () => freshInterpolation());
    }
    onlineHostReplaying = Boolean(state.replaying);
    if (Array.isArray(state.players)) {
      // Guest predicts its own movement between snapshots; every other player is interpolated.
      const mineIdx = onlinePlayerNumber;
      const mine = state.players[mineIdx];
      if (mine && players[mineIdx]) applySnapshotPlayer(players[mineIdx], mine, true, roundChanged);
      const now = performance.now();
      for (let idx = 0; idx < state.players.length; idx++) {
        if (idx === mineIdx) continue;
        const remote = state.players[idx];
        const p = players[idx];
        if (!remote || !p) continue;
        if (!remoteInterpolations[idx]) remoteInterpolations[idx] = freshInterpolation();
        const interp = remoteInterpolations[idx];
        p.characterId = remote.characterId;
        p.stunned = remote.stunned;
        p.shieldLeft = remote.shieldLeft;
        p.dashLeft = remote.dashLeft;
        p.castLeft = remote.castLeft;
        p.castTotal = remote.castTotal;
        p.skillCooldown = remote.skillCooldown;
        p.facingX = remote.facingX;
        p.facingY = remote.facingY;
        p.emotion = remote.emotion;
        p.trap = remote.trap ? { ...remote.trap } : null;
        p.ninjaClone = remote.ninjaClone ? { ...remote.ninjaClone } : null;
        applySnapshotSkillState(p, remote);
        if (interp.lastUpdateTime === 0 || roundChanged) {
          interp.prevX = remote.x; interp.prevY = remote.y; interp.prevVX = remote.vx; interp.prevVY = remote.vy;
          p.x = remote.x; p.y = remote.y;
        } else {
          const measuredInterval = (now - interp.lastUpdateTime) / 1000;
          interp.interpDuration = Math.max(.035, Math.min(.1, measuredInterval * 1.1));
          interp.prevX = p.x; interp.prevY = p.y; interp.prevVX = p.vx; interp.prevVY = p.vy;
        }
        interp.targetX = remote.x; interp.targetY = remote.y; interp.targetVX = remote.vx; interp.targetVY = remote.vy;
        interp.interpTime = 0;
        interp.lastUpdateTime = now;
      }
    }
    game.time = state.time;
    if (state.banner && state.banner.seq !== onlineLastBannerSeq) {
      onlineLastBannerSeq = state.banner.seq;
      if (state.banner.text) showBanner(state.banner.text, Math.max(.35, state.banner.time || .8));
    }
    updateRuleHud();
    if (state.phase === 'finished' && state.result) presentOnlineResult(state.result.winner);
    updateHud();
  }
  function applySnapshotPlayer(p, snap, isLocal, snapPosition) {
    const locallyStunned = p.stunned > 0;
    p.characterId = snap.characterId;
    p.stunned = snap.stunned;
    p.shieldLeft = snap.shieldLeft;
    p.dashLeft = snap.dashLeft;
    p.castLeft = snap.castLeft;
    p.castTotal = snap.castTotal;
    p.skillCooldown = snap.skillCooldown;
    p.emotion = snap.emotion;
    p.impactLeft = snap.impactLeft || 0;
    p.blink = snap.blink || 0;
    p.trap = snap.trap ? { ...snap.trap } : null;
    applySnapshotSkillState(p, snap);
    p.vx = snap.vx;
    p.vy = snap.vy;
    const dx = snap.x - p.x, dy = snap.y - p.y;
    const error = Math.hypot(dx, dy);
    if (isLocal && !snapPosition && error < 100 && snap.stunned <= 0 && !locallyStunned) {
      // Ignore normal round-trip drift; only bleed off meaningful disagreement.
      // Constantly pulling towards an older host position causes mobile rubber-banding.
      // Threshold 100px: blink distance is 138px, so blinks snap immediately.
      if (error > 24) {
        const correction = Math.min(5, error * .16);
        p.x += dx / error * correction;
        p.y += dy / error * correction;
      }
    } else {
      p.x = snap.x;
      p.y = snap.y;
      p.facingX = snap.facingX;
      p.facingY = snap.facingY;
    }
  }
  function updateOnlineClient(dt) {
    if (guestHitStop > 0) {
      // Classic impact freeze: hold the frame briefly so the hit lands.
      guestHitStop = Math.max(0, guestHitStop - dt);
      game.bannerTime = Math.max(0, game.bannerTime - dt);
      updateHud();
      return;
    }
    updatePresentation(dt);
    game.bannerTime = Math.max(0, game.bannerTime - dt);
    if (!game.bannerTime) $('round-banner').classList.remove('show');
    game.shake = Math.max(0, game.shake - dt);
    game.particles = game.particles.filter(p => p.life > 0);
    for (const p of game.particles) { p.life -= dt; p.vy += 210 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    if (game.phase === 'playing') game.time = Math.max(0, game.time - dt);
    updateRemoteInterpolation(dt);
    if (game.phase === 'playing' && players[onlinePlayerNumber]) {
      updatePlayer(players[onlinePlayerNumber], dt, localMoveVector(), false);
    }
    if (game.phase === 'playing') {
      const lagEl = $('lag-indicator');
      if (lagEl) {
        lagEl.hidden = false;
        lagEl.textContent = networkLag + 'ms';
        lagEl.className = 'lag-indicator' + (networkLag > 200 ? ' very-slow' : networkLag > 100 ? ' slow' : '');
      }
    }
    updateHud();
  }
  function updateRemoteInterpolation(dt) {
    if (game.mode !== 'online' || onlinePlayerNumber === 0 || onlinePlayerNumber === null || onlineState !== 'playing') return;
    for (let idx = 0; idx < players.length; idx++) {
      if (idx === onlinePlayerNumber) continue;
      const p = players[idx];
      const interp = remoteInterpolations[idx];
      if (!p || !interp || interp.lastUpdateTime === 0) continue;
      interp.interpTime += dt;
      const t = Math.min(1, interp.interpTime / interp.interpDuration);
      const eased = t * t * (3 - 2 * t);
      p.x = interp.prevX + (interp.targetX - interp.prevX) * eased;
      p.y = interp.prevY + (interp.targetY - interp.prevY) * eased;
      p.vx = interp.prevVX + (interp.targetVX - interp.prevVX) * eased;
      p.vy = interp.prevVY + (interp.targetVY - interp.prevVY) * eased;
    }
  }
  function presentOnlineResult(winner) {
    if (!Number.isInteger(winner) || winner < 0 || winner >= players.length || $('result-screen').classList.contains('visible')) return;
    stopOnlineLoop();
    onlinePendingSkill = false;
    keys.clear();
    stickEnd();
    document.body.classList.add('match-finished');
    stopBackgroundMusic();
    $('online-game-hud').hidden = true;
    $('again-btn').disabled = false;
    const iWon = winner === onlinePlayerNumber;
    updateStats(winner, onlinePlayerNumber);  // guests earn achievements too
    const winnerCharacter = CHARACTERS[game.picks[winner]];
    if (!winnerCharacter) return;
    $('result-title').textContent = `${winnerCharacter.name}霸占沙发！`;
    $('result-subtitle').textContent = iWon ? '这张沙发，今晚归你。' : '惜败！点“再来一局”马上重赛。';
    $('result-rule').textContent = `最近规则：${game.ruleHistory.slice(-3).map(id => RULES[id] && RULES[id].name).filter(Boolean).join(' → ') || '无'}`;
    $('result-icon').textContent = iWon ? '🏆' : '🛋️';
    $('result-screen').classList.add('visible');
  }
  function requestOnlineRematch() {
    if (onlineState !== 'playing' || game.phase !== 'finished') return;
    if (onlinePlayerNumber === 0) {
      onlineRematchVotes.add(0);
      const connectedSeats = [0, ...network.conns.filter(entry => entry.conn.open).map(entry => entry.playerNumber)];
      if (connectedSeats.every(seat => onlineRematchVotes.has(seat))) { startOnlineMatch(); return; }
      $('result-subtitle').textContent = `等待其他玩家点击“再来一局”（${onlineRematchVotes.size}/${players.length}）…`;
    } else if (onlineConnected()) {
      network.send('rematch', { matchId: onlineMatchId, seat: onlinePlayerNumber });
      $('again-btn').disabled = true;
      $('result-subtitle').textContent = '已请求再来一局，等待房主开始…';
    }
  }
  function backToOnlineSelect(notify) {
    if (!['playing', 'select'].includes(onlineState)) return;
    const nextEpoch = onlineLobbyEpoch + 1;
    if (notify && onlineConnected()) network.send('backToSelect', { epoch: nextEpoch });
    clearHighlight();
    enterOnlineSelect(nextEpoch);
  }
  function handleOnlineMessage(data) {
    if (window.__msgLog && window.__msgLog.length < 300) window.__msgLog.push((data && data.type || '?') + (data && Number.isInteger(data.seat) ? ':' + data.seat : ''));
    if (!data || !data.type) return;
    switch (data.type) {
      case 'hello':
        // A (re)joining guest asks for the host's authoritative lobby state.
        if (onlinePlayerNumber === 0 && onlineState === 'select' && onlineConnected()) {
          broadcastOnlineLobby();
        }
        break;
      case 'lobby':
        if (onlinePlayerNumber !== 0 && onlineState === 'select' && Number.isInteger(data.epoch)
            && data.epoch >= onlineLobbyEpoch && Array.isArray(data.characters) && Array.isArray(data.ready)) {
          onlineLobbyEpoch = data.epoch;
          onlineRoomSize = Math.max(2, Math.min(4, Number(data.size) || 2));
          onlineCharacters = data.characters.slice(0, onlineRoomSize);
          while (onlineCharacters.length < onlineRoomSize) onlineCharacters.push(null);
          onlineReady = data.ready.slice(0, onlineRoomSize).map(Boolean);
          onlineSeatConfirmed = true;
          while (onlineReady.length < onlineRoomSize) onlineReady.push(false);
          if (data.v && data.v !== GAME_VERSION) $('online-error').textContent = '双方游戏版本不一致，请双方都刷新页面后再联机';
          updateOnlineLobby();
        }
        break;
      case 'welcome':
        if (onlinePlayerNumber !== 0 && Number.isInteger(data.playerNumber)) {
          onlinePlayerNumber = data.playerNumber;
          onlineRoomSize = Math.max(2, Math.min(4, Number(data.size) || 2));
          onlineSeatConfirmed = true;
          if (Number.isInteger(data.epoch)) onlineLobbyEpoch = Math.max(onlineLobbyEpoch, data.epoch);
          if (data.v && data.v !== GAME_VERSION) $('online-error').textContent = '双方游戏版本不一致，请双方都刷新页面（下拉刷新或强刷）后再联机';
          updateOnlineLobby();
        }
        break;
      case 'roomFull':
        if (onlinePlayerNumber !== 0) leaveOnlineRoom('房间已满，稍后再试');
        break;
      case 'characterSelect':
        if (onlineState !== 'select' || data.epoch !== onlineLobbyEpoch || !CHARACTERS[data.character]) return;
        if (onlinePlayerNumber !== 0 || !Number.isInteger(data.seat) || data.seat < 1 || data.seat >= onlineRoomSize) return;
        if (onlineCharacters[data.seat] !== data.character) onlineReady[data.seat] = false;
        onlineCharacters[data.seat] = data.character;
        broadcastOnlineLobby();
        updateOnlineLobby();
        maybeStartOnlineMatch();
        break;
      case 'playerReady':
        if (onlineState !== 'select' || data.epoch !== onlineLobbyEpoch || typeof data.ready !== 'boolean') return;
        if (onlinePlayerNumber !== 0 || !Number.isInteger(data.seat) || data.seat < 1 || data.seat >= onlineRoomSize) return;
        if (data.character && CHARACTERS[data.character]) onlineCharacters[data.seat] = data.character;
        onlineReady[data.seat] = data.ready;
        broadcastOnlineLobby();
        updateOnlineLobby();
        maybeStartOnlineMatch();
        break;
        if (onlinePlayerNumber === 0 && onlineState === 'select' && onlineConnected()) {
          network.send('lobby', { epoch: onlineLobbyEpoch });
        }
        break;
      case 'lobby':
if (onlinePlayerNumber !== 0 && onlinePlayerNumber !== null && onlineState === 'select' && Number.isInteger(data.epoch)
            && data.epoch >= onlineLobbyEpoch) {
          onlineLobbyEpoch = data.epoch;
          updateOnlineLobby();
        }
        break;
      case 'gameStart':
        if (onlinePlayerNumber !== 0 && onlinePlayerNumber !== null) beginOnlineClientMatch(data.picks, data.sofaCount, data.matchId, data.epoch);
        break;
      case 'input':
        if (onlinePlayerNumber === 0 && onlineState === 'playing' && data.matchId === onlineMatchId && ['playing', 'countdown'].includes(game.phase)) {
          const seat = Number(data.seat);
          if (!Number.isInteger(seat) || seat < 1 || seat >= players.length) break;
          let x = Number(data.x), y = Number(data.y);
          if (!Number.isFinite(x)) x = 0;
          if (!Number.isFinite(y)) y = 0;
          const length = Math.hypot(x, y);
          if (length > 1) { x /= length; y /= length; }
          const input = onlineGuestInputs[seat - 1] || (onlineGuestInputs[seat - 1] = { x: 0, y: 0, skill: false });
          input.x = x; input.y = y; input.skill = input.skill || Boolean(data.skill);
          if (data.skill) registerMash(players[seat]);
          if (Number.isFinite(data.timestamp)) { onlineEchoTimestamp = data.timestamp; onlineEchoAt = performance.now(); }
          onlineLastInputAts[seat - 1] = performance.now();
        }
        break;
        break;
      case 'gameState':
if (onlinePlayerNumber !== 0 && onlinePlayerNumber !== null && onlineState === 'playing') {
          onlineLastSnapshotAt = performance.now();
          // Prefer the echoed input timestamp: both sides use the guest clock, so
          // this measures true input->state latency without cross-device skew.
          if (data.state && Number.isFinite(data.state.echo)) networkLag = Math.max(0, Math.min(9999, Date.now() - data.state.echo));
          else if (Number.isFinite(data.timestamp)) networkLag = Math.max(0, Math.min(9999, Date.now() - data.timestamp));
          applyOnlineSnapshot(data.state);
        }
        break;
      case 'rematch':
        if (onlinePlayerNumber === 0 && onlineState === 'playing' && game.phase === 'finished' && data.matchId === onlineMatchId) {
          const voter = Number(data.seat);
          if (Number.isInteger(voter) && voter >= 1 && voter < players.length) onlineRematchVotes.add(voter);
          const connectedSeats = [0, ...network.conns.filter(entry => entry.conn.open).map(entry => entry.playerNumber)];
          if (connectedSeats.every(seat => seat === 0 || onlineRematchVotes.has(seat))) startOnlineMatch();
        }
        break;
        break;
      case 'backToSelect': {
        if (!Number.isInteger(data.epoch) || data.epoch < onlineLobbyEpoch || data.epoch > onlineLobbyEpoch + 1) return;
        if (data.epoch === onlineLobbyEpoch && onlineState === 'select') return;
        enterOnlineSelect(data.epoch);
        break;
        if (onlinePlayerNumber === 0) broadcastOnlineLobby();
      }
      case 'leave':
        handlePeerLeave(data.seat);
        break;
    }
  }
  function handlePeerLeave(seat) {
    if (!network) return;
    if (onlinePlayerNumber !== 0 && (onlineState === 'select' || onlineState === 'playing')) {
      startGuestRejoin();
      return;
    }
    if (onlinePlayerNumber === 0 && onlineState === 'select') {
      startHostReconnectWait();
      return;
    }
    if (onlinePlayerNumber === 0 && onlineState === 'playing') {
      // Another seat dropped mid-match: standard 20s rejoin window, then the room closes (v1).
      startHostReconnectWait();
      return;
    }
    const message = onlineState === 'playing' ? '对手已离开，本局结束' : '对手已断开连接';
    leaveOnlineRoom(message);
  }
  function startHostReconnectWait() {
    stopOnlineLoop();
    // Keep the room open on a fresh select screen; if the guest refreshes, it
    // rejoins the same code and both sides re-select with a published epoch.
    enterOnlineSelect();
    document.querySelector('.select-hint').textContent = '对手已断开，等待重连…（20 秒后关闭房间）';
    onlineReconnectTimer = setTimeout(() => {
      onlineReconnectTimer = null;
      if (onlineState === 'select' && !onlineConnected()) {
        leaveOnlineRoom('对手未重新连接，房间已关闭');
      }
    }, 20000);
  }
  async function startGuestRejoin() {
    const code = onlineRoomCode;
    if (!code) { leaveOnlineRoom('连接已断开'); return; }
    stopOnlineLoop();
    const operation = ++onlineOperation;  // user intent token for this rejoin
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (onlineState === 'menu' || operation !== onlineOperation) return; // user backed out
      try {
        await joinRoomByCode(code);
      if (operation !== onlineOperation || onlineState === 'menu') {
        // A newer operation (user create/join) already owns `network` — and its
        // prepareOnlineLobby tore this attempt's session down. Do not clobber it.
        if (operation === onlineOperation) {
          // The user left while this attempt was in flight and the join still
          // succeeded: drop the room immediately or they would be yanked back
        }
          // into the lobby against their will.
          const stale = network; network = null;
          if (stale) { stale.onData = null; stale.onPlayerJoin = null; stale.onPlayerLeave = null; stale.leaveRoom().catch(() => {}); }
          return;
        }
        if (onlineConnected()) return; // reconnected; hello/lobby re-syncs the lobby
      } catch (_) { /* fall through to the next attempt */ }
      if (attempt < 6) await new Promise(r => setTimeout(r, 1500));
    }
    if (operation === onlineOperation) leaveOnlineRoom('与对手的连接已断开，请重新加入房间');
  }
  function stopOnlineLoop() {
    if (onlineGameInterval) {
      clearInterval(onlineGameInterval);
      onlineGameInterval = null;
    }
  }
  async function leaveOnlineRoom(message) {
    ++onlineOperation;
    if (onlineReconnectTimer) { clearTimeout(onlineReconnectTimer); onlineReconnectTimer = null; }
    stopOnlineLoop();
    const oldNetwork = network;
    network = null;
    if (oldNetwork) {
      oldNetwork.onData = null;
      oldNetwork.onPlayerJoin = null;
      oldNetwork.onPlayerLeave = null;
    }
    onlinePlayerNumber = null;
    onlineRoomCode = null;
    try { sessionStorage.removeItem('sofa-host-room'); } catch (_) {}
    onlineCharacters = Array(onlineRoomSize).fill(null);
    onlineReady = Array(onlineRoomSize).fill(false);
    onlineGuestInputs = [];
    onlineSeatConfirmed = false;
    onlineLobbyEpoch = 0;
    onlineMatchId = 0;
    onlineGuestInputs = Array(Math.max(0, players.length - 1)).fill(null).map(() => ({ x: 0, y: 0, skill: false }));    onlineRematchVotes = new Set();
    onlinePendingSkill = false;
    remoteInterpolations = [];
    networkLag = 0;
    onlineEchoTimestamp = 0;
    onlineEchoAt = -Infinity;
    onlineLastSnapshotAt = 0;
    onlineHostReplaying = false;
    onlineImpactQueue = [];
    guestHitStop = 0;
    keys.clear();
    stickEnd();
    clearHighlight();
    game.mode = 'online';
    game.phase = 'menu';
    game.paused = false;
    game.seats = [];
    game.rule = null;
    game.rulePhase = 'idle';
    game.capture = [0, 0];
    game.standoff = false;
    document.body.classList.remove('multi-sofa');
    $('pause-screen').classList.remove('visible');
    $('result-screen').classList.remove('visible');
    $('again-btn').disabled = false;
    syncMode();
    showOnlineScreen(typeof message === 'string' ? message : '');
    if (oldNetwork) {
      try {
        await Promise.race([
          oldNetwork.leaveRoom(),
          new Promise(resolve => setTimeout(resolve, 900)),
        ]);
      } catch (_) { /* 关闭失败不影响界面状态 */ }
    }
  }
  // Difficulty and sofa-count selectors
  document.querySelectorAll('.difficulty-btn[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
      game.difficulty = btn.dataset.difficulty;
      document.querySelectorAll('.difficulty-btn[data-difficulty]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.sofa-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      game.sofaCount = Math.max(1, Math.min(3, Number(btn.dataset.sofas) || 1));
      document.querySelectorAll('.sofa-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      game.localPlayerCount = Math.max(2, Math.min(4, Number(btn.dataset.count) || 2));
      document.querySelectorAll('.count-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      onlineRoomSize = Math.max(2, Math.min(4, Number(btn.dataset.size) || 2));
      document.querySelectorAll('.size-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  // Online button event listeners
  $('create-room-btn').addEventListener('click', () => createRoom());
  $('join-room-btn').addEventListener('click', joinRoom);
  $('online-ready-btn').addEventListener('click', toggleOnlineReady);
  $('online-leave-btn').addEventListener('click', () => {
    if (onlineConnected()) network.send('leave', { seat: onlinePlayerNumber });
    leaveOnlineRoom('你已离开房间');
  });
  $('room-code-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') joinRoom();
  });
  function inviteText() {
    // A shareable invite: code + deep link, so friends can join in two taps.
    const link = location.origin + location.pathname;
    return `来和我抢沙发！房间号 ${onlineRoomCode}\n${link}`;
  }
  $('copy-code-btn').addEventListener('click', async () => {
    if (!onlineRoomCode) return;
    const invite = inviteText();
    // On phones, jump straight to the native share sheet; desktop keeps the clipboard.
    if (navigator.share) {
      try { await navigator.share({ title: '沙发只能坐一个', text: invite }); return; } catch (error) { if (error && error.name === 'AbortError') return; }
    }
    navigator.clipboard.writeText(invite).then(() => {
      const btn = $('copy-code-btn');
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋';
        btn.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = inviteText();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      const btn = $('copy-code-btn');
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '📋', 2000);
    });
  });
  $('cancel-waiting-btn').addEventListener('click', leaveOnlineRoom);
  $('back-to-menu-btn').addEventListener('click', () => {
    if (onlineState === 'menu') returnToMenu('cpu');
    else leaveOnlineRoom();
  });
  syncMode();
  resetPlayers();
  updateHud();
  // Host refresh recovery: reopening the page reopens the same room, so a
  // refresh no longer kills the match for both players. The guest rejoin
  // loop (20s grace on their side) will find this room again.
  try {
    const savedHostRoom = sessionStorage.getItem('sofa-host-room');
    if (savedHostRoom) {
      showOnlineScreen('检测到上次的房间，正在恢复…');
      createRoom(savedHostRoom).catch(() => {});
    }
  } catch (_) {}
  if (new URLSearchParams(location.search).get('record') === '1') {
    game.mode = 'demo';
    document.body.classList.add('record-mode');
    syncMode();
    startMatch();
  } else if (new URLSearchParams(location.search).get('showcase') === '1' && !narrowScreen()) {
    game.mode = 'demo';
    syncMode();
    document.body.classList.add('presentation');
    startMatch();
  }
  if (new URLSearchParams(location.search).get('bench') === '1') {
    game.audio = false;
    window.SofaBench = {
      step(dt = .033) { update(dt); },
      render: now => render(now),  // bench hook: probes pump occluded tabs
      update: dt => update(dt),
      online() {
        return {
          state: onlineState, playerNumber: onlinePlayerNumber, roomCode: onlineRoomCode,
          mode: game.mode, phase: game.phase, round: game.round, scores: [...game.scores],
          picks: [...game.picks], rule: game.rule && game.rule.id,
          characters: [...onlineCharacters],
          ready: [...onlineReady],
          roomSize: onlineRoomSize,
          connectedSeats: onlineConnectedSeats(),
          myCharacter: onlineCharacters[onlinePlayerNumber] ?? null,
          opponentCharacter: onlineCharacters[onlinePlayerNumber === 0 ? 1 : 0] ?? null,
          myReady: Boolean(onlineReady[onlinePlayerNumber]),
          opponentReady: Boolean(onlineReady[onlinePlayerNumber === 0 ? 1 : 0]),
          epoch: onlineLobbyEpoch, matchId: onlineMatchId, pendingSkill: onlinePendingSkill,
          bounds: playArea(), interpolationDuration: remoteInterpolations[0] ? remoteInterpolations[0].interpDuration : 0,
          teleport(i, x, y) { const p = players[i]; if (p && Number.isFinite(x) && Number.isFinite(y)) { p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.stunned = 0; } },
          captures: [...game.capture],
          standoff: game.standoff,
          seatInside: game.seats.map(seat => players.map((p, pi) => dist(p, seat) < CAPTURE_RADIUS * (seat.scale || 1) && p.stunned <= 0 ? pi : -1).filter(v => v >= 0)),
          seats: game.seats.map(seat => ({ x: seat.x, y: seat.y, capture: [...seat.capture], scale: seat.scale || 1 })),
          morphT: game.morphT || 0, morphPhase: game.morphPhase, rulePhase: game.rulePhase,
          musicActive: Boolean(game.music),
          chaosTimer: game.chaosTimer || 0, chaosNext: game.chaosNext || 0,
          players: players.map(p => ({ x: p.x, y: p.y, cooldown: p.skillCooldown, characterId: p.characterId })),
          opponentInput: { ...onlineOpponentInput }
        };
      },
      receiveOnline(data) { handleOnlineMessage(data); },
      finishOnline(winner = 0) {
        if (game.mode !== 'online' || onlinePlayerNumber !== 0) throw new Error('Only the online host can finish a bench match');
        game.scores = game.scores.map((_, index) => index === winner ? WIN_SCORE : 0);
        finishMatch();
      },
      run(first, second, maxTicks = 12000) {
        if (!CHARACTERS[first] || !CHARACTERS[second]) throw new Error('Unknown character');
        game.mode = 'demo';
        startMatch();
        game.picks = [first, second];
        syncMode();
        resetPlayers();
        let ticks = 0;
        while (game.phase !== 'finished' && ticks < maxTicks) {
          update(.033);
          ticks++;
        }
        return {
          winner: game.phase === 'finished' ? game.picks[game.scores[0] > game.scores[1] ? 0 : 1] : null,
          winnerSide: game.phase === 'finished' ? (game.scores[0] > game.scores[1] ? 0 : 1) : null,
          scores: [...game.scores],
          rounds: game.round,
          ticks,
          finished: game.phase === 'finished'
        };
      },
      checkSkills() {
        const results = {};
        const prepare = (first, second) => {
          game.mode = 'duo';
          game.picks = [first, second];
          game.rule = null;
          game.phase = 'playing';
          game.paused = false;
          resetPlayers();
        };
        prepare('pulse', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 450;
        players[1].y = 300;
        useSkill(players[0]);
        results.pulse = { ok: players[1].stunned > 0 && players[1].vx > 0 };
        prepare('dash', 'guard');
        players[0].x = 400;
        players[0].y = 300;
        players[0].facingX = 1;
        players[0].facingY = 0;
        players[1].x = 440;
        players[1].y = 300;
        useSkill(players[1]);
        useSkill(players[0]);
        updatePlayer(players[0], .05, { x: 0, y: 0 });
        collide();
        results.dashShield = {
          ok: players[1].stunned === 0 && players[1].shieldLeft < .85 && players[0].vx < 0,
          shieldLeft: players[1].shieldLeft,
          attackerVelocity: players[0].vx
        };
        prepare('blink', 'dash');
        players[0].useAltSkill = true;
        useSkill(players[0]);
        results.blinkSpeed = {
          ok: players[0].speedBoost === 2 && players[0].boostFactor === 1.8
            && players[0].warpLeft === 0
        };
        players[0].useAltSkill = false;
        prepare('blink', 'guard');
        players[0].x = 200;
        players[0].y = 300;
        players[0].facingX = 1;
        players[0].facingY = 0;
        useSkill(players[0]);
        results.blink = { ok: Math.abs(players[0].x - 338) < .01 && players[0].skillCooldown > 0, x: players[0].x };
        results.castReaction = { ok: players[0].castLeft > 0 && players[0].emotion === 'focused', castLeft: players[0].castLeft, emotion: players[0].emotion };
        game.time = 4;
        game.lastImpact = { side: 0, kind: 'blink', time: 5 };
        results.highlightTitle = { ok: highlightTitle(0, 'capture') === '这一闪，刚刚好！', title: highlightTitle(0, 'capture') };
        prepare('magnet', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 540;
        players[1].y = 300;
        useSkill(players[0]);
        const pullVelocity = players[1].vx;
        updatePlayer(players[1], .2, { x: 0, y: 0 });
        results.pull = { ok: pullVelocity < 0 && players[1].vx > 0 && players[1].stunned > 0, pullVelocity, reboundVelocity: players[1].vx, stun: players[1].stunned };
        prepare('trap', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        useSkill(players[0]);
        players[1].x = players[0].trap.x;
        players[1].y = players[0].trap.y;
        updateTraps();
        const waitedForArm = players[1].stunned === 0 && Boolean(players[0].trap);
        updatePlayer(players[0], players[0].trap.arm + .01, { x: 0, y: 0 });
        updateTraps();
        results.trap = {
          ok: waitedForArm && players[1].stunned >= 1.49
            && players[1].stunned > CHARACTERS.pulse.skill.stun && !players[0].trap,
          stun: players[1].stunned
        };
        prepare('trap', 'guard');
        useSkill(players[0]);
        useSkill(players[1]);
        players[1].x = players[0].trap.x;
        players[1].y = players[0].trap.y;
        updatePlayer(players[0], players[0].trap.arm + .01, { x: 0, y: 0 });
        updateTraps();
        results.trapShield = { ok: players[1].stunned === 0 && players[1].shieldHit && !players[0].trap, stun: players[1].stunned };
        prepare('vampire', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 450;
        players[1].y = 300;
        game.seats = [{ x: 420, y: 300, capture: [0, 1], scale: 1 }];
        useSkill(players[0]);
        results.vampire = { ok: players[1].stunned > 0 && players[0].vampireLeft > 0 && players[0].shieldLeft > 0 && game.seats[0].capture[1] < 1, stun: players[1].stunned, drained: game.seats[0].capture[1] };
        prepare('vampire', 'dash');
        players[0].x = 300;
        players[0].y = 300;
        players[1].x = 540;
        players[1].y = 300;
        useSkill(players[0]);
        results.vampireRange = { ok: players[1].stunned === 0 && players[0].vampireLeft > 0 };
        prepare('vampire', 'guard');
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 450;
        players[1].y = 300;
        game.seats = [{ x: 420, y: 300, capture: [0, 1], scale: 1 }];
        useSkill(players[1]);
        useSkill(players[0]);
        results.vampireShield = {
          ok: players[1].stunned === 0 && players[1].shieldLeft < .85
            && game.seats[0].capture[1] === 1
        };
        prepare('dash', 'guard');
        game.time = 4;
        const newTitles = Object.fromEntries(['vampire', 'knight', 'ninja', 'mage'].map(kind => {
          game.lastImpact = { side: 0, kind, time: 5 };
          return [kind, highlightTitle(0, 'capture')];
        }));
        results.newHighlightTitles = {
          ok: Object.values(newTitles).every(title => !title.includes('抢到了关键位置')),
          ...newTitles
        };
        prepare('knight', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 445;
        players[1].y = 300;
        useSkill(players[0]);
        updatePlayer(players[0], .05, { x: 0, y: 0 });
        results.knight = { ok: players[1].stunned > 0 && players[1].vx !== 0, stun: players[1].stunned };
        game.picks = ['knight', 'dash', 'dash'];
        players = Array.from({ length: 3 }, (_, i) => players[i] || makePlayer(i));
        resetPlayers();
        players[0].x = 400;
        players[0].y = 300;
        players[1].x = 350;
        players[1].y = 300;
        players[2].x = 450;
        players[2].y = 300;
        useSkill(players[0]);
        updatePlayer(players[0], .05, { x: 0, y: 0 });
        results.knightTwoSides = {
          ok: players[1].stunned > 0 && players[2].stunned > 0
            && players[1].vx < 0 && players[2].vx > 0,
          leftVelocity: players[1].vx,
          rightVelocity: players[2].vx
        };
        players = players.slice(0, 2);
        prepare('ninja', 'dash');
        players[0].x = 400;
        players[0].y = 300;
        useSkill(players[0]);
        results.ninja = {
          ok: players[0].ninjaLeft === 2 && Boolean(players[0].ninjaClone)
            && players[0].speedBoost === 2 && players[0].boostFactor === 1.7,
          duration: players[0].speedBoost,
          boost: players[0].boostFactor
        };
        const skillSnapshot = buildOnlineSnapshot().players[0];
        const snapshotPlayer = makePlayer(1);
        applySnapshotSkillState(snapshotPlayer, skillSnapshot);
        results.onlineSkillState = {
          ok: snapshotPlayer.speedBoost === 2 && snapshotPlayer.boostFactor === 1.7
            && Boolean(snapshotPlayer.ninjaClone) && snapshotPlayer.ninjaLeft === 2
        };
        updatePlayer(players[0], .05, { x: 1, y: 0 });
        results.ninjaTick = {
          ok: players[0].ninjaClone && players[0].ninjaClone.life < 2
            && players[0].ninjaLeft < 2 && Math.abs(players[0].vx - 230 * 1.7) < .01,
          cloneLife: players[0].ninjaClone && players[0].ninjaClone.life,
          vx: players[0].vx
        };
        prepare('mage', 'dash');
        players[0].x = 300;
        players[0].y = 300;
        players[1].x = 460;
        players[1].y = 300;
        useSkill(players[0]);
        const hadProjectile = Boolean(players[0].mageProjectile);
        for (let step = 0; step < 40 && players[0].mageProjectile; step++) updatePlayer(players[0], .016, { x: 0, y: 0 });
        results.mage = { ok: hadProjectile && players[1].stunned > 0 && !players[0].mageProjectile, stun: players[1].stunned };
        prepare('mage', 'guard');
        players[0].x = 300;
        players[0].y = 300;
        players[1].x = 460;
        players[1].y = 300;
        useSkill(players[1]);
        useSkill(players[0]);
        for (let step = 0; step < 40 && players[0].mageProjectile; step++) updatePlayer(players[0], .016, { x: 0, y: 0 });
        results.mageShield = {
          ok: players[1].stunned === 0 && players[1].shieldLeft < .85 && !players[0].mageProjectile
        };
        prepare('mage', 'dash');
        players[0].x = 200;
        players[0].y = 300;
        players[1].x = 700;
        players[1].y = 300;
        useSkill(players[0]);
        for (let step = 0; step < 40 && players[0].mageProjectile; step++) updatePlayer(players[0], .016, { x: 0, y: 0 });
        results.mageRange = { ok: players[1].stunned === 0 && !players[0].mageProjectile };
        prepare('ninja', 'mage');
        Object.assign(players[0], {
          vampireLeft: 1, knightLeft: 1, knightHitCooldowns: [.5],
          knightRadius: 65, ninjaLeft: 1, ninjaClone: { x: 1, y: 2, life: 1 },
          speedBoost: 1, boostFactor: 1.7, mageProjectile: { x: 1, y: 2, life: 1 }
        });
        resetPlayers();
        results.roundReset = {
          ok: players[0].vampireLeft === 0 && players[0].knightLeft === 0
            && players[0].knightHitCooldowns.length === 0 && players[0].knightRadius === 0
            && players[0].ninjaLeft === 0 && players[0].ninjaClone === null
            && players[0].speedBoost === 0 && players[0].boostFactor === 1
            && players[0].mageProjectile === null
        };
        game.mode = 'chaos';
        game.phase = 'playing';
        game.rule = RULES.morph;
        game.rulePhase = 'active';
        game.seats = [{ x: 480, y: 300, capture: [0, 0], scale: .62 }];
        game.morphT = 4;
        game.morphPhase = 1;
        game.mashCounts = [2, 1];
        game.chaosTimer = 1;
        game.chaosNext = 1;
        update(.016);
        results.chaosRuleReset = {
          ok: game.rule.id !== 'morph' && game.seats[0].scale === 1
            && game.morphT === 0 && game.mashCounts.every(count => count === 0)
        };
        game.mashCounts = [2, 1];
        game.morphT = 4;
        game.morphPhase = 1;
        newRound();
        results.newRoundRuleReset = {
          ok: game.mashCounts.every(count => count === 0)
            && game.morphT === 0 && game.morphPhase === -1
            && game.seats.every(seat => seat.scale === 1)
        };
        return results;
      },
      checkSeats() {
        const results = {};
        game.audio = false;
        const start = count => {
          game.mode = 'duo';
          game.sofaCount = count;
          startMatch();
          game.rule = null;
          game.rulePhase = 'idle';
          game.ruleTarget = null;
          game.ruleMove = null;
          game.seats.forEach(seat => { seat.capture = [0, 0]; });
          game.phase = 'playing';
          game.time = ROUND_SECONDS;
        };
        for (let count = 1; count <= 3; count++) {
          start(count);
          const layout = game.seats.map(seat => [Math.round(seat.x), Math.round(seat.y)]);
          let minGap = Infinity;
          for (let i = 0; i < game.seats.length; i++) {
            for (let j = i + 1; j < game.seats.length; j++) minGap = Math.min(minGap, dist(game.seats[i], game.seats[j]));
          }
          results[`layout${count}`] = { count: game.seats.length, layout, minGap: Math.round(minGap) };
        }
        start(1);
        let ticks = 0;
        while (game.phase === 'playing' && ticks < 90) {
          players[0].x = game.seats[0].x; players[0].y = game.seats[0].y;
          players[1].x = 80; players[1].y = 470;
          players.forEach(p => { p.stunned = 0; p.vx = 0; p.vy = 0; p.dashLeft = 0; });
          update(.033);
          ticks++;
        }
        results.capture = { scores: [...game.scores], ticks, phase: game.phase };
        start(2);
        const seatCount = game.seats.length;
        let ticksSplit = 0;
        while (game.phase === 'playing' && ticksSplit < 40) {
          players[0].x = game.seats[0].x; players[0].y = game.seats[0].y;
          players[1].x = game.seats[1].x; players[1].y = game.seats[1].y;
          players.forEach(p => { p.stunned = 0; p.vx = 0; p.vy = 0; p.dashLeft = 0; });
          update(.033);
          ticksSplit++;
        }
        const frozen = game.standoff && game.seats.every(seat => seat.capture[0] === 0 && seat.capture[1] === 0);
        let ticksBreak = 0;
        while (game.phase === 'playing' && ticksBreak < 90) {
          players[0].x = game.seats[0].x; players[0].y = game.seats[0].y;
          players[1].x = 80; players[1].y = 470;
          players.forEach(p => { p.stunned = 0; p.vx = 0; p.vy = 0; p.dashLeft = 0; });
          update(.033);
          ticksBreak++;
        }
        results.standoff = { seatCount, frozen, ticksSplit, ticksBreak, scores: [...game.scores], phase: game.phase };
        return results;
      }
    };
  } else {
    requestAnimationFrame(frame);
  }
})();