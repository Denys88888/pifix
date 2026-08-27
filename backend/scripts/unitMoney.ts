/**
 * Unit tests for the money layer — the only pure logic in the app where a bug
 * silently changes what people are charged and paid.
 *
 * No database, no server, no fake Pi. Run with: npm run test:unit
 *
 * The invariant at the end is the one that matters: what the client pays must
 * equal what the master receives plus what the platform keeps. Anything else
 * means Pi was created or destroyed by arithmetic.
 */
import { Prisma, type PlatformSettings } from '@prisma/client';
import { D, equalsPi, money, percentOf, sum, toPi } from '../src/lib/money';
import { computeOrderCharges } from '../src/services/escrow';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} — ${detail}`);
    console.log(`  ❌ ${name} — ${detail}`);
  }
}

const eq = (name: string, actual: Prisma.Decimal.Value, expected: string) =>
  check(name, money(actual) === expected, `got ${money(actual)}, expected ${expected}`);

/** Only the three fields computeOrderCharges reads. */
function settings(clientFeePercent: string, masterFeePercent: string, expressFeePi: string) {
  return {
    clientFeePercent: D(clientFeePercent),
    masterFeePercent: D(masterFeePercent),
    expressFeePi: D(expressFeePi),
  } as unknown as PlatformSettings;
}

console.log('\n═══ 1. Rounding never invents precision ═══');

eq('toPi keeps 7 decimals', toPi('1.12345678'), '1.1234567');
check('toPi rounds DOWN, never up', toPi('0.99999999').equals(D('0.9999999')),
  toPi('0.99999999').toString());
eq('a repeating third stays under, not over', toPi(D(1).div(3)), '0.3333333');
eq('already-short values are untouched', toPi('2.5'), '2.5');

console.log('\n═══ 2. money() is a display string, not arithmetic ═══');

eq('whole numbers lose the decimal point', 10, '10');
eq('trailing zeros are trimmed', '10.5000000', '10.5');
eq('zeros before the point survive trimming', '1000', '1000');
eq('zero renders as a single zero', 0, '0');
check('null renders as zero, not "null"', money(null) === '0', money(null));
check('undefined renders as zero', money(undefined) === '0', money(undefined));

console.log('\n═══ 3. Percentages and sums do not drift ═══');

eq('10% of 10', percentOf(10, 10), '1');
eq('10% of 0.15 keeps its tail', percentOf('0.15', 10), '0.015');
eq('a percentage that does not divide evenly rounds down', percentOf('1', '33.3333333'), '0.3333333');
eq('0% is zero, not a rounding artefact', percentOf('123.4567891', 0), '0');
// 0.1 + 0.2 is the classic float trap: as Decimal it must be exactly 0.3.
eq('0.1 + 0.2 is exactly 0.3', sum('0.1', '0.2'), '0.3');
eq('summing many small amounts stays exact', sum(...Array(10).fill('0.1')), '1');
check('equalsPi compares at chain precision', equalsPi('1.00000001', '1.00000002'),
  'values differing below 7 decimals must compare equal');
check('equalsPi still separates real differences', !equalsPi('1.0000001', '1.0000002'), '');

console.log('\n═══ 4. Order charges ═══');

const s = settings('10', '0', '3');
const plain = computeOrderCharges(s, '100', false);
eq('escrow holds the whole budget', plain.escrowAmountPi, '100');
eq('client pays 10% commission on top', plain.clientFeePi, '10');
eq('no express fee unless urgent', plain.expressFeePi, '0');
eq('client total is budget + commission', plain.totalPi, '110');
eq('master keeps the full budget when the master fee is 0', plain.masterPayoutPi, '100');

const urgent = computeOrderCharges(s, '100', true);
eq('urgent adds the express fee to the total', urgent.totalPi, '113');
eq('express fee does not change what the master gets', urgent.masterPayoutPi, '100');
eq('express fee does not change the escrow', urgent.escrowAmountPi, '100');

const both = computeOrderCharges(settings('10', '5', '3'), '100', false);
eq('master fee is deducted from the payout', both.masterPayoutPi, '95');
eq('master fee does not change what the client pays', both.totalPi, '110');

const free = computeOrderCharges(settings('0', '0', '0'), '42.5', true);
eq('zero fees mean the client pays exactly the budget', free.totalPi, '42.5');
eq('zero fees mean the master receives exactly the budget', free.masterPayoutPi, '42.5');

console.log('\n═══ 5. No Pi is created or destroyed ═══');

const cases: Array<[string, string, string, string, boolean]> = [
  // budget, clientFee%, masterFee%, expressFee, urgent
  ['100', '10', '5', '3', false],
  ['100', '10', '5', '3', true],
  ['0.0000003', '10', '5', '3', true],   // below the rounding floor
  ['1', '33.3333333', '7.7777777', '0.0000001', true], // fees that never divide evenly
  ['999999.9999999', '17.5', '2.5', '13', true],       // large, with a full tail
  ['0.15', '10', '10', '0', false],
];

for (const [budget, clientFee, masterFee, express, isUrgent] of cases) {
  const c = computeOrderCharges(settings(clientFee, masterFee, express), budget, isUrgent);

  // The client hands over totalPi. It splits three ways and nowhere else:
  // the master's payout, the platform's cut, and the express fee.
  const platformKeeps = sum(c.clientFeePi, c.masterFeePi);
  const accountedFor = sum(c.masterPayoutPi, platformKeeps, c.expressFeePi);

  check(
    `budget ${budget}${isUrgent ? ' urgent' : ''}: every Pi paid is accounted for`,
    equalsPi(c.totalPi, accountedFor),
    `client pays ${money(c.totalPi)}, accounted ${money(accountedFor)} ` +
      `(master ${money(c.masterPayoutPi)} + platform ${money(platformKeeps)} + express ${money(c.expressFeePi)})`,
  );

  check(
    `budget ${budget}${isUrgent ? ' urgent' : ''}: the master is never paid more than the escrow holds`,
    c.masterPayoutPi.lessThanOrEqualTo(c.escrowAmountPi),
    `payout ${money(c.masterPayoutPi)} vs escrow ${money(c.escrowAmountPi)}`,
  );

  check(
    `budget ${budget}${isUrgent ? ' urgent' : ''}: nothing is negative`,
    [c.escrowAmountPi, c.clientFeePi, c.expressFeePi, c.totalPi, c.masterFeePi, c.masterPayoutPi]
      .every((v) => v.greaterThanOrEqualTo(0)),
    JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, money(v)]))),
  );
}

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
