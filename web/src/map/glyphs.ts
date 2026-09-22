/**
 * Sprite atlas for map nodes.
 *
 * A node is a plate and a glyph. Drawing that with arc() + fillText() costs a
 * path and a text layout per node per frame, which at a few thousand visible
 * nodes is most of the frame. Instead each (character, colour) is rendered
 * once into a shared atlas and every later frame is a single drawImage.
 *
 * Two resolutions, so a glyph is never scaled up far enough to blur: small
 * cells for the usual case, large ones for nodes seen up close. When the
 * atlases fill, they are dropped wholesale and refilled from what is on screen
 * -- simpler than an LRU and, since only visible nodes are drawn, cheap.
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
  atlases: HTMLCanvasElement[]
  used: number
}

const ATLAS = 2048
const MAX_ATLASES = 6

export class GlyphAtlas {
  private tiers: Tier[] = [
    { cell: 64, radius: 30, atlases: [], used: 0 },
    { cell: 192, radius: 94, atlases: [], used: 0 },
  ]
  private where = new Map<string, { atlas: HTMLCanvasElement; x: number; y: number; tier: Tier }>()

  /** Forget everything, e.g. once the web font has loaded. */
  clear() {
    this.where.clear()
    for (const t of this.tiers) {
      t.atlases = []
      t.used = 0
    }
  }

  private budget = Infinity
  /** Sprites wanted this frame but deferred by the budget. */
  pending = 0

  /**
   * Cap how many new sprites one frame may render. Zooming into fresh ground
   * can want hundreds at once; spreading them over a few frames keeps the
   * zoom itself smooth, with the other resolution standing in meanwhile.
   */
  beginFrame(budget: number) {
    this.budget = budget
    this.pending = 0
  }

  /** Draw `char` as a plate of radius `r` CSS pixels centred on x, y. */
  draw(ctx: CanvasRenderingContext2D, char: string, style: SpriteStyle, x: number, y: number, r: number, dpr: number) {
    const small = r * dpr <= this.tiers[0].radius * 1.15
    let tier = small ? this.tiers[0] : this.tiers[1]
    let at = this.where.get(`${tier.cell}|${style.key}|${char}`)
    if (!at && this.budget > 0) {
      this.budget--
      at = this.render(tier, char, style)
      this.where.set(`${tier.cell}|${style.key}|${char}`, at)
    }
    if (!at) {
      this.pending++
      const other = small ? this.tiers[1] : this.tiers[0]
      at = this.where.get(`${other.cell}|${style.key}|${char}`)
      if (!at) return
      tier = other
    }
    const size = (r / tier.radius) * tier.cell
    ctx.drawImage(at.atlas, at.x, at.y, tier.cell, tier.cell, x - size / 2, y - size / 2, size, size)
  }

  private render(tier: Tier, char: string, style: SpriteStyle) {
    const perRow = Math.floor(ATLAS / tier.cell)
    const perAtlas = perRow * perRow
    if (tier.used >= perAtlas * MAX_ATLASES) {
      // Full: start over. Entries for this tier are stale, the other tier's stay.
      for (const [k, v] of this.where) if (v.tier === tier) this.where.delete(k)
      tier.atlases = []
      tier.used = 0
    }
    const n = tier.used++
    const a = Math.floor(n / perAtlas)
    if (!tier.atlases[a]) {
      const c = document.createElement('canvas')
      c.width = ATLAS
      c.height = ATLAS
      tier.atlases[a] = c
    }
    const atlas = tier.atlases[a]
    const slot = n % perAtlas
    const x = (slot % perRow) * tier.cell
    const y = Math.floor(slot / perRow) * tier.cell

    const ctx = atlas.getContext('2d')!
    const cx = x + tier.cell / 2
    const cy = y + tier.cell / 2
    const r = tier.radius
    ctx.clearRect(x, y, tier.cell, tier.cell)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = style.plate
    ctx.fill()
    ctx.lineWidth = Math.max(1, r / 22)
    ctx.strokeStyle = style.stroke
    ctx.stroke()
    ctx.font = `${Math.round(r * 1.28)}px ${style.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.glyph
    ctx.fillText(char, cx, cy + r * 0.04)
    return { atlas, x, y, tier }
  }
}
