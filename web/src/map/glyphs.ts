/**
 * Sprite atlas for map nodes.
 *
 * A node is a plate and a glyph. Drawing that with arc() + fillText() costs a
 * path and a text layout per node per frame, which at a few thousand visible
 * nodes is most of the frame. Instead each (character, colour) is rendered
 * once into a shared atlas and every later frame is a single drawImage.
 *
 * Three resolutions, so a glyph is never scaled up far enough to blur: tiny
 * cells for the many nodes that have only just resolved from points, small
 * ones for the usual case, large ones for nodes seen up close. The tiny tier
 * holds a whole scope at once and is rendered ahead while the page is idle, so
 * that zooming into fresh ground finds every glyph ready.
 *
 * Nothing on screen ever vanishes for want of a sprite. A node whose sprite
 * is not ready borrows another resolution, and failing that `draw` says so
 * and the caller draws it live. Missing sprites are rendered at the end of
 * the frame, within a time budget, never in the middle of it: writing to an
 * atlas between two drawImage calls from it makes the browser snapshot the
 * whole canvas again, which cost more than all the drawing. When a tier
 * fills, only sprites not drawn in the last two frames give up their cells,
 * so a zoom or pan never redraws what is already there.
 */

export interface SpriteStyle {
  key: string
  plate: string
  stroke: string
  glyph: string
  font: string
}

interface Tier {
  cell: number
  /** plate radius inside a cell, leaving room for the stroke */
  radius: number
  perRow: number
  perAtlas: number
  capacity: number
  atlases: HTMLCanvasElement[]
  /** cells ever handed out */
  used: number
  /** cells given back by eviction */
  free: number[]
}

interface Sprite {
  tier: Tier
  slot: number
  x: number
  y: number
  /** frame number this sprite was last drawn in; 0 for one rendered ahead */
  seen: number
}

interface Want {
  tier: Tier
  char: string
  style: SpriteStyle
}

/** Atlas canvases are kept small so that a write invalidates little. */
const ATLAS = 1024
/** A sprite may be drawn this much larger than its cell before the next tier is wanted. */
const UPSCALE = 1.15

function makeTier(cell: number, radius: number, atlases: number): Tier {
  const perRow = Math.floor(ATLAS / cell)
  const perAtlas = perRow * perRow
  return { cell, radius, perRow, perAtlas, capacity: perAtlas * atlases, atlases: [], used: 0, free: [] }
}

export class GlyphAtlas {
  // Tiny: 14 × 1024 cells hold the widest scope (13.5k); atlases are made as
  // needed, so a small scope costs one. Small: 4096 cells. Large: 300.
  private tiers: Tier[] = [makeTier(32, 14, 14), makeTier(64, 30, 16), makeTier(192, 94, 12)]
  private where = new Map<string, Sprite>()
  private wanted = new Map<string, Want>()
  private frame = 2
  /** Sprites drawn this frame from a stand-in or not at all, still to render. */
  pending = 0

  /** How many tiny sprites can be held at once, i.e. how many `prewarm` can take. */
  get capacity() {
    return this.tiers[0].capacity
  }

  /** Forget everything, e.g. once the web font has loaded. */
  clear() {
    this.where.clear()
    this.wanted.clear()
    for (const t of this.tiers) {
      t.atlases = []
      t.used = 0
      t.free = []
    }
  }

  beginFrame() {
    this.frame++
    this.wanted.clear()
    this.pending = 0
  }

