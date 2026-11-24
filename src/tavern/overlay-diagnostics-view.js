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

const DIAGNOSTIC_GROUPS = Object.freeze([
  ['autoAdjusted', '自动适配'], ['pending', '待处理'], ['approximated', '近似'],
  ['needsAttention', '需关注'], ['nonCombat', '非战斗'],
]);

export function diagnosticGroups(diagnostics = {}) {
  return DIAGNOSTIC_GROUPS.map(([key, title]) => ({
    key, title, entries: Array.isArray(diagnostics[key]) ? diagnostics[key] : [],
  }));
}

export function diagnosticCount(diagnostics = {}) {
  return diagnosticGroups(diagnostics).reduce((total, group) => total + group.entries.length, 0);
}

export function diagnosticSummary(diagnostics = {}) {
  return diagnosticGroups(diagnostics).map(group => `${group.title} ${group.entries.length}`).join(' · ');
}

export function diagnosticEntry(doc, entry, index = 0) {
  const row = doc.createElement('div');
  row.className = 'fated-tavern-diagnostic-entry';
  row.dataset.diagnosticIndex = String(index);
  const textNode = doc.createElement('span');
  textNode.className = 'fated-tavern-diagnostic-entry-text';
  textNode.textContent = diagnosticText(entry);
  row.append(textNode);
  if (entry && typeof entry === 'object' && entry.originPath) {
    const path = doc.createElement('code');
    path.className = 'fated-tavern-diagnostic-entry-path';
    path.textContent = entry.originPath;
    row.append(path);
  }
  return row;
}

export function diagnosticGroupView(doc, group, { open = false } = {}) {
  const details = doc.createElement('details');
  details.className = 'fated-tavern-diagnostic-group';
  details.dataset.diagnosticGroup = group.key;
  details.open = open;
  const summary = doc.createElement('summary');
  summary.className = 'fated-tavern-diagnostic-title';
  summary.textContent = `${group.title} (${group.entries.length})`;
  details.append(summary);
  const body = doc.createElement('div');
  body.className = 'fated-tavern-diagnostic-list';
  group.entries.forEach((entry, index) => body.append(diagnosticEntry(doc, entry, index)));
  details.append(body);
  return details;
}

export function renderDiagnosticGroups(doc, diagnostics = {}) {
  const root = doc.createElement('section');
  root.className = 'fated-tavern-diagnostics';
  for (const group of diagnosticGroups(diagnostics)) {
    root.append(diagnosticGroupView(doc, group, { open: group.key === 'pending' || group.key === 'needsAttention' }));
  }
  return root;
}

export function progressRatio(value, max = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

export function progressLabel(value, max = 1) {
  return `${Math.round(progressRatio(value, max) * 100)}%`;
}

export function diagnosticProgress(doc, label, value, max = 1) {
  const wrap = progressView(doc, `${label} ${progressLabel(value, max)}`, value, max);
  wrap.dataset.progress = progressLabel(value, max);
  return wrap;
}
