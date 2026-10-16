/**
 * A light tick felt in the hand. Android has the Vibration API. Safari has
 * none, but since iOS 18 a switch checkbox ticks as it is toggled, so a
 * hidden one is toggled through its label. That is not an API: an update
 * may take it away, and then this does nothing.
 */
export function haptic(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(10)
    return
  }
  const label = document.createElement('label')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  label.appendChild(input)
  document.head.appendChild(label)
  label.click()
  label.remove()
}
