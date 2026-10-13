"""Progress-only history compatibility over the mainline timing record reader.

Capability estimates keep the mainline policy. Live progress also learns from
completed previews and retains its bounded asynchronous startup snapshot.
"""
import copy
import json
import platform
from pathlib import Path
import threading
import time

from . import effort_forecast
from .effort_forecast import positive, same_device, stage_forecast

_CACHE = {}


def timing_record(report, gpu_uuid, system):
    """Keep a completed preview's first pass as progress evidence only."""
    if not isinstance(report, dict):
        return None
    plan = report.get('sampling_plan') or report.get('geometry', {}).get('sampling_plan') or {}
    preview = bool(report.get('preview') or plan.get('preview'))
    if not preview or not plan.get('enabled'):
        return effort_forecast.timing_record(report, gpu_uuid, system, stage_details=True)
    parts = (report.get('video') or {}).get('sampling_passes')
    if not isinstance(parts, list) or len(parts) != 1:
        return None
    normalized = copy.deepcopy(report)
    normalized['sampling_plan'] = dict(plan, enabled=False)
    normalized['video']['step_seconds'] = parts[0].get('step_seconds')
    row = effort_forecast.timing_record(normalized, gpu_uuid, system, stage_details=True)
    if row is not None:
        row.update(two_pass=True, sampling_geometry={k: plan[k] for k in ('first', 'second') if plan.get(k)})
    return row


def estimate(records, canvas, **options):
    return effort_forecast.estimate([row for row in records if row.get('flow', 'full') == 'full'],
                                    canvas, **options)


_START_CONTEXT = {}
# Guards the entries above: only one background read per key, and readers
# always see a complete hardware/records pair. File IO stays outside it.
_START_LOCK = threading.Lock()


def _context_key(output_directory, machine):
    device = machine.get('device_identity') if machine.get('device_backend') == 'mps' else machine.get('gpu_uuid')
    system = machine.get('system') or platform.system()
    return (str(output_directory), json.dumps(device, sort_keys=True), system, machine.get('setup_run')), device, system


def start_context(output_directory, machine, *, timeout=.035):
    """Bound foreground IO to ~35 ms, even on slow/unavailable output disks.

    One daemon per key reads in the background. Its last result stays in use
    while a newer read runs (at most one every 15 s), so a request that starts
    minutes after the previous one still sees that run. A request that started
    before a read finished can pick it up later (history_read_at).
    No GPU calls, resident RPC, model scans, hashing or directory-wide cache
    inspection. Installation inventory describes identity, not live free RAM.
    """
    from threading import Event, Thread
    key, device, system = _context_key(output_directory, machine)
    start = False
    with _START_LOCK:
        entry = _START_CONTEXT.get(key)
        if entry is None:
            entry = dict(ready=Event(), started=None, read_at=None, hardware={}, records=[], reading=False)
            _START_CONTEXT[key] = entry
        now = time.monotonic()
        if not entry['reading'] and (entry['started'] is None or now - entry['started'] > 15):
            entry['reading'], entry['started'], start = True, now, True
    if start:
        def read():
            hardware, records = dict(entry['hardware']), list(entry['records'])
            try:
                if machine.get('setup_run'):
                    with (Path(machine['setup_run']) / 'plan.json').open('rb') as stream:
                        raw = stream.read(1024 * 1024 + 1)
                    if len(raw) <= 1024 * 1024:
                        found = json.loads(raw).get('inventory', {}).get('hardware', {})
                        if same_device(found, device):
                            hardware = {k: found[k] for k in
                                ('gpu_name', 'capability', 'ram_total', 'vram_total', 'system') if k in found}
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            try:
                records = local_records(output_directory, device, system=system)
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            finally:
                with _START_LOCK:
                    entry['hardware'], entry['records'] = hardware, records
                    entry['read_at'], entry['reading'] = time.monotonic(), False
                entry['ready'].set()
        Thread(target=read, name='freevideo-progress-history', daemon=True).start()
    if timeout and not entry['ready'].is_set():
        entry['ready'].wait(timeout)
    with _START_LOCK:
        return dict(entry['hardware']), list(entry['records'])


def history_read_at(output_directory, machine):
    """Monotonic time the last background read finished, or None."""
    with _START_LOCK:
        entry = _START_CONTEXT.get(_context_key(output_directory, machine)[0])
        return entry and entry['read_at']


def local_records(output_directory, gpu_uuid, *, system=None, refresh=False):
    """Latest 48 usable timing records, cached between calls; never open MP4s."""
    system = system or platform.system()
    root = Path(output_directory).resolve() / 'FreeVideo'
    key = (str(root), json.dumps(gpu_uuid, sort_keys=True), system)
    now = time.monotonic()
    cached = _CACHE.get(key)
    if cached and not refresh and now - cached[0] < 15:
        return cached[1]
    paths = []
    for path in root.glob('*/*/video.request.json'):
        try:
            if path.resolve().is_relative_to(root) and path.stat().st_size <= 4 * 1024 * 1024:
                paths.append((path.stat().st_mtime_ns, path))
        except OSError:
            continue
    records = []
    for _, path in sorted(paths, reverse=True):
        try:
            with path.open('rb') as stream:
                data = stream.read(4 * 1024 * 1024 + 1)
            if len(data) > 4 * 1024 * 1024:
                continue
            row = timing_record(json.loads(data), gpu_uuid, system)
            if row:
                records.append(row)
                if len(records) == 48:
                    break
        except (OSError, ValueError, TypeError, AttributeError, KeyError):
            continue
    _CACHE.clear()
    _CACHE[key] = (now, records)
    return records
