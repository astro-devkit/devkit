// DevKit v4 accuracy tests.
// Runs the actual page script in a Node VM (no DOM needed for compute),
// then checks every NEW v4 calculator against independent reference values.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('No <script> block found'); process.exit(1); }

const sandbox = {
  document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} },
  window: {},
  console
};
vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

const CALCS = sandbox.CALCS;
if (!CALCS || !Array.isArray(CALCS)) { console.error('CALCS not exposed'); process.exit(1); }

let pass = 0, fail = 0;
function check(name, actual, expected, tol = 0.01) {
  const a = typeof actual === 'string' ? parseFloat(actual.replace(/[^0-9.\-]/g, '')) : actual;
  const ok = typeof expected === 'string'
    ? actual === expected
    : Math.abs(a - expected) <= tol;
  if (ok) { pass++; console.log('  PASS', name, '=>', actual); }
  else { fail++; console.log('  FAIL', name, '=> got', actual, 'expected', expected); }
}
function calc(id) {
  const c = CALCS.find(x => x.id === id);
  if (!c) { fail++; console.log('  FAIL missing calc:', id); return null; }
  return c;
}
function run(id, inputs) {
  const c = calc(id);
  if (!c) return null;
  const out = c.compute(inputs);
  return out;
}

console.log('Total calculators:', CALCS.length);

// ---- finance ----
let o = run('loan', {p: 20000, rate: 5, years: 5});
check('loan 20000 @5% 5y', o.main, '$377.42/mo');
check('loan total', o.sub, 'Total $22,645.48 · Interest $2,645.48 · Principal + interest only');

o = run('retirement', {p: 0, pmt: 500, rate: 7, years: 30});
check('retirement FV', o.main, '$609,985.50');
check('retirement growth', o.sub, 'You put in $180,000.00 · Growth $429,985.50');

o = run('roi', {cost: 1000, gain: 1300});
check('roi 1000->1300', o.main, '30.0%');

o = run('breakeven', {fixed: 10000, price: 50, varc: 30});
check('breakeven 10000/(50-30)', o.main, '500 units');

o = run('margin', {rev: 1000, cost: 700});
check('margin (1000-700)/1000', o.main, '30.0%');

o = run('markup', {cost: 50, pct: 40});
check('markup 50 +40%', o.main, '$70.00');

// ---- health ----
o = run('macros', {cal: 2000, pp: 30, cp: 40, fp: 30});
check('macros protein', o.main, 'Protein 150 g');
check('macros carbs/fat', o.sub, 'Carbs 200 g · Fat 67 g');

o = run('water', {kg: 70});
check('water 70kg', o.main, '2.45 L/day');

o = run('onerepmax', {w: 100, reps: 5});
check('1rm 100kg x5', o.main, '116.7 kg');

o = run('hrzones', {age: 30});
check('hr max age 30', o.main, 'Max 190 bpm');
check('hr zone 2', o.sub, 'Zone 2 (fat burn) 114–133 bpm · Zone 4 152–171 bpm');

o = run('sleep', {wake: '07:00'});
check('sleep 6 cycles before 07:00', o.main, '21:45 · 6 cycles');
check('sleep other cycles', o.sub, '5 cycles 23:15 · 4 cycles 00:45 · 3 cycles 02:15');

// ---- math ----
o = run('gpa', {grades: 'A:3, B:3'});
check('gpa A:3 B:3', o.main, 'GPA 3.50');

o = run('gpa', {grades: 'A:3, XX:3, B:3'});
check('gpa skips invalid grade', o.main, 'GPA 3.50');
check('gpa skipped sub', o.sub, '6 credits · Skipped 1 entry');

o = run('quadratic', {a: 1, b: -3, c: 2});
check('quadratic x^2-3x+2', o.main, 'x = 2.00 or 1.00');

o = run('gcdlcm', {a: 12, b: 18});
check('gcd/lcm 12,18', o.main, 'GCD 6 · LCM 36');

o = run('power', {base: 2, exp: 10});
check('power 2^10', o.main, '1,024');

// ---- convert ----
o = run('volume', {value: 1, from: 'gal', to: 'L'});
check('volume 1 gal -> L', o.main, '3.7854 L');

o = run('areaunits', {value: 1, from: 'acre', to: 'm2'});
check('area 1 acre -> m2', o.main, '4,046.8600 m²');

o = run('timeunits', {value: 1, from: 'wk', to: 's'});
check('time 1 week -> s', o.main, '604,800 s');

o = run('cooking', {value: 1, ing: 'flour', dir: 'c2g'});
check('cooking 1 cup flour -> g', o.main, '120.0 g');

sandbox.RATES = {USD: 1, EUR: 0.92, GBP: 0.79};
o = run('currency', {amount: 100, from: 'USD', to: 'EUR'});
check('currency 100 USD -> EUR @0.92', o.main, '92.00 EUR');

// ---- everyday ----
o = run('pace', {dist: 10, unit: 'km', mins: 50});
check('pace 10km in 50min', o.main, '5:00 /km');

o = run('paint', {area: 40, cov: 10, coats: 2});
check('paint 40m2 2 coats', o.main, '8.00 L');

o = run('concrete', {len: 3, wid: 2, dep: 0.1});
check('concrete 3x2x0.1', o.main, '0.60 m³');
check('concrete bags', o.sub, '48 × 25 kg bags');

o = run('recipe', {from: 4, to: 6, amt: 200});
check('recipe 4->6 servings 200g', o.main, '300 g');

// ---- structure: every calculator must have required fields and sane defaults ----
let bad = 0;
for (const c of CALCS) {
  if (!c.id || !c.name || !c.cat || !c.f || !Array.isArray(c.inputs) || typeof c.compute !== 'function') {
    fail++; bad++; console.log('  FAIL structure:', c.id || '(no id)');
    continue;
  }
  try {
    const defaults = {};
    for (const inp of c.inputs) defaults[inp.k] = inp.def;
    const r = c.compute(defaults);
    if (!r || typeof r.main !== 'string') { fail++; bad++; console.log('  FAIL defaults:', c.id); }
  } catch (e) { fail++; bad++; console.log('  FAIL defaults threw:', c.id, e.message); }
}
if (!bad) { pass++; console.log('  PASS all 45 calculators have valid structure and run on defaults'); }

console.log(`\n${pass} passed, ${fail} failed (of ${pass + fail})`);
process.exit(fail ? 1 : 0);
