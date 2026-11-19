/**
 * Stable colour per customer: the same name always gets the same hue, on
 * every machine. Red is left out so a customer badge is never mistaken for
 * a critical marker.
 */
const HUES = [205, 262, 152, 38, 318, 178, 92, 232, 290, 58, 338, 128];

const cache = new Map<string, number>();

export function customerHue(name: string): number {
  const key = name.toLowerCase();
  let hue = cache.get(key);
  if (hue === undefined) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hue = HUES[(hash >>> 0) % HUES.length]!;
    cache.set(key, hue);
  }
  return hue;
}
