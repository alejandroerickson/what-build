/**
 * What the app keeps in this browser under `whatbuild.*`. Most of it is one person's: the product
 * they had open, where they were in each Story and mockup, the Story's focus, the sandbox notices
 * they have read. A browser can pass from one person to the next, so that state goes when someone
 * signs out or their session ends. The rest are choices about the device, kept for whoever uses it.
 */
const DEVICE_KEYS = new Set(["whatbuild.theme", "whatbuild.nav", "whatbuild.inspector", "whatbuild.mockup.mode"]);

/** Clear every `whatbuild.*` key but the device's own choices. */
export function forgetPersonalState() {
  try {
    const gone: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("whatbuild.") && !DEVICE_KEYS.has(key)) gone.push(key);
    }
    for (const key of gone) localStorage.removeItem(key);
  } catch {
    // Storage may be blocked; then nothing was kept.
  }
}
