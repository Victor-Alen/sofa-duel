// One fair room rule is drawn at the start of each round.
// Add a new rule here and a matching handler in game.js.
(() => {
  const rules = {
    shuffle: {
      id: 'shuffle', icon: '🛋️', name: '沙发搬家',
      description: '沙发会预告新位置，然后滑过去',
      warningAt: .6, triggerAt: 1.8, moveDuration: .48
    },
    spring: {
      id: 'spring', icon: '✦', name: '弹簧沙发',
      description: '沙发会预告弹起，把附近的人弹开',
      warningAt: .6, triggerAt: 1.8, radius: 151, power: 510, stun: .27
    },
    frenzy: {
      id: 'frenzy', icon: '⚡', name: '技能狂欢',
      description: '双方技能冷却缩短，攻防更快',
      cooldownFactor: .68
    }
  };
  for (const rule of Object.values(rules)) Object.freeze(rule);
  window.SofaRules = Object.freeze(rules);
})();
