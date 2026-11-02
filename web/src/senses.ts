/**
 * A word's senses in our order: main, then secondary, then rare, JMdict's
 * order within each (server: synonyms.sense_order). The site numbers senses
 * by it. A sense's JMdict index stays its id: notes, synonyms, anchors and
 * `senseAt` all name it by that.
 */

import type { Word } from './api'

type Senses = Pick<Word, 'senses' | 'order'>

/** The sense indexes, as the site lists them. */
export const senseOrder = (w: Senses): number[] => w.order ?? w.senses.map((_, i) => i)

/** The number the site shows for sense `i` (its index), from 1. */
export const senseNo = (w: Senses, i: number): number => senseOrder(w).indexOf(i) + 1

/** The word's first sense, as the site lists them: what its head and short rows show. */
export const firstSense = (w: Senses): Word['senses'][number] | undefined => w.senses[senseOrder(w)[0]]

/** The sense a row shows first: under a meaning, the one that has it; else the word's first. */
export const leadSense = (w: Senses & Pick<Word, 'senseAt'>): number =>
  w.senseAt != null && w.senses[w.senseAt] ? w.senseAt : senseOrder(w)[0]
