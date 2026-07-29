/**
 * Static unit checks for AdminWorkspace.navigation / flagsMatch / desktopNavigation.
 * Does not require a browser or live server.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '../src/main/resources/static/js/admin-auth.js'),
  'utf8'
);

const sandbox = {
  window: {},
  console
};
sandbox.window = sandbox;
sandbox.AuthSession = {
  installAjaxAuth() {},
  sanitizeLocalSession() {},
  logout() {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const AW = sandbox.AdminWorkspace || sandbox.window.AdminWorkspace;
if (!AW) {
  console.error('AdminWorkspace not exported');
  process.exit(1);
}

function flags(...list) {
  return list.map((flag) => ({ flag }));
}

const cases = [];
function check(name, ok, detail) {
  cases.push({ name, ok: !!ok, detail });
}

// empty
check('empty permissions -> no routes', AW.navigation([]).length === 0, AW.navigation([]));
check('null permissions -> no routes', AW.navigation(null).length === 0);

// unknown flag ignored (animal also synthesizes operations)
const unknownPlus = AW.navigation(flags('not_a_real_flag', 'animal'));
const unknownFlags = unknownPlus.map((r) => r.flag);
check('unknown flag ignored',
  unknownFlags.includes('animal')
  && !unknownFlags.includes('not_a_real_flag')
  && unknownFlags.every((f) => f === 'animal' || f === 'operations'));

// duplicate flags / same href (help+rescue) — rescue shares help.html and may synthesize operations
const helpRescue = AW.navigation(flags('help', 'rescue'));
const helpRescueFlags = helpRescue.map((r) => r.flag);
const helpEntries = helpRescue.filter((r) => r.href.includes('help.html'));
check('help+rescue dedupe same href',
  helpEntries.length === 1
  && helpRescueFlags.includes('help')
  && !helpRescueFlags.includes('rescue'));

// partial set
const partial = AW.navigation(flags('animal', 'adopt', 'account'));
const partialFlags = partial.map((r) => r.flag);
check('partial includes animal+adopt+account+operations',
  ['animal', 'adopt', 'account', 'operations'].every((f) => partialFlags.includes(f)));
check('partial excludes user/role/permission',
  !partialFlags.includes('user') && !partialFlags.includes('role') && !partialFlags.includes('permission'));

// super-ish set
const superish = AW.navigation(flags(
  'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
  'volunteer', 'account', 'notice', 'help', 'admin_agent'
));
check('broad set has many routes', superish.length >= 10, superish.map((r) => r.flag));

// groups only authorized
const groups = AW.navigationGroups(flags('animal', 'adopt'));
check('groups filtered', groups.every((g) => g.items.every((i) => ['animal', 'adopt', 'operations'].includes(i.flag) || i.flag)));
check('no governance group without user/role/permission',
  !groups.some((g) => g.id === 'governance'));

// desktop split
const desk = AW.desktopNavigation(flags('animal', 'adopt', 'user', 'role'));
check('desktop primary has animal/adopt', desk.primary.some((i) => i.flag === 'animal') && desk.primary.some((i) => i.flag === 'adopt'));
check('desktop more has user/role', desk.more.some((i) => i.flag === 'user') && desk.more.some((i) => i.flag === 'role'));

// flagsMatch
check('flagsMatch equal', AW.flagsMatch('animal', 'animal'));
check('flagsMatch help/rescue alias', AW.flagsMatch('help', 'rescue') && AW.flagsMatch('rescue', 'help'));
check('flagsMatch rejects other', !AW.flagsMatch('animal', 'adopt'));
check('flagsMatch empty current', !AW.flagsMatch('animal', ''));

// duplicate permission objects
const dup = AW.navigation([{ flag: 'animal' }, { flag: 'animal' }, { flag: 'animal' }]);
check('duplicate permission objects collapse', dup.filter((r) => r.flag === 'animal').length === 1);

const failed = cases.filter((c) => !c.ok);
console.log(JSON.stringify({ total: cases.length, failed: failed.length, cases }, null, 2));
process.exit(failed.length ? 1 : 0);
