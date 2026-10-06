// "Radical Number 9", "Variant Of Radical 125": a number where a meaning would be.
// A radical's name ("Dotted Cliff Radical (no. 53)") says something and stays.
const FILLER = /\b(radical|number|variant|of)\b|\bno\.|[\d().,\s-]+/gi
const NUMBER = /^[\d,.]+$/

/**
 * KANJIDIC's meanings without the bare radical numbers it files as meanings
 * (server/forms.py does the same). A bare number is a meaning only when
 * nothing else is: 卌 is "40", while 万's "10,000" repeats "Ten Thousand".
 */
export function realMeanings(meanings: string[]): string[] {
  const real = meanings.filter((m) => m.replace(FILLER, '').trim() !== '')
  return real.length ? real : meanings.filter((m) => NUMBER.test(m.trim()))
}
