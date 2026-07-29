const fs = require('fs');
const path = require('path');
const d = 'src/main/resources/static/page/end';
let totalUse = 0;
const symbolUse = {};
for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.html'))) {
  const c = fs.readFileSync(path.join(d, f), 'utf8');
  const multi = (c.match(/<\/svg>\s*<svg class="ui-icon"/g) || []).length;
  const plainDel = (c.match(/>删除<\/button>/g) || []).length;
  const plainEdit = (c.match(/>编辑<\/button>/g) || []).length;
  const plainDetail = (c.match(/>详情<\/button>/g) || []).length;
  const plainAdd = (c.match(/>新增<\/button>/g) || []).length;
  const doubleTrash = (c.match(/#icon-trash[\s\S]{0,200}#icon-trash/g) || []).length;
  const uses = [...c.matchAll(/#icon-[\w-]+/g)].map((m) => m[0].slice(1));
  totalUse += uses.length;
  for (const u of uses) symbolUse[u] = (symbolUse[u] || 0) + 1;
  if (multi || plainDel || plainEdit || plainDetail || plainAdd || doubleTrash) {
    console.log(f, { multi, plainDel, plainEdit, plainDetail, plainAdd, doubleTrash });
  }
}
const sprite = fs.readFileSync('src/main/resources/static/icons/ui-icons.svg', 'utf8');
const symbols = [...sprite.matchAll(/id="(icon-[\w-]+)"/g)].map((m) => m[1]);
const dup = symbols.filter((s, i) => symbols.indexOf(s) !== i);
const missing = Object.keys(symbolUse).filter((id) => !symbols.includes(id));
console.log('symbols', symbols.length, 'uses', totalUse, 'dup', dup, 'missing', missing);
console.log('by symbol', symbolUse);
