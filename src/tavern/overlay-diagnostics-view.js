import { tavernTheme } from './theme.js';

export function style(doc) {
  const installed = doc.querySelector('style[data-fated-tavern-overlay]');
  if (installed) {
    installed.textContent = tavernTheme;
    return;
  }
  const node = doc.createElement('style');
  node.setAttribute('data-fated-tavern-overlay', '');
  node.textContent = tavernTheme;
  (doc.head || doc.documentElement)?.append(node);
}

export function diagnosticGroup(doc, title, entries = [], { open = false } = {}) {
  const details = doc.createElement('details');
  details.className = 'fated-tavern-diagnostic-group';
  if (open) details.open = true;
  const summary = doc.createElement('summary');
  summary.className = 'fated-tavern-diagnostic-title';
  summary.textContent = `${title} (${entries.length})`;
  details.append(summary);
  const list = doc.createElement('ul');
  list.className = 'fated-tavern-diagnostic-list';
  for (const entry of entries) {
    const item = doc.createElement('li');
    item.textContent = typeof entry === 'string' ? entry : entry?.message ?? JSON.stringify(entry);
    list.append(item);
  }
  details.append(list);
  return details;
}

export function progressView(doc, label, value, max = 1) {
  const wrap = doc.createElement('div');
  wrap.className = 'fated-tavern-progress';
  const text = doc.createElement('span');
  text.textContent = label;
  const meter = doc.createElement('progress');
  meter.max = max;
  meter.value = Math.max(0, Math.min(max, value));
  meter.setAttribute('aria-label', label);
  wrap.append(text, meter);
  return wrap;
}

export function diagnosticView(doc, diagnostics = {}) {
  const root = doc.createElement('section');
  root.className = 'fated-tavern-diagnostics';
  root.append(
    diagnosticGroup(doc, '自动适配', diagnostics.autoAdjusted ?? []),
    diagnosticGroup(doc, '待处理', diagnostics.pending ?? [], { open: true }),
    diagnosticGroup(doc, '近似', diagnostics.approximated ?? []),
    diagnosticGroup(doc, '需关注', diagnostics.needsAttention ?? []),
    diagnosticGroup(doc, '非战斗', diagnostics.nonCombat ?? []),
  );
  return root;
}

export function diagnosticText(diagnostic) {
  if (typeof diagnostic === 'string') return diagnostic;
  return diagnostic?.userSummary ?? diagnostic?.message ?? diagnostic?.reason ?? '';
}

export function diagnosticsPayload(diagnostics = {}) {
  return Object.fromEntries(Object.entries(diagnostics).map(([key, value]) => [key, Array.isArray(value) ? value.map(diagnosticText) : value]));
}
