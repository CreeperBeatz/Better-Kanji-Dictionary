/** A note's text as markdown, loaded on demand by NoteContent. */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
    >
      {text}
    </ReactMarkdown>
  )
}
