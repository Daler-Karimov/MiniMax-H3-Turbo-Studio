"""Tell from a LoRA file's header alone whether it can be used with the FreeVideo model.

Only the key names and tensor shapes are read; no weights are loaded. The module
list below is the model's fixed layout, so the verdict needs no prepared model.
The engine still makes the exact check when it merges the adapter.
"""
import json
import os
import re
import struct
import threading

from .lora_names import _targets

MAX_HEADER_BYTES = 64 * 1024 * 1024
BLOCKS, REFINER_BLOCKS = 50, 2
UNCHECKED = None  # known module, shape not asserted here


def _layout():
    shapes = {}
    for scope, count in (('transformer_blocks', BLOCKS), ('token_refiner.refiner_blocks', REFINER_BLOCKS)):
        for i in range(count):
            p = f'{scope}.{i}.'
            attn = p + ('attn.orig.' if scope == 'transformer_blocks' else 'attn.')
            for name in ('to_q', 'to_k', 'to_v'):
                shapes[attn + name] = (7168, 5376)
            shapes[attn + 'to_out.0'] = (5376, 7168)
            shapes[p + 'ff.net.0.proj'] = (28672, 5376)
            shapes[p + 'ff.net.2'] = (5376, 14336)
    for i in range(BLOCKS):
        p = f'transformer_blocks.{i}.'
        shapes[p + 'attn.to_out_linear'] = (5376, 7168)
        shapes[p + 'adaln_proj.linear'] = UNCHECKED
        shapes[p + 'attn.linear_attention.alpha.down'] = (128, 5376)
        shapes[p + 'attn.linear_attention.alpha.up'] = (7168, 128)
        shapes[p + 'attn.linear_attention.beta_proj'] = (56, 5376)
        shapes[p + 'attn.linear_attention.output_gate.down'] = (128, 5376)
        shapes[p + 'attn.linear_attention.output_gate.up'] = (7168, 128)
        shapes[p + 'attn.softmax_gate.up'] = (56, 5376)
        shapes[p + 'attn.linear_attention.norm'] = (128,)
        for name, shape in (('k_sp', (7168, 1, 5, 5)), ('v_sp', (7168, 1, 5, 5)), ('k_tm', (7168, 1, 5)), ('v_tm', (7168, 1, 5))):
            shapes[p + 'attn.linear_attention.short_conv.' + name] = shape
        shapes[p + 'attn.orig.norm_k'] = shapes[p + 'attn.orig.norm_q'] = (128,)
        shapes[p + 'norm1'] = shapes[p + 'norm2'] = (5376,)
    for i in range(REFINER_BLOCKS):
        p = f'token_refiner.refiner_blocks.{i}.'
        shapes[p + 'attn.norm_k'] = shapes[p + 'attn.norm_q'] = (128,)
        shapes[p + 'norm1'] = shapes[p + 'norm2'] = (5376,)
    shapes.update({
        'context_embedder': (5376, 5120), 'audio_proj_in': (5376, 32), 'audio_proj_out': (32, 5376),
        'proj_in': (5376, 96), 'proj_out': (96, 5376), 'time_embedder.linear_1': (5376, 256),
        'time_embedder.linear_2': (2688, 5376), 'norm_out.linear': (10752, 2688),
        'norm_out.norm': (5376,), 'token_refiner.final_norm': (5376,)})
    return shapes


LAYOUT = _layout()
UNUSABLE = 'This LoRA was not trained for the FreeVideo model and cannot be used.'
_CACHE, _LOCK = {}, threading.Lock()


