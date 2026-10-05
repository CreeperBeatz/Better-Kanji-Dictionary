/**
 * The start guide: a reviewer's onboarding, as a deck of cards in a popup.
 * What reviewing is, how the queue works, each kind of task, what you can do
 * and what to look out for, then the way into the queue. For reviewers:
 * nothing here is about the admin's tools or how a user suggests a change.
 *
 * It opens by itself the first time a reviewer enters review mode
 * (Workbench), and again from the handbook. The handbook has the full rules;
 * the cards are the short version. The cards are in English, like the handbook.
 *
 * Keyboard: ← / → turn the cards, Esc closes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { strings, useLang } from '../i18n'
import { useKey } from '../keys'
import { Overlay } from '../Overlay'
import { markOnboarded } from './onboarded'

const S = strings(
  {
    back: 'back',
    next: 'next',
    of: '{n} of {m}',
    guide: 'Start guide',
    close: 'close',
    queue: 'Open the queue',
    handbook: 'Read the handbook',
  },
  {
    back: 'назад',
    next: 'напред',
    of: '{n} от {m}',
    guide: 'Първи стъпки',
    close: 'затворете',
    queue: 'Към опашката',
    handbook: 'Към наръчника',
  },
)

interface Card {
  kicker: string
  title: string
  /** A character that stands for the card, drawn large beside the title. */
  glyph?: string
  lead: ReactNode
  /** "Do" and "Look out" lists, or anything else the card needs. */
  body?: ReactNode
  /** The handbook section with the full rules. */
  more?: string
}

function List({ label, tone, children }: { label: string; tone?: 'watch'; children: ReactNode }) {
  return (
    <div className="onb-list" data-tone={tone}>
      <h4>{label}</h4>
      <ul>{children}</ul>
    </div>
  )
}

const J = ({ children }: { children: ReactNode }) => <span lang="ja">{children}</span>

/** The five stages, on the overview card: each opens its own card. */
const STAGES: { name: string; q: string; card: number }[] = [
  { name: 'Parts', q: 'Which parts is this character built from, as written today?', card: 3 },
  { name: 'Forms', q: 'How does this shape relate to that one?', card: 4 },
  { name: 'Meanings', q: 'What are the 1–6 things this kanji does in words?', card: 5 },
  { name: 'Bulgarian', q: 'Is the machine translation right?', card: 6 },
  { name: 'Reports', q: 'Is the dictionary’s English really wrong?', card: 7 },
]

