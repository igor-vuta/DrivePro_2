// L20 smoke test: the expo-location teardown workaround.
//
// app/src/location.js exists because expo-location's *web* build unsubscribes
// through an EventEmitter that has no removeSubscription(), so stopping a
// location watch throws and takes the app down - which drivers hit on the
// common paths (accept a ride, go offline, leave the Drive tab). The helper
// swallows exactly that error and nothing else; this suite pins that contract
// so a future "tidy up the try/catch" cannot silently reintroduce the crash.
//
// It is plain ESM with no React Native imports, so Node can load it directly.
// Usage: node tests/smoke22.mjs   (no server needed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopWatching } from '../../app/src/location.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label} ${extra}`);
  }
};

// ---- the happy path: a working subscription is removed normally ----
let removed = 0;
check('a healthy subscription is removed', stopWatching({ remove: () => { removed++; } }) === true);
check('remove() was actually called once', removed === 1, String(removed));

// ---- the bug it exists for ----
const webCrash = {
  remove() {
    throw new TypeError('c.LocationEventEmitter.removeSubscription is not a function');
  },
};
let survived = true;
let result = null;
try {
  result = stopWatching(webCrash);
} catch {
  survived = false;
}
check('the expo web teardown crash is swallowed', survived, 'stopWatching rethrew the known error');
check('and reports that it could not remove cleanly', result === false, String(result));

// ---- everything else still propagates ----
let propagated = false;
try {
  stopWatching({
    remove() {
      throw new Error('network is down');
    },
  });
} catch (e) {
  propagated = /network is down/.test(e.message);
}
check('unrelated errors are not masked', propagated);

// ---- defensive shapes ----
check('null subscription is a no-op', stopWatching(null) === false);
check('undefined subscription is a no-op', stopWatching(undefined) === false);
check('an object without remove() is a no-op', stopWatching({}) === false);

// ---- nothing bypasses the helper ----
// A raw `.remove()` on a location watch is the crash; every teardown in
// DriveTab must go through stopWatching instead.
const driveTab = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'src', 'screens', 'DriveTab.js'), 'utf8');
check('DriveTab imports the helper', /import \{ stopWatching \} from '\.\.\/location'/.test(driveTab));
check(
  'no bare watchRef.current.remove() is left',
  !/watchRef\.current\.remove\(\)/.test(driveTab),
  'a location watch is still torn down directly'
);
const watchTeardowns = (driveTab.match(/stopWatching\(/g) || []).length;
check('every teardown path is covered', watchTeardowns === 3, `found ${watchTeardowns}, expected 3`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
