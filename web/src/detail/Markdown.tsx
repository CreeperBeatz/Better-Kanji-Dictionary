/** A note's text as markdown, loaded on demand by NoteContent. */
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Parsed again only when the text changes, not on every render of the page
// around it: a tab turn renders the app, and the notes are hidden behind it.
export default memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
    >
      {text}
    </ReactMarkdown>
  )
})
