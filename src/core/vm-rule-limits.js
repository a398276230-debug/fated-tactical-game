export function ruleAvailability(state, rule, key) {
  const vm = state.vm;
  const stamp = vm?.ruleTurns?.[key];
  const sameRound = Boolean(stamp && stamp.round === state.round);
  const sameTurn = sameRound && stamp.turn === state.turn;
  const roundUsed = sameRound ? (stamp.roundCount ?? stamp.count ?? 0) : 0;
  const usesLeft = Math.min(
    rule.usesPerBattle === undefined ? Infinity : Math.max(0, rule.usesPerBattle - (vm?.uses?.[key] ?? 0)),
    rule.usesPerTurn === undefined ? Infinity : Math.max(0, rule.usesPerTurn - (sameTurn ? stamp.count : 0)),
    rule.usesPerRound === undefined ? Infinity : Math.max(0, rule.usesPerRound - roundUsed),
  );
  const cooldownRemaining = rule.cooldownTurns === undefined || !stamp ? 0 : Math.max(0, stamp.round + rule.cooldownTurns - state.round);
  return { usesLeft, cooldownRemaining, sameTurn, roundUsed, stamp };
}
