// Add a character here, then choose one of the skill kinds implemented in game.js.
// All balance values are first-pass tuning values; see README.md before changing them.
(() => {
  const roster = {
    dash: {
      id: 'dash', name: '珊珊', color: '#ff795f', dark: '#dd5d49', light: '#ffac8e',
      speed: 200, ears: 'long', pitch: 440, wave: 'sawtooth', personality: '急性子，先冲再说',
      skill: { kind: 'dash', name: '冲撞', description: '向前冲刺，撞飞对手', cooldown: 2.5, duration: .19, power: 490 }
    },
    guard: {
      id: 'guard', name: '蓝蓝', color: '#76b5eb', dark: '#428bc8', light: '#b1d5ee',
      speed: 205, ears: 'round', pitch: 520, wave: 'sine', personality: '笑眯眯，但绝不让座',
      skill: { kind: 'shield', name: '护盾', description: '挡住冲撞、震波或弹簧', cooldown: 3.0, duration: 0.85, counterPower: 450 }
    },
    pulse: {
      id: 'pulse', name: '团团', color: '#83c996', dark: '#4f9b70', light: '#b7e3bf',
      speed: 195, ears: 'leaf', pitch: 330, wave: 'triangle', personality: '看着安静，靠近就弹开',
      skill: { kind: 'pulse', name: '震波', description: '震开身边的对手', cooldown: 2.8, radius: 132, power: 610, stun: .34 }
    },
    blink: {
      id: 'blink', name: '闪闪', color: '#f2bd59', dark: '#c18735', light: '#ffe2a0',
      speed: 210, ears: 'long', pitch: 680, wave: 'sine', personality: '喜欢突然出现抢镜头',
      skill: { kind: 'blink', name: '闪现', description: '瞬移并震开落点附近的对手', cooldown: 2.8, distance: 138, radius: 70, power: 560, stun: .32 },
      skillAlt: { kind: 'blinkSpeed', name: '加速', description: '大幅加速移动，快速抢夺沙发', cooldown: 3.2, duration: 2.0, boost: 1.8 }
    },
    magnet: {
      id: 'magnet', name: '柚柚', color: '#ae91df', dark: '#7b61b5', light: '#d7c4f0',
      speed: 190, ears: 'round', pitch: 280, wave: 'sine', personality: '慢慢靠近，一下子控场',
      skill: { kind: 'pull', name: '引力', description: '牵引对手片刻，再将其弹开', cooldown: 3.1, radius: 185, power: 610, stun: .5, rebound: .18, reboundPower: 560 }
    },
    trap: {
      id: 'trap', name: '米米', color: '#ed9fb5', dark: '#bd6987', light: '#f7c9d7',
      speed: 200, ears: 'leaf', pitch: 580, wave: 'triangle', personality: '抱枕比本人更有主意',
      skill: { kind: 'trap', name: '抱枕阵', description: '留下抱枕，困住踩到的对手', cooldown: 3.2, duration: 3.2, arm: .45, radius: 50, stun: 1.5 }
    },
    vampire: {
      id: 'vampire', name: '德德', color: '#8b45a6', dark: '#5e2d73', light: '#b87fc9',
      speed: 215, ears: 'pointed', pitch: 380, wave: 'sawtooth', personality: '优雅地吸取对手活力',
      skill: { kind: 'vampire', name: '吸血蝙蝠', description: '化身蝙蝠吸血，咬中吸取对手的占领进度', cooldown: 3.5, duration: 1.2, stun: 0.4 }
    },
    knight: {
      id: 'knight', name: '剑剑', color: '#c0c0c0', dark: '#808080', light: '#e8e8e8',
      speed: 185, ears: 'helmet', pitch: 220, wave: 'square', personality: '旋转宝剑，所向披靡',
      skill: { kind: 'knight', name: '剑刃旋风', description: '旋转宝剑，碰到对手使其眩晕', cooldown: 2.8, duration: 1.5, radius: 65, stun: 0.45, power: 380 }
    },
    ninja: {
      id: 'ninja', name: '影影', color: '#2d2d2d', dark: '#1a1a1a', light: '#4a4a4a',
      speed: 230, ears: 'mask', pitch: 720, wave: 'sine', personality: '神出鬼没，分身扰敌',
      skill: { kind: 'ninja', name: '影分身', description: '留下分身迷惑对手，真身加速', cooldown: 3.0, duration: 2.0, boost: 1.7 }
    },
    mage: {
      id: 'mage', name: '法法', color: '#4169e1', dark: '#2a4494', light: '#6b8de3',
      speed: 195, ears: 'hat', pitch: 480, wave: 'triangle', personality: '远程法术，控场大师',
      skill: { kind: 'mage', name: '魔法弹', description: '发射魔法弹，远程击退对手', cooldown: 2.6, radius: 200, power: 520, stun: 0.35 }
    }
  };
  for (const character of Object.values(roster)) {
    Object.freeze(character.skill);
    Object.freeze(character);
  }
  window.SofaCharacters = Object.freeze(roster);
})();
