#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_ROOT = path.join(ROOT, 'src', 'main', 'resources', 'static', 'page', 'end');
const VERSION_FILE = path.join(__dirname, 'admin-asset-version.txt');
const PAGES = [
  'account.html',
  'admin_agent.html',
  'adopt.html',
  'animal.html',
  'help.html',
  'index.html',
  'notice.html',
  'operations.html',
  'permission.html',
  'person.html',
  'proof.html',
  'role.html',
  'user.html',
  'visit.html',
  'volunteer.html'
];
const ASSET_PATTERNS = [
  { name: 'product-ui.css', required: true, regex: /product-ui\.css\?v=([A-Za-z0-9._-]+)/g },
  { name: 'admin-workspace.css', required: true, regex: /admin-workspace\.css\?v=([A-Za-z0-9._-]+)/g },
  { name: 'admin-auth.js', required: true, regex: /admin-auth\.js\?v=([A-Za-z0-9._-]+)/g },
  { name: 'ui-icons.svg', required: false, regex: /ui-icons\.svg\?v=([A-Za-z0-9._-]+)/g }
];

function readVersion() {
  return fs.readFileSync(VERSION_FILE, 'utf8').trim();
}

function validateVersion(version) {
  if (!/^[0-9]{8}[A-Za-z0-9._-]+$/.test(version)) {
    throw new Error(`版本号格式无效：${version}`);
  }
}

function versionsFor(source, pattern) {
  pattern.regex.lastIndex = 0;
  return Array.from(source.matchAll(pattern.regex), match => match[1]);
}

function check(expected) {
  const failures = [];
  const rows = [];
  for (const page of PAGES) {
    const pagePath = path.join(PAGE_ROOT, page);
    const source = fs.readFileSync(pagePath, 'utf8');
    const detail = {};
    for (const pattern of ASSET_PATTERNS) {
      const versions = versionsFor(source, pattern);
      detail[pattern.name] = Array.from(new Set(versions));
      if (pattern.required && versions.length === 0) {
        failures.push(`${page}: 缺少 ${pattern.name}`);
      }
      if (versions.some(version => version !== expected)) {
        failures.push(`${page}: ${pattern.name} 存在非当前版本 ${detail[pattern.name].join(', ')}`);
      }
    }
    rows.push({ page, ...detail });
  }
  const result = {
    strict: true,
    expectedVersion: expected,
    pages: PAGES.length,
    passedPages: PAGES.length - new Set(failures.map(item => item.split(':')[0])).size,
    failures,
    rows
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

function setVersion(nextVersion) {
  validateVersion(nextVersion);
  for (const page of PAGES) {
    const pagePath = path.join(PAGE_ROOT, page);
    let source = fs.readFileSync(pagePath, 'utf8');
    for (const pattern of ASSET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      source = source.replace(pattern.regex, `${pattern.name}?v=${nextVersion}`);
    }
    fs.writeFileSync(pagePath, source, 'utf8');
  }
  fs.writeFileSync(VERSION_FILE, `${nextVersion}\n`, 'utf8');
  check(nextVersion);
}

const args = process.argv.slice(2);
if (args[0] === '--set') {
  if (!args[1] || args.length !== 2) {
    throw new Error('用法：node tools/admin-asset-version.cjs --set YYYYMMDDx');
  }
  setVersion(args[1]);
} else if (args.length === 0 || args[0] === '--check') {
  check(readVersion());
} else {
  throw new Error('用法：node tools/admin-asset-version.cjs [--check | --set YYYYMMDDx]');
}
