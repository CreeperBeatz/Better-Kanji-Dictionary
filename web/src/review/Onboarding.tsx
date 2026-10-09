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

/** The four stages, on the overview card: each opens its own card. */
const STAGES: { name: string; q: string; card: number }[] = [
  { name: 'Characters', q: 'How is it related, what is it built from, and what is a part with no meaning?', card: 3 },
  { name: 'Meanings', q: 'What are the 1–6 things this kanji does in words?', card: 4 },
  { name: 'Bulgarian', q: 'Is the machine translation right?', card: 5 },
  { name: 'Reports', q: 'Is what someone reported really wrong?', card: 6 },
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
            Pick a <b>stage</b> at the top (characters, meanings, Bulgarian, reports) or <b>all</b>. A greyed stage has
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
      title: 'Four kinds of card',
      lead: <>Each stage asks its questions in plain words. The next four cards take them one by one.</>,
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
      kicker: 'Task 1 of 4',
      title: 'Characters',
      glyph: '午',
      lead: (
        <>
          One card per character, up to three questions: how is it related to other characters, what is it built from
          today, and, for a part with no meaning in the dictionary, what is it? Every answer says what it does.
        </>
      ),
      more: 'Characters',
      body: (
        <>
          <List label="Do">
            <li>
              Read the <b>AI draft</b> and its reason first. It is a suggestion with its proof, not a fact.
            </li>
            <li>
              Pick an answer: <i>use the proposal</i>, <i>keep it as it is</i>, <i>no parts</i>, or <i>something else</i>.
              Take the split the sources give. A base kanji stays whole.
            </li>
            <li>
              <b>A form of another kanji</b> (<J>龰</J> is <J>止</J>, <J>氵</J> is <J>水</J>): mark the root in step 1.
              A form has no parts of its own, so step 2 is not asked.
            </li>
            <li>
              No such pieces? It has <b>no parts</b>. That is fine: <J>日</J> and <J>午</J> are learned as one piece.
            </li>
            <li>
              Read <b>what this changes</b> and the summary above <i>save</i> before saving.
            </li>
          </List>
          <List label="Look out" tone="watch">
            <li>
              <b>Lookalikes and stroke splits.</b> <J>日</J> is not <J>口</J>, <J>木</J> is not <J>八 十</J>.
            </li>
            <li>
              <b>The old form</b> only breaks a tie between two groupings visible today (<J>従</J>). It never adds a part.
            </li>
            <li>
              <b>A form of</b> lends its meaning to every kanji with the part: check the list of kanji under it. A part
              that is several things in different kanji is a <b>shape</b> with a name (<J>丷</J>), and the card won’t let
              you save both.
            </li>
          </List>
        </>
      ),
    },
    {
      kicker: 'Task 2 of 4',
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
              <b>Confirm every word</b> in the groups: select several, right-click, <i>Confirm</i>. Words two AI runs agreed
              on start confirmed: glance over them and take back a wrong one. Accept stays greyed until every word is
              confirmed, and until you press <i>Done</i> on steps 2 and 3.
            </li>
            <li>
              Unsure of a word? <i>Not sure: leave for later</i>. It comes back at the end of the queue.
            </li>
            <li>
              Single words arrive here too, after their kanji’s card. Keys <kbd>1</kbd>–<kbd>9</kbd> pick a group. Then click accept.
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
      kicker: 'Task 3 of 4',
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
      kicker: 'Task 4 of 4',
      title: 'Reports',
      glyph: '誤',
      lead: (
        <>
          Someone found a mistake no card can fix: a word’s English (JMdict’s), a kanji’s readings or levels, its similar
          kanji. Those come from reference dictionaries: nothing on the site changes, whatever you decide.
        </>
      ),
      more: 'Reports',
      body: (
        <>
          <List label="Do">
            <li>
              <b>Confirm</b> a real mistake: a wrong meaning or reading, a common sense that is missing, a wrong level. It
              goes into the data issues list and on to the source.
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
      lead: <>Every card has the same few buttons. Most have a key.</>,
      body: (
        <>
          <dl className="onb-keys">
            <dt>accept</dt>
            <dd>
              Take the card as shown. Once you change something it becomes <i>save my answer</i>. On a character’s card,
              <i> save</i> saves the answers picked. No key does this: click the button.
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
            <dd>Only on reports and people’s suggestions. A character’s card has answers that say what they do instead.</dd>
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
              Spot something wrong that no card fixes? <i>Something else is wrong?</i> on every card, and at the bottom of
              the page’s Edit, files a report. Even yours goes to the queue.
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
