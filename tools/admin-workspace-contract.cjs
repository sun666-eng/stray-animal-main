#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_ROOT = path.join(ROOT, 'src', 'main', 'resources', 'static', 'page', 'end');
const EXPECTED = {
  'account.html': 'command',
  'admin_agent.html': 'agent',
  'adopt.html': 'workflow',
  'animal.html': 'command',
  'help.html': 'workflow',
  'index.html': 'hub',
  'notice.html': 'command',
  'operations.html': 'hub',
  'permission.html': 'command',
  'person.html': 'profile',
  'proof.html': 'command',
  'role.html': 'command',
  'user.html': 'command',
  'visit.html': 'command',
  'volunteer.html': 'command'
};

const failures = [];
const rows = [];
for (const [page, expectedVariant] of Object.entries(EXPECTED)) {
  const source = fs.readFileSync(path.join(PAGE_ROOT, page), 'utf8');
  const main = source.match(/<main\b[^>]*class=["'][^"']*\badmin-main\b[^"']*["'][^>]*>/i);
  const variant = main && main[0].match(/data-workspace-variant=["']([^"']+)["']/i);
  const h1 = source.match(/<h1\b[^>]*id=["']([^"']+)["']/i);
  const labelledHero = h1 && new RegExp(`<section\\b[^>]*aria-labelledby=["']${h1[1]}["']`, 'i').test(source);
  const problems = [];
  if (!main) problems.push('缺少 admin-main');
  if (!variant || variant[1] !== expectedVariant) problems.push(`工作区类型应为 ${expectedVariant}`);
  if (!h1) problems.push('缺少带 id 的页面主标题');
  if (!labelledHero) problems.push('主视觉区未由 h1 标注');
  if (problems.length) failures.push(`${page}: ${problems.join('；')}`);
  rows.push({ page, expectedVariant, actualVariant: variant ? variant[1] : null, ok: problems.length === 0 });
}

const result = {
  strict: true,
  pages: rows.length,
  passedPages: rows.filter(row => row.ok).length,
  failures,
  rows
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
