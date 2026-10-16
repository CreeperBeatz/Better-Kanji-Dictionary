/**
 * The interface language, English or Bulgarian, and the strings in it.
 *
 * Strings live next to the component that shows them, as two tables that the
 * compiler holds to the same keys:
 *
 *   const S = strings({ close: 'close', found: '{n} found' }, { close: 'затвори', found: 'намерени: {n}' })
 *   const t = S(useLang())
 *   t('found', { n: 3 })
 *
 * Plurals are keys with `_one` / `_other` endings, picked by Intl.PluralRules:
 * `t.plural('sentence', n)` reads `sentence_one` or `sentence_other`. For a
 * string with markup in it, `t.node('key', { n: <b>3</b> })` returns nodes.
 *
 * Code outside components (the API client, the lookup worker's messages) uses
 * `getLang()`, which does not re-render anything when the language changes.
 */

import { Fragment, createElement, useSyncExternalStore, type ReactNode } from 'react'

export type Lang = 'en' | 'bg'

const KEY = 'betterrtk:lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'bg') return saved
  } catch {
    // storage blocked: fall through to the browser's own language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bg') ? 'bg' : 'en'
}

let current: Lang = initial()
const listeners = new Set<() => void>()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function getLang(): Lang {
  return current
}

/** The locale dates and numbers are written in: day before month in English too. */
export const localeOf = (lang: Lang) => (lang === 'bg' ? 'bg-BG' : 'en-GB')

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  keepDict(null)
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // not remembered across visits, but still switched now
  }
  document.documentElement.lang = lang
  for (const l of listeners) l()
}

/** This page only, and not remembered: the dictionary tab is in English, as its dictionaries are (main.tsx). */
export function pinLang(lang: Lang): void {
  current = lang
  document.documentElement.lang = lang
  for (const l of listeners) l()
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getLang,
    getLang,
  )
}

/** The language that is not `lang`. */
export const otherLang = (lang: Lang): Lang => (lang === 'bg' ? 'en' : 'bg')

// The dictionary's own language, where it is not the interface's: picked from
// the phone's Dictionary tab, held down (App.tsx), or T. Remembered; the
// interface switch puts the dictionary back in step with it.
const DICT_KEY = 'betterrtk:dict-lang'
let dictOwn: Lang | null = (() => {
  try {
    const saved = localStorage.getItem(DICT_KEY)
    return saved === 'en' || saved === 'bg' ? saved : null
  } catch {
    return null
  }
})()

function keepDict(lang: Lang | null): void {
  dictOwn = lang
  try {
    if (lang) localStorage.setItem(DICT_KEY, lang)
    else localStorage.removeItem(DICT_KEY)
  } catch {
    // not remembered across visits, but still switched now
  }
}

/** The language the dictionary's content is shown in: the interface's, unless another is picked. */
export function getContentLang(): Lang {
  return dictOwn ?? current
}

/** Shows the dictionary's content in `lang`, whatever the interface is in. */
export function setContentLang(lang: Lang): void {
  if (lang === getContentLang()) return
  keepDict(lang === current ? null : lang)
  for (const l of listeners) l()
}

/** The dictionary's language, for its content: meanings, senses, notes. Labels and buttons follow `useLang`. */
export function useContentLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getContentLang,
    getContentLang,
  )
}

type Vars = Record<string, string | number>

function fill(template: string, vars?: Vars): string {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {}

export interface Translate<K extends string> {
  (key: K, vars?: Vars): string
  /** `key_one` / `key_other` (and whatever else the language's plural rules ask for) by `n`. */
  plural(key: string, n: number, vars?: Vars): string
  /** The string with `{name}` placeholders filled by nodes, for markup inside a sentence. */
  node(key: K, vars: Record<string, ReactNode>): ReactNode
  lang: Lang
}

/** One component's strings: English, and Bulgarian with exactly the same keys. */
export function strings<const E extends Record<string, string>>(
  en: E,
  bg: { [K in keyof E]: string },
): (lang: Lang) => Translate<Extract<keyof E, string>> {
  const tables: Record<Lang, Record<string, string>> = { en, bg }
  return (lang) => {
    const table = tables[lang]
    const t = ((key: string, vars?: Vars) => fill(table[key] ?? en[key] ?? key, vars)) as unknown as Translate<
      Extract<keyof E, string>
    >
    t.plural = (key, n, vars) => {
      const rules = (pluralRules[lang] ??= new Intl.PluralRules(lang))
      const form = `${key}_${rules.select(n)}`
      const template = table[form] ?? table[`${key}_other`] ?? en[`${key}_other`] ?? key
      return fill(template, { n, ...vars })
    }
    t.node = (key, vars) => {
      const parts = (table[key] ?? en[key] ?? key).split(/\{(\w+)\}/)
      return createElement(
        Fragment,
        null,
        ...parts.map((p, i) => (i % 2 ? createElement(Fragment, { key: i }, vars[p] ?? `{${p}}`) : p)),
      )
    }
    t.lang = lang
    return t
  }
}
