/**
 * How many words a meaning's card shows, on a kanji's page and in all its
 * words: a few at first, more in place, then the way to all of them.
 */

/** Words a card shows at first, and how many more each "show more" adds. */
export const FIRST_WORDS = 6
export const MORE_WORDS = 10
/** Past this many, a card points to all its words instead of showing more. */
export const OPEN_UPTO = 20

/**
 * Up to `n` items of the lists, shared out by how long each list is: each
 * list gives one first -- every reading keeps a word -- or its first `least`,
 * and then each next item goes to the list whose share is furthest behind
 * (kun 12, on 6, n 6: 4 and 2). Each list's part, in its order.
 */
export function share<T>(lists: T[][], n: number, least: number[] = []): T[][] {
  const take: number[] = lists.map((l, i) => Math.min(l.length, Math.max(l.length ? 1 : 0, least[i] ?? 0)))
  let left = n - take.reduce((a, b) => a + b, 0)
  while (left > 0) {
    let best = -1
    lists.forEach((l, i) => {
      if (take[i] < l.length && (best < 0 || l.length / (take[i] + 1) > lists[best].length / (take[best] + 1))) best = i
    })
    if (best < 0) break
    take[best]++
    left--
  }
  return lists.map((l, i) => l.slice(0, take[i]))
}
