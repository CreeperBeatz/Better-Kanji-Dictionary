/**
 * Script detection, romaji and deinflection, ported from server/japanese.py.
 *
 * The two must agree -- the same query has to find the same words on the
 * device as on the server -- so this follows the Python line for line rather
 * than improving on it. Change one, change both; web/scripts/parity.ts checks.
 */

// ---------------------------------------------------------------- script

function isKanaChar(c: number): boolean {
  return (c >= 0x3041 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) || c === 0x30fc
}

export function isKana(s: string): boolean {
  if (!s) return false
  for (const ch of s) if (!isKanaChar(ch.codePointAt(0)!)) return false
  return true
}

export function hasJapanese(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x3041 && c <= 0x30ff) || (c >= 0x4e00 && c <= 0x9fff)) return true
  }
  return false
}

export function katakanaToHiragana(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch
  }
  return out
}

// ---------------------------------------------------------------- romaji

const ROMAJI: Record<string, string> = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', n: 'ん', nn: 'ん',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
}

/** Python's str.strip(): whitespace, including the Unicode kinds. */
export function pyStrip(s: string): string {
  return s.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/gu, '')
}

/** Python's str.split() with no argument. */
export function pySplit(s: string): string[] {
  return s.split(/[\s\x1c-\x1f\x85]+/u).filter(Boolean)
}

/** Best-effort romaji to hiragana. Returns '' if nothing converted cleanly. */
export function romajiToKana(input: string): string {
  const s = pyStrip(input.toLowerCase())
  // eslint-disable-next-line no-control-regex
  if (!s || !/^[\x00-\x7f]*$/.test(s)) return ''
  let out = ''
  let i = 0
  while (i < s.length) {
    // Doubled consonant -> small tsu, e.g. "kitte" -> きって
    if (i + 1 < s.length && s[i] === s[i + 1] && !'aeioun'.includes(s[i])) {
      out += 'っ'
      i += 1
      continue
    }
    let matched = false
    for (const size of [3, 2, 1]) {
      const chunk = s.slice(i, i + size)
      if (Object.hasOwn(ROMAJI, chunk)) {
        out += ROMAJI[chunk]
        i += chunk.length
        matched = true
        break
      }
    }
    if (!matched) return '' // unconvertible -- treat the whole input as English
  }
  return out
}

// ---------------------------------------------------------------- deinflection

// Part-of-speech families, as bits, so a rule's type set is one number.
export const V1 = 1
export const V5 = 2
export const VS = 4
export const VK = 8
export const ADJ = 16

interface Rule {
  suffix: string
  replace: string
  needs: number
  gives: number
  label: string
}

// Godan rows: dictionary ending -> [a-stem, i-stem, e-stem, o-stem, te, ta]
const GODAN: [string, [string, string, string, string, string, string]][] = [
  ['う', ['わ', 'い', 'え', 'お', 'って', 'った']],
  ['く', ['か', 'き', 'け', 'こ', 'いて', 'いた']],
  ['ぐ', ['が', 'ぎ', 'げ', 'ご', 'いで', 'いだ']],
  ['す', ['さ', 'し', 'せ', 'そ', 'して', 'した']],
  ['つ', ['た', 'ち', 'て', 'と', 'って', 'った']],
  ['ぬ', ['な', 'に', 'ね', 'の', 'んで', 'んだ']],
  ['ぶ', ['ば', 'び', 'べ', 'ぼ', 'んで', 'んだ']],
  ['む', ['ま', 'み', 'め', 'も', 'んで', 'んだ']],
  ['る', ['ら', 'り', 'れ', 'ろ', 'って', 'った']],
]