  /**
   * Draw `char` as a plate of radius `r` CSS pixels centred on x, y.
   * False when no sprite of it exists yet at any resolution.
   */
  draw(ctx: CanvasRenderingContext2D, char: string, style: SpriteStyle, x: number, y: number, r: number, dpr: number): boolean {
    const want = r * dpr
    let ti = this.tiers.findIndex((t) => want <= t.radius * UPSCALE)
    if (ti < 0) ti = this.tiers.length - 1
    let tier = this.tiers[ti]
    const key = `${tier.cell}|${style.key}|${char}`
    let sp = this.where.get(key)
    if (!sp) {
      this.pending++
      if (!this.wanted.has(key)) this.wanted.set(key, { tier, char, style })
      // Stand in with another resolution: a larger one scales down sharp, so
      // those first, then smaller ones (the tiny tier is nearly always there).
      for (let j = ti + 1; j < this.tiers.length && !sp; j++) sp = this.at(j, style, char)
      for (let j = ti - 1; j >= 0 && !sp; j--) sp = this.at(j, style, char)
      if (!sp) return false
      tier = sp.tier
    }
    sp.seen = this.frame
    const size = (r / tier.radius) * tier.cell
    const src = tier.atlases[Math.floor(sp.slot / tier.perAtlas)]
    ctx.drawImage(src, sp.x, sp.y, tier.cell, tier.cell, x - size / 2, y - size / 2, size, size)
    return true
  }

  /**
   * Render what this frame found missing, for up to `ms` milliseconds. Call
   * once all drawing is done. Zooming into fresh ground can want hundreds at
   * once; whatever does not fit is asked for again next frame if still
   * visible. `pending` afterwards says how many are left.
   */
  endFrame(ms: number) {
    const t0 = performance.now()
    for (const [key, w] of this.wanted) {
      if (performance.now() - t0 > ms) break
      this.wanted.delete(key)
      if (!this.where.has(key)) this.render(w.tier, w.char, w.style, true, this.frame)
    }
    this.pending = this.wanted.size
  }

  /**
   * Render a tiny sprite ahead of need. Never evicts anything: false once the
   * tier is full, so a caller can stop.
   */
  prewarm(char: string, style: SpriteStyle): boolean {
    const tier = this.tiers[0]
    if (this.where.has(`${tier.cell}|${style.key}|${char}`)) return true
    return this.render(tier, char, style, false, 0) !== null
  }

  private at(ti: number, style: SpriteStyle, char: string): Sprite | undefined {
    return this.where.get(`${this.tiers[ti].cell}|${style.key}|${char}`)
  }

  private claim(tier: Tier, evict: boolean): number {
    if (tier.free.length) return tier.free.pop()!
    if (tier.used < tier.capacity) return tier.used++
    if (!evict) return -1
    // Full: release what has not been drawn in the last two frames. What is
    // on screen keeps its cell, so nothing visible disappears.
    for (const [k, v] of this.where) {
      if (v.tier === tier && v.seen < this.frame - 1) {
        this.where.delete(k)
        tier.free.push(v.slot)
      }
    }
    return tier.free.length ? tier.free.pop()! : -1
  }

  private render(tier: Tier, char: string, style: SpriteStyle, evict: boolean, seen: number): Sprite | null {
    const slot = this.claim(tier, evict)
    if (slot < 0) return null
    const a = Math.floor(slot / tier.perAtlas)
    if (!tier.atlases[a]) {
      const c = document.createElement('canvas')
      c.width = ATLAS
      c.height = ATLAS
      tier.atlases[a] = c
    }
    const atlas = tier.atlases[a]
    const i = slot % tier.perAtlas
    const x = (i % tier.perRow) * tier.cell
    const y = Math.floor(i / tier.perRow) * tier.cell

    const ctx = atlas.getContext('2d')!
    const cx = x + tier.cell / 2
    const cy = y + tier.cell / 2
    const r = tier.radius
    ctx.clearRect(x, y, tier.cell, tier.cell)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = style.plate
    ctx.fill()
    ctx.lineWidth = Math.max(0.75, r / 22)
    ctx.strokeStyle = style.stroke
    ctx.stroke()
    ctx.font = `${Math.round(r * 1.28)}px ${style.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.glyph
    ctx.fillText(char, cx, cy + r * 0.04)

    const sp: Sprite = { tier, slot, x, y, seen }
    this.where.set(`${tier.cell}|${style.key}|${char}`, sp)
    return sp
  }
}
