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
      skill: { kind: 'shield', name: '护盾', description: '挡住冲撞、震波或弹簧', cooldown: 2.6, duration: 1, counterPower: 650 }
    },
    pulse: {
      id: 'pulse', name: '团团', color: '#83c996', dark: '#4f9b70', light: '#b7e3bf',
      speed: 195, ears: 'leaf', pitch: 330, wave: 'triangle', personality: '看着安静，靠近就弹开',
      skill: { kind: 'pulse', name: '震波', description: '震开身边的对手', cooldown: 2.8, radius: 132, power: 610, stun: .34 }
    },
    blink: {
      id: 'blink', name: '闪闪', color: '#f2bd59', dark: '#c18735', light: '#ffe2a0',
      speed: 210, ears: 'long', pitch: 680, wave: 'sine', personality: '喜欢突然出现抢镜头',
      skill: { kind: 'blink', name: '闪现', description: '瞬移并震开落点附近的对手', cooldown: 2.8, distance: 138, radius: 70, power: 560, stun: .32 }
    },
    magnet: {
      id: 'magnet', name: '柚柚', color: '#ae91df', dark: '#7b61b5', light: '#d7c4f0',
      speed: 190, ears: 'round', pitch: 280, wave: 'sine', personality: '慢慢靠近，一下子控场',
      skill: { kind: 'pull', name: '引力', description: '牵引对手片刻，再将其弹开', cooldown: 3.1, radius: 185, power: 650, stun: .55, rebound: .18, reboundPower: 560 }
    },
    trap: {
      id: 'trap', name: '米米', color: '#ed9fb5', dark: '#bd6987', light: '#f7c9d7',
      speed: 200, ears: 'leaf', pitch: 580, wave: 'triangle', personality: '抱枕比本人更有主意',
      skill: { kind: 'trap', name: '抱枕阵', description: '留下抱枕，困住踩到的对手', cooldown: 3.2, duration: 3.5, arm: .45, radius: 50, stun: 1.1 }
    }
  };
  for (const character of Object.values(roster)) {
    Object.freeze(character.skill);
    Object.freeze(character);
  }
  window.SofaCharacters = Object.freeze(roster);
})();
