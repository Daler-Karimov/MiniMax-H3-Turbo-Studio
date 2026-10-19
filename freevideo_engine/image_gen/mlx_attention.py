"""Image attention through MLX's fused Metal kernel on Apple GPUs.

At the 1024 x 1024 shape (4125 keys, 32 heads of 128) Torch's MPS attention
ran at about 3.5 TFLOPS on an M5; this kernel is the one the Mac video engine
already uses. Q/K/V and the output share their Metal buffers through DLPack.
"""
import math

import torch

from ..backends.mps_mlx_attention import to_mlx_many, to_torch


def available():
    try:
        import mlx.core  # noqa: F401
    except Exception:
        return False
    return True


def routed(fallback, *, min_queries=256):
    """``attention`` for image-sized calls; short text segments, where the hand-over costs more, keep ``fallback``."""
    def run(query, key, value, attn_mask=None):
        if query.shape[1] < min_queries:
            return fallback(query, key, value, attn_mask=attn_mask)
        return attention(query, key, value, attn_mask=attn_mask)
    return run


def attention(query, key, value, attn_mask=None):
    """Same contract as ``qwen_dit.attention``: (batch, sequence, heads, dim), boolean mask or None."""
    import mlx.core as mx
    tensors = (query, key, value) if attn_mask is None else (query, key, value, attn_mask)
    arrays = to_mlx_many(tensors)
    q, k, v = (mx.swapaxes(array, 1, 2) for array in arrays[:3])
    mask = arrays[3] if attn_mask is not None else None
    out = mx.fast.scaled_dot_product_attention(q, k, v, scale=1 / math.sqrt(query.shape[-1]), mask=mask)
    out = mx.contiguous(mx.swapaxes(out, 1, 2))
    result = to_torch(out, query.device)
    del arrays, q, k, v, mask, out
    # One unified pool: do not let MLX keep the freed buffers from Torch.
    mx.clear_cache()
    return result
