// Shared GPS data cache — mutated by both the GPS proxy handler and the background collector.
// Both modules import this same object reference.
const gpsCache = { data: null, ts: 0 };
export default gpsCache;
