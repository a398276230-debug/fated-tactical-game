import { STATUSES } from '../presets/status-defaults.js';
import { modifierKeys, statusModifierRange } from '../core/status_modifiers.js';

const rows = Object.values(STATUSES).map(status => {
  const modifiers = Object.entries(status.modifiers).map(([key, value]) => `${key}=${value}（${statusModifierRange(key, status)}）`).join('，');
  const expiry = [].concat(status.expireOn ?? []).map(rule => rule.trigger).join('/');
  return [status.id, `${status.icon}${status.name}`, status.category, status.remainingTurns,
    status.tickTiming, `${status.stackRule}/${status.maxStacks}`, modifiers, expiry || '—', status.description].join(' | ');
});

export const STATUS_CATALOG = [
  '默认状态模板：战局 statusTemplates 优先，无同名定义时使用以下模板。未知 ID 必须先注册。',
  'ID | 名称 | 类别 | 默认回合数 | 周期时点 | 叠层规则/上限 | 默认修饰键 | 提前解除事件 | 说明',
  ...rows,
  `所有模板共用的合法修饰键：${modifierKeys.map(key => `${key}（${statusModifierRange(key)}）`).join('、')}。护甲实例覆盖保持模板的正负方向。`,
  '授予和 patchStatus 只覆盖模板已声明的修饰键。声明 modifiers.amount 即拥有护盾池（与类别无关）；实例 amount 是剩余量。多池按状态 ID 顺序扣减。taunted 需要敌对来源。',
  '模板类别：buff/debuff/control/dot/hot/shield。持续类型：battle_turns（自身回合末递减）/until_removed/persistent；后两者不递减。',
].join('\n');
