"""Profile the existing BiRefNet -> matting boundary on authentic local images.
No model substitution, TLS bypass, image generation, or production publication.
"""
import argparse
import faulthandler
import json
from pathlib import Path
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('images', nargs='+', type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--threads', type=int, choices=range(1, 9))
parser.add_argument('--no-arena', action='store_true')
parser.add_argument('--basic-no-prepacking', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
records = []

def record(stage, start, **extra):
    value = {'stage': stage, 'ms': round((time.perf_counter() - start) * 1000), **extra}
    records.append(value)
    print(json.dumps(value), flush=True)
    (args.output / 'timing.json').write_text(json.dumps(records, indent=2), encoding='utf-8')

started = time.perf_counter()
faulthandler.dump_traceback_later(55)
from PIL import Image
from rembg import new_session, remove
import rembg.bg as bg
import onnxruntime as ort
record('imports', started)
options = ort.SessionOptions()
if args.threads:
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
if args.no_arena:
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
if args.basic_no_prepacking:
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    options.add_session_config_entry('session.disable_prepacking', '1')
started = time.perf_counter()
session = new_session('birefnet-general', sess_opts=options)
record('model_load', started, providers=session.inner_session.get_providers(), threads=args.threads,
       no_arena=args.no_arena, basic_no_prepacking=args.basic_no_prepacking)

original_normalize = session.normalize
original_run = session.inner_session.run
original_matting = bg.alpha_matting_cutout

def normalize(*values, **kwargs):
    started = time.perf_counter()
    result = original_normalize(*values, **kwargs)
    record('preprocess', started)
    return result

def inference(*values, **kwargs):
    started = time.perf_counter()
    result = original_run(*values, **kwargs)
    record('inference', started)
    return result

def matting(*values, **kwargs):
    started = time.perf_counter()
    result = original_matting(*values, **kwargs)
    record('alpha_matting', started)
    return result

session.normalize = normalize
session.inner_session.run = inference
bg.alpha_matting_cutout = matting
for source in args.images:
    started = time.perf_counter()
    with Image.open(source) as original:
        image = original.convert('RGB')
    record('decode', started, source=source.name)
    started = time.perf_counter()
    result = remove(image, session=session, alpha_matting=True,
                    alpha_matting_foreground_threshold=240,
                    alpha_matting_background_threshold=10, alpha_matting_erode_size=5)
    record('remove_total', started, source=source.name)
    started = time.perf_counter()
    result.save(args.output / source.name)
    record('encode', started, source=source.name)
faulthandler.cancel_dump_traceback_later()
