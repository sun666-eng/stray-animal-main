#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_ROOT = path.join(ROOT, 'src', 'main', 'resources', 'static', 'page', 'front');
const VERSION_FILE = path.join(__dirname, 'front-asset-version.txt');
const PAGES = fs.readdirSync(PAGE_ROOT).filter(name => name.endsWith('.html')).sort();
const ASSETS = [
  { name: 'product-ui.css', required: true, regex: /product-ui\.css\?v=([A-Za-z0-9._-]+)/g },
  { name: 'user-workspace.js', required: true, regex: /user-workspace\.js\?v=([A-Za-z0-9._-]+)/g },
  { name: 'front-shell.js', required: false, regex: /front-shell\.js\?v=([A-Za-z0-9._-]+)/g }
];

function readVersion() {
  return fs.readFileSync(VERSION_FILE, 'utf8').trim();
}

function validateVersion(version) {
  if (!/^[0-9]{8}[A-Za-z0-9._-]+$/.test(version)) throw new Error(`版本号格式无效：${version}`);
}

function matches(source, asset) {
  asset.regex.lastIndex = 0;
  return Array.from(source.matchAll(asset.regex), match => match[1]);
}

function check(expected) {
  const failures = [];
  const rows = [];
  for (const page of PAGES) {
    const source = fs.readFileSync(path.join(PAGE_ROOT, page), 'utf8');
    const detail = {};
    for (const asset of ASSETS) {
      const versions = matches(source, asset);
      detail[asset.name] = Array.from(new Set(versions));
      if (asset.required && versions.length !== 1) failures.push(`${page}: ${asset.name} 应恰好引用一次，实际 ${versions.length}`);
      if (versions.some(version => version !== expected)) failures.push(`${page}: ${asset.name} 存在非当前版本 ${detail[asset.name].join(', ')}`);
    }
    rows.push({ page, ...detail });
  }
  const failedPages = new Set(failures.map(item => item.split(':')[0]));
  const result = { strict: true, expectedVersion: expected, pages: PAGES.length, passedPages: PAGES.length - failedPages.size, failures, rows };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

function setVersion(nextVersion) {
  validateVersion(nextVersion);
  for (const page of PAGES) {
    const file = path.join(PAGE_ROOT, page);
    let source = fs.readFileSync(file, 'utf8');
    for (const asset of ASSETS) {
      asset.regex.lastIndex = 0;
      source = source.replace(asset.regex, `${asset.name}?v=${nextVersion}`);
    }
    fs.writeFileSync(file, source, 'utf8');
  }
  fs.writeFileSync(VERSION_FILE, `${nextVersion}\n`, 'utf8');
  check(nextVersion);
}

const args = process.argv.slice(2);
if (args[0] === '--set' && args[1] && args.length === 2) setVersion(args[1]);
else if (args.length === 0 || (args.length === 1 && args[0] === '--check')) check(readVersion());
else throw new Error('用法：node tools/front-asset-version.cjs [--check | --set YYYYMMDDx]');
