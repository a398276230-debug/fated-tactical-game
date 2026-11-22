import { evaluateExpr } from './formula.js';
import { distance3D, unitAt } from './spatial.js';
import { selectVM, zoneContains } from './vm-select.js';
import { skillCarrierVars } from './vm-carriers.js';

const maxSteps = 2000;
const maxDepth = 64;
const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const coordinate = value => Number.isInteger(value?.x) && Number.isInteger(value?.y);
const samePoint = (a, b) => a.x === b.x && a.y === b.y;

export const newVM = () => ({ stack: [], events: {}, pendingAsk: null, stepsRemaining: maxSteps, serial: 0 });
const nextId = (vm, prefix) => `${prefix}_${++vm.serial}`;

function resolveEntity(state, ref) {
  if (!ref) return undefined;
  return ref.type === 'status' ? own(own(state.units, ref.ownerId)?.statuses, ref.id)
    : ref.type === 'unit' ? own(state.units, ref.id)
    : ref.type === 'zone' ? own(state.zones, ref.id)
    : ref.type === 'item' ? own(state.items, ref.id)
    : ref.value;
}

function entityRef(state, value, from, owner, context) {
  if (from.startsWith('vars.')) {
    const register = own(context.vars, from.slice(5));
    const refs = Array.isArray(register) ? register : [register];
    const ref = refs.find(entry => entry && typeof entry === 'object' && resolveEntity(state, entry) === value);
    if (ref) return ref;
    if (own(state.zones, value.id) === value) return { type: 'zone', id: value.id };
    if (own(state.items, value.id) === value) return { type: 'item', id: value.id };
  }
  if (from === 'statuses') return { type: 'status', ownerId: owner.id, id: Object.keys(owner.statuses).find(key => owner.statuses[key] === value) };
  if (from === 'tape' || from === 'cells') return { type: 'literal', value };
  if (from === 'zones') return { type: 'zone', id: value.id };
  if (own(state.units, value.id) === value) return { type: 'unit', id: value.id };
  return { type: 'literal', value };
}

function makeFrame(vm, spec) {
  return { frameId: nextId(vm, 'f'), kind: 'action', ownerId: null, sourceId: null, ruleId: null,
    program: [], pc: 0, vars: {}, eventRef: null, ...spec };
}

export function pushFrame(state, spec) {
  const frame = makeFrame(state.vm, spec);
  state.vm.stack.push(frame);
  return frame;
}

export function startVM(state, spec) {
  state.vm ??= newVM();
  if (state.vm.stack.length || state.vm.pendingAsk) throw new Error('已有动作正在结算');
  state.vm.stepsRemaining = maxSteps;
  return pushFrame(state, spec);
}

function childFrame(state, frame, patch) {
  return pushFrame(state, { kind: frame.kind, ownerId: frame.ownerId, sourceId: frame.sourceId, ruleId: frame.ruleId,
    eventRef: frame.eventRef, carrier: frame.carrier ?? null, attribution: frame.attribution ?? null, scope: frame.scope ?? null, hook: frame.hook ?? null, localsRef: frame.localsRef ?? frame.frameId, ...patch });
}

function registers(state, frame) {
  return (state.vm.stack.find(entry => entry.frameId === frame.localsRef) ?? frame).vars;
}

