import { STATUSES } from '../presets/status-defaults.js';

const reservedIds = Object.keys(STATUSES).join('、');

export const STATUS_CATALOG = `【VM 状态】
apply_status 只引用当前战局 statusTemplates 中可执行的状态。新状态先添加模板，再引用，ID 与表键一致。原生状态 ID 可直接引用但不能覆盖：${reservedIds}。若同名效果机制不同（例如不会碎冰的冻结），另起英文 ID 如 permafrost_freeze；同批先 add /statusTemplates/permafrost_freeze，再用 apply_status 引用它。
模板必填 id、name。可选 icon（≤24 字符）、category（推荐枚举：buff / debuff / control / dot / hot / shield；护盾吸收机制必须写 category:"shield" 并将护盾量存于 vars.shieldAmount）、description（≤300 字符）、remainingTurns（整数 1…100）、durationType（枚举：battle_turns / until_removed / persistent）、stackMode（枚举：refresh / stack / replace / extend）、maxStacks（整数 1…999999 或数值表达式；施加时在施术者上下文求值）、expireOn（{hook, filter?}，hook 取允许钩子枚举，filter 为布尔表达式）、flags（枚举数组：undispellable / concept_immune）、tags（小写标签数组）、tier（整数 1…7）、vars、mods、rules。省略期限和叠层字段时默认为 battle_turns、1 回合、refresh、1 层。
周期伤害和治疗用 turn_start 或 turn_end 规则，状态自然到期触发的后置效果／反噬直接写在该状态模板自身的 after_status_removed 规则（filter:"event.statusId == status.id && event.reason == 'expired'"），持续限制用 mods.locks，数值修饰用 mods，护盾用 category:"shield"，护盾量存于 vars.shieldAmount。apply_status 可按施加上下文求值 vars，并指定 turns、stacks、stackMode、extendTurns 或 expireOn。remove_status 的 where 可读取 status.id、status.category 等注册字段。
需要直接添加初始状态时，在 /units/<unitId>/statuses/<statusId> 写入闭合实例，必填 id、templateId（均等于状态 ID）、ownerId（等于单位 ID）、name（须与状态模板 name 完全一致）、remainingTurns（整数 1…100，persistent 也必填正整数如 1）、durationType、stackMode、maxStacks（正整数）、stacks（整数 1…maxStacks），可选 sourceId（单位 ID 或 null）等模板字段；实例 vars 写已求值的 JSON 值。`;
