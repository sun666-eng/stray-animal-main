const fs = require('fs');
const path = require('path');
const dir = 'src/main/resources/static/page/end';
const map = {
  'adopt.html': [
    ['@click="detailItem=null" title="关闭" aria-label="关闭弹窗"', '@click="detailItem=null" title="关闭" aria-label="关闭领养详情"'],
    ['@click="cancelVisit" title="关闭" aria-label="关闭弹窗"', '@click="cancelVisit" title="关闭" aria-label="关闭回访录入"'],
    ['@click="actionItem=null" title="关闭" aria-label="关闭弹窗"', '@click="actionItem=null" title="关闭" aria-label="关闭操作确认"'],
  ],
  'proof.html': [
    ['@click="detailItem=null" title="关闭" aria-label="关闭弹窗"', '@click="detailItem=null" title="关闭" aria-label="关闭凭证详情"'],
    ['@click="cancelEdit" title="关闭" aria-label="关闭弹窗"', '@click="cancelEdit" title="关闭" aria-label="关闭凭证编辑"'],
  ],
  'visit.html': [
    ['@click="cancelEdit" title="关闭" aria-label="关闭弹窗"', '@click="cancelEdit" title="关闭" aria-label="关闭回访编辑"'],
  ],
  'user.html': [
    ['@click="cancelEdit" title="关闭" aria-label="关闭弹窗"', '@click="cancelEdit" title="关闭" aria-label="关闭用户编辑"'],
    ['@click="onlineOpen=false" title="关闭" aria-label="关闭弹窗"', '@click="onlineOpen=false" title="关闭" aria-label="关闭在线用户列表"'],
  ],
};

function bumpCss(s) {
  return s
    .replace(/admin-workspace\.css\?v=[^"']+/g, 'admin-workspace.css?v=20260728c')
    .replace(/product-ui\.css\?v=[^"']+/g, 'product-ui.css?v=20260728c');
}

for (const [f, pairs] of Object.entries(map)) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [a, b] of pairs) {
    if (s.includes(a)) {
      s = s.split(a).join(b);
      n++;
    }
  }
  fs.writeFileSync(p, bumpCss(s), 'utf8');
  console.log(f, 'aria-fixes', n);
}

// bump remaining admin pages css version
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, 'utf8');
  const next = bumpCss(s);
  if (next !== s) {
    fs.writeFileSync(p, next, 'utf8');
    console.log('css-bump', f);
  }
}

// permission dialog polish
require('./fix-permission-dialog.cjs');
