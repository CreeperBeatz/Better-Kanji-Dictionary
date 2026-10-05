// "Radical Number 9", "Variant Of Radical 125": a number where a meaning would be.
// A radical's name ("Dotted Cliff Radical (no. 53)") says something and stays.
const FILLER = /\b(radical|number|variant|of)\b|\bno\.|[\d().,\s-]+/gi

/** KANJIDIC's meanings without the bare radical numbers it files as meanings (server/forms.py does the same). */
export function realMeanings(meanings: string[]): string[] {
  return meanings.filter((m) => m.replace(FILLER, '').trim() !== '')
}
