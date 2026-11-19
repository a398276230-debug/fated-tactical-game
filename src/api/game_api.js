import { buildScenario } from '../presets/scenarios.js';
import { calculatePrebattleResources, protocolDistance } from '../core/prebattle_resources.js';
export { calculatePrebattleResources, protocolDistance };
import { applyAction, currentUnit, preview, refreshOutcome, settleTurn, STATUSES } from '../core/combat.js';
import { chooseAction } from '../core/ai.js';
import { applyCommand } from './commands.js';
import { validateState } from './validation.js';
import { formatBattleReportText } from './battle_report.js';

const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const version = 1;
const battleVersion = 2;
const maxHistory = 2000;
const maxBatch = 32;
const own = (obj, key) => Object.hasOwn(obj, key);
const shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => own(value, key));

// Path segments are arrays, not executable paths or JSON Patch input.
function diff(before, after, path = [], changes = []) {
  if (before === after) return changes;
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && Array.isArray(before) === Array.isArray(after)
    && (!Array.isArray(before) || before.length === after.length)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diff(own(before, key) ? before[key] : undefined, own(after, key) ? after[key] : undefined,
        [...path, Array.isArray(before) ? Number(key) : key], changes);
    }
  } else {
    changes.push({ path, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) });
  }
  return changes;
}

function simulate(base, transaction) {
  const isCommand = transaction?.kind === 'commands';
  if (!shape(transaction, isCommand ? ['kind', 'entries', 'reason'] : ['kind', 'entries']) || !Array.isArray(transaction.entries)
    || transaction.entries.length < 1 || transaction.entries.length > maxBatch) fail('事务格式错误');
  if (isCommand && (typeof transaction.reason !== 'string' || !transaction.reason.trim() || transaction.reason.length > 300)) fail('无效的事务理由');
  const next = copy(base);
  if (transaction.kind === 'actions') {
    for (const action of transaction.entries) {
      if (!action || Object.getPrototypeOf(action) !== Object.prototype
        || Object.values(action).some(v => typeof v !== 'string' && typeof v !== 'boolean' && !Number.isInteger(v))) fail('动作必须由 JSON 字段组成');
      applyAction(next, action);
    }
  } else if (transaction.kind === 'commands') {
    for (const command of transaction.entries) applyCommand(next, command);
    const outcome = refreshOutcome(next);
    validateState(next);
    if (!outcome && (base.outcome || currentUnit(base)?.id !== currentUnit(next)?.id || currentUnit(next)?.hp === 0)) {
      settleTurn(next);
      validateState(next);
    }
  } else fail('未知事务类型');
  return next;
}

