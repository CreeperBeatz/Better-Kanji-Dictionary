// Signing in to tests/sandbox.py as a person would, for the check scripts:
// ask for a link (the sandbox hands it back as devLink) and open it.

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Opens `email`'s sign-in link on `page`; the session is then in its localStorage. */
export async function logIn(page, base, email) {
  const res = await fetch(`${base}/api/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email }),
  }).then((r) => r.json())
  await page.goto(res.devLink.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'networkidle' })
}

/**
 * A page of its own, signed in as `email`, its page errors and console errors
 * (but the avatars' misses) pushed to `errors`, `label` before each.
 */
export async function signedIn(browser, base, email, errors, { viewport = { width: 1300, height: 900 }, settle = 600, label = `${email}: ` } = {}) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}${e}`))
  page.on('console', (m) => m.type() === 'error' && !/avatar/.test(m.text()) && errors.push(`${label}${m.text()}`))
  await logIn(page, base, email)
  await wait(settle)
  return page
}

/** The API from inside the page, with its session as a bearer token, as the app sends it. */
export const call = (page, path, body) =>
  page.evaluate(
    ([p, b]) =>
      fetch(p, {
        method: b === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('betterrtk:session')}` },
        body: b === undefined ? undefined : JSON.stringify(b),
      }).then((r) => r.json()),
    [path, body],
  )
