const own = (table, key) => table && Object.hasOwn(table, key) ? table[key] : undefined;

export function vmAttribution(state) {
  const stack = state.vm?.stack ?? [];
  const ruleFrame = [...stack].reverse().find(frame => frame.ruleId);
  if (!ruleFrame) return null;
  const carrier = ruleFrame.carrier;
  const skillId = carrier?.type === 'skill' ? carrier.id : null;
  const skill = skillId ? own(state.skills, skillId) : null;
  const ruleId = ruleFrame.ruleId;
  const item = carrier?.type === 'item' ? own(state.items, carrier.id) : null;
  const template = own(state.equipment, item?.templateId);
  const status = carrier?.type === 'status' ? own(own(state.units, carrier.ownerId)?.statuses, carrier.id) : null;
  const zone = carrier?.type === 'zone' ? own(state.zones, carrier.id) : null;
  const rule = stack.findLast(frame => frame.ruleId === ruleId && frame.rule)?.rule
    ?? [skill, item, template, status, zone].flatMap(entity => entity?.rules ?? []).find(rule => rule.id === ruleId);
  const carrierName = template?.name ?? status?.name ?? zone?.name;
  // The bottom-most action is the original action. Nested perform/replay frames
  // must not replace it in the causal explanation.
  const actionFrame = stack.find(frame => {
    const event = own(state.vm.events, frame.eventRef);
    return ['attack', 'skill', 'move'].includes(event?.actionType);
  });
  const actionEvent = actionFrame ? own(state.vm.events, actionFrame.eventRef) : null;
  return {
    carrierType: carrier?.type ?? 'rule',
    ...(skillId ? { skillId, skillName: skill?.name ?? skillId } : {}),
    ...(carrierName ? { carrierName } : {}),
    ruleId,
    ...(rule?.label || rule?.name ? { ruleName: rule.label ?? rule.name } : {}),
    ...(actionEvent ? {
      action: {
        type: actionEvent.actionType,
        ...(actionEvent.skillId ? { skillId: actionEvent.skillId, skillName: own(state.skills, actionEvent.skillId)?.name ?? actionEvent.skillId } : {}),
      },
    } : {}),
  };
}

export function attributionLine(detail) {
  const a = detail?.attribution;
  if (!a) return '';
  const source = a.skillName ? `技能「${a.skillName}」` : a.carrierName ? `${({item:'装备',status:'状态',zone:'区域'})[a.carrierType] ?? '效果'}「${a.carrierName}」` : '';
  const action = a.action?.skillName ?? ({ attack: '普通攻击', move: '移动', skill: '技能施放' })[a.action?.type];
  return `触发来源：${source}${source ? '·' : ''}${a.ruleName ?? a.ruleId}${action ? `（源行动：${action}）` : ''}`;
}

export function choiceProse(choice, chooser, targetName) {
  const answer = choice.kind === 'number' ? proseNumber(choice.value) : choice.label;
  const title = `${chooser}${choice.automatic ? '自动选择' : '选择'}「${choice.prompt}」：${answer}`;
  const { commit } = choice;
  const lines = [];
  if (commit) {
    const kind = { damage: '伤害', heal: '治疗', resource: '资源变动' }[commit.kind];
    if (kind) {
      const target = commit.targetId && targetName(commit.targetId);
      const resource = commit.kind === 'resource' && commit.pool ? ` · ${commit.pool.toUpperCase()}` : '';
      const amount = Number.isFinite(commit.amount) ? `，待结算 ${proseNumber(commit.amount)}` : '';
      lines.push(`${target ? `对${target}的` : ''}${kind}${resource}${amount}`);
    }
  }
  if (choice.kind === 'number') lines.push(`可选范围 ${proseNumber(choice.min)} 至 ${proseNumber(choice.max)}`);
  return { title, lines };
}

export function proseNumber(value) {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  return Number(value.toFixed(6)).toString();
}

export function normalizeProse(text) {
  return typeof text === 'string'
    ? text.replace(/-?\d+\.\d{3,}/g, value => proseNumber(Number(value)))
    : text;
}