function buildRules(): Map<string, Rule[]> {
  const rules: Rule[] = []
  const add = (suffix: string, replace: string, needs: number, gives: number, label: string) =>
    rules.push({ suffix, replace, needs, gives, label })

  // --- ichidan: strip る, attach directly to the stem
  for (const [suffix, label, gives] of [
    ['ます', 'polite', V1], ['ました', 'polite past', V1], ['ません', 'polite negative', V1],
    ['ませんでした', 'polite negative past', V1], ['まして', 'polite -te', V1],
    ['ましょう', 'polite volitional', V1], ['ない', 'negative', ADJ], ['なかった', 'negative past', ADJ],
    ['ぬ', 'archaic negative', V1], ['ず', 'negative -zu', V1], ['た', 'past', V1], ['て', '-te', V1],
    ['たい', 'desire', ADJ], ['よう', 'volitional', V1], ['ろ', 'imperative', V1], ['よ', 'imperative', V1],
    ['れば', 'conditional', V1], ['たら', 'conditional -tara', V1],
    ['られる', 'passive or potential', V1], ['させる', 'causative', V1],
    ['させられる', 'causative passive', V1], ['られた', 'passive past', V1], ['そう', 'appearance', V1],
    ['すぎる', 'excess', V1], ['なさい', 'polite imperative', V1],
  ] as [string, string, number][]) {
    add(suffix, 'る', V1, gives, label)
  }

  // --- godan, generated per row so no ending is missed
  for (const [ending, [a, i, e, o, te, ta]] of GODAN) {
    for (const [stem, suffix, label, gives] of [
      [i, 'ます', 'polite', V1], [i, 'ました', 'polite past', V1], [i, 'ません', 'polite negative', V1],
      [i, 'ませんでした', 'polite negative past', V1], [i, 'まして', 'polite -te', V1],
      [i, 'ましょう', 'polite volitional', V1], [i, 'たい', 'desire', ADJ], [i, 'そう', 'appearance', V1],
      [i, 'すぎる', 'excess', V1], [i, 'なさい', 'polite imperative', V1], [i, '', 'stem', V1],
      [a, 'ない', 'negative', ADJ], [a, 'なかった', 'negative past', ADJ], [a, 'ず', 'negative -zu', V1],
      [a, 'ぬ', 'archaic negative', V1], [a, 'れる', 'passive', V1], [a, 'せる', 'causative', V1],
      [a, 'される', 'causative passive', V1], [a, 'せられる', 'causative passive', V1],
      [e, 'る', 'potential', V1], [e, 'ば', 'conditional', V1], [e, '', 'imperative', V1],
      [o, 'う', 'volitional', V5],
    ] as [string, string, string, number][]) {
      add(stem + suffix, ending, V5, gives, label)
    }
    add(te, ending, V5, V1, '-te')
    add(ta, ending, V5, V1, 'past')
    add(ta + 'ら', ending, V5, V1, 'conditional -tara')
    add(ta + 'り', ending, V5, V1, 'representative')
  }

  // --- i-adjectives
  for (const [suffix, replace, label, gives] of [
    ['くない', 'い', 'negative', ADJ], ['くなかった', 'い', 'negative past', ADJ], ['かった', 'い', 'past', V1],
    ['くて', 'い', '-te', V1], ['く', 'い', 'adverbial', V1], ['ければ', 'い', 'conditional', V1],
    ['さ', 'い', 'nominalised', V1], ['そう', 'い', 'appearance', V1], ['すぎる', 'い', 'excess', V1],
  ] as [string, string, string, number][]) {
    add(suffix, replace, ADJ, gives, label)
  }

  // --- suru and kuru, which follow no row
  for (const [suffix, label, gives] of [
    ['します', 'polite', V1], ['しました', 'polite past', V1], ['しません', 'polite negative', V1],
    ['しない', 'negative', ADJ], ['しなかった', 'negative past', ADJ], ['した', 'past', V1],
    ['して', '-te', V1], ['される', 'passive', V1], ['させる', 'causative', V1], ['しよう', 'volitional', V1],
    ['できる', 'potential', V1], ['すれば', 'conditional', V1], ['したら', 'conditional -tara', V1],
    ['したい', 'desire', ADJ],
  ] as [string, string, number][]) {
    add(suffix, 'する', VS, gives, label)
  }
  for (const [suffix, label, gives] of [
    ['きます', 'polite', V1], ['きました', 'polite past', V1], ['きません', 'polite negative', V1],
    ['こない', 'negative', ADJ], ['こなかった', 'negative past', ADJ], ['きた', 'past', V1],
    ['きて', '-te', V1], ['こられる', 'passive or potential', V1], ['こさせる', 'causative', V1],
    ['こよう', 'volitional', V1],
  ] as [string, string, number][]) {
    add(suffix, 'くる', VK, gives, label)
  }

  // --- auxiliaries that chain off the -te form
  for (const [suffix, replace, label] of [
    ['ている', 'て', 'progressive'], ['てる', 'て', 'progressive'], ['ています', 'て', 'progressive polite'],
    ['ていた', 'て', 'past progressive'], ['てた', 'て', 'past progressive'], ['てしまう', 'て', 'completion'],
    ['ちゃう', 'て', 'completion'], ['ておく', 'て', 'preparatory'], ['とく', 'て', 'preparatory'],
    ['てある', 'て', 'resultant'], ['ていく', 'て', 'going'], ['てくる', 'て', 'coming'],
    ['でいる', 'で', 'progressive'], ['でる', 'で', 'progressive'], ['でいた', 'で', 'past progressive'],
  ]) {
    add(suffix, replace, V1, V1, label)
  }

  const table = new Map<string, Rule[]>()
  for (const r of rules) {
    const list = table.get(r.suffix)
    if (list) list.push(r)
    else table.set(r.suffix, [r])
  }
  return table
}

const RULES = buildRules()
// Python measures in code points; every suffix here is BMP, so length agrees.
const MAX_SUFFIX = Math.max(...[...RULES.keys()].map((s) => s.length))

export interface Candidate {
  text: string
  reasons: string[]
  types: number
}

/** Every plausible dictionary form of `word`, shallowest first. */
export function deinflect(input: string, maxDepth = 10): Candidate[] {
  const word = isKana(input) ? katakanaToHiragana(input) : input
  const seen = new Set<string>([`${word}\u0000${0}`])
  const first: Candidate = { text: word, reasons: [], types: 0 }
  const out = [first]
  const queue = [first]

  // Slicing by code point, as Python does, so a character outside the BMP is
  // never cut in half.
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    if (cur.reasons.length >= maxDepth) continue
    const chars = [...cur.text]
    for (let size = 1; size <= Math.min(MAX_SUFFIX, chars.length); size++) {
      const suffix = chars.slice(chars.length - size).join('')
      const rules = RULES.get(suffix)
      if (!rules) continue
      for (const rule of rules) {
        if (cur.types && !(cur.types & rule.gives)) continue
        const base = chars.slice(0, chars.length - size).join('') + rule.replace
        if (base.length < 1) continue
        const key = `${base}\u0000${rule.needs}`
        if (seen.has(key)) continue
        seen.add(key)
        const next: Candidate = { text: base, reasons: [...cur.reasons, rule.label], types: rule.needs }
        out.push(next)
        queue.push(next)
      }
    }
  }
  return out
}

/** Does a word whose senses carry `posMask` satisfy a rule's type constraint? */
export function posMatches(posMask: number, types: number): boolean {
  if (!types) return true
  return (posMask & types) !== 0
}
