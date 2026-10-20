"""File-backed image weights for Apple GPUs.

On a Mac the card's memory is the host's. Weights copied into ordinary memory
and onto the GPU heap stay wired while the GPU uses them, and a 24 GB machine
with a browser open swapped the other programs out at gigabytes per second to
hold the 15 GB model. Here the stacked layers' weights are read-only views of
the checkpoint's own mapped pages, which the system can drop and read again
instead of swapping, and ``MappedStack`` lends each layer to the GPU for its
pass. Only ``set_resident`` layers keep their GPU copy between passes.
"""
import json
import mmap
import struct
import warnings

import torch

_DTYPES = {'BF16': torch.bfloat16, 'F16': torch.float16, 'F32': torch.float32, 'I8': torch.int8,
           'U8': torch.uint8, 'I32': torch.int32, 'I64': torch.int64}


class MappedCheckpoint:
    """A safetensors reader whose ``get_tensor`` returns views of the mapped file.

    Everything else (keys, slices, metadata) is the wrapped reader's, so the
    loaders validate exactly what they validate without it.
    """

    def __init__(self, reader, path):
        self.reader = reader
        with open(path, 'rb') as stream:
            size, = struct.unpack('<Q', stream.read(8))
            header = json.loads(stream.read(size))
            self.mapping = mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ)
        self.start = 8 + size
        self.header = {key: value for key, value in header.items() if key != '__metadata__'}
        with warnings.catch_warnings():
            # Read-only checkpoint bytes: the views are only ever copy sources.
            warnings.simplefilter('ignore', UserWarning)
            self.data = torch.frombuffer(self.mapping, dtype=torch.uint8)

    def __getattr__(self, name):
        return getattr(self.reader, name)

    def get_tensor(self, key):
        entry = self.header.get(key)
        dtype = _DTYPES.get(entry['dtype']) if entry else None
        if dtype is None:
            return self.reader.get_tensor(key)
        begin, end = entry['data_offsets']
        begin += self.start
        size = torch.empty((), dtype=dtype).element_size()
        if begin % size:
            return self.reader.get_tensor(key)   # unaligned: an ordinary copy
        return self.data[begin:self.start + end].view(dtype).reshape(entry['shape'])


def _stores(layer):
    for module in layer.modules():
        for store, parameter in ((module._parameters, True), (module._buffers, False)):
            for key, tensor in store.items():
                if tensor is not None:
                    yield store, key, tensor, parameter


class MappedStack:
    """Layers whose weights live on the host (mapped or not), moved to the GPU for each pass."""

    def __init__(self, layers, *, name, device):
        self.name = name
        self.layers = list(layers)
        if not self.layers:
            raise ValueError('MappedStack needs at least one layer')
        self.device = torch.device(device)
        self.host = [list(_stores(layer)) for layer in self.layers]
        self.layer_bytes = max(sum(t.numel() * t.element_size() for _, _, t, _ in entries) for entries in self.host)
        # Mapped pages are the file's, not this process's: the system takes them back when it needs them.
        self.host_bytes = 0
        self.resident = 0
        self.bound = set()
        self.copied_bytes = 0
        self.hooks = []
        for index, layer in enumerate(self.layers):
            self.hooks.append(layer.register_forward_pre_hook(lambda module, args, index=index: self._bind(index)))
            self.hooks.append(layer.register_forward_hook(
                lambda module, args, output, index=index: self._release(index)))

    at_boundary = True

    @property
    def offloader(self):
        return self

    def _bind(self, index):
        if index in self.bound:
            return
        for store, key, tensor, parameter in self.host[index]:
            value = tensor.to(self.device)
            store[key] = torch.nn.Parameter(value, requires_grad=False) if parameter else value
            self.copied_bytes += tensor.numel() * tensor.element_size()
        self.bound.add(index)

    def _unbind(self, index):
        for store, key, tensor, _ in self.host[index]:
            store[key] = tensor
        self.bound.discard(index)

    def _release(self, index):
        if index >= self.resident:
            self._unbind(index)

    def set_resident(self, count):
        """Keep the first ``count`` layers' GPU copies between passes (filled on their next use)."""
        count = max(0, min(int(count), len(self.layers)))
        for index in sorted(self.bound):
            if index >= count:
                self._unbind(index)
        self.resident = count
        return count

    def stats(self):
        return dict(name=self.name, layers=len(self.layers), layer_bytes=self.layer_bytes, pinned_layers=0,
                    pinned_bytes=0, resident_layers=self.resident, cached_bytes=len(self.bound) * self.layer_bytes,
                    copied_bytes=self.copied_bytes, mapped=True)

    def close(self):
        for hook in self.hooks:
            hook.remove()
        for index in list(self.bound):
            self._unbind(index)