def read_header(path):
    """The safetensors header as {name: shape} plus its metadata; ValueError when it is not one."""
    with open(path, 'rb') as stream:
        raw = stream.read(8)
        if len(raw) != 8:
            raise ValueError('Not a safetensors file')
        size = struct.unpack('<Q', raw)[0]
        if not 2 <= size <= MAX_HEADER_BYTES:
            raise ValueError('Not a safetensors file')
        text = stream.read(size)
    if len(text) != size:
        raise ValueError('Truncated safetensors header')
    try:
        header = json.loads(text.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError('Not a safetensors file') from error
    if not isinstance(header, dict):
        raise ValueError('Not a safetensors file')
    metadata = header.pop('__metadata__', None)
    shapes = {}
    for key, value in header.items():
        shape = value.get('shape') if isinstance(value, dict) else None
        if not isinstance(shape, list) or not all(type(n) is int and n >= 0 for n in shape):
            raise ValueError('Not a safetensors file')
        shapes[key] = tuple(shape)
    return shapes, metadata if isinstance(metadata, dict) else {}


def _find(target):
    """The model module a target name refers to (without any #bias mark), or None."""
    target = target.removesuffix('#bias')
    if target not in LAYOUT and '.attn.' in target:
        target = target.replace('.attn.', '.attn.orig.', 1)
    return target if target in LAYOUT else None


FAMILIES = (('wan', re.compile(r'\.(?:self_attn|cross_attn)\.|\.ffn\.\d|^head\.head')),
            ('hunyuan', re.compile(r'double_blocks|single_blocks')),
            ('ltx', re.compile(r'\.attn[12]\.')),
            ('sd', re.compile(r'down_blocks|up_blocks|input_blocks|lora_te|text_model')))


def family(keys):
    """Which other model a file's layer names belong to, or None when they match none we know."""
    for name, pattern in FAMILIES:
        if any(pattern.search(key) for key in keys):
            return name
    return None


def _bad(reason, keys, **detail):
    return dict(reason=reason, family=family(keys) if reason == 'other-model' else None, **detail)


def _block(target):
    found = re.search(r'blocks\.(\d+)\.', target)
    return int(found[1]) + 1 if found else None


def assess(shapes):
    """None when the adapter fits, else why not: reason 'other-model' (names of another model), 'shape' (our names,
    a different size) or 'format' (not a LoRA we can read). 'layer' and the sizes say where. A layer name the table
    does not list, in a file that matches no other known model, is let through."""
    keys = list(shapes)
    pairs, full = {}, []
    for key in keys:
        canonical = key.replace('.default.', '.').replace('.lora_down.weight', '.lora_A.weight').replace('.lora_up.weight', '.lora_B.weight')
        match = re.fullmatch(r'(.+)\.lora_([AB])\.weight', canonical)
        if match:
            pairs.setdefault(match[1], {})[match[2]] = shapes[key]
        elif canonical.endswith('.alpha'):
            pairs.setdefault(canonical[:-6], {})
        elif canonical.endswith(('.diff', '.diff_b')):
            bias = canonical.endswith('.diff_b')
            full.append((canonical[:-7] if bias else canonical[:-5], shapes[key], bias))
        else:
            return _bad('other-model' if family(keys) else 'format', keys, layer=key)
    if not any('A' in pair for pair in pairs.values()) and not full:
        return _bad('format', keys, layer=None)
    wrong = []
    for name, pair in pairs.items():
        if not {'A', 'B'} <= pair.keys():
            return _bad('format', keys, layer=name)
        a, b = pair['A'], pair['B']
        if len(a) != 2 or len(b) != 2 or a[0] != b[1] or a[0] <= 0:
            return _bad('format', keys, layer=name)
        for target, split, swap in _targets(name):
            found = _find(target)
            if found is None:
                if family(keys):
                    return _bad('other-model', keys, layer=name)
                continue  # a name this table does not list: the engine makes the exact check
            expected = LAYOUT[found]
            rows = b[0] if split is None else b[0] // 3
            if expected is UNCHECKED:
                continue
            if (split is not None and b[0] % 3) or (swap and rows % 2) or list(expected) != [rows, a[1]]:
                wrong.append((found, list(expected), [rows, a[1]]))
    for name, shape, bias in full:
        for target, split, swap in _targets(name):
            found = _find(target)
            if found is None:
                if family(keys):
                    return _bad('other-model', keys, layer=name)
                continue
            expected = LAYOUT[found]
            if bias or expected is UNCHECKED:
                continue
            actual = list(shape)
            if split is not None:
                if not actual or actual[0] % 3:
                    wrong.append((found, list(expected), actual))
                    continue
                actual[0] //= 3
            if actual != list(expected) or (swap and (not actual or actual[0] % 2)):
                wrong.append((found, list(expected), actual))
    if wrong:
        layer, expected, actual = wrong[0]
        return dict(reason='shape', family=None, layer=layer, block=_block(layer), expected=expected, actual=actual, count=len(wrong))
    return None


BASE_FIELDS = ('ss_base_model_version', 'modelspec.architecture', 'base_model', 'modelspec.implementation', 'ss_network_module')


def summarize(shapes, metadata):
    """Counts and a few names from the header; no path, no weights."""
    first = [[key, list(shapes[key])] for key in list(shapes)[:5]]
    base = {name: str(metadata[name])[:80] for name in BASE_FIELDS if name in metadata}
    return dict(keys=len(shapes), first=first, base=base)


def check_file(path):
    """{'usable', 'reason', ...} for a LoRA file, remembered until the file changes."""
    try:
        stat = os.stat(path)
        stamp = (str(path), stat.st_size, stat.st_mtime_ns)
    except OSError:
        return {'usable': False, 'reason': 'unreadable'}
    with _LOCK:
        if stamp in _CACHE:
            return dict(_CACHE[stamp])
    try:
        shapes, metadata = read_header(path)
        problem = assess(shapes)
        result = {'usable': problem is None, 'reason': None, **(problem or {}), 'summary': summarize(shapes, metadata)}
    except (OSError, ValueError):
        result = {'usable': False, 'reason': 'unreadable'}
    with _LOCK:
        if len(_CACHE) > 256:
            _CACHE.clear()
        _CACHE[stamp] = dict(result)
    return dict(result)


def require_usable(path):
    """Stop a request before generation starts when a LoRA cannot work with the model."""
    if not check_file(path)['usable']:
        raise ValueError(UNUSABLE)
