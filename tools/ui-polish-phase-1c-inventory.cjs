const fs = require('fs');
const path = require('path');

const roots = [
  'src/main/resources/static/page/end',
  'src/main/resources/static/page/front'
];
const files = [];
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.html$/i.test(n)) files.push(p);
  }
}
roots.forEach(walk);

const items = [];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  const rx = /<button(\s[^>]*)?>/gi;
  let m;
  while ((m = rx.exec(c))) {
    const tag = m[0];
    const cls = (tag.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const type = (tag.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const disabled = /\bdisabled\b/.test(tag);
    const aria = (tag.match(/aria-label\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const rest = c.slice(m.index, m.index + 240);
    const text = ((rest.match(/>([\s\S]*?)<\/button>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    const line = c.slice(0, m.index).split(/\n/).length;
    const before = c.slice(Math.max(0, m.index - 400), m.index);
    const inTable = /admin-row-actions|admin-card-actions|ui-page-buttons|admin-help-card-actions/.test(before + rest);
    const inDialog = /admin-dialog|role="dialog"|role='dialog'|alertdialog/.test(before);
    const danger = /删除|清空|驳回|拒绝|停用|danger|is-danger|确认删除|确认清空/.test(text + cls + aria);
    const iconOnly = !text || text.length <= 2 || /[☰×⌄‹›]/.test(text);
    let semantic = 'secondary';
    if (/is-primary/.test(cls) || /保存|提交|确认|新增|创建/.test(text)) semantic = 'primary';
    if (/is-dark/.test(cls)) semantic = 'dark';
    if (/is-ghost/.test(cls) || /取消|返回|详情|刷新|查询|清除/.test(text)) semantic = 'ghost';
    if (danger && /确认/.test(text)) semantic = 'danger-confirm';
    else if (danger) semantic = 'danger-entry';
    if (iconOnly) semantic = 'icon-only';
    if (/is-danger/.test(cls) && !/确认/.test(text)) semantic = 'danger-entry';
    items.push({
      page: path.relative('src/main/resources/static', f).replace(/\\/g, '/'),
      line,
      type,
      class: cls,
      text,
      aria,
      disabled,
      inTable,
      inDialog,
      danger,
      iconOnly,
      suggested: semantic
    });
  }
}

const byClass = {};
for (const i of items) {
  const k = i.class || '(none)';
  byClass[k] = (byClass[k] || 0) + 1;
}
const topClasses = Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 50);
const byPage = {};
for (const i of items) {
  byPage[i.page] = (byPage[i.page] || 0) + 1;
}

const outDir = 'output/playwright/ui-polish-phase-1c';
fs.mkdirSync(outDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  buttonCount: items.length,
  topClasses,
  byPage,
  dangerCount: items.filter((i) => i.danger).length,
  iconOnlyCount: items.filter((i) => i.iconOnly).length,
  disabledCount: items.filter((i) => i.disabled).length,
  tableCount: items.filter((i) => i.inTable).length,
  dialogCount: items.filter((i) => i.inDialog).length,
  noClassCount: items.filter((i) => !i.class).length,
  items
};
fs.writeFileSync(path.join(outDir, 'button-inventory.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  buttonCount: report.buttonCount,
  dangerCount: report.dangerCount,
  iconOnlyCount: report.iconOnlyCount,
  noClassCount: report.noClassCount,
  tableCount: report.tableCount,
  dialogCount: report.dialogCount,
  topClasses: topClasses.slice(0, 20),
  byPage
}, null, 2));
