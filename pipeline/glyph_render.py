"""Draw a character from its KanjiVG strokes, and look at it with DaKanji.

KanjiVG paths are SVG in a 109x109 box. They are sampled into polylines here
(no SVG library needed: KanjiVG uses only M, C/c, S/s and the odd L/l) and
drawn light on black at 128x128, the way the drawing pad feeds the model in
web/src/draw/classifier.ts. The glyph keeps its place in the em box rather
than being recentred, so 口 and 囗 stay different sizes.

The model is DaKanji v2 (web/src/draw/dakanji, MIT). Two of its layers are
read, not just its answer: the 128-number pooled feature vector before the
classifier, and the raw scores for all 6,507 classes before the softmax.
"""

import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent.parent
MODEL = ROOT / "web" / "src" / "draw" / "dakanji" / "char_classifier.onnx"
LABELS = ROOT / "web" / "src" / "draw" / "dakanji" / "labels.txt"

SIZE = 128
MARGIN = 0.12
LINE = 6
BOX = 109.0

_TOKEN = re.compile(r"([MmLlHhVvCcSsQqTtZz])|(-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?)")
_ARGS = {"m": 2, "l": 2, "h": 1, "v": 1, "c": 6, "s": 4, "q": 4, "t": 2}


def _cubic(p0, p1, p2, p3, n=8):
    t = np.linspace(0, 1, n + 1)[1:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def path_points(d: str) -> np.ndarray:
    """Sample one SVG path into an (n, 2) polyline."""
    pts: list[np.ndarray] = []
    cur = np.zeros(2)
    start = np.zeros(2)
    last_ctrl = None
    cmd = ""
    nums: list[float] = []

    def run(cmd: str, nums: list[float]) -> None:
        nonlocal cur, start, last_ctrl
        k = _ARGS[cmd.lower()]
        rel = cmd.islower()
        for i in range(0, len(nums) - k + 1, k):
            g = np.array(nums[i:i + k], dtype=float)
            base = cur if rel else np.zeros(2)
            c = cmd.lower()
            if c == "m":
                cur = base + g
                start = cur.copy()
                pts.append(cur[None])
                cmd = "l" if rel else "L"  # repeated moveto groups are linetos
                last_ctrl = None
            elif c == "l":
                cur = base + g
                pts.append(cur[None])
                last_ctrl = None
            elif c == "h":
                cur = np.array([(cur[0] if rel else 0) + g[0], cur[1]])
                pts.append(cur[None])
                last_ctrl = None
            elif c == "v":
                cur = np.array([cur[0], (cur[1] if rel else 0) + g[0]])
                pts.append(cur[None])
                last_ctrl = None
            elif c == "c":
                p1, p2, p3 = base + g[0:2], base + g[2:4], base + g[4:6]
                pts.append(_cubic(cur, p1, p2, p3))
                last_ctrl, cur = p2, p3
            elif c == "s":
                p1 = 2 * cur - last_ctrl if last_ctrl is not None else cur
                p2, p3 = base + g[0:2], base + g[2:4]
                pts.append(_cubic(cur, p1, p2, p3))
                last_ctrl, cur = p2, p3
            elif c in "qt":  # not used by KanjiVG; treat as a straight line
                cur = base + g[-2:]
                pts.append(cur[None])
                last_ctrl = None

    for m in _TOKEN.finditer(d):
        if m.group(1):
            if cmd and nums:
                run(cmd, nums)
            nums = []
            cmd = m.group(1)
            if cmd in "Zz":
                cur = start.copy()
                pts.append(cur[None])
                cmd = ""
        else:
            nums.append(float(m.group(2)))
    if cmd and nums:
        run(cmd, nums)
    return np.concatenate(pts) if pts else np.zeros((0, 2))


def render(paths: list[str], size: int = SIZE, line: float = LINE) -> np.ndarray:
    """Light-on-black image of the strokes, float32 0..255, in the em box."""
    img = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(img)
    scale = size * (1 - 2 * MARGIN) / BOX
    off = size * MARGIN
    w = max(1, round(line * size / SIZE))
    for d in paths:
        p = path_points(d) * scale + off
        if len(p) == 1:
            p = np.vstack([p, p + 0.1])
        xy = [tuple(q) for q in p]
        draw.line(xy, fill=255, width=w, joint="curve")
        r = w / 2
        for q in (xy[0], xy[-1]):  # round caps
            draw.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
    return np.asarray(img, dtype=np.float32)


@lru_cache(maxsize=1)
def labels() -> list[str]:
    return list(LABELS.read_text(encoding="utf-8").strip())


@lru_cache(maxsize=1)
def _session():
    import onnx
    import onnxruntime as ort

    m = onnx.load(str(MODEL))
    have = {o.name for o in m.graph.output}
    for name in ("view_DequantizeLinear_Output", "linear_1"):
        if name not in have:
            m.graph.output.append(onnx.helper.make_empty_tensor_value_info(name))
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(m.SerializeToString(), opts, providers=["CPUExecutionProvider"])


def look(images: np.ndarray, batch: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """(features (n,128), logits (n,6507)) for a stack of (n,128,128) images."""
    s = _session()
    feats, logits = [], []
    for i in range(0, len(images), batch):
        x = images[i:i + batch][:, None]
        f, l = s.run(["view_DequantizeLinear_Output", "linear_1"], {"image": x})
        feats.append(f.reshape(len(x), -1))
        logits.append(l)
    return np.concatenate(feats), np.concatenate(logits)
