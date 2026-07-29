const fs = require('fs');
const path = require('path');
const dir = 'src/main/resources/static/page/end';
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  // find buttons immediately after dialog head title blocks or inside head
  const re = /admin-dialog-head[\s\S]{0,500}?<\/button>/g;
  const matches = [...s.matchAll(re)];
  console.log('\n===' + f + ' count=' + matches.length);
  matches.forEach((mm, idx) => {
    const snippet = mm[0].replace(/\s+/g, ' ').slice(0, 280);
    console.log(idx + 1, snippet);
  });
}
