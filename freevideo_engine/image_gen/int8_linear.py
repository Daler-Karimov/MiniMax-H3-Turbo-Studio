"""The int8 projections of the image model, per platform.

``ops()`` is the engine's CUDA ``int8_ops`` everywhere but macOS, where Triton
does not exist. There the same prepared ConvRot rows run on the Apple GPU: on
an M5 or newer through the TensorOps int8 kernels of ``backends.mps_int8``
(one int8 scale per activation row, like CUDA); on older Apple GPUs the
activation is rotated and multiplied by the int8 rows widened to BF16, with
the row scales applied to the output.
"""
import sys

import torch
from torch.nn import functional as F

GROUP = 256
_H16 = {}


def ops():
    """The module providing ``Int8Linear`` and ``install_cached_linears`` on this platform."""
    if sys.platform == 'darwin':
        return sys.modules[__name__]
    from .. import int8_ops
    return int8_ops


def hadamard16(device):
    """H4 (x) H4 / 4 with H4 = [[1,1,1,-1],[1,1,-1,1],[1,-1,1,1],[-1,1,1,1]] (FP32), as in int8_ops."""
    key = str(device)
    if key not in _H16:
        h4 = torch.tensor([[1, 1, 1, -1], [1, 1, -1, 1], [1, -1, 1, 1], [-1, 1, 1, 1]], dtype=torch.float32)
        _H16[key] = (torch.kron(h4, h4) / 4).to(device).contiguous()
    return _H16[key]


def rotate(rows):
    """[M, K] rows times the group-256 ConvRot rotation H256 = H16 (x) H16, in FP32."""
    h16 = hadamard16(rows.device)
    groups = rows.float().reshape(rows.shape[0], -1, 16, 16)
    return (h16 @ groups @ h16).reshape(rows.shape)


def _tensor_ops(linear):
    from ..backends import mps_int8
    return (mps_int8.available() and linear.in_features <= mps_int8.CONVROT_DEPTH
            and linear.out_features % mps_int8.TILE == 0)


class Int8Linear(torch.nn.Module):
    """A prepared ConvRot int8 Linear on an Apple GPU; the buffers are those of int8_ops.Int8Linear.

    The most recent prepared input is shared by every Int8Linear, so Q/K/V
    quantize (or rotate) the same activation once; the entry keeps its source alive.
    """
    _last = {}

    @property
    def bias(self):
        return self.original.bias

    def prepared(self, rows, quantize):
        key = (rows.data_ptr(), rows._version, tuple(rows.shape), tuple(rows.stride()), str(rows.device), quantize)
        last = Int8Linear._last
        if last.get('key') != key:
            last.clear()
            if quantize:
                from ..backends import mps_int8
                value = mps_int8.quantize_rows(rows, convrot=True)
            else:
                value = rotate(rows).to(rows.dtype)
            last.update(key=key, source=rows, value=value)
        return last['value']

    def forward(self, value):
        rows = value.reshape(-1, value.shape[-1])
        if rows.stride(-1) != 1:
            rows = rows.contiguous()
        scales = self.weight_scale.reshape(-1)
        quantize = value.dtype in (torch.bfloat16, torch.float16) and _tensor_ops(self)
        if quantize:
            from ..backends import mps_int8
            output = mps_int8.matmul(self.prepared(rows, True), self.weight_int8, scales, dtype=value.dtype)
        else:
            # int8 values are exact in BF16; the row scales go on the output, in FP32.
            output = F.linear(self.prepared(rows, False), self.weight_int8.to(value.dtype))
            output = output.float().mul_(scales).to(value.dtype)
        if self.bias is not None:
            output = output + self.bias
        return output.reshape(*value.shape[:-1], self.out_features)


def install_cached_linears(model, linears, rotation):
    """Replace prepared int8 Linears with meta int8 placeholders for layer loading (as int8_ops)."""
    if rotation is None or rotation.get('kind') != 'convrot' or rotation.get('group') != GROUP:
        raise ValueError('Int8 projections need ConvRot group-256 weights')
    for name, spec in linears.items():
        if spec.get('storage') != 'int8' or spec.get('convrot_group') != GROUP:
            raise ValueError('Int8 cache entry is not a ConvRot int8 matrix: ' + name)
        original = model.get_submodule(name)
        if not isinstance(original, torch.nn.Linear):
            raise ValueError('Int8 cache target is not a Linear: ' + name)
        if list(original.weight.shape) != spec['weight_shape'] or original.in_features % GROUP:
            raise ValueError('Int8 cache shape differs from the official model: ' + name)
        replacement = Int8Linear.__new__(Int8Linear)
        torch.nn.Module.__init__(replacement)
        replacement.register_buffer('weight_int8', torch.empty(spec['weight_shape'], dtype=torch.int8, device='meta'))
        replacement.register_buffer('weight_scale', torch.empty(spec['scale_shape'], dtype=torch.float32, device='meta'))
        replacement.original = torch.nn.Module()
        replacement.original.register_parameter('bias', original.bias)
        replacement.in_features = original.in_features
        replacement.out_features = original.out_features
        replacement.input_dtype = getattr(torch, spec.get('input_dtype', 'bfloat16'))
        prefix, _, child = name.rpartition('.')
        setattr(model.get_submodule(prefix) if prefix else model, child, replacement)