export function createGameAPI() {
  let state, origin, revision = 0, serial = 0;
  let frames = [];
  const pending = new Map(), listeners = new Set();
  function current() { return state ?? fail('请先创建战局'); }
  function publish() {
    revision++;
    pending.clear();
    for (const listener of listeners) {
      try { listener(revision); } catch (error) { globalThis.reportError?.(error); }
    }
  }
  function commit(next, transaction) {
    if (frames.length >= maxHistory) fail('战局事务已达上限，请导出战报后重开');
    frames.push({ before: current(), transaction });
    state = next;
    publish();
    return { ok: true, revision };
  }
  function undo() {
    if (!frames.length) return { ok: false, error: '没有可撤销的事务' };
    state = frames.pop().before;
    publish();
    return { ok: true, revision };
  }
  function restore(snapshot) {
    if (!shape(snapshot, ['kind', 'version', 'origin', 'state', 'journal'])
      || snapshot.kind !== 'battle' || ![1, battleVersion].includes(snapshot.version) || !Array.isArray(snapshot.journal)
      || snapshot.journal.length > maxHistory) fail('不支持的战局快照格式');
    validateState(snapshot.origin);
    validateState(snapshot.state);
    // Old moves may now invite reactions. Resume the actual v1 board rather than
    // retroactively applying the new movement rules to the old history.
    if (snapshot.version === 1) {
      origin = state = copy(snapshot.state);
      frames = [];
      publish();
      return { ...api.getStateSummary(), migratedFrom: 1 };
    }
    const start = copy(snapshot.origin), history = [];
    let next = start;
    for (const transaction of snapshot.journal) {
      const entry = copy(transaction);
      const result = simulate(next, entry);
      history.push({ before: next, transaction: entry });
      next = result;
    }
    if (diff(next, snapshot.state).length) fail('快照状态与命令日志重放不一致');
    origin = start;
    state = next;
    frames = history;
    publish();
    return api.getStateSummary();
  }
  const api = {
    calculatePrebattleResources,
    protocolDistance,
    createBattle(scenarioOrImportSnapshot = 'ruins') {
      if (scenarioOrImportSnapshot?.kind === 'battle') return restore(scenarioOrImportSnapshot);
      const next = buildScenario(scenarioOrImportSnapshot);
      validateState(next);
      origin = state = next;
      frames = [];
      publish();
      return api.getStateSummary();
    },
    restoreBattleSnapshot: restore,
    exportBattleSnapshot() {
      return copy({ kind: 'battle', version: battleVersion, origin, state: current(), journal: frames.map(frame => frame.transaction) });
    },
    exportPersistentCarryOver() {
      const s = current();
      return copy({ kind: 'persistent', version,
        units: Object.fromEntries(Object.values(s.units).map(u => [u.id, {
          statuses: Object.fromEntries(Object.entries(u.statuses).filter(([, v]) => v.durationType === 'persistent')),
          weapon: u.weapon, gear: u.gear,
        }])), items: s.items,
        ...(s.statusTemplates && Object.keys(s.statusTemplates).length ? { statusTemplates: s.statusTemplates } : {}) });
    },
    exportBattleReport() {
      const s = current(), rounds = new Map();
      for (const log of s.logs) {
        if (!rounds.has(log.round)) rounds.set(log.round, []);
        rounds.get(log.round).push(log);
      }
      const outcome = { blue: '蓝方胜利', red: '红方胜利', draw: '平局' }[s.outcome] ?? '战斗尚未结束';
      return copy({ version, scenarioId: s.scenarioId, title: s.title, outcome: s.outcome,
        rounds: [...rounds].map(([round, events]) => ({ round, events })), units: api.listUnits(),
        journal: frames.map(frame => frame.transaction),
        summary: `${s.title} · 第 ${s.round} 轮 · ${outcome} · ${s.logs.length} 条事件` });
    },
    exportBattleReportText() {
      const names = new Map(Object.values(origin?.units ?? {}).map(u => [u.id, u.name]));
      for (const frame of frames) {
        if (frame.transaction.kind !== 'commands') continue;
        for (const command of frame.transaction.entries) if (command.type === 'spawn_unit') names.set(command.unit.id, command.unit.name);
      }
      return formatBattleReportText(api.exportBattleReport(), Object.fromEntries(names));
    },
    getStateSummary() {
      const s = current();
      return { revision, scenarioId: s.scenarioId, title: s.title, mode: s.mode, round: s.round,
        currentUnitId: s.order[s.turn] ?? null, order: [...s.order], outcome: s.outcome,
        units: api.listUnits() };
    },
    listStatusTemplates() {
      const s = current();
      return copy({ ...STATUSES, ...s.statusTemplates });
    },
    listUnits() {
      return Object.values(current().units).map(({ id, name, team, x, y, hp, maxHp, ap, statuses, mainHand, offHand, shield, stance, moraleState, swarm, mc, deathrattle }) => ({
        id, name, team, x, y, hp, maxHp, ap, mainHand, offHand, shield, stance, moraleState: moraleState ?? 'steady',
        swarm: swarm ? { count: swarm.count, minimum: swarm.minimum } : null, mc: mc ?? 1, deathrattle: Boolean(deathrattle), statuses: Object.keys(statuses),
      }));
    },
    inspectWeaponSlots(unitId) {
      const s = current();
      if (!own(s.units, unitId)) return null;
      const u = s.units[unitId];
      const item = id => id ? ({ id, ...s.items[id], template: s.equipment[s.items[id]?.templateId] }) : null;
      return copy({ unitId, stance: u.stance, mainHand: item(u.mainHand ?? u.weapon), offHand: item(u.offHand), shield: item(u.shield),
        greatswordMode: u.greatswordMode ?? 'offensive', blockMode: u.blockMode ?? 'normal' });
    },
    setWeaponStance(unitId, stance, options = {}) {
      const s = current();
      if (!own(s.units, unitId)) return { ok: false, error: '未知单位' };
      if (!['light_blade','dual_wield','attunement','greatsword','sword_shield'].includes(stance)) return { ok: false, error: '未知持械姿态' };
      const patch = { stance };
      if (options.greatswordMode !== undefined) patch.greatswordMode = options.greatswordMode;
      if (options.blockMode !== undefined) patch.blockMode = options.blockMode;
      const transaction = { kind: 'commands', entries: [{ type: 'set_unit_stat', unitId, patch }], reason: '切换持械姿态' };
      return commit(simulate(s, transaction), transaction);
    },
    listManeuvers(unitId) {
      const s = current();
      const u = s.units[unitId];
      if (!u) return null;
      return copy(u.maneuvers ?? ['charge','lock_on','scan','cover','guard','interrupt','push','knockback','grapple','disarm','trip','flee','detour']);
    },
    inspectUnit(unitId) {
      const s = current();
      if (!own(s.units, unitId)) return null;
      const unit = s.units[unitId];
      return copy({ ...unit, equipment: [unit.weapon, unit.mainHand, unit.offHand, unit.shield, ...unit.gear].filter(Boolean).filter((id, i, all) => all.indexOf(id) === i).map(id => ({
        ...s.items[id], template: s.equipment[s.items[id].templateId],
      })) });
    },
    listActionLogs(limit = 10) {
      if (!Number.isInteger(limit) || limit < 0 || limit > 200) fail('日志条数须为 0–200 的整数');
      return limit ? copy(current().logs.slice(-limit)) : [];
    },
    getBattleState() { return copy(current()); },
    subscribe(listener) {
      if (typeof listener !== 'function') fail('监听器必须是函数');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    previewAction(action) { return copy(preview(current(), copy(action))); },
    playAction(action) {
      if (!action || Object.getPrototypeOf(action) !== Object.prototype) fail('动作须为普通对象');
      const transaction = { kind: 'actions', entries: [copy(action)] };
      return commit(simulate(current(), transaction), transaction);
    },
    stepEnemy() {
      const s = current();
      if (s.outcome || s.units[s.order[s.turn]]?.team !== 'red') return { ok: false };
      return api.playAction(chooseAction(copy(s)) ?? { type: 'end' });
    },
    proposeCommands(commands, options = {}) {
      try {
        if (!shape(options, ['baseRevision', 'reason']) || options.baseRevision !== revision) fail('版本已变化，请重新试算');
        if (typeof options.reason !== 'string' || !options.reason.trim() || options.reason.length > 300) fail('请填写试算理由（1–300 字）');
        if (!Array.isArray(commands) || commands.length < 1 || commands.length > maxBatch) fail('命令必须是 1–32 条的数组');
        const s = current();
        const isUndo = commands.length === 1 && shape(commands[0], ['type', 'operation'])
          && commands[0].type === 'replay_or_undo' && commands[0].operation === 'undo';
        const transaction = { kind: 'commands', entries: copy(commands), reason: options.reason };
        const next = isUndo ? frames.at(-1)?.before ?? fail('没有可撤销的事务') : simulate(s, transaction);
        const changes = diff(s, next);
        if (!changes.length) fail('命令没有改变战局');
        const proposalId = `p${++serial}`;
        if (pending.size >= 16) pending.delete(pending.keys().next().value);
        pending.set(proposalId, { transaction, next, isUndo, revision });
        return copy({ ok: true, dryRun: true, proposalId, baseRevision: revision, reason: options.reason, diff: changes });
      } catch (error) { return { ok: false, dryRun: true, error: error.message }; }
    },
    commitProposal(proposalId) {
      const p = pending.get(proposalId);
      if (!p || p.revision !== revision) return { ok: false, error: '提案不存在或已过期，请重新试算' };
      try { return p.isUndo ? undo() : commit(p.next, p.transaction); }
      catch (error) { return { ok: false, error: error.message }; }
    },
    undoLastCommit: undo,
  };
  return Object.freeze(api);
}

export const GameAPI = createGameAPI();
if (typeof window !== 'undefined') window.FatedTacticalGame = GameAPI;
