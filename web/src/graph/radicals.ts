/**
 * The 214 classical (Kangxi) radicals, by number. The Kangxi Radicals block
 * is in Kangxi order, and NFKC gives each one's ordinary kanji -- as
 * pipeline/readings.py does for the radical on a kanji's page.
 */
const KANGXI = new Map(Array.from({ length: 214 }, (_, i) => [String.fromCodePoint(0x2f00 + i).normalize('NFKC'), i + 1]))

/**
 * The radical as Japanese writes it, where the block has the old form (青 for
 * 靑), and the shapes a radical takes inside a kanji (氵 for 水) -- as the
 * decomposition writes them: ⺤, not 爫. Only these: the graph's "form of"
 * also links shapes that are not the radical (龶 to 生). 阝 is left out, as it
 * is two radicals: 阜 on the left, 邑 on the right.
 */
const FORMS: Record<string, number> = {
  亻: 9,
  刂: 18,
  '⺌': 42,
  忄: 61,
  㣺: 61,
  戸: 63,
  扌: 64,
  龵: 64,
  攵: 66,
  氵: 85,
  氺: 85,
  灬: 86,
  '⺤': 87,
  犭: 94,
  礻: 113,
  '⺮': 118,
  糹: 120,
  罒: 122,
  耂: 125,
  艹: 140,
  衤: 145,
  𧘇: 145,
  '⻊': 157,
  辶: 162,
  '⻍': 162,
  青: 174,
  飠: 184,
  𩙿: 184,
  麦: 199,
  黄: 201,
  黒: 203,
  斉: 210,
  歯: 211,
  竜: 212,
  亀: 213,
}

/** Which of the 214 radicals a character is, written as itself or as one of its forms. */
export function radicalNumber(char: string): number | null {
  return KANGXI.get(char) ?? FORMS[char] ?? null
}
