/**
 * Normalize admin dialog header close buttons to:
 *   class="admin-dialog-close" + × + 关闭 + aria-label + title
 */
const fs = require('fs');
const path = require('path');

const dir = path.join('src/main/resources/static/page/end');
const CSS_VER = '20260728c';

function extractAttr(attrs, name) {
  const re = new RegExp(
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|(\\{[^}]*\\}|[^\\s>]+))',
    'i'
  );
  const m = attrs.match(re);
  if (!m) return null;
  return m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
}

function hasAttr(attrs, name) {
  return new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(attrs);
}

function stripAttr(attrs, name) {
  return attrs
    .replace(
      new RegExp(
        '\\s*' +
          name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|\\{[^}]*\\}|[^\\s>]+)',
        'gi'
      ),
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCloseButton(attrs, content) {
  const text = content.replace(/\s+/g, ' ').trim();
  // only transform close-like buttons
  if (!(text === '关闭' || text === '×' || text === 'x' || text === 'X' || text === '')) {
    // empty content with only whitespace already trimmed - reject non-close
    if (!/^[×xX关闭\s]*$/.test(content) || !content.includes('关闭') && !/[×xX]/.test(content)) {
      return null;
    }
  }

  let a = attrs || '';
  // ensure type=button
  if (!hasAttr(a, 'type')) {
    a = 'type="button" ' + a;
  }

  // class merge
  const existingClass = extractAttr(a, 'class');
  a = stripAttr(a, 'class');
  const cls = existingClass
    ? existingClass.includes('admin-dialog-close')
      ? existingClass
      : existingClass + ' admin-dialog-close'
    : 'admin-dialog-close';
  a = `class="${cls}" ` + a;

  // title
  if (!hasAttr(a, 'title')) {
    a += ' title="关闭"';
  }

  // aria-label fallback from existing or generic
  if (!hasAttr(a, 'aria-label')) {
    a += ' aria-label="关闭弹窗"';
  }

  a = a.replace(/\s+/g, ' ').trim();

  return (
    `<button ${a}>` +
    `<span class="admin-dialog-close-icon" aria-hidden="true">×</span>` +
    `<span class="admin-dialog-close-text">关闭</span>` +
    `</button>`
  );
}

function transformHtml(html, file) {
  let count = 0;
  // Pattern: first child div of head, then button that is the close control
  // Works for minified and pretty HTML.
  const re =
    /(<div\s+class="admin-dialog-head"[^>]*>\s*<div\b[\s\S]*?<\/div>\s*)(<button\b)([^>]*)>([\s\S]*?)<\/button>/gi;

  const out = html.replace(re, (full, prefix, btnOpen, attrs, content) => {
    const next = buildCloseButton(attrs, content);
    if (!next) return full;
    count += 1;
    return prefix + next;
  });

  // bump css version query for cache bust when present
  let withVer = out.replace(
    /admin-workspace\.css\?v=[^"']+/g,
    `admin-workspace.css?v=${CSS_VER}`
  );
  withVer = withVer.replace(
    /product-ui\.css\?v=[^"']+/g,
    `product-ui.css?v=${CSS_VER}`
  );

  return { html: withVer, count };
}

let total = 0;
const report = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  const { html, count } = transformHtml(src, f);
  if (html !== src) {
    fs.writeFileSync(p, html, 'utf8');
  }
  total += count;
  report.push(`${f}: ${count}`);
}
console.log(report.join('\n'));
console.log('TOTAL_FIXED=' + total);
