import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type DrawCandidate } from '../api'
import { strings, useLang } from '../i18n'
import { meaningsOf } from '../i18n/content'

const S = strings(
  {
    area: 'Drawing area',
    undo: 'undo stroke',
    clear: 'clear',
    waking: 'waking the recogniser',
    strokes_one: '{n} stroke',
    strokes_other: '{n} strokes',
    didYouMean: 'Did you mean',
    noEntry: 'no dictionary entry',
    candidate: '{m} — {n} strokes',
  },
  {
    area: 'Поле за рисуване',
    undo: 'върнете черта',
    clear: 'изчистете',
    waking: 'разпознаването се зарежда',
    strokes_one: '{n} черта',
    strokes_other: '{n} черти',
    didYouMean: 'Може би',
    noEntry: 'няма речникова статия',
    candidate: '{m} — {n} черти',
  },
)

interface Props {
  onPick: (char: string) => void
}

const SIZE = 300

type Stroke = [number, number][]

export function DrawPad({ onPick }: Props) {
  const lang = useLang()
  const t = S(lang)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const drawing = useRef(false)
  const seq = useRef(0)
  const [candidates, setCandidates] = useState<DrawCandidate[]>([])
  const [drawn, setDrawn] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server builds its reference index on first use; doing it now means the
  // first stroke is not the one that waits for it.
  useEffect(() => {
    api.recognizerReady().then(
      () => setReady(true),
      (e) => setError(String(e.message ?? e)),
    )
  }, [])

  const paint = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, SIZE, SIZE)

    // Guide lines, the way a practice square is ruled.
    g.strokeStyle = 'rgba(122,112,100,0.25)'
    g.setLineDash([4, 6])
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(SIZE / 2, 0); g.lineTo(SIZE / 2, SIZE)
    g.moveTo(0, SIZE / 2); g.lineTo(SIZE, SIZE / 2)
    g.stroke()
    g.setLineDash([])

    g.strokeStyle = '#ede6da'
    g.lineWidth = 9
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const s of strokes.current) {
      if (s.length === 0) continue
      g.beginPath()
      g.moveTo(s[0][0], s[0][1])
      if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1] + 0.1)
      for (let i = 1; i < s.length; i++) g.lineTo(s[i][0], s[i][1])
      g.stroke()
    }
  }, [])

  useEffect(paint, [paint])

  const run = useCallback(async () => {
    const ink = strokes.current
    setDrawn(ink.length)
    if (ink.length === 0) {
      setCandidates([])
      return
    }
    const mine = ++seq.current
    try {
      // Only the endpoints are used, so there is no point posting every
      // pointermove sample.
      const thinned = ink.map((s) => (s.length > 2 ? [s[0], s[s.length - 1]] : s))
      const res = await api.recognize(thinned)
      if (mine === seq.current) {
        setCandidates(res.candidates)
        setError(null)
      }
    } catch (e) {
      if (mine === seq.current) setError(String((e as Error).message ?? e))
    }
  }, [])

  function pos(e: React.PointerEvent): [number, number] {
    const r = canvasRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE]
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    strokes.current.push([pos(e)])
    paint()
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    strokes.current[strokes.current.length - 1].push(pos(e))
    paint()
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    run()
  }

  function clear() {
    strokes.current = []
    setCandidates([])
    setDrawn(0)
    paint()
  }

  function undo() {
    strokes.current.pop()
    paint()
    run()
  }

  return (
    <div className="drawpad-wrap">
      <div className="drawpad-left">
        <canvas
          ref={canvasRef}
          className="drawpad"
          width={SIZE}
          height={SIZE}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          aria-label={t('area')}
        />

        <p className="drawpad-actions">
          <button className="clear" onClick={undo} disabled={drawn === 0}>
            {t('undo')}
          </button>
          <button className="clear" onClick={clear} disabled={drawn === 0}>
            {t('clear')}
          </button>
        </p>
        <p className="hint">
          {error ? error : !ready ? t('waking') : drawn === 0 ? null : t.plural('strokes', drawn)}
        </p>
      </div>

      {/* Picking types the character into the search and clears the box, so
          the next one starts on a clean pad. */}
      <div className="drawpad-right">
        {candidates.length > 0 && (
          <>
            <h3 className="draw-group">{t('didYouMean')}</h3>
            <div className="results">
              {candidates.map((c) => (
                <button
                  key={c.char}
                  className="result"
                  onClick={() => {
                    onPick(c.char)
                    clear()
                  }}
                  title={t('candidate', { m: meaningsOf(c, lang).value[0] ?? t('noEntry'), n: c.strokes })}
                >
                  {c.char}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
