// Tearing down an expo-location watch crashes the web app.
//
// expo-location 19.0.8 unsubscribes through `LocationEventEmitter`, and its
// native build makes that a LegacyEventEmitter (which has removeSubscription).
// The *web* build - LocationEventEmitter.web.js - constructs the modern
// expo-modules-core EventEmitter instead, which has no such method, so
// `subscription.remove()` throws
//   "LocationEventEmitter.removeSubscription is not a function"
// and React tears the whole tree down. Drivers hit this on the paths that stop
// watching: accepting a ride, going offline, or leaving the Drive tab.
//
// By the time it throws, expo has already dropped the callback and called
// removeWatchAsync, so the watch really is stopped; what leaks is one idle
// emitter subscription. Swallowing exactly this error is therefore safe, and
// anything else still propagates.
//
// Delete this once expo-location ships a web LocationEventEmitter with
// removeSubscription (or switches to subscription.remove()).

const KNOWN = /removeSubscription is not a function/;

export function stopWatching(subscription) {
  if (!subscription || typeof subscription.remove !== 'function') return false;
  try {
    subscription.remove();
    return true;
  } catch (e) {
    if (KNOWN.test(String((e && e.message) || e))) return false;
    throw e;
  }
}
