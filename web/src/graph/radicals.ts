/**
 * The 214 classical (Kangxi) radicals, by number. The Kangxi Radicals block
 * is in Kangxi order, and NFKC gives each one's ordinary kanji -- as
 * pipeline/readings.py does for the radical on a kanji's page.
 */
const KANGXI = new Map(Array.from({ length: 214 }, (_, i) => [String.fromCodePoint(0x2f00 + i).normalize('NFKC'), i + 1]))

/**
 * The radical as Japanese writes it, where the block has the old form (青 for
 * 靑), and the shapes a radical takes inside a kanji (氵 for 水). Only these:
 * the graph's "form of" also links shapes that are not the radical (龶 to 生).
 * 阝 is left out, as it is two radicals: 阜 on the left, 邑 on the right.
 */
const FORMS: Record<string, number> = {
  戸: 63,
  青: 174,
  麦: 199,
  黄: 201,
  黒: 203,
  斉: 210,
  歯: 211,
  竜: 212,
  亀: 213,
  亻: 9,
  刂: 18,
  '⺌': 42,
  忄: 61,
  扌: 64,
  攵: 66,
  氵: 85,
  氺: 85,
  灬: 86,
  爫: 87,
  牜: 93,
  犭: 94,
  礻: 113,
  '⺮': 118,
  糹: 120,
  罒: 122,
  耂: 125,
  艹: 140,
  衤: 145,
  訁: 149,
  𧾷: 157,
  辶: 162,
  '⻌': 162,
  '⻍': 162,
  釒: 167,
  飠: 184,
}

/** Which of the 214 radicals a character is, written as itself or as one of its forms. */
export function radicalNumber(char: string): number | null {
  return KANGXI.get(char) ?? FORMS[char] ?? null
}
