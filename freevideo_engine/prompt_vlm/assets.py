"""Explicit, resumable installation through FreeVideo's download routing."""
import json
from pathlib import Path
import shutil
from .. import disk_space

FAMILY = 'image-models'


def catalog():
    return json.loads(Path(__file__).with_name('model.json').read_text(encoding='utf-8'))


def directory(root):
    spec = catalog()
    return Path(root) / 'models' / 'prompt-vlm' / spec['revision']


def ready(root):
    spec, folder = catalog(), directory(root)
    try:
        receipt = json.loads((folder / 'verified.json').read_text(encoding='utf-8'))
        return receipt.get('revision') == spec['revision'] and all(
            (folder / row['file']).stat().st_size == row['bytes'] and
            receipt['files'].get(row['file']) == (folder / row['file']).stat().st_mtime_ns
            for row in spec['files'])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def remote(spec, row):
    """One catalog file with every source FreeVideo may fetch it from.

    Hugging Face hosts are pinned to the catalog revision. ModelScope has no
    matching commit, so its copy is accepted only when the size and SHA-256 in
    the catalog match, as for the image model.
    """
    from ..network import source_url
    hf = '/%s/resolve/%s/%s' % (spec['repo'], spec['revision'], row['file'])
    mirror = spec['modelscope']
    return dict(repo=spec['repo'], revision=spec['revision'], file=row['file'], family='image', sources=[
        dict(id='official', url=source_url('models', 'official') + hf),
        dict(id='hf-mirror', url=source_url('models', 'hf-mirror') + hf),
        dict(id='modelscope', url=source_url(FAMILY, 'modelscope') + '/models/%s/resolve/%s/%s' % (
            mirror['repo'], mirror['revision'], row['file']))])


def install(root, progress, check):
    from .. import network, provision
    from ..adaln_assets import _download_plan
    from ..monitoring import save
    if ready(root):
        return
    folder, spec = directory(root), catalog()
    folder.mkdir(parents=True, exist_ok=True)
    ledger_path = folder / 'download-verified.json'
    try:
        ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        ledger = {}
    missing = [row for row in spec['files'] if not provision.verified(folder / row['file'], row, ledger)]
    total = sum(row['bytes'] for row in missing)
    retained = 0
    for row in missing:
        path = folder / row['file']
        partial = path.with_suffix(path.suffix + '.partial')
        if partial.is_file():
            size = partial.stat().st_size
            if size < row['bytes']:
                retained += size
    if disk_space.free_bytes(folder) < total - retained + 256 * 2**20:
        raise ValueError('disk_space')
    plan = _download_plan(root)
    # Same three hosts as the image model, so the same ordering, measured
    # routes and Download source choice apply. Installs whose plan predates
    # that family keep their Hugging Face order, with ModelScope after it.
    sources = plan['sources'] = dict(plan.get('sources', {}))
    if not sources.get(FAMILY):
        sources[FAMILY] = [dict(row) for row in sources.get('models', [])
                           if row['id'] in ('official', 'hf-mirror')] or [{'id': 'official'}, {'id': 'hf-mirror'}]
        sources[FAMILY].append({'id': 'modelscope'})
    plan.update(quiet=True, resource_check=check)
    done = 0
    for row in missing:
        check()
        path = folder / row['file']
        def moved(current, size, speed, **kwargs):
            progress(dict(phase='download', done=done + current, total=total))
        network.download(network.model_urls(plan, remote(spec, row)), path, row['sha256'], moved,
                         network=plan, size=row['bytes'], category=FAMILY, keep_partial=True, stall_seconds=30,
                             slow_seconds=15, low_speed_limit=64 * 1024)
        ledger[str(path)] = provision.file_identity(path, row)
        save(ledger_path, ledger)
        done += row['bytes']
    save(folder / 'verified.json', dict(revision=spec['revision'], files={
        row['file']: (folder / row['file']).stat().st_mtime_ns for row in spec['files']}))
