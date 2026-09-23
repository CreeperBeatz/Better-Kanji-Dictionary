/**
 * Bulgarian text: normalising, stemming, and reading shlyokavitsa -- a
 * line-for-line twin of server/bulgarian.py, held to the same answers word by
 * word by tests/offline_parity.py.
 *
 * `stem` is Jacques Savoy's light stemmer as Apache Lucene implements it in
 * BulgarianStemmer.java (Apache License 2.0). Lengths are counted in code
 * points, as Python counts them.
 */

const STRESS = /[\u0300\u0301]/g
const UNSTRESS: Record<string, string> = { ѐ: 'е', ѝ: 'и' }

export function hasCyrillic(s: string): boolean {
  return /[\u0400-\u04FF]/.test(s)
}

/** Plain ASCII with something to read in it: what shlyokavitsa is typed in. */
export function isLatinQuery(s: string): boolean {
  return /^[\x00-\x7f]*$/.test(s) && /[A-Za-z0-9]/.test(s)
}

/** Lower case, stress marks off. й stays: it is a letter, not и with a mark. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(STRESS, '')
    .replace(/[ѐѝ]/g, (c) => UNSTRESS[c])
}

/** Runs of letters and digits, split where unicode61 would split them. */
export function words(s: string): string[] {
  return s.split(/[^\p{L}\p{N}\p{Co}]+/u).filter(Boolean)
}

const len = (w: string) => [...w].length
const drop = (w: string, n: number) => [...w].slice(0, -n).join('')
const ends = (w: string, ...tails: string[]) => tails.some((t) => w.endsWith(t))

function removeArticle(w: string): string {
  const n = len(w)
  if (n > 6 && ends(w, 'ият')) return drop(w, 3)
  if (n > 5 && ends(w, 'ът', 'то', 'те', 'та', 'ия')) return drop(w, 2)
  if (n > 4 && ends(w, 'ят')) return drop(w, 2)
  return w
}

function removePlural(w: string): string {
  const n = len(w)
  if (n > 6) {
    if (ends(w, 'овци')) return drop(w, 3) // -овци -> -о
    if (ends(w, 'ове')) return drop(w, 3)
    if (ends(w, 'еве')) return drop(w, 3) + 'й' // -еве -> -й
  }
  if (n > 5) {
    if (ends(w, 'ища')) return drop(w, 3)
    if (ends(w, 'та')) return drop(w, 2)
    if (ends(w, 'ци')) return drop(w, 2) + 'к'
    if (ends(w, 'зи')) return drop(w, 2) + 'г'
    const c = [...w]
    if (c[n - 3] === 'е' && c[n - 1] === 'и') return drop(w, 3) + 'я' + c[n - 2] // -еXи -> -яX
  }
  if (n > 4) {
    if (ends(w, 'си')) return drop(w, 2) + 'х'
    if (ends(w, 'и')) return drop(w, 1)
  }
  return w
}

/** Savoy's light stemmer: articles, plurals and a final vowel off. */
export function stem(word: string): string {
  let w = word
  if (len(w) < 4) return w
  if (len(w) > 5 && ends(w, 'ища')) return drop(w, 3)
  w = removeArticle(w)
  w = removePlural(w)
  if (len(w) > 3) {
    if (ends(w, 'я')) w = drop(w, 1)
    if (ends(w, 'а', 'о', 'е')) w = drop(w, 1)
  }
  // The paper writes the ен -> н rule twice; Lucene, like Savoy's own Perl, applies it once.
  if (len(w) > 4 && ends(w, 'ен')) w = drop(w, 2) + 'н'
  const c = [...w]
  if (c.length > 5 && c[c.length - 2] === 'ъ') w = drop(w, 2) + c[c.length - 1] // ъN -> N
  return w
}

/** What the Bulgarian indexes store for a gloss, and what a query looks for. */
export function terms(text: string): string[] {
  return words(normalize(text)).map(stem)
}

const utf8 = new TextEncoder()

/**
 * A 32-bit FNV-1a hash of the text's words as written, unstemmed: what lets
 * a search put вода before водя, which share the stem вод.
 */
export function spelling(text: string): number {
  let h = 0x811c9dc5
  for (const b of utf8.encode(words(normalize(text)).join(' '))) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h
}

// ------------------------------------------------------------ shlyokavitsa

/** Latin spellings, longest first, each with what it can stand for, likeliest first. */
const SHLYOKAVITSA: [string, string[]][] = [
  ['sht', ['щ']],
  ['dzh', ['дж']],
  ['6t', ['щ']],
  ['zh', ['ж']],
  ['ch', ['ч']],
  ['sh', ['ш']],
  ['ts', ['ц']],
  ['dz', ['дз']],
  ['dj', ['дж']],
  ['yu', ['ю']],
  ['iu', ['ю']],
  ['ju', ['ю']],
  ['ya', ['я']],
  ['ia', ['я', 'ия']],
  ['ja', ['я']],
  ['yo', ['йо', 'ьо']],
  ['io', ['йо', 'ьо']],
  ['jo', ['йо', 'ьо']],
  ['a', ['а', 'ъ']],
  ['b', ['б']],
  ['c', ['ц', 'к']],
  ['d', ['д']],
  ['e', ['е']],
  ['f', ['ф']],
  ['g', ['г']],
  ['h', ['х']],
  ['i', ['и', 'й']],
  ['j', ['ж', 'й']],
  ['k', ['к']],
  ['l', ['л']],
  ['m', ['м']],
  ['n', ['н']],
  ['o', ['о']],
  ['p', ['п']],
  ['q', ['я']],
  ['r', ['р']],
  ['s', ['с']],
  ['t', ['т']],
  ['u', ['у', 'ъ']],
  ['v', ['в']],
  ['w', ['в', 'щ']],
  ['x', ['х', 'кс']],
  ['y', ['ъ', 'й']],
  ['z', ['з']],
  ['1', ['ъ']],
  ['`', ['ъ']],
  ['4', ['ч']],
  ['6', ['ш']],
  ['7', ['щ']],
]

export const MAX_CANDIDATES = 512

/** Every Cyrillic spelling a Latin-typed word could be, most likely first. */
export function shlyokavitsa(word: string): string[] {
  const w = word.toLowerCase()
  const out: string[] = []
  const walk = (i: number, acc: string): void => {
    if (out.length >= MAX_CANDIDATES) return
    if (i === w.length) {
      out.push(acc)
      return
    }
    for (const [latin, cyrillic] of SHLYOKAVITSA) {
      if (w.startsWith(latin, i)) {
        for (const c of cyrillic) {
          walk(i + latin.length, acc + c)
          if (out.length >= MAX_CANDIDATES) return
        }
      }
    }
  }
  walk(0, '')
  return out
}

/** The candidate whose stem the most Bulgarian glosses contain; ties go to the earlier one. */
export function bestReading(word: string, docs: (stem: string) => number): string | null {
  let best: string | null = null
  let bestN = 0
  for (const c of shlyokavitsa(word)) {
    const n = docs(stem(c))
    if (n > bestN) {
      best = c
      bestN = n
    }
  }
  return best
}
