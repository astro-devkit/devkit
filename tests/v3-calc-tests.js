// DevKit v3 calculator accuracy tests.
// Loads the REAL <script> from index.html into a VM and checks every calculator
// against independently computed reference values.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> found in index.html'); process.exit(1); }

const sandbox = {
  console,
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
    addEventListener() {},
  },
  navigator: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const CALCS = sandbox.CALCS;
if (!Array.isArray(CALCS) || CALCS.length === 0) { console.error('FAIL: CALCS not defined'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + ' — got: ' + JSON.stringify(got) + ' want: ' + JSON.stringify(want)); }
}
function close(name, got, want, tol) {
  if (Math.abs(got - want) <= tol) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + ' — got: ' + got + ' want: ' + want + ' ±' + tol); }
}
function num(s) { const x = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return x; }
function calc(id) { const c = CALCS.find(x => x.id === id); if (!c) throw new Error('missing calc ' + id); return c; }

// structural: every calc runs on its defaults without throwing
CALCS.forEach(c => {
  try {
    const v = {};
    c.inputs.forEach(i => { v[i.k] = i.def; });
    const r = c.compute(v, new Date('2025-01-01T00:00:00'));
    if (!r || typeof r.main !== 'string' || !r.main) throw new Error('empty result');
  } catch (e) { fail++; console.log('FAIL structural ' + c.id + ': ' + e.message); }
});
console.log('structural checks done for ' + CALCS.length + ' calculators');

// reference values (independently computed)
eq('mortgage $300k 6% 30y', calc('mortgage').compute({ p: 300000, rate: 6, years: 30 }).main, '$1,798.65/mo');
eq('compound $10k 5% 10y monthly', calc('compound').compute({ p: 10000, rate: 5, years: 10, freq: 12 }).main, '$16,470.09');
eq('simple $5k 4% 3y', calc('simple').compute({ p: 5000, rate: 4, years: 3 }).main, '$5,600.00');
eq('tip $100 15%', calc('tip').compute({ bill: 100, pct: 15, people: 1 }).main, '$115.00');
eq('discount $80 -25%', calc('discount').compute({ price: 80, off: 25 }).main, '$60.00');
eq('salary $25/hr 40h', calc('salary').compute({ hourly: 25, hrs: 40 }).main, '$52,000.00/yr');
eq('percent 20% of 150', calc('percent').compute({ mode: 'of', x: 20, y: 150 }).main, '30.00');
eq('percent 30 is what % of 150', calc('percent').compute({ mode: 'is', x: 30, y: 150 }).main, '20.00%');
eq('bmi 70kg 175cm', calc('bmi').compute({ kg: 70, cm: 175 }).main, '22.9');
eq('bmi category normal', calc('bmi').compute({ kg: 70, cm: 175 }).sub.includes('Normal'), true);
eq('bmr male 30y 80kg 180cm mod-active', calc('bmr').compute({ sex: 'm', age: 30, kg: 80, cm: 180, act: '1.55' }).main, '2,759 kcal/day');
close('bodyfat navy male 90/40/180cm', num(calc('bodyfat').compute({ sex: 'm', waist: 90, neck: 40, hip: 95, height: 180 }).main), 11.9, 0.3);
eq('mean 2,4,4,4,5,5,7,9', calc('meansd').compute({ nums: '2, 4, 4, 4, 5, 5, 7, 9' }).main, 'Mean 5.00');
eq('pop SD of dataset = 2', calc('meansd').compute({ nums: '2, 4, 4, 4, 5, 5, 7, 9' }).sub.includes('Population SD 2.00'), true);
eq('area rect 5x4', calc('area').compute({ shape: 'rect', a: 5, b: 4 }).main, '20.00 units²');
close('area circle r=3', num(calc('area').compute({ shape: 'circle', a: 3, b: 4 }).main), 28.27, 0.01);
eq('area tri 6x4', calc('area').compute({ shape: 'tri', a: 6, b: 4 }).main, '12.00 units²');
eq('pythag 3-4-5', calc('pythag').compute({ a: 3, b: 4 }).main, 'c = 5.00');
eq('length 1 mi to km', calc('length').compute({ value: 1, from: 'mi', to: 'km' }).main, '1.6093 km');
eq('length 12 in to ft', calc('length').compute({ value: 12, from: 'in', to: 'ft' }).main, '1.0000 ft');
eq('weight 1 kg to lb', calc('weight').compute({ value: 1, from: 'kg', to: 'lb' }).main, '2.2046 lb');
eq('temp 100C to F', calc('temp').compute({ value: 100, from: 'C', to: 'F' }).main, '212.00 °F');
eq('temp -40C to F', calc('temp').compute({ value: -40, from: 'C', to: 'F' }).main, '-40.00 °F');
eq('temp 0C to K', calc('temp').compute({ value: 0, from: 'C', to: 'K' }).main, '273.15 °K');
eq('data 1 GB to B', calc('data').compute({ value: 1, from: 'GB', to: 'B' }).main, '1,073,741,824.00 B');
eq('speed 100 kmh to mph', calc('speed').compute({ value: 100, from: 'kmh', to: 'mph' }).main, '62.14 mph');
eq('age 2000-01-01 at 2025-01-01', calc('age').compute({ birth: '2000-01-01' }, new Date('2025-01-01T00:00:00')).main, '25 years');
eq('age days lived', calc('age').compute({ birth: '2000-01-01' }, new Date('2025-01-01T00:00:00')).sub.includes('9,132 days'), true);
eq('datediff Jan 2025', calc('datediff').compute({ d1: '2025-01-01', d2: '2025-02-01' }).main, '31 days');
eq('fuel 300mi 30mpg $3.50', calc('fuel').compute({ mode: 'mpg', distance: 300, distunit: 'mi', cons: 30, price: 3.5 }).main, '$35.00');
eq('fuel 300km 7.8L/100km $1.60', calc('fuel').compute({ mode: 'l100km', distance: 300, distunit: 'km', cons: 7.8, price: 1.6 }).main, '$37.44');

console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + CALCS.length + ' calculators');
process.exit(fail ? 1 : 0);
