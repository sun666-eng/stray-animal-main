/**
 * Phase 4C — static API inventory from Controllers + AuthInterceptor public rules.
 * Output: output/playwright/release-phase-4c/api-inventory.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ctrlDir = path.join(root, 'src/main/java/com/example/controller');
const authPath = path.join(root, 'src/main/java/com/example/common/AuthInterceptor.java');
const outDir = process.env.E2E4C_OUT
  ? path.resolve(process.env.E2E4C_OUT)
  : path.join(root, 'output/playwright/release-phase-4c');
fs.mkdirSync(outDir, { recursive: true });

function listJava(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.java')).map(f => path.join(dir, f));
}

function extractBase(content) {
  const m = content.match(/@RequestMapping\s*\(\s*["']([^"']+)["']\s*\)/);
  return m ? m[1] : '';
}

function extractMappings(content, file) {
  const base = extractBase(content);
  const lines = content.split(/\r?\n/);
  const apis = [];
  const methodMap = {
    GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT',
    DeleteMapping: 'DELETE', PatchMapping: 'PATCH'
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [ann, http] of Object.entries(methodMap)) {
      const re = new RegExp('@' + ann + '(?:\\s*\\(([^)]*)\\))?');
      const m = line.match(re);
      if (!m) continue;
      let sub = '';
      const args = m[1] || '';
      const pathM = args.match(/["']([^"']*)["']/);
      if (pathM) sub = pathM[1];
      // RequestMapping with method=
      let methods = [http];
      if (ann === 'RequestMapping' || line.includes('RequestMapping')) {
        // handled below
      }
      const full = (base + (sub.startsWith('/') ? sub : (sub ? '/' + sub : ''))).replace(/\/+/g, '/') || base;
      // find method name
      let name = '';
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const mm = lines[j].match(/(?:public|protected)\s+\S+\s+(\w+)\s*\(/);
        if (mm) { name = mm[1]; break; }
      }
      apis.push({
        method: http,
        path: full || base,
        subPath: sub,
        basePath: base,
        handler: name,
        controller: path.basename(file),
        line: i + 1,
        file: path.relative(root, file).replace(/\\/g, '/')
      });
    }
    // @RequestMapping(value="/x", method={...})
    const rm = line.match(/@RequestMapping\s*\(([^)]*)\)/);
    if (rm && !line.includes('@RequestMapping("/api')) {
      const args = rm[1];
      if (/method\s*=/.test(args)) {
        let sub = '';
        const pm = args.match(/(?:value|path)\s*=\s*["']([^"']+)["']/) || args.match(/["']([^"']+)["']/);
        if (pm) sub = pm[1];
        const methods = [];
        if (/GET/.test(args)) methods.push('GET');
        if (/POST/.test(args)) methods.push('POST');
        if (/PUT/.test(args)) methods.push('PUT');
        if (/DELETE/.test(args)) methods.push('DELETE');
        if (/HEAD/.test(args)) methods.push('HEAD');
        if (methods.length === 0) methods.push('GET');
        const full = (base + (sub.startsWith('/') ? sub : (sub ? '/' + sub : ''))).replace(/\/+/g, '/');
        let name = '';
        for (let j = i; j < Math.min(i + 8, lines.length); j++) {
          const mm = lines[j].match(/(?:public|protected)\s+\S+\s+(\w+)\s*\(/);
          if (mm) { name = mm[1]; break; }
        }
        for (const http of methods) {
          // skip if already added by GetMapping style on same line
          if (apis.some(a => a.line === i + 1 && a.method === http)) continue;
          apis.push({
            method: http, path: full, subPath: sub, basePath: base,
            handler: name, controller: path.basename(file), line: i + 1,
            file: path.relative(root, file).replace(/\\/g, '/')
          });
        }
      }
    }
  }
  return apis;
}

function classify(api, authSrc) {
  const p = api.path;
  const m = api.method;
  let anonymous = false;
  let loginRequired = true;
  let adminish = false;
  let permissionFlags = [];
  let ownership = false;
  let sensitive = false;
  let isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(m);
  let exportData = /export|template/i.test(p);
  let fileOp = /\/api\/files/.test(p);
  let llm = /pet-care|admin-agent|petcare/i.test(p);

  // Public rules from AuthInterceptor knowledge
  if ((p === '/api/health/live' || p === '/api/health/ready') && (m === 'GET' || m === 'HEAD')) {
    anonymous = true; loginRequired = false;
  }
  if (p === '/api/user/login' || p === '/api/user/register') {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && (p === '/api/animal/page1' || /^\/api\/animal\/\d+$/.test(p))) {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && (p === '/api/notice/page' || /^\/api\/notice\/\d+$/.test(p))) {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && p === '/api/account/public') {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && (p === '/api/dashboard/public-stats' || p === '/api/dashboard/home-stats')) {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && /^\/api\/operations\/animals\/\d+\/medical$/.test(p)) {
    anonymous = true; loginRequired = false;
  }
  if (m === 'GET' && p.startsWith('/api/files/')) {
    anonymous = true; // optional login; controller enforces visibility
    loginRequired = false;
  }

  const flagMap = {
    '/api/user': ['user'], '/api/role': ['role'], '/api/permission': ['permission'],
    '/api/animal': ['animal'], '/api/adopt': ['adopt'], '/api/proof': ['proof'],
    '/api/visit': ['visit'], '/api/volunteer': ['volunteer'], '/api/account': ['account'],
    '/api/notice': ['notice'], '/api/help': ['help', 'rescue'],
    '/api/admin-agent': ['admin_agent']
  };
  for (const [prefix, flags] of Object.entries(flagMap)) {
    if (p === prefix || p.startsWith(prefix + '/')) {
      permissionFlags = flags;
      adminish = ['user', 'role', 'permission', 'admin_agent', 'account', 'notice'].some(f => flags.includes(f))
        || (isWrite && ['animal', 'adopt', 'proof', 'visit', 'volunteer', 'help'].some(f => flags.includes(f)));
      break;
    }
  }
  if (/\/mine|\/my_|profile|notification|favorite|pet-care|ws-ticket/i.test(p)) {
    ownership = true;
    adminish = false;
  }
  if (/password|config|apiKey|key|cipher|phone|wechat|address/i.test(p + api.handler)) {
    sensitive = true;
  }

  let expectedAnon = anonymous ? 200 : 401;
  if (isWrite && anonymous) expectedAnon = 401;
  let expectedUserForbidden = adminish && isWrite ? 403 : null;

  return {
    ...api,
    anonymousAllowed: anonymous,
    loginRequired,
    adminLikely: adminish,
    permissionFlags,
    objectOwnershipLikely: ownership,
    sensitiveFieldsLikely: sensitive,
    isWrite,
    exportData,
    fileOp,
    llm,
    expectedAnonStatus: expectedAnon,
    expectedUserOnAdminWrite: expectedUserForbidden,
    scenarioIdHint: `${m}_${p.replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 80)
  };
}

const authSrc = fs.readFileSync(authPath, 'utf8');
let all = [];
for (const f of listJava(ctrlDir)) {
  const c = fs.readFileSync(f, 'utf8');
  all = all.concat(extractMappings(c, f).map(a => classify(a, authSrc)));
}

// Deduplicate by method+path+line
const seen = new Set();
all = all.filter(a => {
  const k = a.method + ' ' + a.path + ' ' + a.controller + ' ' + a.line;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const inventory = {
  generatedAt: new Date().toISOString(),
  controllerCount: listJava(ctrlDir).length,
  endpointCount: all.length,
  anonymousCount: all.filter(a => a.anonymousAllowed).length,
  writeCount: all.filter(a => a.isWrite).length,
  exportCount: all.filter(a => a.exportData).length,
  fileOpCount: all.filter(a => a.fileOp).length,
  llmCount: all.filter(a => a.llm).length,
  endpoints: all
};

fs.writeFileSync(path.join(outDir, 'api-inventory.json'), JSON.stringify(inventory, null, 2));
console.log('API inventory:', inventory.endpointCount, 'endpoints ->', path.join(outDir, 'api-inventory.json'));
process.exit(0);
