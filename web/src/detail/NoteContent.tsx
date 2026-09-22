import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { getImage, isLocalImage } from '../localNotes'

export function Note({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** An image from either the server or this browser's own store. */
export function NoteImage({ name }: { name: string }) {
  const local = isLocalImage(name)
  const [blobUrl, setBlobUrl] = useState<{ name: string; url: string } | null>(null)

  useEffect(() => {
    if (!local) return
    let url: string | null = null
    let stale = false
    getImage(name).then((img) => {
      if (stale || !img) return
      url = URL.createObjectURL(img.blob)
      setBlobUrl({ name, url })
    })
    return () => {
      stale = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [name, local])

  const src = local ? (blobUrl?.name === name ? blobUrl.url : null) : api.imageUrl(name)
  return src ? <img src={src} alt="" /> : <span className="assoc-image-pending" />
}
