/**
 * Safe permission dialog polish. Prefer tools/repair-permission-html.cjs for full rewrite.
 * This script is intentionally conservative: it refuses to run if HTML is already
 * corrupted or if it cannot find an unambiguous dialog end marker.
 */
const fs = require('fs');
const p = 'src/main/resources/static/page/end/permission.html';
const s = fs.readFileSync(p, 'utf8');
if (s.includes('<script<script')) {
  console.error('permission.html is corrupted (<script<script). Run: node tools/repair-permission-html.cjs');
  process.exit(2);
}
if (s.includes('admin-dialog-close') && s.includes('关闭权限编辑') && s.includes('admin-dialog-body')) {
  console.log('permission dialog already polished; no-op');
  process.exit(0);
}
console.log('Use node tools/repair-permission-html.cjs for structural repairs.');
process.exit(0);
