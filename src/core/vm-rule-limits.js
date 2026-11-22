export function ruleAvailability(state, rule, key) {
  const vm = state.vm;
  const stamp = vm?.ruleTurns?.[key];
  const sameTurn = Boolean(stamp && stamp.round === state.round && stamp.turn === state.turn);
  const usesLeft = Math.min(
    rule.usesPerBattle === undefined ? Infinity : Math.max(0, rule.usesPerBattle - (vm?.uses?.[key] ?? 0)),
    rule.usesPerTurn === undefined ? Infinity : Math.max(0, rule.usesPerTurn - (sameTurn ? stamp.count : 0)),
  );
  const cooldownRemaining = rule.cooldownTurns === undefined || !stamp ? 0 : Math.max(0, stamp.round + rule.cooldownTurns - state.round);
  return { usesLeft, cooldownRemaining, sameTurn, stamp };
}
