/** A note's text as markdown, loaded on demand by NoteContent. */
import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const LINKS: Components = { a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }

// Parsed again only when the text changes, not on every render of the page
// around it: a tab turn renders the app, and the notes are hidden behind it.
// `components` replaces elements (the handbook gives its headings ids); keep it stable.
export default memo(function Markdown({ text, components }: { text: string; components?: Components }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components ? { ...LINKS, ...components } : LINKS}>
      {text}
    </ReactMarkdown>
  )
})
