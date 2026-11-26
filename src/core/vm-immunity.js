import { evaluateExpr } from './formula.js';
import { getStatusTemplate } from '../presets/status-defaults.js';
import { ruleAvailability } from './vm-rule-limits.js';
const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

function carrierEntity(state, carrier) {
  if (!carrier) return undefined;
  if (carrier.type === 'status') return own(own(state.units, carrier.ownerId)?.statuses, carrier.id);
  if (carrier.type === 'skill') return own(state.skills, carrier.id);
  if (carrier.type === 'item') {
    const item = own(state.items, carrier.id);
    const template = own(state.equipment, item?.templateId);
    return { ...template, ...item, vars: { ...template?.vars, ...item?.vars } };
  }
  if (carrier.type === 'zone') return own(state.zones, carrier.id);
  if (carrier.type === 'unit') return own(state.units, carrier.id);
}

function ruleContext(state, entry, event, carrierScope) {
  const entity = carrierEntity(state, entry.carrier);
  const row = { entity: entity ?? {}, carrier: entry.carrier ?? { type: 'unit', id: entry.ownerId }, nativeOwnerId: entry.ownerId };
  return carrierScope(state, row, entry.ownerId, event, {
    // Immunity checks are deliberately non-recursive. A before_status rule may
    // ask about the candidate status, but cannot trigger another immunity walk.
    isImmune: () => null,
  });
}

function cancelProgram(program, context) {
  for (const op of program ?? []) {
    if (op.op === 'if') {
      const condition = evaluateExpr(op.cond, context);
      if (typeof condition !== 'boolean') return false;
      if (!cancelProgram(condition ? op.then : op.else, context)) return false;
    } else if (op.op === 'mutate_event' && Object.keys(op.patch).every(key => key === 'cancel')) {
      const cancel = evaluateExpr(op.patch.cancel, context);
      if (typeof cancel !== 'boolean') return false;
      context.event.cancel = cancel;
    } else return false; // Do not speculate past asks, rolls or side effects.
  }
  return true;
}

/**
 * Read-only status immunity query for formula is_immune(). It evaluates only
 * existing before_status cancellation rules for the proposed status. The
 * event exposes the real source/target/status context, while the evaluator
 * never advances the VM or invokes rule counters, RNG, asks, commits, or
 * nested immunity queries. Unsupported/non-deterministic programs simply do
 * not prove immunity.
 */
export function isStatusImmune(state, target, statusId, source = null, dependencies = {}) {
  if (!target?.id || typeof statusId !== 'string') return null;
  const event = {
    actorId: source?.id ?? null,
    sourceId: source?.id ?? null,
    targetId: target.id,
    statusId,
    tags: getStatusTemplate(state, statusId)?.tags ?? [],
  };
  const { collectRules, carrierScope } = dependencies;
  if (typeof collectRules !== 'function' || typeof carrierScope !== 'function') return null;
  const entries = collectRules(state, 'before_status', event, { isImmune: () => null });
  for (const entry of entries) {
    const { usesLeft, cooldownRemaining } = ruleAvailability(state, entry.rule, entry.useKey);
    if (!usesLeft || cooldownRemaining) continue;
    const context = ruleContext(state, entry, event, carrierScope);
    if (entry.rule.filter !== undefined && evaluateExpr(entry.rule.filter, context) !== true) continue;
    if (cancelProgram(entry.rule.program, context)) {
      event.cancel = context.event.cancel;
      if (event.cancel === true) {
        event.immunityCarrier = entry.carrier ?? { type: 'unit', id: entry.ownerId };
        event.immunityOwnerId = entry.ownerId;
      }
    } else event.cancel = undefined;
  }
  return event.cancel === true;
}
