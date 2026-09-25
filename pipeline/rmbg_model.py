"""Build the subject-selection model the drawing editor loads: RMBG-1.4 for the browser.

BRIA publishes RMBG-1.4 as fp32 (176 MB), fp16 (88 MB) and int8 (44 MB). The
int8 one computes in integers (ConvInteger), which only the CPU runs, and
loses detail; the fp32 one is four times the download. This keeps fp32
compute but stores each convolution's weights as int8 with one scale per
output channel, turned back into floats when the model loads: 44 MB to fetch,
the same masks as fp32 (IoU 0.99 on test photos, against 0.94-0.99 for BRIA's
int8), and it runs on WebGPU as well as the CPU.

The input's height and width are also made free, so a device without WebGPU
can run it at 512 px in a quarter of the time.

    pip install onnx numpy
    python pipeline/rmbg_model.py          # -> web/public/models/rmbg-1.4-w8.onnx

The output is not in git (web/.gitignore); run this before `npm run build`.
Without it the editor falls back to BRIA's int8 model, fetched from Hugging
Face. Licence: Bria RMBG-1.4, non-commercial use.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

REVISION = "2ceba5a5efaec153162aedea169f76caf9b46cf8"
SOURCE = f"https://huggingface.co/briaai/RMBG-1.4/resolve/{REVISION}/onnx/model.onnx"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "models" / "rmbg-1.4-w8.onnx"
CACHE = ROOT / "pipeline" / "data" / f"rmbg-1.4-{REVISION[:8]}.onnx"


def fetch() -> Path:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"fetching {SOURCE}", flush=True)
        tmp = CACHE.with_suffix(".part")
        urllib.request.urlretrieve(SOURCE, tmp)
        tmp.rename(CACHE)
    return CACHE


def build(src: Path, out: Path) -> None:
    m = onnx.load(str(src))
    g = m.graph

    dims = g.input[0].type.tensor_type.shape.dim
    dims[2].dim_param = "height"
    dims[3].dim_param = "width"

    # The model is opset 11, before DequantizeLinear took an axis, so the
    # per-channel scale is a Cast and a Mul -- both folded away on load.
    inits = {i.name: i for i in g.initializer}
    weights = sorted({n.input[1] for n in g.node if n.op_type == "Conv"})
    nodes = []
    for name in weights:
        w = numpy_helper.to_array(inits[name])
        shape = (w.shape[0],) + (1,) * (w.ndim - 1)
        scale = np.abs(w.reshape(w.shape[0], -1)).max(1) / 127
        scale[scale == 0] = 1e-8
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        g.initializer.remove(inits[name])
        g.initializer.extend(
            [
                numpy_helper.from_array(q, f"{name}_q"),
                numpy_helper.from_array(scale.reshape(shape).astype(np.float32), f"{name}_s"),
            ]
        )
        nodes += [
            helper.make_node("Cast", [f"{name}_q"], [f"{name}_f"], to=TensorProto.FLOAT),
            helper.make_node("Mul", [f"{name}_f", f"{name}_s"], [name]),
        ]
    for n in reversed(nodes):
        g.node.insert(0, n)

    onnx.checker.check_model(m)
    out.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(out))
    print(f"{out.relative_to(ROOT)}: {out.stat().st_size / 1e6:.1f} MB, {len(weights)} convolutions")


if __name__ == "__main__":
    build(fetch(), Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
