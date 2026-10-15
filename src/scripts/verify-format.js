/**
 * Unit + data checks for src/lib/format.js: hours, phones, visible tags.
 * Runs against real values pulled from the database plus a table of edge cases.
 */
const assert = require('assert');
const sqlite3 = require('node:sqlite');
const path = require('path');
const { formatHours, formatPhone, visibleTags } = require('../lib/format');

const CASES = [
  ['24/7', 'Open 24 hours, 7 days a week'],
  ['Mo-Fr 09:00-18:00', 'Mon-Fri 9:00 am-6:00 pm'],
  ['Mo-Fr 09:00-18:00; Sa,Su 09:00-18:30', 'Mon-Fri 9:00 am-6:00 pm, Sat-Sun 9:00 am-6:30 pm'],
  ['Mo-Su 10:00-22:00', 'Daily 10:00 am-10:00 pm'],
  ['Sa,Su 10:00-16:00', 'Sat-Sun 10:00 am-4:00 pm'],
  ['Mo,Tu,We,Th,Fr 07:00-15:00', 'Mon-Fri 7:00 am-3:00 pm'],
  ['PH off', 'Closed on public holidays'],
  ['Mo-Fr 16:30+', 'Mon-Fri 4:30 pm onwards'],
  ['Su-Th 11:00-22:00; Fr-Sa 11:00-25:00', 'Mon-Thu, Sun 11:00 am-10:00 pm, Fri-Sat 11:00 am-1:00 am (+1 day)'],
  ['Mo-Fr 09:00-12:00,13:00-17:00', 'Mon-Fri 9:00 am-12:00 pm, 1:00 pm-5:00 pm'],
  ['Mo-Fr 09:00-18:00; PH off', 'Mon-Fri 9:00 am-6:00 pm, Closed on public holidays'],
  ['Mo-Fr 09:00-18:00; Sa,Su off', 'Mon-Fri 9:00 am-6:00 pm, Sat-Sun closed'],
  ['Mo-Fr 07:00-18:00; Sa, Su 08:00-18:00', 'Mon-Fri 7:00 am-6:00 pm, Sat-Sun 8:00 am-6:00 pm'],
  ['Tu-Sa 17:30-11:00+', 'Tue-Sat 5:30 pm-11:00 am (+1 day) onwards'],
  ['Mo-Sa 07:00-22:00, Su 08:00-22:00', 'Mon-Sat 7:00 am-10:00 pm, Sun 8:00 am-10:00 pm'],
  ['Tu-Th 17:00-24:00, Fr 17:00-02:00, Sa 15:30-02:00; Su,Mo off', 'Tue-Thu 5:00 pm-12:00 am (+1 day), Fri 5:00 pm-2:00 am (+1 day), Sat 3:30 pm-2:00 am (+1 day), Mon, Sun closed'],
  ['Th-Su 17:00-22:00, Sa,Su 11:00-14:00', 'Thu-Sun 5:00 pm-10:00 pm, Sat-Sun 11:00 am-2:00 pm'],
  ['Sa-Mo 10:00-16:00', 'Mon, Sat-Sun 10:00 am-4:00 pm'],
  ['', null],
  [null, null],
  ['sunrise-sunset', null],
  ['Mo-Fr dawn-dusk', null],
  ['whenever we feel like it', null],
  ['Mo-Fr 9am-5pm', null],
  ['PH 10:00-12:00', 'public holidays 10:00 am-12:00 pm'],
  ['Mo-Su 00:00-24:00', 'Daily open all day']
];

let failures = 0;
for (const [input, expected] of CASES) {
  const actual = formatHours(input);
  if (actual !== expected) {
    failures++;
    console.log(`HOURS FAIL ${JSON.stringify(input)} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
}

const PHONE_CASES = [
  ['+1-604-675-0000', '(604) 675-0000'],
  ['(604) 675-0000', '(604) 675-0000'],
  ['6046750000', '(604) 675-0000'],
  ['+160****7069', '+160****7069'],
  ['+1 604 899 9283', '(604) 899-9283'],
  [null, null]
];
for (const [input, expected] of PHONE_CASES) {
  const actual = formatPhone(input);
  if (actual !== expected) {
    failures++;
    console.log(`PHONE FAIL ${JSON.stringify(input)} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
}

assert.deepStrictEqual(visibleTags(['patio', 'source-openstreetmap', 'cuisine-italian']), ['patio', 'cuisine-italian']);
assert.deepStrictEqual(visibleTags(null), []);

// Real data pass: count how many stored values format cleanly vs. stay hidden.
const db = new sqlite3.DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
const hours = db.prepare('SELECT hours FROM businesses WHERE hours IS NOT NULL AND hours <> \'\'').all().map((r) => r.hours);
const phones = db.prepare("SELECT phone FROM businesses WHERE phone IS NOT NULL AND phone <> ''").all().map((r) => r.phone);
const shown = hours.filter((h) => formatHours(h) !== null).length;
console.log(`hours: ${hours.length} stored, ${shown} render in plain English, ${hours.length - shown} hidden (unparseable)`);
console.log('hidden examples:', hours.filter((h) => formatHours(h) === null).slice(0, 6));
console.log('rendered examples:', hours.filter((h) => formatHours(h) !== null).slice(0, 6).map((h) => `${h}  =>  ${formatHours(h)}`));
console.log(`phones: ${phones.length} stored, ${phones.filter((p) => /^\(\d{3}\) \d{3}-\d{4}$/.test(formatPhone(p))).length} in (604) 675-0000 form`);
console.log('phone examples:', phones.slice(0, 4).map((p) => `${p}  =>  ${formatPhone(p)}`));
console.log(failures === 0 ? 'FORMATTER OK' : `FORMATTER FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
