/**
 * The labeling handbook (handbook.md next to this file): the rules for each
 * task type and the worked cases. Loaded only when its tab opens, with the
 * markdown renderer the notes already use.
 *
 * The markdown is cut at its ## headings into sections, and the Cases into
 * one card per case. Contents beside it (a fold above it on a phone) list the
 * sections and their ### headings, and mark the one being read.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import Markdown from '../detail/Markdown'
import { strings, useLang } from '../i18n'
import text from './handbook.md?raw'

const S = strings(
  { contents: 'Contents', newHere: 'New here? Start with the cards' },
  { contents: 'Съдържание', newHere: 'Нови сте? Започнете с картите' },
)

interface Heading {
  id: string
  title: string
}
interface Section extends Heading {
  body: string
  subs: Heading[]
}

/** What a heading reads as, without its markdown: the same from the source and from the rendered tree. */
const plain = (s: string) => s.replace(/[*_`]/g, '').trim()
const slug = (s: string) =>
  'hb-' +
  plain(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')

type HNode = { type: string; value?: string; children?: HNode[] }
const textOf = (n: HNode): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join(''))

const H3: Components = {
  h3: ({ node, children }) => <h3 id={slug(textOf(node as HNode))}>{children}</h3>,
}

function parse(md: string) {
  const [head, ...rest] = md.split(/^## /m)
  const title = head.match(/^# (.+)$/m)?.[1] ?? ''
  const intro = head.replace(/^# .+$/m, '').trim()
  const sections: Section[] = rest.map((chunk) => {
    const nl = chunk.indexOf('\n')
    const name = chunk.slice(0, nl).trim()
    const body = chunk.slice(nl + 1).trim()
    const subs = [...body.matchAll(/^### (.+)$/gm)].map((m) => ({ id: slug(m[1]), title: plain(m[1]) }))
    return { id: slug(name), title: plain(name), body, subs }
  })
  return { title, intro, sections }
}

/** The Cases: what comes before the first case, then one card per case. */
function Cases({ body }: { body: string }) {
  const [lead, ...cases] = body.split(/^### /m)
  return (
    <>
      {lead.trim() && <Markdown text={lead} />}
      {cases.map((c) => {
        const nl = c.indexOf('\n')
        const name = c.slice(0, nl)
        return (
          <article key={name} className="handbook-case">
            <h3 id={slug(name)}>{plain(name)}</h3>
            <Markdown text={c.slice(nl + 1)} />
          </article>
        )
      })}
    </>
  )
}

function Toc({
  sections,
  at,
  onGo,
  children,
}: {
  sections: Section[]
  at: { section: string; sub: string }
  onGo: (id: string) => void
  children?: ReactNode
}) {
  return (
    <ol className="handbook-toc-list">
      {sections.map((s) => (
        <li key={s.id} data-on={at.section === s.id || undefined}>
          <a href={`#${s.id}`} onClick={(e) => (e.preventDefault(), onGo(s.id))}>
            {s.title}
          </a>
          {s.subs.length > 0 && (
            <ol>
              {s.subs.map((h) => (
                <li key={h.id} data-on={at.sub === h.id || undefined}>
                  <a href={`#${h.id}`} onClick={(e) => (e.preventDefault(), onGo(h.id))}>
                    {h.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
      {children}
    </ol>
  )
}

/** `section` names a ## section to open at (a card's "in the handbook" link). */
export default function Handbook({ section, onStart }: { section?: string; onStart?: () => void }) {
  const t = S(useLang())
  const { title, intro, sections } = useMemo(() => parse(text), [])
  const root = useRef<HTMLDivElement>(null)
  const fold = useRef<HTMLDetailsElement>(null)
  const [at, setAt] = useState({ section: '', sub: '' })
  // Until then, the scroll a click in the contents started is still running: keep its heading marked.
  const pinned = useRef(0)
  const sectionOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sections) {
      m.set(s.id, s.id)
      for (const h of s.subs) m.set(h.id, s.id)
    }
    return m
  }, [sections])

  // The heading last scrolled past is the one being read. The review screen's body is what scrolls.
  useEffect(() => {
    const box = root.current?.closest('.workbench-body')
    if (!box || !root.current) return
    const marks = [...root.current.querySelectorAll<HTMLElement>('.handbook [id]')]
    let frame = 0
    const update = () => {
      frame = 0
      if (Date.now() < pinned.current) return
      const top = box.getBoundingClientRect().top + 48
      let id = ''
      for (const m of marks) {
        if (m.getBoundingClientRect().top > top) break
        id = m.id
      }
      // At the very bottom the last heading may never reach the top: count it as read.
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2 && marks.length) id = marks[marks.length - 1].id
      const section = sectionOf.get(id) ?? ''
      setAt((was) => (was.section === section && was.sub === id ? was : { section, sub: id }))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const unpin = () => (pinned.current = 0)
    update()
    box.addEventListener('scroll', onScroll, { passive: true })
    box.addEventListener('scrollend', unpin)
    return () => {
      box.removeEventListener('scroll', onScroll)
      box.removeEventListener('scrollend', unpin)
      cancelAnimationFrame(frame)
    }
  }, [sectionOf])

  const go = useCallback(
    (id: string, jump = false) => {
      const el = document.getElementById(id)
      if (!el) return
      const still = jump || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // The last headings never reach the top; the one clicked is the one being read all the same.
      // (Opening at a section, the scroll itself marks it.)
      if (!jump) {
        pinned.current = Date.now() + 1500
        setAt({ section: sectionOf.get(id) ?? '', sub: id })
      }
      el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' })
      if (fold.current) fold.current.open = false
    },
    [sectionOf],
  )

  useEffect(() => {
    if (section) go(slug(section), true)
  }, [section, go])

  const start = onStart && (
    <li className="handbook-toc-start">
      <button className="clear" onClick={onStart}>
        {t('newHere')} →
      </button>
    </li>
  )

  return (
    <div className="handbook-layout" ref={root}>
      <nav className="handbook-toc" aria-label={t('contents')}>
        <p className="handbook-toc-title">{t('contents')}</p>
        <Toc sections={sections} at={at} onGo={go}>
          {start}
        </Toc>
      </nav>
      <article className="handbook" lang="en">
        <h1>{title}</h1>
        <Markdown text={intro} />
        <details className="handbook-fold" ref={fold}>
          <summary>{t('contents')}</summary>
          <Toc sections={sections} at={at} onGo={go}>
            {start}
          </Toc>
        </details>
        {sections.map((s) => (
          <section key={s.id} className="handbook-section" data-cases={s.title === 'Cases' || undefined}>
            <h2 id={s.id}>{s.title}</h2>
            {s.title === 'Cases' ? <Cases body={s.body} /> : <Markdown text={s.body} components={H3} />}
          </section>
        ))}
      </article>
    </div>
  )
}