function contextFor(state, frame, host) {
  const event = own(state.vm.events, frame.eventRef) ?? {};
  const self = own(state.units, frame.ownerId);
  const source = own(state.units, frame.sourceId);
  const target = resolveEntity(state, frame.scope?.target) ?? own(state.units, event.targetId);
  const attacker = own(state.units, event.actorId) ?? source;
  const vars = { ...registers(state, frame) };
  const bound = resolveEntity(state, frame.scope?.bound);
  Object.assign(vars, frame.scope?.bindings);
  const carrier = resolveEntity(state, frame.carrier);
  return {
    self, source, target, attacker, candidate: bound, vars, event: { ...event, actor: attacker, source, target },
    resolveEntity: (value, kind) => {
      const entity = typeof value === 'string' ? own(state.units, value) ?? own(state.zones, value) ?? own(state.items, value)
        : value?.type && (value.type === 'literal' ? Object.hasOwn(value, 'value') : Object.hasOwn(value, 'id'))
          ? resolveEntity(state, value) : value;
      return kind === 'unit' && own(state.units, entity?.id) !== entity ? undefined : entity;
    },
    status: resolveEntity(state, frame.scope?.status) ?? (frame.carrier?.type === 'status' ? carrier : undefined),
    zone: resolveEntity(state, frame.scope?.zone) ?? (frame.carrier?.type === 'zone' ? carrier : undefined),
    skill: frame.carrier?.type === 'skill' ? { vars: skillCarrierVars(state, frame.carrier) } : undefined,
    item: frame.carrier?.type === 'item' ? { vars: { ...own(state.equipment, carrier?.templateId)?.vars, ...carrier?.vars } } : undefined,
    tape: resolveEntity(state, frame.scope?.tape), center: event.center, pool: frame.scope?.pool,
    round: state.round, turn: state.turn, timeOfDay: state.time?.timeOfDay, units: Object.values(state.units), zones: state.zones,
    distance: (a = self, b = target) => coordinate(a) && coordinate(b) ? distance3D(state, a, b) : null,
    resource: (entity, key) => host.resource?.(state, entity, key) ?? own(entity, key),
    inZone: (entity, key) => Object.values(state.zones ?? {}).some(zone => (zone.templateId === key || zone.tags?.includes(key)) && zoneContains(state, zone, entity)),
    isImmune: (unit, key) => host.isImmune?.(state, unit, key, frame) ?? false,
    select: selector => selectVM(state, selector, contextFor(state, frame, host), { pure: true }),
  };
}

export function newEvent(state, initial) {
  const eventRef = nextId(state.vm, 'ev');
  state.vm.events[eventRef] = structuredClone(initial);
  return eventRef;
}

