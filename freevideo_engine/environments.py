"""Pinned installation layouts; model lifetimes are independent of venv count."""
import logging
import os
from pathlib import Path
import platform

ENVIRONMENTS = {
    'unified': {'cuda': 'cu130', 'torch': ['torch==2.13.0', 'torchvision==0.28.0', 'torchaudio==2.11.0']},
    'engine': {'cuda': 'cu129', 'torch': ['torch==2.13.0', 'torchvision==0.28.0']},
    'encoder': {'cuda': 'cu130', 'torch': ['torch==2.14.0', 'torchvision==0.29.0', 'torchaudio==2.11.0']},
}


def constraints_file(name, system=None):
    if (system or platform.system()) == 'Darwin':
        if name != 'unified':
            raise ValueError('Mac requires the native unified environment')
        from .macos_bootstrap import constraints
        return constraints()
    prefix = 'windows-' if (system or platform.system()) == 'Windows' else ''
    return Path(__file__).resolve().parent.parent / 'constraints' / (prefix + name + '.txt')


# uv reads each value of these options as a space-separated list of files, even
# when it arrives as one quoted argument: `-c "D:\Comfy UI\pins.txt"` names
# `D:\Comfy` and `UI\pins.txt` and stops with "File not found" (exit code 2).
# Requirement files, editables, wheels and --python keep their spaces.
UV_FILE_LIST_OPTIONS = frozenset(('-c', '--constraint', '--constraints', '-b', '--build-constraint',
                                  '--build-constraints', '--override', '--overrides'))


# uv 0.9.0 adds sdists-v9/<index>/<name>/<version>/<revision>/src and
# setuptools adds build/bdist.<platform>/wheel/... beneath the cache. Reserve
# 200 characters below the engine root, including downloads/uv-cache. This
# allows headroom above measured staging paths, not arbitrary sdists.
UV_BUILD_PATH_CHARS = 200


# Git creates and enters its own folders with the ordinary 259-character limit
# even when core.longpaths lets it write deep files. Reserve the clone folder,
# its ".partial-<ns>" name and the longest object path below it.
GIT_PATH_CHARS = 140


def _short_view(root, environ, reserve):
    """The view that leaves `reserve` characters below `root`, or None when none can be had."""
    from . import launch_view, runtime_alias
    from .long_paths import path_chars, plain
    from .package_paths import WINDOWS_PATH_LIMIT
    if not runtime_alias._backend.windows():
        return None
    root = Path(os.path.abspath(plain(root)))
    view = launch_view.current(environ)
    if (view is None or not root.is_relative_to(view.real)
            or path_chars(launch_view.value(root, view)) + 1 + reserve > WINDOWS_PATH_LIMIT):
        try:
            view = launch_view.View(root, runtime_alias.runtime_view(root, longest=reserve))
        except OSError as error:
            if (path_chars(root) + 1 + reserve <= WINDOWS_PATH_LIMIT
                    and runtime_alias._backend.ansi_path(root)):
                view = launch_view.View(root, root)
            else:
                return None  # No short entry: keep the old behaviour.
    if path_chars(launch_view.value(root, view)) + 1 + reserve > WINDOWS_PATH_LIMIT:
        return None
    return view


def uv_build_environment(command, root, environ):
    """Windows uv pip builds use a short view of the existing cache and scratch.

    TEMP alone does not move uv's sdist source tree or isolated build venv.
    Mark only this child's view: processes.popen translates its paths, while
    installation settings, cache ownership and the parent's environment stay put.
    """
    if (not command or Path(command[0]).name.lower() not in ('uv', 'uv.exe')
            or list(command[1:2]) != ['pip']):
        return environ
    from . import launch_view, runtime_alias
    from .long_paths import io_path
    from .triton_compat import TEMP_KEYS, TEMP_ROOT_ENV, _writable_temporary
    view = _short_view(root, environ, UV_BUILD_PATH_CHARS)
    if view is None:
        return environ
    temporary = Path(launch_view.value(Path(os.path.abspath(root)) / 'tmp' / 'uv', view))
    try:
        for path in (temporary.parent, temporary):
            folder = io_path(path)
            folder.mkdir(parents=True, exist_ok=True)
            if folder.is_symlink() or runtime_alias.is_junction(path):
                raise OSError('The package build temporary folder is a link')
        _writable_temporary(temporary)
    except OSError as error:
        # Like a missing short entry, an unusable scratch folder must not stop installs that worked before.
        logging.getLogger(__name__).warning('Package builds keep the previous environment: %s', error)
        return environ
    return dict(launch_view.environment_view(environ, view),
                **{key: str(temporary) for key in (*TEMP_KEYS, TEMP_ROOT_ENV)})


