import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AssociationView } from '../api'

interface Props {
  char: string
  onPick: (char: string) => void
}

const SKETCH = 260

export function Associations({ char, onPick }: Props) {
  const [view, setView] = useState<AssociationView | null>(null)
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sketching, setSketching] = useState(false)

  const load = useCallback(() => {
    api.associations(char).then(
      (d) => {
        setView(d)
        const mine = d.own.find((a) => a.author === 'local')
        setText(mine?.text ?? '')
        setImages(mine?.images ?? [])
        setDirty(false)
      },
      () => setView(null),
    )
  }, [char])

  useEffect(load, [load])

  const save = useCallback(
    async (nextText: string, nextImages: string[]) => {
      setSaving(true)
      try {
        await api.saveAssociation(char, nextText, nextImages)
        setDirty(false)
        load()
      } finally {
        setSaving(false)
      }
    },
    [char, load],
  )

  // Autosave on a pause rather than a button: notes written mid-study should
  // never be lost to navigating away.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save(text, images), 900)
    return () => clearTimeout(t)
  }, [dirty, text, images, save])

  async function attach(blob: Blob, filename: string) {
    const { name } = await api.uploadImage(blob, filename)
    const next = [...images, name]
    setImages(next)
    await save(text, next)
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    if (!item) return
    const blob = item.getAsFile()
    if (blob) {
      e.preventDefault()
      attach(blob, `paste.${blob.type.split('/')[1] || 'png'}`)
    }
  }

  function onDrop(e: React.DragEvent) {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      attach(file, file.name)
    }
  }

  function removeImage(name: string) {
    const next = images.filter((i) => i !== name)
    setImages(next)
    save(text, next)
  }

  return (
    <section className="rail-section">
      <h2>My association for {char}</h2>

      <textarea
        className="assoc-text"
        value={text}
        placeholder={`What does ${char} look like to you?`}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        rows={4}
      />

      <p className="assoc-actions">
        <button className="clear" onClick={() => setSketching((s) => !s)}>
          {sketching ? 'close sketch' : 'sketch one'}
        </button>
        <span className="tally">
          {saving ? 'saving' : dirty ? 'unsaved' : text || images.length ? 'saved' : 'paste or drop an image'}
        </span>
      </p>

      {sketching && (
        <Sketch
          onSave={async (blob) => {
            await attach(blob, 'sketch.png')
            setSketching(false)
          }}
        />
      )}

      {images.length > 0 && (
        <div className="assoc-images">
          {images.map((name) => (
            <figure key={name}>
              <img src={api.imageUrl(name)} alt="" />
              <button className="clear" onClick={() => removeImage(name)}>
                remove
              </button>
            </figure>
          ))}
        </div>
      )}

      {view && view.components.length > 0 && (
        <div className="assoc-parts">
          <h3>From its parts</h3>
          {view.components.map((c) => (
            <div key={c.char} className="assoc-part">
              <button className="assoc-part-glyph" onClick={() => onPick(c.char)}>
                {c.char}
              </button>
              <p>{c.notes[0]?.text}</p>
            </div>
          ))}
        </div>
      )}

      {view && view.own.some((a) => a.author !== 'local') && (
        <div className="assoc-parts">
          <h3>Other people wrote</h3>
          {view.own
            .filter((a) => a.author !== 'local')
            .map((a) => (
              <div key={a.id} className="assoc-part">
                <span className="assoc-author">{a.authorName}</span>
                <p>{a.text}</p>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}

function Sketch({ onSave }: { onSave: (blob: Blob) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  function pos(e: React.PointerEvent): [number, number] {
    const r = ref.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * SKETCH, ((e.clientY - r.top) / r.height) * SKETCH]
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    const g = ref.current!.getContext('2d')!
    g.strokeStyle = '#ede6da'
    g.lineWidth = 3
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(...pos(e))
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    const g = ref.current!.getContext('2d')!
    g.lineTo(...pos(e))
    g.stroke()
  }

  return (
    <div className="sketch">
      <canvas
        ref={ref}
        width={SKETCH}
        height={SKETCH}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
        aria-label="Sketch area"
      />
      <p className="assoc-actions">
        <button
          className="clear"
          onClick={() => {
            const c = ref.current!
            c.getContext('2d')!.clearRect(0, 0, SKETCH, SKETCH)
          }}
        >
          clear
        </button>
        <button
          className="clear"
          onClick={() => ref.current!.toBlob((b) => b && onSave(b), 'image/png')}
        >
          keep it
        </button>
      </p>
    </div>
  )
}