export function scheduleHooks(state, parent, hook, eventRef, host) {
  const event = own(state.vm.events, eventRef);
  host.expireStatuses?.(state, hook, event);
  const entries = host.rules?.(state, hook, event) ?? [];
  const ordered = entries.filter(({ rule }) => rule.enabled !== false).sort((a, b) =>
    (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.carrierOrder - b.carrierOrder || compareId(a.rule.id, b.rule.id));
  // Evaluate filters when the rule is reached so they can observe earlier event mutations.
  for (const entry of ordered.reverse()) pushFrame(state, { kind: 'hook', hook, eventRef, ownerId: entry.ownerId,
    sourceId: entry.sourceId ?? parent.sourceId, ruleId: entry.rule.id, carrier: entry.carrier ?? null,
    rule: entry.rule, useKey: entry.useKey ?? `${entry.ownerId}:${entry.rule.dedupeKey ?? entry.rule.id}`, program: entry.rule.program });
}

function pruneEvents(vm) {
  for (const id of Object.keys(vm.events)) {
    if (!vm.stack.some(frame => frame.eventRef === id || frame.awaitEvent === id)) delete vm.events[id];
  }
}

function writeChoice(state, frame, ask, value, host) {
  const multi = ask.maxSelect !== undefined;
  const choiceRef = ask.kind === 'entity' ? own(frame.choiceRefs, value) : undefined;
  registers(state, frame)[ask.outVar] = multi ? value.map(id => own(frame.choiceRefs, id)) : choiceRef ?? value;
  delete frame.choiceRefs;
  const action = state.vm.stack.findLast(entry => entry.native === 'action');
  if (action) action.answers.push(value);
  const unit = own(state.units, ask.chooserId);
  const labelFor = id => ask.options.find(option => option.id === id)?.label ?? id;
  const label = multi ? value.map(labelFor).join('、')
    : coordinate(value) ? `(${value.x}, ${value.y})` : Array.isArray(ask.options) ? labelFor(value) : value;
  host.log(state, unit, 'choice', `${unit.name}选择了${label}`);
}

function automaticChoice(state, ask, host) {
  if (ask.kind === 'number') return ask.aiPolicy === 'max' ? ask.options.max : ask.options.min;
  return host.choose?.(state, ask) ?? ask.options[0];
}

function askInstruction(state, frame, op, context, host, options) {
  const chooser = selectVM(state, op.chooser, context)[0];
  if (!chooser) return;
  let choices;
  if (op.kind === 'number') {
    const min = evaluateExpr(op.min, context), max = evaluateExpr(op.max, context);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return;
    choices = { min, max, step: Number.isInteger(min) && Number.isInteger(max) ? 1 : 'any' };
  } else if (op.kind === 'option') choices = op.options;
  else if (op.kind === 'entity') {
    const { from, of = 'target' } = op.select;
    const entities = new Map();
    for (const entity of selectVM(state, op.select, context)) {
      if (typeof entity.id === 'string' && !entities.has(entity.id)) entities.set(entity.id, entity);
    }
    choices = [...entities.values()].map(({ id, name }) => ({ id, label: name ?? id }));
    if (choices.length) frame.choiceRefs = Object.fromEntries([...entities].map(([id, entity]) =>
      [id, entityRef(state, entity, from, context[of], context)]));
  }
  else choices = selectVM(state, op.select, context).filter(cell => coordinate(cell) && !unitAt(state, cell.x, cell.y, chooser.id))
    .map(({x, y}) => ({x, y}));
  if (!choices || choices.length === 0) return;
  const ask = { askId: nextId(state.vm, 'ask'), chooserId: chooser.id, prompt: op.prompt, kind: op.kind,
    options: choices, outVar: op.out, aiPolicy: op.aiPolicy,
    ...(op.maxSelect === undefined ? {} : { maxSelect: op.maxSelect }) };
  if (options.dryRun || (host.isAI?.(state, chooser) ?? (chooser.controlPolicy?.controller === 'ai' || chooser.team === 'red'))) {
    if (options.dryRun) options.conditional = true;
    const choice = automaticChoice(state, ask, host);
    const value = ask.maxSelect !== undefined ? [choice.id] : ask.kind === 'entity' || ask.kind === 'option' ? choice.id : choice;
    writeChoice(state, frame, ask, value, host);
  } else state.vm.pendingAsk = ask;
}

export function answerVM(state, action, host) {
  const ask = state.vm?.pendingAsk;
  const frame = state.vm?.stack.at(-1);
  if (!ask || !frame || action.askId !== ask.askId) throw new Error('该战斗选择已失效');
  if (Object.keys(action).some(key => !['type', 'askId', 'value', 'x', 'y'].includes(key))) throw new Error('回答含未知字段');
  let value;
  if (ask.kind === 'cell') {
    if (Object.hasOwn(action, 'value') || !coordinate(action) || !ask.options.some(cell => samePoint(cell, action))) throw new Error('请选择有效格子');
    value = { x: action.x, y: action.y };
  } else {
    if (Object.hasOwn(action, 'x') || Object.hasOwn(action, 'y')) throw new Error('回答类型不匹配');
    value = action.value;
    if (ask.kind === 'number') {
      const { min, max, step } = ask.options;
      if (!Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) throw new Error('数值超出选择范围');
    } else if (ask.maxSelect !== undefined) {
      if (!Array.isArray(value) || value.length < 1 || value.length > ask.maxSelect) throw new Error(`请选择 1–${ask.maxSelect} 个实体`);
      const requested = new Set(value);
      const ordered = ask.options.filter(option => requested.has(option.id));
      if (ordered.length !== value.length) throw new Error('请选择不同的有效实体');
      value = ordered.map(option => option.id);
    } else if (!ask.options.some(option => option.id === value)) throw new Error('请选择有效选项');
  }
  writeChoice(state, frame, ask, value, host);
  state.vm.pendingAsk = null;
}

function stepLoop(state, frame) {
  const ref = frame.items[frame.pc++];
  const entity = resolveEntity(state, ref);
  if (!entity) return;
  const scope = { ...frame.scope, bound: ref };
  if (ref.type === 'status') scope.status = ref;
  if (ref.type === 'zone') scope.zone = ref;
  if (frame.from === 'tape') scope.tape = ref;
  if (frame.bind) scope.bindings = { ...scope.bindings, [frame.bind]: ref };
  else if (ref.type === 'unit') scope.target = ref;
  childFrame(state, frame, { kind: frame.hook ? 'hook' : 'action', scope, program: frame.program });
}

function execute(state, frame, op, host, options) {
  const context = contextFor(state, frame, host);
  const evaluate = value => evaluateExpr(value, context);
  const vars = registers(state, frame);
  switch (op.op) {
    case 'let': {
      const owner = frame.carrier ? resolveEntity(state, frame.carrier) : context.self;
      const skill = frame.carrier?.type === 'skill' ? frame.carrier : null;
      if (op.scope === 'owner' && !owner && !skill) return;
      const value = evaluate(op.value);
      if (value !== null && ['number', 'string', 'boolean'].includes(typeof value)) {
        const record = op.scope !== 'owner' ? vars : skill
          ? ((state.vm.skillVars ??= {})[JSON.stringify([skill.ownerId, skill.id])] ??= skillCarrierVars(state, skill))
          : (owner.vars ??= {});
        Object.defineProperty(record, op.name, { value, writable: true, enumerable: true, configurable: true });
      }
      return;
    }
    case 'if': {
      const program = evaluate(op.cond) === true ? op.then : op.else;
      if (program?.length) childFrame(state, frame, { program });
      return;
    }
    case 'for_each': {
      const entities = selectVM(state, op.select, context);
      if (!entities.length) return;
      const { from, of = 'target' } = op.select;
      const items = entities.map(entity => entityRef(state, entity, from, context[of], context));
      childFrame(state, frame, { kind: 'loop', from, bind: op.bind ?? null, items, program: op.body });
      return;
    }
    case 'ask': askInstruction(state, frame, op, context, host, options); return;
    default: {
      if (!Object.hasOwn(host.ops, op.op)) throw new Error(`未知 Opcode ${op.op}`);
      host.ops[op.op]({ state, frame, op, context, evaluate, vars, options, host,
        select: selector => selectVM(state, selector, context),
        push: spec => pushFrame(state, spec), branch: program => childFrame(state, frame, { program }),
      });
    }
  }
}

export function stepVM(state, host, options = {}) {
  const vm = state.vm;
  while (vm.stack.length && !vm.pendingAsk) {
    const frame = vm.stack.at(-1);
    if (vm.stepsRemaining-- <= 0 || vm.stack.length > maxDepth) {
      host.log(state, own(state.units, frame.ownerId), 'vm_halt', '结算超过指令步数或栈深限制，已中止本次结算');
      vm.stack.length = 0;
      break;
    }
    if (frame.rule && !frame.entered) {
      frame.entered = true;
      const { rule, useKey } = frame;
      if ((rule.filter !== undefined && evaluateExpr(rule.filter, contextFor(state, frame, host)) !== true)
          || host.enterRule?.(state, frame, useKey) === false) {
        vm.stack.pop();
        continue;
      }
    }
    // Native frames are data continuations for combat physics. Their handlers live outside state.
    if (frame.native) {
      host.continue({ state, frame, host, options, context: contextFor(state, frame, host) });
      continue;
    }
    if (frame.kind === 'loop') {
      if (frame.pc >= frame.items.length) vm.stack.pop();
      else stepLoop(state, frame);
      continue;
    }
    if (frame.pc >= frame.program.length) {
      vm.stack.pop();
      continue;
    }
    const op = frame.program[frame.pc++];
    if (op.enabled !== false) execute(state, frame, op, host, options);
  }
  pruneEvents(vm);
  return { pendingAsk: vm.pendingAsk, conditional: options.conditional === true };
}
