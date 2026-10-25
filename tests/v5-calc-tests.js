// DevKit v5 accuracy tests.
// Runs the actual page script in a Node VM (no DOM needed for compute),
// then checks the NEW v5 calculators and the unit-switching changes
// against independent reference values.
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
function check(name, actual, expected) {
  const ok = actual === expected;
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
  return c.compute(inputs);
}

console.log('Total calculators:', CALCS.length);

// ---- LLM cost calculator ----
// Sonnet 4.5: 1M uncached in ($3.00) + 1M cached ($0.30) + 0 write + 500k out ($7.50) = $10.80
let o = run('llmcost', {model: 'sonnet45', pin: 3, pread: 0.3, pwrite: 0, pout: 15, tin: 1000000, tcached: 1000000, twrite: 0, tout: 500000, reqs: 1});
check('llmcost sonnet 4.5, 1 req', o.main, '$10.80');
check('llmcost sonnet 4.5 breakdown', o.sub, '$10.8000 / request · input $3.0000 + cached $0.3000 + write $0.0000 + output $7.5000');

o = run('llmcost', {model: 'sonnet45', pin: 3, pread: 0.3, pwrite: 0, pout: 15, tin: 1000000, tcached: 1000000, twrite: 0, tout: 500000, reqs: 100});
check('llmcost sonnet 4.5, 100 reqs', o.main, '$1,080.00');

// Cache-write billing (Anthropic): 100k write tokens at $3.75/M = $0.375
o = run('llmcost', {model: 'sonnet45', pin: 3, pread: 0.3, pwrite: 3.75, pout: 15, tin: 0, tcached: 0, twrite: 100000, tout: 0, reqs: 1});
check('llmcost cache-write only', o.main, '$0.38');
check('llmcost cache-write breakdown', o.sub, '$0.3750 / request · input $0.0000 + cached $0.0000 + write $0.3750 + output $0.0000');

// Custom model: 2M in @ $2 + 1M out @ $10 = $14.00
o = run('llmcost', {model: 'custom', pin: 2, pread: 0.2, pwrite: 0, pout: 10, tin: 2000000, tcached: 0, twrite: 0, tout: 1000000, reqs: 1});
check('llmcost custom model', o.main, '$14.00');

// GPT-6.1 Sol preset: 100k in @ $2 + 1M cached @ $0.10 + 50k out @ $10 = $0.20 + $0.10 + $0.50 = $0.80
o = run('llmcost', {model: 'gpt61sol', pin: 0, pread: 0, pwrite: 0, pout: 0, tin: 100000, tcached: 1000000, twrite: 0, tout: 50000, reqs: 1});
check('llmcost gpt-6.1 sol preset', o.main, '$0.80');

// ---- tokens/sec simulator ----
// TTFT 2000/2000 = 1.00s, decode 500/50 = 10s, total 11s, effective 2500/11 = 227 tok/s
o = run('toksec', {prefill: 2000, decode: 50, prompt: 2000, out: 500, conc: 1});
check('toksec total time', o.main, 'Total 11.00 s');
check('toksec breakdown', o.sub, 'First token 1.00 s · decode 10.00 s · 227 tok/s effective');

// Concurrency: 4 concurrent requests share the 50 tok/s decode -> 12.5 tok/s each, decode 40s
o = run('toksec', {prefill: 2000, decode: 50, prompt: 2000, out: 500, conc: 4});
check('toksec 4x concurrency total', o.main, 'Total 41.00 s');

// Sub-second TTFT formats as ms: 100/2000 = 0.05s = 50 ms; decode 10/50 = 0.2s = 200 ms; total 250 ms
o = run('toksec', {prefill: 2000, decode: 50, prompt: 100, out: 10, conc: 1});
check('toksec ms formatting', o.main, 'Total 250 ms');

// ---- unit switching: metric / imperial on BMI, BMR, body fat ----
// 154 lb = 69.85 kg, 70 in = 177.8 cm = 1.778 m -> BMI 22.1
o = run('bmi', {units: 'imperial', kg: 154, cm: 70});
check('bmi imperial 154lb 70in', o.main, '22.1');
// metric still works: 70kg, 175cm -> 22.9
o = run('bmi', {units: 'metric', kg: 70, cm: 175});
check('bmi metric unchanged', o.main, '22.9');

// BMR imperial: 176 lb (79.83 kg), 70 in (177.8 cm), male 30y
// BMR = 10*79.83 + 6.25*177.8 - 5*30 + 5 = 798.3 + 1111.25 - 150 + 5 = 1764.6; TDEE x1.55 = 2735
o = run('bmr', {sex: 'm', age: 30, units: 'imperial', kg: 176, cm: 70, act: '1.55'});
check('bmr imperial', o.main, '2,735 kcal/day');

// Body fat imperial: male, waist 35in, neck 16in, height 70in
// Navy: 495/(1.0324 - 0.19077*log10(35-16) + 0.15456*log10(70)) - 450
// log10(19)=1.27875, log10(70)=1.84510 -> 495/(1.0324-0.24393+0.28517)-450 = 495/1.07364-450 = 11.0%
o = run('bodyfat', {sex: 'm', units: 'imperial', waist: 35, neck: 16, hip: 95, height: 70});
check('bodyfat imperial', o.main, '11.1%');

// ---- swap support: every from/to converter must have both inputs ----
const converters = ['length', 'weight', 'temp', 'data', 'speed', 'volume', 'areaunits', 'timeunits', 'currency'];
let swapBad = 0;
for (const id of converters) {
  const c = calc(id);
  if (!c) { swapBad++; continue; }
  const keys = c.inputs.map(i => i.k);
  if (keys.indexOf('from') < 0 || keys.indexOf('to') < 0) { fail++; swapBad++; console.log('  FAIL no from/to:', id); }
}
if (!swapBad) { pass++; console.log('  PASS all 9 converters have from/to inputs (swap button renders)'); }

// ---- structure: every calculator runs on defaults ----
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
if (!bad) { pass++; console.log('  PASS all ' + CALCS.length + ' calculators have valid structure and run on defaults'); }

console.log(`\n${pass} passed, ${fail} failed (of ${pass + fail})`);
process.exit(fail ? 1 : 0);
