const shapes = {单体:'single',圆形:'circle',圆:'circle',环形:'ring',环:'ring',扇形:'fan',扇:'fan',锥形:'cone',锥:'cone',直线:'line',线形:'line',线:'line'};
const targets = {敌方:'enemy',敌人:'enemy',敌对:'enemy',友方:'ally',队友:'ally',自身:'self',自己:'self',任意:'any',所有:'any',环境:'cell',格子:'cell'};
const tiers = '贴身|近程|中程|远程|超距';
const distance = new RegExp(`^(?:(${tiers})\\s*[(（]\\s*(\\d+)\\s*[)）]|(\\d+)(?![\\d.]))`);

export function tagEntries(labels) {
  return [].concat(labels ?? []).flatMap(label => String(label).split(/[\[\]【】]/u)).map(tag => tag.trim()).filter(Boolean);
}

export function parseAreaTags(labels) {
  const tags = tagEntries(labels);
  const field = pattern => tags.map(tag => tag.match(pattern)?.[1]).find(value => value != null) ?? null;
  const rangeText = field(/^(?:有效距离|射程)\s*[:：]\s*(.*)$/u);
  const area = field(/^范围\s*[:：]\s*(.*)$/u);
  const rangeMatch = rangeText?.match(distance);
  const areaMatch = area?.match(distance);
  const areaShape = area?.match(/(?:^|[+＋])\s*(圆形?|扇形?|锥形?|环形?|直线|线形?)\s*(?=[(（]|$)/u)?.[1];
  const filter = area?.match(/[(（]\s*([^()（）]+?)\s*[)）]\s*$/u)?.[1];
  const declared = field(/^目标类型\s*[:：]\s*(.*)$/u);
  const number = pattern => {
    const value = field(pattern);
    return value == null ? null : Number(value);
  };
  return {
    range: rangeMatch ? Number(rangeMatch[2] ?? rangeMatch[3]) : null,
    shape: shapes[field(/^(?:形状|范围形状)\s*[:：]\s*(.*)$/u)] ?? shapes[areaShape] ?? shapes[declared] ?? tags.map(tag => shapes[tag]).find(Boolean) ?? (area != null ? 'circle' : null),
    target: targets[field(/^(?:目标|对象|敌友)\s*[:：]\s*(.*)$/u)] ?? targets[filter] ?? targets[declared] ?? tags.map(tag => targets[tag]).find(Boolean) ?? null,
    radius: number(/^(?:半径|范围半径)\s*[:：]\s*(\d+(?:\.\d+)?)\s*格?$/u) ?? (areaMatch ? Number(areaMatch[2] ?? areaMatch[3]) : null),
    width: number(/^(?:宽度|宽)\s*[:：]\s*(\d+(?:\.\d+)?)\s*格?$/u),
    angle: number(/^(?:角度|扇面角度|张角)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:°|度)?$/u),
    innerRadius: number(/^内圈半径\s*[:：]\s*(\d+(?:\.\d+)?)\s*格?$/u),
    missingRange: rangeText != null && !rangeMatch,
    missingRadius: area != null && !areaMatch,
    rangeTier: rangeMatch?.[1] ?? null,
    healing: tags.some(tag => /^核心功能\s*[:：]\s*治疗$/u.test(tag)),
  };
}
