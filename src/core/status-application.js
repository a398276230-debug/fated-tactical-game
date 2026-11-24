import { evaluateExpr, validExpr } from './formula.js';
import { validVmExpiry } from './vm-schema.js';
import { authorityFor } from './vm-authority.js';
import { STATUSES } from '../presets/status-defaults.js';

const own = (record, key) => record != null && Object.hasOwn(record, key) ? record[key] : undefined;
const bounded = (value, min, max) => Math.min(max, Math.max(min, Math.floor(value)));
const sourceValue = (raw, context) => {
  if (typeof raw === 'string' && !validExpr(raw)) return raw;
  return evaluateExpr(raw, context);
};
const finite = (value, fallback, strict, label) => {
  if (Number.isFinite(value)) return value;
  if (strict) throw new Error(`无效状态${label}`);
  return fallback;
};

export function resolveStatusApplication(state, target, statusId, input = {}, { strict = false } = {}) {
  const template = own(state.statusTemplates, statusId) ?? own(STATUSES, statusId);
  if (!template || !target) return null;
  const previous = own(target.statuses, statusId);
  const requestedMode = input.stackMode ?? previous?.stackMode ?? template.stackMode ?? 'refresh';
  const replace = requestedMode === 'replace';
  const sourceId = own(input, 'sourceId') ? input.sourceId : replace ? null : previous?.sourceId ?? null;
  const source = own(state.units, sourceId) ?? target;
  const context = { self: source, source, target, event: {}, status: previous ?? null,
    vars: input.contextVars ?? previous?.vars ?? {} };
  const capValue = sourceValue(template.maxStacks ?? 1, context);
  const cap = finite(capValue, NaN, strict, '层数上限');
  if (!Number.isFinite(cap)) return null;
  const maxStacks = bounded(cap, 1, 999999);
  const defaultStacks = requestedMode === 'extend' ? previous?.stacks ?? 1 : 1;
  const stacksValue = sourceValue(input.stacks ?? defaultStacks, context);
  const stacks = finite(stacksValue, NaN, strict, '层数');
  if (!Number.isFinite(stacks)) return null;
  const durationValue = sourceValue(input.remainingTurns ?? input.turns ?? template.remainingTurns ?? 1, context);
  const extensionValue = sourceValue(input.extendTurns ?? 1, context);
  const duration = finite(durationValue, NaN, strict, '持续回合');
  const extension = finite(extensionValue, NaN, strict, '延长回合');
  if (!Number.isFinite(duration) || !Number.isFinite(extension)) return null;
  const vars = {};
  for (const [key, raw] of Object.entries(template.vars ?? {})) {
    const value = sourceValue(raw, context);
    if (value !== null && value !== undefined) vars[key] = value;
  }
  for (const [key, value] of Object.entries(input.vars ?? {})) if (value !== null) vars[key] = structuredClone(value);
  const sourceCarrier = replace ? input.sourceCarrier ?? null : input.sourceCarrier ?? previous?.sourceCarrier ?? null;
  const authority = authorityFor(state, sourceCarrier, sourceId ?? target.id);
  const status = {
    ...structuredClone(template), id: statusId, templateId: statusId, ownerId: target.id,
    stackMode: requestedMode, maxStacks,
    stacks: bounded(requestedMode === 'stack' && previous ? previous.stacks + stacks : stacks, 1, maxStacks), vars,
    durationType: input.durationType ?? (replace ? template.durationType : previous?.durationType ?? template.durationType) ?? 'battle_turns',
    remainingTurns: requestedMode === 'extend' && previous && input.remainingTurns == null && input.turns == null
      ? bounded(previous.remainingTurns + extension, 1, 100)
      : requestedMode === 'stack' && previous && input.remainingTurns == null && input.turns == null
        ? bounded(Math.max(previous.remainingTurns, duration), 1, 100) : bounded(duration, 1, 100),
    sourceId, sourceCarrier,
    authorityRank: authority.authorityRank, sourceTier: authority.unitTier,
    ...(Number.isFinite(input.effectiveTier) ? { effectiveTier: input.effectiveTier } : {}),
    tags: structuredClone(template.tags ?? []), flags: structuredClone(template.flags ?? []),
    mods: structuredClone(template.mods ?? []), rules: structuredClone(template.rules ?? []),
  };
  const expiry = own(input, 'expireOn') ? input.expireOn : replace ? undefined : previous?.expireOn;
  if (expiry !== undefined && expiry !== null && !validVmExpiry(expiry)) {
    if (strict) throw new Error('无效字段：expireOn');
    return null;
  }
  if (expiry !== undefined) status.expireOn = structuredClone(expiry);
  if (status.category === 'shield') {
    const amount = input.amount ?? vars.shieldAmount;
    if (amount !== undefined) {
      const numeric = finite(Number(amount), NaN, strict, '护盾值');
      if (!Number.isFinite(numeric)) return null;
      status.vars.shieldAmount = Math.max(1, Math.round(numeric))
        + (previous && requestedMode === 'stack' ? Number(previous.vars?.shieldAmount ?? 0) : 0);
    }
  }
  status.appliedRound = state.round;
  status.appliedTurn = state.turn;
  if (!replace && previous?.pools) status.pools = previous.pools;
  return { nextStatus: status, previous, replacePrevious: Boolean(previous && replace) };
}
