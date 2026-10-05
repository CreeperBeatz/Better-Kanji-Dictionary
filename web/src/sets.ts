/** Sets kept in React state: each change makes a new one. */

/** `s` with `id` in it if it was not, and without it if it was. */
export function toggled<T>(s: Set<T>, id: T): Set<T> {
  const n = new Set(s)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}

/** `s` with every one of `ids` in it (`on`) or out of it. */
export function withIds<T>(s: Set<T>, ids: Iterable<T>, on: boolean): Set<T> {
  const n = new Set(s)
  for (const id of ids) {
    if (on) n.add(id)
    else n.delete(id)
  }
  return n
}
