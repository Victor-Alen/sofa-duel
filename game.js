(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
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
  // All starting spots are centered horizontally so neither side starts closer.
  const seatSpots = [[480, 312], [480, 255], [480, 365]];
  const narrowScreen = () => window.matchMedia('(max-width: 760px)').matches;
  const isDesktop = () => !narrowScreen() && !('ontouchstart' in window) && window.innerWidth > 760;

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

  const players = [makePlayer(0), makePlayer(1)];
  const highlightPool = Array.from({ length: HIGHLIGHT_FRAME_COUNT }, () => {
    const frame = document.createElement('canvas');
    frame.width = 480; frame.height = 270;
    return frame;
  });
  const game = { mode: 'cpu', difficulty: 'normal', phase: 'menu', manualPicks: ['dash', 'guard'], picks: ['dash', 'guard'], scores: [0, 0], capture: [0, 0], time: ROUND_SECONDS, seat: { x: 480, y: 312 }, previousSeatY: null, rule: null, previousRule: null, ruleHistory: [], ruleTarget: null, ruleMove: null, rulePhase: 'idle', elapsed: 0, round: 0, tiedRounds: 0, wait: 0, bannerTime: 0, playTipTime: 0, bannerText: '', particles: [], shake: 0, hitStop: 0, paused: false, audio: true, audioContext: null, replay: null, highlightFrames: [], highlightClock: 0, lastImpact: null, combo: [0, 0], maxCombo: [0, 0], stats: loadStats(), music: null, musicGain: null, achievementQueue: [], currentAchievement: null };
  let last = performance.now();

  function makePlayer(i) {
    return { i, characterId: i ? 'guard' : 'dash', x: i ? 740 : 220, y: 360, vx: 0, vy: 0, facingX: i ? -1 : 1, facingY: 0, dashLeft: 0, dashHit: false, shieldLeft: 0, shieldHit: false, pulseLeft: 0, pullLeft: 0, warpLeft: 0, reboundLeft: 0, reboundX: 0, reboundY: 0, reboundPower: 0, trap: null, skillCooldown: 0, stunned: 0, blink: 0, walk: 0, aiDecision: 0, wantsSkill: false, anim: i * 1.7, emotion: 'neutral', emotionLeft: 0, castLeft: 0, castTotal: .4, impactLeft: 0, celebrateLeft: 0 };
  }

  function tone(frequency = 440, duration = .09, type = 'sine', volume = .055, slide = 1) {
    if (!game.audio) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = game.audioContext || (game.audioContext = new AC());
      if (ac.state === 'suspended') ac.resume();
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type; osc.frequency.setValueAtTime(frequency, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * slide), ac.currentTime + duration);
      gain.gain.setValueAtTime(volume, ac.currentTime);
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

  function updateStats(winner) {
    game.stats.matches++;
    if (winner === 0) game.stats.wins++;
    game.stats.totalScore += game.scores[winner];
    game.stats.maxCombo = Math.max(game.stats.maxCombo, game.maxCombo[winner]);
    const matchTime = game.round * ROUND_SECONDS + (ROUND_SECONDS - game.time);
    if (winner === 0 && matchTime < game.stats.fastestWin) game.stats.fastestWin = matchTime;
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
    if (!game.audio || game.music) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = game.audioContext || (game.audioContext = new AC());
      if (ac.state === 'suspended') ac.resume();
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(.018, ac.currentTime + 2);
      gain.connect(ac.destination);
      game.musicGain = gain;
      const playChord = (freq, startTime, duration) => {
        const osc = ac.createOscillator();
        const oscGain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        oscGain.gain.setValueAtTime(.3, startTime);
        oscGain.gain.exponentialRampToValueAtTime(.001, startTime + duration);
        osc.connect(oscGain);
        oscGain.connect(gain);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      const chords = [[261.63, 329.63, 392], [293.66, 369.99, 440], [329.63, 415.30, 493.88], [349.23, 440, 523.25]];
      let chordIndex = 0;
      const loopMusic = () => {
        if (!game.music) return;
        const now = ac.currentTime;
        const chord = chords[chordIndex % chords.length];
        for (const freq of chord) playChord(freq, now, 3.8);
        chordIndex++;
        game.music = setTimeout(loopMusic, 4000);
      };
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
    const el = $('round-banner');
    el.textContent = text;
    el.classList.add('show');
  }

  function resetPlayers() {
    for (let i = 0; i < 2; i++) {
      const p = players[i];
      Object.assign(p, { characterId: game.picks[i], x: narrowScreen() ? (i ? 620 : 340) : (i ? 730 : 230), y: 355, vx: 0, vy: 0, facingX: i ? -1 : 1, facingY: 0, dashLeft: 0, dashHit: false, shieldLeft: 0, shieldHit: false, pulseLeft: 0, pullLeft: 0, warpLeft: 0, reboundLeft: 0, reboundX: 0, reboundY: 0, reboundPower: 0, trap: null, skillCooldown: 0, stunned: 0, blink: 0, walk: 0, aiDecision: 0, wantsSkill: false, anim: i * 1.7, emotion: 'neutral', emotionLeft: 0, castLeft: 0, castTotal: .4, impactLeft: 0, celebrateLeft: 0 });
    }
  }

  function updateRuleHud() {
    const hud = $('rule-hud');
    if (!game.rule) {
      hud.textContent = '';
      delete hud.dataset.rule;
      delete hud.dataset.phase;
      hud.classList.remove('warning');
      return;
    }
    const rule = game.rule;
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
    if (reason === 'draw') return `${name}赢得了这场幸运对决！`;
    if (reason === 'closest') return '只差一步，也是胜利！';
    if (reason === 'timeout') return '最后一秒，守住了！';
    const impact = game.lastImpact;
    if (impact && impact.side === winner && impact.time - game.time < 2.4) {
      return {
        dash: '这一撞值回票价！', shield: '这一挡，反击漂亮！', pulse: '一下震开，机会来了！',
        blink: '这一闪，刚刚好！', pull: '拉回来，再弹走！', trap: '抱枕立大功！'
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

  function newRound() {
    game.round++;
    clearHighlight();
    game.lastImpact = null;
    game.playTipTime = game.round === 1 && game.mode !== 'demo' ? 4 : 0;
    $('play-tip').classList.toggle('show', game.playTipTime > 0);
    game.capture = [0, 0];
    game.time = ROUND_SECONDS;
    game.phase = 'countdown';
    game.wait = document.body.classList.contains('record-mode') ? .55 : 1.8;
    const spots = seatSpots.filter(spot => spot[1] !== game.previousSeatY);
    const spot = spots[Math.floor(Math.random() * spots.length)];
    game.seat = { x: spot[0], y: spot[1] };
    game.previousSeatY = spot[1];
    const choices = RULE_IDS.filter(id => id !== game.previousRule);
    const ruleId = forcedRule || choices[Math.floor(Math.random() * choices.length)];
    game.rule = RULES[ruleId];
    game.previousRule = ruleId;
    game.ruleHistory.push(ruleId);
    game.rulePhase = ruleId === 'frenzy' ? 'active' : 'idle';
    game.ruleMove = null;
    game.elapsed = 0;
    const destinations = seatSpots.filter(candidate => candidate[1] !== spot[1]);
    const destination = destinations[Math.floor(Math.random() * destinations.length)];
    game.ruleTarget = { x: destination[0], y: destination[1] };
    $('record-hook').textContent = {
      shuffle: '室友抢沙发，沙发先跑了！',
      spring: '抢沙发，沙发把人弹飞了！',
      frenzy: '室友抢沙发，技能突然加速！'
    }[ruleId];
    resetPlayers();
    showBanner(`第 ${game.round} 回合 · ${game.rule.name}`, 1.1);
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
    if (game.mode === 'demo') {
      const picks = [...CHARACTER_IDS];
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const picked = picks[i];
        picks[i] = picks[j];
        picks[j] = picked;
      }
      game.picks = picks.slice(0, 2);
    } else if (game.mode === 'cpu') {
      const opponents = CHARACTER_IDS.filter(id => id !== game.manualPicks[0]);
      game.picks = [game.manualPicks[0], opponents[Math.floor(Math.random() * opponents.length)]];
    } else {
      game.picks = [...game.manualPicks];
    }
    syncMode();
    game.scores = [0, 0];
    game.combo = [0, 0];
    game.maxCombo = [0, 0];
    game.round = 0;
    game.tiedRounds = 0;
    game.ruleHistory = [];
    game.previousRule = null;
    game.previousSeatY = null;
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

  function scorePoint(winner, reason) {
    if (game.phase !== 'playing') return;
    game.playTipTime = 0;
    $('play-tip').classList.remove('show');
    game.scores[winner]++;
    game.combo[winner]++;
    game.combo[1 - winner] = 0;
    game.maxCombo[winner] = Math.max(game.maxCombo[winner], game.combo[winner]);
    if (game.combo[winner] >= 2) {
      showBanner(`${CHARACTERS[game.picks[winner]].name} ${game.combo[winner]} 连击！`, 1.2);
      burst(game.seat.x, game.seat.y - 35, winner, 15 + game.combo[winner] * 5);
      tone(600 + game.combo[winner] * 80, .15, 'triangle', .05);
    }
    game.tiedRounds = 0;
    game.phase = 'roundEnd';
    startHighlight(winner, reason);
    game.wait = game.replay ? 3.3 : 2.15;
    game.shake = .18;
    burst(game.seat.x, game.seat.y - 35, winner, 30);
    react(players[winner], 'happy', 2.8, true);
    react(players[1 - winner], 'sad', 2.2);
    const name = CHARACTERS[game.picks[winner]].name;
    showBanner(reason === 'draw' ? `${name}赢得平局抽签！` : reason === 'closest' ? `${name}更近一步！` : reason === 'timeout' ? `${name}险胜！` : `${name}抢到了！`, 1.65);
    characterSound(players[winner], 'win');
    characterSound(players[1 - winner], 'lose');
    updateHud();
  }

  function finishMatch() {
    game.phase = 'finished';
    document.body.classList.add('match-finished');
    const winner = game.scores[0] > game.scores[1] ? 0 : 1;
    updateStats(winner);
    stopBackgroundMusic();

    // Handle online mode
    if (game.mode === 'online' && network) {
      if (onlineGameInterval) {
        clearInterval(onlineGameInterval);
        onlineGameInterval = null;
      }
      $('online-game-hud').hidden = true;

      // Host sends game end signal
      if (onlinePlayerNumber === 0) {
        network.sendGameEnd({ winner: winner, scores: game.scores });
      }

      // Return to online menu after delay
      setTimeout(() => leaveOnlineRoom(), 3000);
    }

    $('result-title').textContent = `${CHARACTERS[game.picks[winner]].name}霸占沙发！`;
    $('result-subtitle').textContent = game.mode === 'demo' ? '自动演示即将重新开始。' : winner === 0 ? '这张沙发，今晚归你。' : '再抢一次？';
    $('result-rule').textContent = `最近规则：${game.ruleHistory.slice(-3).map(id => RULES[id].name).join(' → ')}`;
    $('result-icon').textContent = winner === 0 ? '🏆' : '🛋️';
    $('result-screen').classList.add('visible');
    if (game.mode === 'demo') game.wait = 3.5;
  }

  function syncMode() {
    document.querySelectorAll('.mode').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === game.mode));
    const waitingForOpponent = game.mode === 'cpu' && !document.body.classList.contains('in-match');
    $('control-tip').textContent = game.mode === 'demo' ? '电脑自动对战，点击开始观看' :
      game.mode === 'duo' ? '玩家一 WASD / 空格 · 玩家二 方向键 / 回车' :
      game.mode === 'online' ? '联网对战 · 创建或加入房间' :
      narrowScreen() ? '左侧摇杆移动 · 右侧按钮放技能' : 'WASD 移动 · 空格放技能';
    $('start-btn').firstChild.textContent = game.mode === 'demo' ? '开始观看演示 ' : game.mode === 'online' ? '进入联网模式 ' : '开始抢沙发 ';
    $('player-a-label').textContent = `${game.mode === 'demo' ? '电脑' : '玩家一'}·${CHARACTERS[game.picks[0]].name}`;
    $('player-b-label').textContent = waitingForOpponent ? '随机对手' : `${game.mode === 'demo' || game.mode === 'cpu' ? '电脑' : '玩家二'}·${CHARACTERS[game.picks[1]].name}`;
    for (let i = 0; i < 2; i++) {
      const character = CHARACTERS[game.picks[i]];
      const avatar = document.querySelector(i ? '.team-b .avatar' : '.team-a .avatar');
      const unknownOpponent = i === 1 && waitingForOpponent;
      avatar.textContent = unknownOpponent ? '?' : character.name.slice(0, 1);
      avatar.style.background = unknownOpponent ? '#b9b0b2' : character.color;
      avatar.style.boxShadow = `0 4px 0 ${unknownOpponent ? '#91878b' : character.dark}`;
      avatar.setAttribute('aria-label', unknownOpponent ? '随机对手' : character.name);
      $(i ? 'cap-b' : 'cap-a').style.background = character.color;
    }
    $('dash-touch').firstChild.textContent = CHARACTERS[game.picks[0]].skill.name;
    $('dash-touch').style.background = CHARACTERS[game.picks[0]].color;
    $('dash-touch').style.borderBottomColor = CHARACTERS[game.picks[0]].dark;
    $('picker-b-row').hidden = game.mode !== 'duo';
    document.querySelector('.pickers').hidden = game.mode === 'demo' || game.mode === 'online';
    const diffSelector = $('difficulty-selector');
    if (diffSelector) diffSelector.hidden = game.mode !== 'cpu';
    renderPickers();
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
    const describe = character => `${character.name} · ${character.personality}；${character.skill.name}：${character.skill.description}（移动 ${character.speed} · 冷却 ${character.skill.cooldown} 秒）`;
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
    game.ruleTarget = null;
    game.ruleMove = null;
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
    document.body.classList.remove('in-match', 'demo-mode', 'presentation', 'match-finished');
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
    if (!['playing', 'countdown', 'roundEnd'].includes(game.phase)) return;
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
    const winner = game.scores[0] > game.scores[1] ? 0 : 1;
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
    g.fillStyle = CHARACTERS[game.picks[0]].color; g.font = '900 66px sans-serif'; g.fillText(`${CHARACTERS[game.picks[0]].name}  ${game.scores[0]}`, 115, 513);
    g.fillStyle = '#cbbfba'; g.font = '900 42px sans-serif'; g.fillText('VS', 510, 510);
    g.fillStyle = CHARACTERS[game.picks[1]].color; g.font = '900 66px sans-serif'; g.textAlign = 'right'; g.fillText(`${game.scores[1]}  ${CHARACTERS[game.picks[1]].name}`, 965, 513); g.textAlign = 'left';
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
    $('dash-touch').classList.toggle('cooling', players[0].skillCooldown > 0);
    $('dash-touch').querySelector('small').textContent = players[0].skillCooldown > 0 ? `${players[0].skillCooldown.toFixed(1)}s` : '↗';
    $('status-label').textContent = game.paused ? '已暂停' : game.replay ? '高光回放' : game.phase === 'playing' ? '抢沙发中' : game.phase === 'countdown' ? '准备开战' : game.phase === 'roundEnd' ? '本回合结束' : game.mode === 'demo' ? '自动演示' : '先到 3 分获胜';
  }

  function pushAway(attacker, victim, power, stun) {
    const distance = dist(attacker, victim);
    const dx = distance > 1 ? (victim.x - attacker.x) / distance : attacker.facingX;
    const dy = distance > 1 ? (victim.y - attacker.y) / distance : attacker.facingY;
    let hit = false;
    if (victim.shieldLeft > 0 && !victim.shieldHit) {
      victim.shieldLeft = 0;
      victim.shieldHit = true;
      attacker.dashLeft = 0;
      attacker.stunned = Math.max(attacker.stunned, .3);
      attacker.blink = .42;
      attacker.impactLeft = .28;
      attacker.vx = -dx * CHARACTERS[victim.characterId].skill.counterPower;
      attacker.vy = -dy * CHARACTERS[victim.characterId].skill.counterPower;
      react(victim, 'smug', .9);
      react(attacker, 'surprised', .5);
      burst(victim.x, victim.y - 15, victim.i, 18);
      game.lastImpact = { side: victim.i, kind: 'shield', time: game.time };
      game.hitStop = Math.max(game.hitStop, .075);
      characterSound(victim, 'block');
    } else {
      victim.dashLeft = 0;
      victim.reboundLeft = 0;
      victim.stunned = Math.max(victim.stunned, stun);
      victim.blink = .42;
      victim.impactLeft = .26;
      victim.vx = dx * power;
      victim.vy = dy * power;
      react(victim, 'dizzy', Math.max(.45, stun));
      react(attacker, 'happy', .35);
      burst(victim.x, victim.y - 15, attacker.i, 16);
      game.lastImpact = { side: attacker.i, kind: CHARACTERS[attacker.characterId].skill.kind, time: game.time };
      game.hitStop = Math.max(game.hitStop, .045);
      characterSound(victim, 'hit');
      hit = true;
    }
    game.shake = .12;
    tone(160, .13, 'square', .035, .75);
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
      p.shieldHit = false;
      burst(p.x, p.y - 10, p.i, 8);
      tone(570, .14, 'sine', .055);
    },
    pulse(p, skill) {
      p.pulseLeft = .32;
      const other = players[1 - p.i];
      if (dist(p, other) <= skill.radius) pushAway(p, other, skill.power, skill.stun);
      burst(p.x, p.y, p.i, 20);
      tone(230, .2, 'triangle', .06);
    },
    blink(p, skill) {
      const from = { x: p.x, y: p.y };
      const other = players[1 - p.i];
      const otherDistance = dist(p, other);
      const travel = otherDistance < skill.distance + 30 ? Math.max(0, otherDistance - 28) : skill.distance;
      const edge = narrowScreen() ? [300, 660] : [41, W - 41];
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
    pull(p, skill) {
      p.pullLeft = .34;
      const other = players[1 - p.i];
      if (dist(p, other) <= skill.radius && pushAway(p, other, -skill.power, skill.stun)) {
        const distance = dist(p, other) || 1;
        other.reboundLeft = skill.rebound;
        other.reboundX = (other.x - p.x) / distance;
        other.reboundY = (other.y - p.y) / distance;
        other.reboundPower = skill.reboundPower;
      }
      burst(p.x, p.y, p.i, 12);
      tone(310, .2, 'sine', .055);
    },
    trap(p, skill) {
      p.trap = { x: p.x, y: p.y + 12, left: skill.duration, arm: skill.arm, radius: skill.radius, stun: skill.stun };
      burst(p.x, p.y + 12, p.i, 10);
      tone(480, .11, 'triangle', .045);
    }
  };

  function useSkill(p, simultaneous = false) {
    if (game.phase !== 'playing' || game.paused || p.skillCooldown > 0 || (!simultaneous && p.stunned > 0)) return;
    const skill = CHARACTERS[p.characterId].skill;
    const handler = skillHandlers[skill.kind];
    if (!handler) return;
    p.skillCooldown = skill.cooldown * (game.rule && game.rule.id === 'frenzy' ? game.rule.cooldownFactor : 1);
    p.castTotal = skill.kind === 'trap' ? .5 : skill.kind === 'pull' ? .46 : .38;
    p.castLeft = p.castTotal;
    react(p, 'focused', p.castTotal);
    characterSound(p, 'skill');
    handler(p, skill);
  }

  const ruleHandlers = {
    shuffle(rule) {
      game.ruleMove = { fromY: game.seat.y, toY: game.ruleTarget.y, elapsed: 0, duration: rule.moveDuration };
      burst(game.seat.x, game.seat.y, 0, 15);
      game.shake = .08;
      showBanner('沙发搬家！', .65);
      tone(510, .17, 'triangle', .06);
    },
    spring(rule) {
      for (const p of players) {
        const distance = dist(p, game.seat);
        if (distance > rule.radius) continue;
        if (p.shieldLeft > 0 && !p.shieldHit) {
          p.shieldLeft = 0;
          p.shieldHit = true;
          react(p, 'smug', .75);
          characterSound(p, 'block');
        } else {
          const dx = distance > 1 ? (p.x - game.seat.x) / distance : (p.i ? 1 : -1);
          const dy = distance > 1 ? (p.y - game.seat.y) / distance : 0;
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

  function updateRoomRule(dt) {
    if (!game.rule || game.rule.id === 'frenzy' || game.rulePhase === 'triggered') return;
    game.elapsed += dt;
    if (game.rulePhase === 'moving') {
      const move = game.ruleMove;
      move.elapsed = Math.min(move.duration, move.elapsed + dt);
      const t = move.elapsed / move.duration;
      const eased = t * t * (3 - 2 * t);
      game.seat.y = move.fromY + (move.toY - move.fromY) * eased;
      if (t >= 1) {
        game.seat.y = move.toY;
        game.ruleMove = null;
        game.rulePhase = 'triggered';
        burst(game.seat.x, game.seat.y, 1, 15);
        game.shake = .12;
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
    if (game.mode === 'demo' || (p.i === 1 && game.mode === 'cpu')) {
      const other = players[1 - p.i];
      const skill = CHARACTERS[p.characterId].skill;
      const seatDistance = dist(p, game.seat);
      const nearSeat = seatDistance < 86;
      const enemyDistance = dist(p, other);
      const nearOther = enemyDistance < 145;
      const contested = dist(other, game.seat) < 89;
      const hostileTrap = other.trap;

      // Difficulty-based parameters
      const difficulty = game.difficulty || 'normal';
      const reactionTime = difficulty === 'easy' ? 0.8 : difficulty === 'normal' ? 0.55 : 0.35;
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

      const target = nearSeat && (nearOther || contested) ? other : game.seat;
      let dx = target.x - p.x, dy = target.y - p.y;
      const length = Math.hypot(dx, dy);
      if (nearSeat && !nearOther && !contested) return { x: 0, y: 0 };
      if (length > 1) { dx /= length; dy /= length; }

      // Easy difficulty: add slight movement noise
      if (difficulty === 'easy' && Math.random() < 0.1) {
        dx += (Math.random() - 0.5) * 0.3;
        dy += (Math.random() - 0.5) * 0.3;
      }

      p.aiDecision -= dt;
      const opposingSkill = CHARACTERS[other.characterId].skill.kind;

      // Per-difficulty skill attempt chance (checked once per decision window, not per frame)
      const attemptChance = difficulty === 'easy' ? 0.3 : difficulty === 'normal' ? 0.5 : 0.75;

      // Smarter skill usage based on difficulty
      let useNow = false;
      if (p.aiDecision <= 0 && other.stunned <= 0 && p.skillCooldown <= 0) {
        if (skill.kind === 'dash') {
          // Only dash when it pays off: the enemy is contesting the sofa or closer to it than we are,
          // is roughly in front, and we roll below the attempt chance.
          const enemyOnSeat = dist(other, game.seat) < 89;
          const enemyCloser = dist(other, game.seat) < seatDistance;
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
        } else {
          useNow = enemyDistance < skill.radius && Math.random() < attemptChance;
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
          p.aiDecision = 0.25 + Math.random() * 0.35;
        }
      }
      return { x: dx, y: dy };
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

  function updatePlayer(p, dt, move) {
    p.skillCooldown = Math.max(0, p.skillCooldown - dt);
    p.shieldLeft = Math.max(0, p.shieldLeft - dt);
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
      const speed = CHARACTERS[p.characterId].speed;
      p.vx = move.x * speed;
      p.vy = move.y * speed;
      if (Math.hypot(move.x, move.y) > .15) {
        p.facingX = move.x; p.facingY = move.y;
        p.walk += dt * 11;
      }
    }
    const edge = narrowScreen() ? [300, 660] : [41, W - 41];
    p.x = Math.max(edge[0], Math.min(edge[1], p.x + p.vx * dt));
    p.y = Math.max(142, Math.min(H - 39, p.y + p.vy * dt));
  }

  function collide() {
    const a = players[0], b = players[1];
    const d = dist(a, b);
    if (d >= 50) return;
    const nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1);
    const overlap = (50 - d) / 2;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;
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

  function updateTraps() {
    for (const owner of players) {
      const trap = owner.trap;
      if (!trap || trap.arm > 0) continue;
      const victim = players[1 - owner.i];
      if (dist(victim, trap) > trap.radius) continue;
      if (victim.shieldLeft > 0 && !victim.shieldHit) {
        victim.shieldLeft = 0;
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
      owner.trap = null;
      game.shake = .1;
      game.hitStop = Math.max(game.hitStop, .055);
      burst(trap.x, trap.y, owner.i, 18);
      tone(205, .16, 'square', .04, .8);
    }
  }

  function burst(x, y, side, count) {
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
    if (game.paused) return;
    updatePresentation(dt);
    updateRemoteInterpolation(dt);
    game.bannerTime = Math.max(0, game.bannerTime - dt);
    if (!game.bannerTime) $('round-banner').classList.remove('show');
    game.shake = Math.max(0, game.shake - dt);
    game.particles = game.particles.filter(p => p.life > 0);
    for (const p of game.particles) { p.life -= dt; p.vy += 210 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
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
    updateTraps();
    const inside = players.map(p => dist(p, game.seat) < 89 && p.stunned <= 0);
    if (inside[0] !== inside[1]) {
      const i = inside[0] ? 0 : 1;
      game.capture[i] += dt;
      game.capture[1 - i] = Math.max(0, game.capture[1 - i] - dt * .35);
      if (game.capture[i] >= CAPTURE_SECONDS) scorePoint(i, 'capture');
    } else if (!inside[0]) {
      game.capture[0] = Math.max(0, game.capture[0] - dt * .13);
      game.capture[1] = Math.max(0, game.capture[1] - dt * .13);
    }
    if (game.time <= 0 && game.phase === 'playing') {
      if (Math.abs(game.capture[0] - game.capture[1]) > .01) {
        scorePoint(game.capture[0] > game.capture[1] ? 0 : 1, 'timeout');
      } else {
        const distances = players.map(p => dist(p, game.seat));
        if (Math.abs(distances[0] - distances[1]) > 1) {
          scorePoint(distances[0] < distances[1] ? 0 : 1, 'closest');
        } else {
          game.tiedRounds++;
          if (game.tiedRounds >= 2) {
            scorePoint(Math.random() < .5 ? 0 : 1, 'draw');
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
    const { x, y } = game.seat;
    const pulse = Math.sin(now / 250) * 2;
    if (game.rule && game.rule.id === 'shuffle' && ['warning', 'moving'].includes(game.rulePhase)) {
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
    ctx.fillStyle = '#725e6040'; ctx.beginPath(); ctx.ellipse(x, y + 58, 111, 28, 0, 0, 7); ctx.fill();
    // Occupation aura and progress arcs.
    ctx.save(); ctx.translate(x, y + 12);
    ctx.strokeStyle = '#fff9dfaa'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 89 + pulse, 0, 7); ctx.stroke();
    for (let i = 0; i < 2; i++) {
      if (game.capture[i] <= 0) continue;
      ctx.strokeStyle = CHARACTERS[game.picks[i]].color; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, 96, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, game.capture[i] / CAPTURE_SECONDS), false); ctx.stroke();
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
    ctx.fillStyle = '#fff8ed'; ctx.font = '800 12px DM Sans, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ONLY ONE SEAT', x, y - 54);
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
      if (game.capture[1 - p.i] > .55 && dist(p, game.seat) >= 89) return 'worried';
      if (game.capture[p.i] > .55) return 'happy';
      if (game.time < 5 && game.scores[p.i] < game.scores[1 - p.i]) return 'worried';
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
    roundRect(x - 27, y - 65, 54, 21, 9, '#fffaf0');
    ctx.fillStyle = dark; ctx.font = '800 12px Noto Sans SC, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(character.name, x, y - 49);
    if (p.skillCooldown > 0) {
      const cooldown = character.skill.cooldown * (game.rule && game.rule.id === 'frenzy' ? game.rule.cooldownFactor : 1);
      roundRect(x - 22, y + 29, 44, 5, 3, '#fff9');
      roundRect(x - 22, y + 29, 44 * (1 - p.skillCooldown / cooldown), 5, 3, light);
    }
    ctx.restore();
  }

  function captureHighlight(now) {
    if (game.phase !== 'playing' || now - game.highlightClock < 1000 / HIGHLIGHT_FPS) return;
    game.highlightClock = now;
    const frame = game.highlightFrames.length >= HIGHLIGHT_FRAME_COUNT ? game.highlightFrames.shift() : highlightPool[game.highlightFrames.length];
    frame.getContext('2d').drawImage(canvas, 0, 0, frame.width, frame.height);
    game.highlightFrames.push(frame);
  }

  function renderHighlight() {
    const frames = game.highlightFrames;
    const position = Math.min(frames.length - 1, game.replay.elapsed / game.replay.duration * frames.length);
    const frame = frames[Math.max(0, Math.floor(position))];
    ctx.fillStyle = '#202534'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(frame, 0, 0, W, H);
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, '#20253455'); shade.addColorStop(.25, '#20253400'); shade.addColorStop(.75, '#20253400'); shade.addColorStop(1, '#20253466');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    if (game.replay && game.highlightFrames.length) {
      renderHighlight();
      return;
    }
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - .5) * 8, (Math.random() - .5) * 8);
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
    if (game.phase !== 'menu' && game.phase !== 'finished') return;
    game.mode = btn.dataset.mode;
    syncMode();
    if (game.mode === 'online') showOnlineScreen();
  }));
  $('fullscreen-btn').addEventListener('click', enterFullscreen);
  $('exit-fullscreen-btn').addEventListener('click', exitFullscreen);
  $('demo-btn').addEventListener('click', () => { game.mode = 'demo'; syncMode(); startMatch(); enterFullscreen(); });
  $('stop-demo-btn').addEventListener('click', stopDemo);
  $('start-btn').addEventListener('click', () => {
    if (game.mode === 'online') {
      showOnlineScreen();
    } else {
      startMatch();
    }
  });
  $('again-btn').addEventListener('click', startMatch);
  $('change-btn').addEventListener('click', () => returnToMenu(game.mode));
  $('resume-btn').addEventListener('click', togglePause);
  $('restart-btn').addEventListener('click', startMatch);
  $('menu-btn').addEventListener('click', () => returnToMenu(game.mode));
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
  $('skip-replay').addEventListener('click', skipReplay);
  canvas.addEventListener('pointerdown', () => { if (game.replay) skipReplay(); });
  $('sound-btn').addEventListener('click', () => {
    game.audio = !game.audio;
    $('sound-btn').textContent = game.audio ? '♪' : '×';
    $('sound-btn').setAttribute('aria-label', game.audio ? '关闭声音' : '打开声音');
    tone(620, .09);
  });
  document.addEventListener('keydown', event => {
    if ($('poster-dialog').open) return;
    if (game.replay && ['Space', 'Enter', 'Escape'].includes(event.code)) {
      event.preventDefault();
      skipReplay();
      return;
    }
    const activeRound = ['playing', 'countdown', 'roundEnd'].includes(game.phase);
    if (activeRound && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.code)) event.preventDefault();
    if (activeRound) keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyP') togglePause();
    if (event.code === 'Escape') exitFullscreen();
    if (event.code === 'KeyR' && game.phase !== 'menu') startMatch();
    if (event.code === 'Space' && game.mode !== 'demo') useSkill(players[0]);
    if (event.code === 'Enter' && game.mode === 'duo') useSkill(players[1]);
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
  $('dash-touch').addEventListener('pointerdown', e => { e.preventDefault(); useSkill(players[0]); });

  // Online Multiplayer Functions (PeerJS WebRTC)
  let network = null;
  let onlineState = 'menu'; // menu, waiting, character-select, playing
  let onlineRoomCode = null;
  let onlinePlayerNumber = null;
  let onlineOpponentCharacter = null;
  let onlineGameInterval = null;
  let onlineOpponentInput = { keys: new Set(), mobile: { x: 0, y: 0 }, skill: false };
  let connectionCheckInterval = null;

  // Network interpolation state
  let remoteInterpolation = {
    prevX: 0, prevY: 0, prevVX: 0, prevVY: 0,
    targetX: 0, targetY: 0, targetVX: 0, targetVY: 0,
    interpTime: 0, interpDuration: 0.1, // 100ms interpolation
    lastUpdateTime: 0
  };
  let networkLag = 0; // Current lag in ms

  function updateConnectionStatus(status) {
    const el = $('connection-status');
    if (!el) return;
    el.className = 'connection-status ' + status;
    const small = el.querySelector('small');
    if (small) {
      small.textContent = status === 'connected' ? '已连接' : status === 'connecting' ? '连接中...' : '未连接';
    }
    const dot = el.querySelector('.status-dot');
    if (dot) {
      dot.className = 'status-dot ' + (status === 'connected' ? '' : status);
    }

    // Update lag indicator
    const lagEl = $('lag-indicator');
    if (lagEl && status === 'connected' && game.mode === 'online') {
      lagEl.hidden = false;
      lagEl.textContent = networkLag + 'ms';
      lagEl.className = 'lag-indicator' + (networkLag > 200 ? ' very-slow' : networkLag > 100 ? ' slow' : '');
    } else if (lagEl) {
      lagEl.hidden = true;
    }
  }

  function showOnlineScreen() {
    hideAllScreens();
    $('online-screen').classList.add('visible');
    $('online-menu').hidden = false;
    $('online-waiting').hidden = true;
    $('online-character-select').hidden = true;
    $('back-to-menu-btn').hidden = true;
    $('online-game-hud').hidden = true;
    onlineState = 'menu';
    updateConnectionStatus('disconnected');
  }

  function hideAllScreens() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
  }

  async function createRoom() {
    if (!network) network = new window.SofaNetwork();

    $('online-menu').hidden = true;
    $('online-waiting').hidden = false;
    $('back-to-menu-btn').hidden = false;
    onlineState = 'waiting';
    updateConnectionStatus('connecting');

    // Show loading state
    $('room-code').textContent = '创建中...';
    document.querySelector('.waiting-text').textContent = '正在创建房间...';

    try {
      const result = await network.createRoom();
      if (result.error) {
        alert(result.error);
        showOnlineScreen();
        return;
      }

      onlineRoomCode = result.roomId;
      onlinePlayerNumber = result.playerNumber;
      $('room-code').textContent = onlineRoomCode;
      document.querySelector('.waiting-text').textContent = '等待对手加入...';
      updateConnectionStatus('connected');

      // Start connection health check
      startConnectionCheck();

      network.onPlayerJoin = () => {
        // Opponent joined, move to character select
        onlineState = 'character-select';
        $('online-waiting').hidden = true;
        $('online-character-select').hidden = false;
        showOnlineCharacterSelect();
        stopConnectionCheck();
      };

      network.onPlayerLeave = () => {
        alert('对手已断开连接');
        leaveOnlineRoom();
      };

      network.onData = (data) => {
        if (data.type === 'characterSelect') {
          onlineOpponentCharacter = data.character;
          $('online-p2-char').textContent = CHARACTERS[data.character].name;
          $('online-p2-status').classList.add('ready');

          // If I already selected, start game
          if (game.manualPicks[onlinePlayerNumber]) {
            startOnlineGame();
          }
        } else if (data.type === 'input') {
          onlineOpponentInput = data.input;
        }
      };
    } catch (error) {
      alert('创建房间失败：' + error.message);
      showOnlineScreen();
    }
  }

  async function joinRoom() {
    const code = $('room-code-input').value.trim();
    if (!code) {
      alert('请输入房间号');
      return;
    }

    if (!network) network = new window.SofaNetwork();

    $('online-menu').hidden = true;
    $('online-waiting').hidden = false;
    $('back-to-menu-btn').hidden = false;
    onlineState = 'waiting';
    updateConnectionStatus('connecting');

    // Show loading state
    $('room-code').textContent = '连接中...';
    document.querySelector('.waiting-text').textContent = '正在加入房间...';

    try {
      const result = await network.joinRoom(code);
      if (result.error) {
        alert(result.error);
        showOnlineScreen();
        return;
      }

      onlineRoomCode = result.roomId;
      onlinePlayerNumber = result.playerNumber;

      // Show waiting screen with note
      $('room-code').textContent = '已加入';
      document.querySelector('.waiting-text').textContent = '等待房主开始...';
      updateConnectionStatus('connected');

      // Start connection health check
      startConnectionCheck();

      network.onPlayerLeave = () => {
        alert('与房主断开连接');
        leaveOnlineRoom();
      };

      network.onData = (data) => {
        if (data.type === 'characterSelect') {
          onlineOpponentCharacter = data.character;
          $('online-p2-char').textContent = CHARACTERS[data.character].name;
          $('online-p2-status').classList.add('ready');
        } else if (data.type === 'gameState') {
          // Client receives game state from host
          applyRemoteGameState(data.state);
        } else if (data.type === 'gameStart') {
          startOnlineGameAsClient();
        }
      };
    } catch (error) {
      alert('加入房间失败：' + error.message);
      showOnlineScreen();
    }
  }

  function startConnectionCheck() {
    stopConnectionCheck();
    connectionCheckInterval = setInterval(() => {
      if (network && network.isConnected()) {
        updateConnectionStatus('connected');
      } else {
        updateConnectionStatus('connecting');
      }
    }, 2000);
  }

  function stopConnectionCheck() {
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval);
      connectionCheckInterval = null;
    }
  }

  function showOnlineCharacterSelect() {
    const picker = $('online-picker');
    picker.innerHTML = '';
    CHARACTER_IDS.forEach(id => {
      const char = CHARACTERS[id];
      const btn = document.createElement('button');
      btn.className = 'character-choice';
      btn.innerHTML = `<span class="choice-avatar" style="background:${char.color}">${char.icon}</span><div><strong>${char.name}</strong><small>${char.skill.name}</small></div>`;
      btn.addEventListener('click', () => selectOnlineCharacter(id, btn));
      picker.appendChild(btn);
    });
  }

  function selectOnlineCharacter(characterId, btn) {
    if (!network) return;

    game.manualPicks[onlinePlayerNumber] = characterId;
    game.picks[onlinePlayerNumber] = characterId;

    // Send to opponent
    network.sendCharacterSelect(characterId);

    // Update UI
    $('online-p1-char').textContent = CHARACTERS[characterId].name;
    document.querySelectorAll('#online-picker .character-choice').forEach(b => {
      b.style.opacity = '0.5';
      b.style.boxShadow = 'none';
    });
    btn.style.opacity = '1';
    btn.style.boxShadow = '0 0 0 3px #4caf50';

    // If opponent already selected, start game
    if (onlineOpponentCharacter) {
      startOnlineGame();
    }
  }

  function startOnlineGame() {
    onlineState = 'playing';
    hideAllScreens();
    $('online-game-hud').hidden = false;

    // Set opponent character
    if (onlineOpponentCharacter) {
      game.manualPicks[1 - onlinePlayerNumber] = onlineOpponentCharacter;
      $('online-opponent-name').textContent = `对手 (${CHARACTERS[onlineOpponentCharacter].name})`;
    }

    game.picks = [...game.manualPicks];
    game.mode = 'duo'; // Treat as local duo for game logic
    syncMode();
    startMatch();

    // Host sends game state
    if (onlinePlayerNumber === 0) {
      onlineGameInterval = setInterval(() => {
        if (game.phase === 'playing' && network.isConnected()) {
          network.sendGameState({
            phase: game.phase,
            scores: game.scores,
            time: game.time,
            rule: game.rule ? game.rule.id : null,
            seat: game.seat,
            players: players.map(p => ({
              x: p.x,
              y: p.y,
              vx: p.vx,
              vy: p.vy,
              characterId: p.characterId,
              skillCooldown: p.skillCooldown,
              stunned: p.stunned,
              emotion: p.emotion
            }))
          });
        }
      }, 100);
    }
  }

  function startOnlineGameAsClient() {
    onlineState = 'playing';
    hideAllScreens();
    $('online-game-hud').hidden = false;

    game.mode = 'duo';
    syncMode();

    // Client sends input
    onlineGameInterval = setInterval(() => {
      if (game.phase === 'playing' && network.isConnected()) {
        network.sendInput({
          keys: Array.from(keys),
          mobile: { x: mobile.x, y: mobile.y },
          skill: false
        });
      }
    }, 50);
  }

  function applyRemoteGameState(state) {
    if (!state) return;

    // Calculate network lag
    if (state.timestamp) {
      networkLag = Date.now() - state.timestamp;
    }

    // Apply remote game state for client
    game.phase = state.phase;
    game.scores = state.scores;
    game.time = state.time;

    if (state.rule) {
      const ruleId = typeof state.rule === 'string' ? state.rule : state.rule.id;
      game.rule = RULES[ruleId];
    }

    if (state.seat) {
      game.seat = state.seat;
    }

    // Update player positions from host with interpolation
    if (state.players && state.players.length >= 2) {
      const remotePlayerIdx = 1 - onlinePlayerNumber;
      const remotePlayer = state.players[remotePlayerIdx];
      if (remotePlayer && players[remotePlayerIdx]) {
        // Initialize interpolation state on first update
        if (remoteInterpolation.lastUpdateTime === 0) {
          remoteInterpolation.prevX = remotePlayer.x;
          remoteInterpolation.prevY = remotePlayer.y;
          remoteInterpolation.prevVX = remotePlayer.vx;
          remoteInterpolation.prevVY = remotePlayer.vy;
          remoteInterpolation.targetX = remotePlayer.x;
          remoteInterpolation.targetY = remotePlayer.y;
          remoteInterpolation.targetVX = remotePlayer.vx;
          remoteInterpolation.targetVY = remotePlayer.vy;
          players[remotePlayerIdx].x = remotePlayer.x;
          players[remotePlayerIdx].y = remotePlayer.y;
        } else {
          // Store current position as previous
          remoteInterpolation.prevX = players[remotePlayerIdx].x;
          remoteInterpolation.prevY = players[remotePlayerIdx].y;
          remoteInterpolation.prevVX = players[remotePlayerIdx].vx;
          remoteInterpolation.prevVY = players[remotePlayerIdx].vy;

          // Set new target position
          remoteInterpolation.targetX = remotePlayer.x;
          remoteInterpolation.targetY = remotePlayer.y;
          remoteInterpolation.targetVX = remotePlayer.vx;
          remoteInterpolation.targetVY = remotePlayer.vy;

          // Reset interpolation timer
          remoteInterpolation.interpTime = 0;
        }
        remoteInterpolation.lastUpdateTime = performance.now();
      }
    }

    updateHud();
  }

  function updateRemoteInterpolation(dt) {
    if (onlinePlayerNumber === null || onlinePlayerNumber === 0) return; // Only client needs interpolation

    const remotePlayerIdx = 1 - onlinePlayerNumber;
    const remotePlayer = players[remotePlayerIdx];
    if (!remotePlayer) return;

    // Update interpolation time
    remoteInterpolation.interpTime += dt;
    const t = Math.min(1, remoteInterpolation.interpTime / remoteInterpolation.interpDuration);

    // Smooth easing function
    const eased = t * t * (3 - 2 * t);

    // Interpolate position
    remotePlayer.x = remoteInterpolation.prevX + (remoteInterpolation.targetX - remoteInterpolation.prevX) * eased;
    remotePlayer.y = remoteInterpolation.prevY + (remoteInterpolation.targetY - remoteInterpolation.prevY) * eased;

    // Interpolate velocity (for smoother animation)
    remotePlayer.vx = remoteInterpolation.prevVX + (remoteInterpolation.targetVX - remoteInterpolation.prevVX) * eased;
    remotePlayer.vy = remoteInterpolation.prevVY + (remoteInterpolation.targetVY - remoteInterpolation.prevVY) * eased;

    // Update lag indicator periodically
    if (game.phase === 'playing') {
      const lagEl = $('lag-indicator');
      if (lagEl) {
        lagEl.textContent = networkLag + 'ms';
        lagEl.className = 'lag-indicator' + (networkLag > 200 ? ' very-slow' : networkLag > 100 ? ' slow' : '');
      }
    }
  }

  function endOnlineGame() {
    if (onlineGameInterval) {
      clearInterval(onlineGameInterval);
      onlineGameInterval = null;
    }
    $('online-game-hud').hidden = true;
  }

  async function leaveOnlineRoom() {
    stopConnectionCheck();
    if (onlineGameInterval) {
      clearInterval(onlineGameInterval);
      onlineGameInterval = null;
    }
    if (network) {
      await network.leaveRoom();
      network = null;
    }
    $('online-game-hud').hidden = true;
    onlineOpponentCharacter = null;
    onlineOpponentInput = { keys: new Set(), mobile: { x: 0, y: 0 }, skill: false };
    // Reset interpolation state
    remoteInterpolation = {
      prevX: 0, prevY: 0, prevVX: 0, prevVY: 0,
      targetX: 0, targetY: 0, targetVX: 0, targetVY: 0,
      interpTime: 0, interpDuration: 0.1,
      lastUpdateTime: 0
    };
    networkLag = 0;
    showOnlineScreen();
  }

  // Difficulty selector event listeners
  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      game.difficulty = btn.dataset.difficulty;
      document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Online button event listeners
  $('create-room-btn').addEventListener('click', createRoom);
  $('join-room-btn').addEventListener('click', joinRoom);
  $('room-code-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') joinRoom();
  });
  $('copy-code-btn').addEventListener('click', () => {
    if (!onlineRoomCode) return;
    navigator.clipboard.writeText(onlineRoomCode).then(() => {
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
      textArea.value = onlineRoomCode;
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
  $('back-to-menu-btn').addEventListener('click', leaveOnlineRoom);

  syncMode();
  resetPlayers();
  updateHud();
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
        results.trap = { ok: waitedForArm && players[1].stunned > 0 && !players[0].trap, stun: players[1].stunned };

        prepare('trap', 'guard');
        useSkill(players[0]);
        useSkill(players[1]);
        players[1].x = players[0].trap.x;
        players[1].y = players[0].trap.y;
        updatePlayer(players[0], players[0].trap.arm + .01, { x: 0, y: 0 });
        updateTraps();
        results.trapShield = { ok: players[1].stunned === 0 && players[1].shieldHit && !players[0].trap, stun: players[1].stunned };
        return results;
      }
    };
  } else {
    requestAnimationFrame(frame);
  }
})();
