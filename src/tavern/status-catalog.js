import { STATUSES } from '../presets/status-defaults.js';

const reservedIds = Object.keys(STATUSES).join('、');

export const STATUS_CATALOG = `【VM 状态】
apply_status 只引用当前战局 statusTemplates 中可执行的状态。新状态先添加模板，再引用，ID 与表键一致。原生状态 ID 留给引擎内置机制：${reservedIds}。
模板必填 id、name。可选 icon、category、description、remainingTurns（整数 1…100）、durationType（battle_turns/until_removed/persistent）、stackMode（refresh/stack/replace/extend）、maxStacks（整数 1…10）、tags、tier、vars、mods、rules。expireOn 可省，格式为 {hook, filter?}，filter 是布尔表达式。省略期限和叠层字段时默认为 battle_turns、1 回合、refresh、1 层。
周期伤害和治疗用 turn_start 或 turn_end 规则，持续限制用 mods.locks，数值修饰用 mods，护盾用 category:"shield"，护盾量存于 vars.shieldAmount。apply_status 可按施加上下文求值 vars，并指定 turns、stacks、stackMode、extendTurns 或 expireOn。remove_status 的 where 可读取 status.id、status.category 等注册字段。
需要直接添加初始状态时，在 /units/<unitId>/statuses/<statusId> 写入模板字段，再填 templateId（等于状态 ID）、ownerId（等于单位 ID）、sourceId（单位 ID 或 null）、stacks、remainingTurns、durationType、stackMode。实例 vars 写已求值的 JSON 值。`;
