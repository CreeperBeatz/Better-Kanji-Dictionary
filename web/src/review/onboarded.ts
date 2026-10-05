/**
 * Whether this browser has shown a reviewer the "Start here" cards. Apart from
 * Onboarding.tsx so the review screen can ask without loading the cards.
 */
const SEEN = 'betterrtk:review-onboarded'

export function onboarded(): boolean {
  try {
    return localStorage.getItem(SEEN) === '1'
  } catch {
    return true
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(SEEN, '1')
  } catch {
    // Private mode: the cards may open again next time, which is harmless.
  }
}
