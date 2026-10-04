/**
 * The labeling handbook (handbook.md next to this file): the rules for each
 * task type and the worked cases. Loaded only when its tab opens, with the
 * markdown renderer the notes already use.
 */
import Markdown from '../detail/Markdown'
import text from './handbook.md?raw'

export default function Handbook() {
  return (
    <article className="handbook" lang="en">
      <Markdown text={text} />
    </article>
  )
}