def git_long_path_environment(path, environ):
    """Windows Git, and the Python that runs it, work from a short view of the install root.

    `path` is any folder below the install root (the folder holding setup.lock,
    which the short entry is verified through). Only this child's environment is
    marked; paths on screen, in receipts and in the checkout keep their real spelling.
    """
    from . import launch_view
    from .long_paths import path_chars, plain
    path = Path(os.path.abspath(plain(path)))
    root = next((parent for parent in (path, *path.parents) if os.path.isfile(parent / 'setup.lock')), None)
    if root is None:
        return environ
    view = _short_view(root, environ, GIT_PATH_CHARS + path_chars(path) - path_chars(root))
    return environ if view is None else launch_view.environment_view(environ, view)


def uv_file_arguments(command, cwd=None):
    """Return (command, cwd) for which uv reads constraint files in folders with spaces.

    Such a file is named relative to its folder, which becomes uv's working
    directory. FreeVideo passes every other path to uv as an absolute path.
    """
    command = [str(item) for item in command]
    if not command or Path(command[0]).name.lower() not in ('uv', 'uv.exe') or command[1:2] != ['pip']:
        return command, cwd
    values = {}
    for index, item in enumerate(command):
        option, equals, value = item.partition('=')
        if item in UV_FILE_LIST_OPTIONS and index + 1 < len(command):
            values[index + 1] = ('', command[index + 1])
        elif equals and option.startswith('--') and option in UV_FILE_LIST_OPTIONS:
            values[index] = (option + '=', value)
    spaced = {index: row for index, row in values.items() if ' ' in row[1]}
    if not spaced:
        return command, cwd
    base = Path(cwd or os.getcwd())
    folder = (base / next(iter(spaced.values()))[1]).parent
    result = list(command)
    for index, (prefix, value) in spaced.items():
        try:
            relative = os.path.relpath(base / value, folder)
        except ValueError:  # Another Windows drive; uv reports the original path.
            return command, cwd
        if ' ' in relative:
            return command, cwd
        result[index] = prefix + relative
    return result, str(folder)


def bootstrap_versions(value, system=None):
    result = dict(value, target_system=system or platform.system())
    if result['target_system'] == 'Darwin':
        from .macos_bootstrap import versions
        return versions(value)
    if result['target_system'] == 'Windows':
        result['uv'] = result['windows']['uv']
    return result


def environment_names(layout):
    if layout == 'unified':
        return ('unified',)
    if layout == 'dual':
        return ('engine', 'encoder')
    raise ValueError('Unknown environment layout: ' + str(layout))


def select_layout(requested=None, saved=None):
    saved = saved or {}
    layout = requested or saved.get('pending_environment_layout') or saved.get('environment_layout')
    if layout is None and saved.get('python'):
        # v0.2.0/0.2.1 receipts did not record a layout. Preserve them on update.
        layout = 'unified' if saved.get('python') == saved.get('comfy_python') else 'dual'
    layout = layout or 'unified'
    environment_names(layout)
    return layout


def role_pythons(root, layout, system=None):
    from .system import venv_python
    names = environment_names(layout)
    return {'engine': venv_python(root / 'envs' / names[0], system),
            'encoder': venv_python(root / 'envs' / names[-1], system)}
