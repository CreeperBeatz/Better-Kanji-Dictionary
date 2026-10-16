/**
 * A light tick felt in the hand, where the Vibration API is: Android.
 *
 * Safari has none. An iPhone ticks as a switch (`<input type="checkbox"
 * switch>`) is toggled, but since iOS 26.5 only when a finger taps the
 * switch itself, not when a script clicks it (WebKit bug 309082), and never
 * from a timer. So what should tick on an iPhone puts a switch, unseen
 * (`.haptic-switch` in theme.css), where the finger lands, and acts on its
 * change. It keeps its own look under the zero opacity: a switch stripped
 * of it does not tick.
 */
export function haptic(): void {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(10)
}
