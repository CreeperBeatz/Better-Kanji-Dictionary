import { api, type Author } from '../api'
import { getLang, strings } from '../i18n'

const S = strings(
  { cannotResize: 'this browser cannot resize images', unreadable: 'could not read that image' },
  { cannotResize: 'този браузър не може да преоразмерява картинки', unreadable: 'картинката не може да бъде прочетена' },
)

/**
 * A profile picture, or the stand-in for one.
 *
 * An account without a picture shows its initial on a colour picked from its
 * id, so the same person is recognisable down a thread. `null` is nobody
 * signed in: a plain silhouette.
 */
export function Avatar({ author, size = 28 }: { author: Author | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) }

  if (!author) {
    return (
      <span className="avatar avatar-none" style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="62%" height="62%">
          <circle cx="12" cy="8.5" r="4" fill="currentColor" />
          <path d="M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5" fill="currentColor" />
        </svg>
      </span>
    )
  }

  if (author.avatar) {
    return <img className="avatar" style={style} src={api.avatarUrl(author.avatar)} alt="" />
  }

  const initial = [...(author.name || author.username || '?').trim()][0]?.toUpperCase() ?? '?'
  return (
    <span className="avatar" style={{ ...style, background: `hsl(${hue(author.id)} 24% 27%)` }} aria-hidden="true">
      {initial}
    </span>
  )
}

function hue(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Centre-crop a picked image to a small square, so uploads stay tiny. */
export async function squareAvatar(file: File, px = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(S(getLang())('cannotResize'))
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(S(getLang())('unreadable')))), 'image/webp', 0.88),
  )
}