function cards(go: (i: number) => void): Card[] {
  return [
    {
      kicker: 'Welcome',
      title: 'You are a reviewer',
      glyph: '検',
      lead: (
        <>
          Parts, meanings and translations come in from dictionaries, from an AI and from other people. None of it reaches
          the site until a reviewer accepts it. That is your job.
        </>
      ),
      body: (
        <List label="What your decisions change">
          <li>
            <b>The study order.</b> A kanji is never taught before one it contains, so the parts you accept move kanji
            earlier or later for every learner.
          </li>
          <li>
            <b>The pages.</b> What you accept (parts, forms, meaning groups, Bulgarian) is what the kanji and word pages
            show.
          </li>
          <li>
            <b>Your name.</b> Every decision is logged under it, with the reason you give.
          </li>
        </List>
      ),
    },
    {
      kicker: 'How it works',
      title: 'One card at a time',
      glyph: '列',
      lead: <>The Queue tab holds everything waiting. You decide a card, and the next one opens.</>,
      body: (
        <List label="Getting around">
          <li>
            Pick a <b>stage</b> at the top (parts, forms, meanings, Bulgarian, reports) or <b>all</b>. A greyed stage has
            nothing waiting yet.
          </li>
          <li>Cards come most important first, which mostly means the most frequent kanji and words first.</li>
          <li>
            The bar at the top shows tasks done and how much of N5–N2 is fully verified. Click it for each stage.
          </li>
          <li>
            Your unfinished work on a card is <b>kept in this browser</b> until you decide it. Reload or come back
            tomorrow; it is still there.
          </li>
          <li>
            <b>History</b> lists every decision you made.
          </li>
        </List>
      ),
    },
    {
      kicker: 'The tasks',
      title: 'Five kinds of card',
      lead: <>Each stage asks one question. The next five cards take them one by one.</>,
      body: (
        <div className="onb-stages">
          {STAGES.map((s) => (
            <button key={s.name} className="onb-stage" onClick={() => go(s.card)}>
              <b>{s.name}</b>
              <span>{s.q}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      kicker: 'Task 1 of 5',
      title: 'Parts',
      glyph: '午',
      lead: <>Which parts is this character built from, as it is written today? Each part must do a job in it.</>,
      more: 'Parts',
      body: (
        <>
          <List label="Do">
            <li>Name the smallest pieces that are kanji or real parts, and that mean something here.</li>
            <li>
              No such pieces? It has no parts (it is <b>atomic</b>). That is fine: <J>午</J> is learned as one piece.
            </li>
            <li>
              Nothing proposed? It is a <b>check</b>: <i>looks right, keep it</i>, or type the right parts.
            </li>
          </List>
          <List label="Look out" tone="watch">
            <li>
              <b>Stroke splits.</b> Sources chop real parts into strokes (<J>口 → 丨一</J>). Reject them.
            </li>
            <li>
              <b>Lookalikes.</b> <J>午</J> contains <J>干</J>, but a pestle has nothing to do with a shield. Leave it
              out of the parts.
            </li>
            <li>
              <b>The old form</b> only breaks a tie between two groupings visible today (<J>従</J>). It never adds a part.
            </li>
            <li>
              <b>The impact line.</b> “157 kanji contain it” means 157 kanji change. A big number deserves a second look.
            </li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Task 2 of 5',
      title: 'Forms',
      glyph: '亻',
      lead: <>How does one shape relate to another? A form link carries meaning across; it never changes parts.</>,
      more: 'Forms',
      body: (
        <>
          <List label="The four links">
            <li>
              <b>same part in another position</b>: <J>人·亻</J>, <J>水·氵</J>
            </li>
            <li>
              <b>its old form</b>: the pre-reform shape, <J>青·靑</J>
            </li>
            <li>
              <b>is a form of</b>: squashed or moved, lending its meaning, <J>龰·止</J>
            </li>
            <li>
              <b>looks like</b>: a mnemonic only, <J>龶</J> looks like <J>王</J>
            </li>
          </List>
          <List label="Look out" tone="watch">
            <li>
              <i>is a form of</i> needs history behind it: the old form, or a reference.
            </li>
            <li>
              Reject a <i>looks like</i> that points at a kanji the learner will meet with a different meaning.
            </li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Task 3 of 5',
      title: 'Meanings',
      glyph: '合',
      lead: (
        <>
          Group what the kanji does in its words: 1–6 groups, on a board where each group holds its words. Accepting
          decides the groups and every word at once.
        </>
      ),
      more: 'Meanings',
      body: (
        <>
          <List label="Do">
            <li>
              Look at <b>red-edged words</b> first: the AI was unsure of them.
            </li>
            <li>Drag words between groups, or right-click for the menu.</li>
            <li>
              <b>Tick every word</b> in the groups as you check it. Accept stays greyed until all of them are ticked.
            </li>
            <li>
              Unsure of a word? <i>Not sure: leave for later</i>. It comes back at the end of the queue.
            </li>
            <li>
              Single words arrive here too, after their kanji’s card. Keys <kbd>1</kbd>–<kbd>9</kbd> pick a group.
            </li>
          </List>
          <List label="Look out" tone="watch">
            <li>
              <b>Don’t pad.</b> A kanji with one meaning (<J>楓</J>, maple) gets one group.
            </li>
            <li>
              <b>Test each group</b> with its words: if they don’t share a meaning, the group is wrong.
            </li>
            <li>
              <b>“No meaning” is not a shrug box.</b> It is for ateji and whole-word spellings (<J>合羽</J>,{' '}
              <J>生姜</J>). <J>沖合</J> was put there by mistake.
            </li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Task 4 of 5',
      title: 'Bulgarian',
      glyph: '訳',
      lead: (
        <>
          Every Bulgarian gloss and kanji meaning was machine-translated. Fix what is wrong or unnatural, and leave what is
          right.
        </>
      ),
      more: 'Bulgarian',
      body: (
        <>
          <List label="Do">
            <li>
              A card waits until its kanji’s <b>meanings are accepted</b>, then shows which group it is in. That tells you
              which sense to carry.
            </li>
            <li>Translate the word’s own English. One short meaning per field on a kanji card.</li>
            <li>What you accept shows on the site at once.</li>
          </List>
          <List label="Look out" tone="watch">
            <li>
              Japanese kanji are <b>канджи</b>, never кандзи (that is Chinese).
            </li>
            <li>Search by Bulgarian text keeps the old wording until the data is rebuilt.</li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Task 5 of 5',
      title: 'Reports',
      glyph: '誤',
      lead: (
        <>
          Someone says the dictionary’s English for a word is wrong. The English comes from JMdict and is never edited
          here: nothing on the site changes, whatever you decide.
        </>
      ),
      more: 'Reports',
      body: (
        <>
          <List label="Do">
            <li>
              <b>Confirm</b> a real mistake: a wrong meaning, a common sense that is missing, a gloss from another word.
              It goes on to JMdict.
            </li>
            <li>
              <b>Reject</b> a matter of taste, and say why: the person who reported it sees your reason.
            </li>
          </List>
          <List label="Look out" tone="watch">
            <li>Check against another dictionary or the example sentences, not against how you would put it.</li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Your tools',
      title: 'What you can do',
      glyph: '手',
      lead: <>Every card has the same few buttons, and each has a key.</>,
      body: (
        <>
          <dl className="onb-keys">
            <dt>
              <kbd>a</kbd> accept
            </dt>
            <dd>
              Take the card as shown. Once you change something it becomes <i>save my answer</i>.
            </dd>
            <dt>
              <kbd>s</kbd> skip
            </dt>
            <dd>
              Leave it for now. Skipped cards wait under <i>skipped</i> in the queue bar.
            </dd>
            <dt>
              <kbd>r</kbd> reject
            </dt>
            <dd>Only on parts, forms and people’s suggestions: things that can be wrong as a whole.</dd>
            <dt>reset card</dt>
            <dd>Throw away your changes and start again from the proposal.</dd>
            <dt>
              <kbd>j</kbd> <kbd>k</kbd>
            </dt>
            <dd>Next and previous card.</dd>
          </dl>
          <List label="Outside the queue">
            <li>
              <b>Edit</b> at the bottom of any kanji or word page changes it directly: live at once, and logged like a
              decision.
            </li>
            <li>
              Spot wrong English there? <i>The English meaning is wrong</i> files a report. Even yours goes to the queue.
            </li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Before you start',
      title: 'What to look out for',
      glyph: '注',
      lead: (
        <>
          <b>The modern shape decides the order; the old shape decides the story.</b> Most hard cards come down to that.
        </>
      ),
      body: (
        <List label="Habits that keep the data good" tone="watch">
          <li>
            <b>A proposal is not a fact.</b> The AI and the data sources are often wrong. Never accept because it was
            proposed.
          </li>
          <li>
            <b>Ask what each piece does</b> in this character or word, not what it looks like.
          </li>
          <li>
            <b>Read the impact</b> before changing parts that many kanji share.
          </li>
          <li>
            <b>Write a reason</b> whenever the decision is not obvious. It is what the next person reads.
          </li>
          <li>
            <b>Unsure? Skip.</b> A skipped card costs nothing; a guess costs every learner who meets it.
          </li>
        </List>
      ),
    },
    {
      kicker: 'Safety net',
      title: 'You can’t break it',
      glyph: '安',
      lead: <>Decide and move on. Every decision is logged, and the admin can revert any of them.</>,
      body: (
        <List label="When something goes wrong">
          <li>Accepted something by mistake? Tell the admin which card; it is one click to put back.</li>
          <li>
            A case took real thought? Put your reasoning in the reason field and tell the admin, so it goes into the
            handbook’s <b>Cases</b> and the next reviewer decides it the same way.
          </li>
          <li>Not sure what a rule means? The handbook has every stage in full, with worked cases.</li>
        </List>
      ),
    },
    {
      kicker: 'Ready',
      title: 'That’s all you need',
      glyph: '始',
      lead: (
        <>
          Start with a stage you know well. The handbook is one tab away whenever a card makes you stop and think, and
          this guide waits at the top of it.
        </>
      ),
    },
  ]
}

export default function Onboarding({
  onClose,
  onQueue,
  onHandbook,
}: {
  onClose: () => void
  onQueue: () => void
  onHandbook: (section?: string) => void
}) {
  const t = S(useLang())
  const [at, setAt] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const deck = cards(setAt)
  const card = deck[at]
  const last = at === deck.length - 1

  useEffect(markOnboarded, [])

  // Focus moves into the guide, and back to what had it when the guide closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => before?.focus?.()
  }, [])

  useKey((e) => {
    if (e.key === 'ArrowRight') setAt((i) => Math.min(i + 1, deck.length - 1))
    else if (e.key === 'ArrowLeft') setAt((i) => Math.max(i - 1, 0))
  })

  // Escape is the review screen's (Workbench): with the guide open it closes the guide.
  return (
    <Overlay
      className="onb-overlay"
      panel="onb-panel"
      label={t('guide')}
      onClose={onClose}
      escape={false}
      closeTitle={`${t('close')} (Esc)`}
      tabIndex={-1}
      ref={panel}
    >
      <article className="onb-card" lang="en" key={at} aria-live="polite">
        <header className="onb-card-head">
          <div>
            <p className="onb-kicker">{card.kicker}</p>
            <h2>{card.title}</h2>
          </div>
          {card.glyph && (
            <span className="onb-glyph" lang="ja" aria-hidden="true">
              {card.glyph}
            </span>
          )}
        </header>
        <p className="onb-lead">{card.lead}</p>
        {card.body && <div className="onb-body">{card.body}</div>}
        {card.more && (
          <button className="clear onb-more" onClick={() => onHandbook(card.more)}>
            {card.more} in the handbook →
          </button>
        )}
        {last && (
          <div className="onb-finish">
            <button className="account-submit" onClick={onQueue}>
              {t('queue')}
            </button>
            <button className="workbench-exit" onClick={() => onHandbook()}>
              {t('handbook')}
            </button>
          </div>
        )}
      </article>

      <footer className="onb-nav">
        <button className="workbench-exit" disabled={at === 0} onClick={() => setAt(at - 1)}>
          ← {t('back')}
        </button>
        <span className="onb-dots">
          {deck.map((c, i) => (
            <button key={c.title} data-on={i === at || undefined} onClick={() => setAt(i)} title={c.title} aria-label={c.title} />
          ))}
        </span>
        <span className="hint onb-count">{t('of', { n: at + 1, m: deck.length })}</span>
        <button className="account-submit" disabled={last} onClick={() => setAt(at + 1)}>
          {t('next')} →
        </button>
      </footer>
    </Overlay>
  )
}
