// DP-UI-003: pickup labels follow the accepted point, including failed lookup.
// Usage: node tests/smoke69.mjs
import { resolveLiftPickup } from '../../app/src/liftPickup.js';

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

const west = { lat: 43.2389, lng: 76.8897 };
const eastDestination = { lat: 43.24, lng: 76.9 };
const named = await resolveLiftPickup({
  walkerPosition: west,
  reverseLookup: async (point) => {
    check('default lookup receives the advertised West pickup',
      point.lat === west.lat && point.lng === west.lng && point.lng !== eastDestination.lng);
    return '  West pickup street  ';
  },
});
check('default accepted label uses the named pickup',
  named.address === 'West pickup street' && named.point.lng === west.lng);

const meet = { lat: 43.2391, lng: 76.8902 };
const meeting = await resolveLiftPickup({
  meet,
  walkerPosition: west,
  reverseLookup: async (point) => {
    check('meeting lookup uses the offered point', point.lat === meet.lat && point.lng === meet.lng);
    return 'Meeting kerb';
  },
});
check('meeting point keeps its own named location',
  meeting.address === 'Meeting kerb' && meeting.point.lng === meet.lng);

for (const [label, reverseLookup] of [
  ['lookup failure', async () => { throw new Error('offline'); }],
  ['empty lookup', async () => '   '],
  ['missing lookup address', async () => undefined],
  ['unusable lookup address', async () => ({ address: 'wrong shape' })],
]) {
  const result = await resolveLiftPickup({ walkerPosition: west, reverseLookup });
  check(`${label} yields actual pickup coordinates`, result.address === '43.23890, 76.88970');
}

const meetFallback = await resolveLiftPickup({ meet, walkerPosition: west, reverseLookup: async () => '' });
check('meeting lookup failure yields meeting coordinates', meetFallback.address === '43.23910, 76.89020');

let finishLookup;
const pending = resolveLiftPickup({
  walkerPosition: west,
  reverseLookup: () => new Promise((resolve) => { finishLookup = resolve; }),
});
west.lat = eastDestination.lat;
west.lng = eastDestination.lng;
finishLookup('');
const frozen = await pending;
check('movement during lookup cannot rename the accepted pickup',
  frozen.point.lat === 43.2389 && frozen.point.lng === 76.8897
  && frozen.address === '43.23890, 76.88970');

const unknown = await resolveLiftPickup({ reverseLookup: async () => 'unrelated map centre' });
check('unknown walker position does not borrow an unrelated label', unknown === null);
const invalid = await resolveLiftPickup({ walkerPosition: { lat: NaN, lng: 76.9 }, reverseLookup: async () => 'bad' });
check('invalid walker position cannot be named', invalid === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
