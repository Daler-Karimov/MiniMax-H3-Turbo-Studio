"""Local ComfyUI queue adapter and optional background-chain routes."""
import json
import logging
import math
import os
from pathlib import Path, PurePosixPath
import ssl
import threading
import time
from urllib import error, request

from .chain_runner import ChainBusy, ChainRunner
from . import chain_plan, chain_store

RUNNER = None
CONTINUE_INPUTS = {'after': 'continue_from', 'before': 'continue_to'}


def _generate_inputs():
    try:
        from .comfy_nodes import FreeVideoGenerate
        return {row.id: row for row in FreeVideoGenerate.define_schema().inputs}
    except Exception:
        return {}


def seconds_for_frames(frames, minimum=1.625, maximum=60., step=.1):
    """Pick a legal duration inside the requested VAE cell, below its upper edge."""
    from .geometry import geometry
    value = (frames - .5) / 24
    if step is not None and step > 0:
        value = round(math.floor(value / step) * step, 10)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    if geometry(seconds=value)['frames'] != frames:
        raise ValueError('Block frames cannot be represented by the node duration input')
    return value


class ComfyHost:
    continuation_inputs = tuple(CONTINUE_INPUTS.values())

    def __init__(self, server):
        self.server = server

    def inputs(self, block_inputs):
        schema = _generate_inputs()
        values = {key: block_inputs[key] for key in ('text', 'seed')}
        if 'frames' in schema:
            values['frames'] = block_inputs['frames']
        else:
            seconds = schema.get('seconds')
            values['seconds'] = seconds_for_frames(block_inputs['frames'],
                getattr(seconds, 'min', 1.625), getattr(seconds, 'max', 60.), getattr(seconds, 'step', .1))
        independent = os.environ.get('FREEVIDEO_CHAIN_INDEPENDENT') == '1'
        for key, name in CONTINUE_INPUTS.items():
            # Each direction is filled once the node offers its input.
            if name in schema:
                values[name] = '' if independent else block_inputs[key]
        return values

    def work_exists(self, path):
        import folder_paths
        root = Path(folder_paths.get_output_directory()).resolve()
        output = (root / path).resolve()
        return output.is_relative_to(root) and output.is_file()

    def submit(self, prompt_id, prompt, extra_data):
        try:
            from comfy.cli_args import args
        except ImportError:
            args = None
        address = getattr(self.server, 'address', None) or getattr(args, 'listen', None) or '127.0.0.1'
        port = getattr(self.server, 'port', None) or getattr(args, 'port', None) or 8188
        address = address.split(',')[0].strip('[]')
        address = {'0.0.0.0': '127.0.0.1', '::': '::1'}.get(address, address)
        if ':' in address:
            address = '[' + address + ']'
        tls = bool(getattr(args, 'tls_keyfile', None))
        url = '%s://%s:%s/prompt' % ('https' if tls else 'http', address, port)
        body = dict(prompt=prompt, prompt_id=prompt_id, extra_data=extra_data)
        if extra_data.get('client_id') is not None:
            body['client_id'] = extra_data['client_id']
        message = request.Request(url, data=json.dumps(body).encode('utf-8'),
                                  headers={'Content-Type': 'application/json'}, method='POST')
        # This request belongs to our own server, even with an inherited proxy.
        handlers = [request.ProxyHandler({})]
        if tls:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            handlers.append(request.HTTPSHandler(context=context))
        opener = request.build_opener(*handlers)
        try:
            with opener.open(message, timeout=30) as response:
                response.read()
        except error.HTTPError as failure:
            if failure.code != 400:
                raise
            try:
                value = json.loads(failure.read())
                parts = [(value.get('error') or {}).get('message') or 'Prompt validation failed']
                first = next(iter((value.get('node_errors') or {}).values()), None)
                if first:
                    parts.append(json.dumps(first, ensure_ascii=False))
                raise RuntimeError('; '.join(parts)) from None
            except (ValueError, TypeError, AttributeError):
                raise RuntimeError('Prompt validation failed') from None

    def status(self, prompt_id):
        queue = self.server.prompt_queue
        running, pending = queue.get_current_queue()
        for rows, state in ((running, 'running'), (pending, 'pending')):
            if any(row[1] == prompt_id for row in rows):
                return dict(state=state, error=None, output=None)
        history = queue.get_history(prompt_id=prompt_id).get(prompt_id)
        if history is None:
            return dict(state='missing', error=None, output=None)
        status = history.get('status')
        outputs = history.get('outputs') or {}
        output = None
        for node in outputs.values():
            summaries = node.get('freevideo_summary') or []
            if summaries:
                output = summaries[0].get('video')
                break
            for row in node.get('videos', node.get('images', [])):
                if row.get('type') == 'output' and row.get('filename', '').lower().endswith('.mp4'):
                    output = str(PurePosixPath(row.get('subfolder', '')) / row['filename'])
                    break
        if status and status.get('status_str') == 'success' or status is None and outputs:
            return dict(state='success', error=None, output=output)
        messages = (status or {}).get('messages', [])
        if any(row[0] == 'execution_interrupted' for row in messages):
            return dict(state='interrupted', error=None, output=None)
        message = next((row[1].get('exception_message') for row in messages if row[0] == 'execution_error'), None)
        return dict(state='error', error=message or 'Prompt execution failed', output=None)

    def cancel(self, prompt_id, node):
        from .comfy_progress import cancel_request
        import nodes
        return cancel_request(self.server.prompt_queue, prompt_id, node, nodes.interrupt_processing)

    def join(self, record, cancelled):
        try:
            from .chain_join import join_outputs
        except ImportError:
            raise RuntimeError('Joining is not available in this version') from None
        planned = record.get('plan')
        blocks = chain_store.leading_blocks(record)
        # A planned chain shows exactly the requested length: what the last block made beyond it is left out.
        frames = planned['frames'] if planned and not planned['single'] and len(blocks) == len(record['blocks']) else None
        return join_outputs([block['output'] for block in blocks], record['id'], cancelled,
                            frames=frames, replace=record.get('output'))


def continuation_directions():
    """'after' and 'before', each once FreeVideoGenerate has the input that carries it."""
    schema = _generate_inputs()
    return {key for key, name in CONTINUE_INPUTS.items() if name in schema}


def continuation_available():
    return 'after' in continuation_directions()


def report_fields(chain):
    def source(value):
        if isinstance(value, str):
            return dict(type='block', id=value)
        return dict(type='work') if value is not None else None
    return dict(index=chain['index'], count=chain['count'],
                after=source(chain['after']), before=source(chain['before']))


def block_context(server, node_id):
    try:
        if RUNNER is not None and server is not None:
            prompt_id = server.last_prompt_id
            chain = RUNNER.context(prompt_id, node_id)
            return dict(chain, _prompt_id=prompt_id) if chain is not None else None
    except Exception:
        pass
    return None


def block_finished(chain, node_id, output, report_id, continuation=None):
    try:
        if RUNNER is not None and chain is not None:
            # Capture the executing attempt, so a late callback cannot finish a retry.
            RUNNER.finished(chain['_prompt_id'], node_id, output, report_id, continuation)
    except Exception:
        pass


class FakeHost(ComfyHost):
    """Optional CPU-only prompts for development; never touch the host queue."""
    fake = True

    def __init__(self, server, seconds=None):
        super().__init__(server)
        self.seconds = float(os.environ.get('FREEVIDEO_CHAIN_FAKE_SECONDS', '12')) if seconds is None else seconds
        if not math.isfinite(self.seconds) or self.seconds < 0:
            raise ValueError('Fake duration must be finite and nonnegative')
        self.lock, self.closed = threading.RLock(), threading.Event()
        self.jobs, self.runner = {}, None

    def inputs(self, block_inputs):
        return {key: block_inputs[key] for key in ('text', 'frames', 'seed')}

    def join(self, record, cancelled):
        return chain_store.leading_blocks(record)[-1]['output']

    def _saved_video(self, frames):
        from .comfy_library import _report, _video
        import folder_paths
        root = Path(folder_paths.get_output_directory()).resolve()
        videos = []
        for path in (root / 'FreeVideo').glob('*/*/video.mp4'):
            identity = path.parent.relative_to(root / 'FreeVideo').as_posix()
            try:
                path = _video(root, identity)
                info = path.stat()
                if not path.is_file() or not info.st_size:
                    continue
                report = _report(path)
                count = (report.get('geometry') or {}).get('frames')
                if 'chain_join' in report or type(count) is not int or count < frames:
                    continue
                videos.append((info.st_mtime_ns, (Path('FreeVideo') / identity / 'video.mp4').as_posix()))
            except (OSError, ValueError, TypeError, AttributeError):
                continue
        return max(videos)[1] if videos else None

    def submit(self, prompt_id, prompt, extra_data):
        chain = extra_data['freevideo_chain']
        node = self.runner.records[chain['id']]['node']
        job = dict(node=str(node), state='pending', error=None, output=None, cancel=threading.Event())
        thread = threading.Thread(target=self._run, args=(prompt_id, node, chain, job),
                                  name='FreeVideo fake chain block', daemon=True)
        job['thread'] = thread
        with self.lock:
            self.jobs[prompt_id] = job
        thread.start()

    def _run(self, prompt_id, node, chain, job):
        from .comfy_progress import STATE, publish
        progress = None
        try:
            if self.closed.is_set() or job['cancel'].is_set():
                return
            with self.lock:
                job['state'] = 'running'
            if self.runner.context(prompt_id, node) is None:
                return
            progress = publish(self.server, node, {'label': 'Preparing video', 'new_request': True})
            started = time.monotonic()
            total = max(1, math.ceil(self.seconds / .5))
            for done in range(total + 1):
                used = time.monotonic() - started
                progress = publish(self.server, node, dict(label='Sampling', phase='sampling', done=done, total=total,
                    overall=dict(status='running', estimated=True, fraction=.9 * done / total,
                                 elapsed_seconds=used, remaining_seconds=max(0., self.seconds - used))))
                if done < total and job['cancel'].wait(self.seconds / total):
                    return
                if self.closed.is_set() or job['cancel'].is_set():
                    return
            progress = publish(self.server, node, dict(label='Decoding video', phase='decode',
                overall=dict(status='running', estimated=True, fraction=.95,
                             elapsed_seconds=time.monotonic() - started, remaining_seconds=0.)))
            frames = self.runner.records[chain['id']]['blocks'][chain['index']]['inputs']['frames']
            needed = frames - 22 if chain['after'] is not None or chain['before'] is not None else frames
            output = self._saved_video(needed)
            if self.closed.is_set() or job['cancel'].is_set():
                return
            if output is None:
                with self.lock:
                    job.update(state='error', error='Fake generation needs a saved video with at least %s frames' % needed)
                return
            publish(self.server, node, dict(label='Video saved', phase='complete',
                overall=dict(status='complete', fraction=1.)))
            # The shape the engine reports for a continued block.
            continuation = (dict(overlap_frames=22, new_frames=frames - 22, requested_frames=frames)
                            if chain['after'] is not None else None)
            with self.lock:
                self.runner.finished(prompt_id, node, output, None, continuation)
                job.update(state='success', output=output)
        except Exception:
            logging.exception('[FreeVideo] Fake chain generation failed')
            with self.lock:
                job.update(state='error', error='Fake generation failed')
        finally:
            with self.lock:
                if job['state'] in ('pending', 'running'):
                    if progress is not None and job['cancel'].is_set() and not self.closed.is_set():
                        with self.runner.lock:
                            # A late cancellation must not end a newer request on this node.
                            current = next((row for row in STATE.snapshot() if row['node'] == str(node)), {})
                            if (current.get('sequence') == progress['sequence']
                                    and self.runner.context(prompt_id, node) is not None):
                                publish(self.server, node, dict(label='Generation cancelled', phase='cancelled',
                                    overall=dict(status='cancelled')))
                    job['state'] = 'interrupted'
            self.runner.wake.set()

    def status(self, prompt_id):
        with self.lock:
            job = self.jobs.get(prompt_id, {})
            return dict(state=job.get('state', 'missing'), error=job.get('error'), output=job.get('output'))

    def cancel(self, prompt_id, node):
        with self.lock:
            if prompt_id in self.jobs and self.jobs[prompt_id]['node'] == str(node):
                self.jobs[prompt_id]['cancel'].set()

    def close(self):
        self.closed.set()
        with self.lock:
            jobs = list(self.jobs.values())
            for job in jobs:
                job['cancel'].set()
        for job in jobs:
            if job['thread'] is not threading.current_thread():
                job['thread'].join(timeout=2.)


def hidden_outputs(root):
    try:
        root = Path(root).resolve()
        def exists(output):
            path = (root / output).resolve()
            return path.is_relative_to(root) and path.is_file()
        return RUNNER.hidden(exists) if RUNNER is not None else set()
    except Exception:
        return set()


def register():
    global RUNNER
    from aiohttp import web
    from server import PromptServer
    from .comfy_bridge import installation, installation_root
    server = PromptServer.instance
    if server is None or getattr(server, '_freevideo_chain', False):
        return
    fake = os.environ.get('FREEVIDEO_CHAIN_FAKE') == '1'
    root = installation_root() if fake else installation()[0]
    host = FakeHost(server) if fake else ComfyHost(server)
    if fake:
        logging.warning('[FreeVideo] Fake background chain generation is enabled')
    runner = ChainRunner(Path(root) / 'chains', host, estimate=None)
    if fake:
        host.runner = runner
    RUNNER = runner
    server._freevideo_chain = True

    def response(value, status=200):
        return web.json_response(value, status=status, headers={'Cache-Control': 'no-store'})

    async def body(request):
        try:
            value = await request.json()
        except (ValueError, TypeError):
            raise ValueError('A JSON object is required') from None
        if not isinstance(value, dict):
            raise ValueError('A JSON object is required')
        return value

    @server.routes.post('/freevideo/chain/plan')
    async def plan(request):
        try:
            value = await body(request)
            return response({'plan': chain_plan.plan(
                value.get('seconds'), value.get('single', False), value.get('max_frames'),
                value.get('single_limit_seconds'), value.get('block_seconds'))})
        except chain_plan.PlanError as failure:
            return response({'error': str(failure), 'code': failure.code}, 400)
        except ValueError as failure:
            return response({'error': str(failure), 'code': 'invalid'}, 400)

    @server.routes.post('/freevideo/chain')
    async def create(request):
        try:
            value = await body(request)
            normalized = chain_store.validate(value)
            if not fake and os.environ.get('FREEVIDEO_CHAIN_INDEPENDENT') != '1':
                missing = {key for row in normalized['blocks'] for key in CONTINUE_INPUTS
                           if row[key] is not None} - continuation_directions()
                if 'after' in missing:
                    return response({'error': 'Continuing a video is not available in this version'}, 409)
                if missing:
                    return response({'error': 'Extending backwards or filling a gap is not available in this version'}, 409)
            return response({'chain': runner.create(value)})
        except ChainBusy as failure:
            return response({'error': str(failure)}, 409)
        except chain_plan.PlanError as failure:
            return response({'error': str(failure), 'code': failure.code}, 400)
        except ValueError as failure:
            return response({'error': str(failure)}, 400)

    def asking(request):
        # ?client_id=... marks each chain as this page's own or not.
        query = getattr(request, 'query', None)
        return query.get('client_id') if query is not None else None

    @server.routes.get('/freevideo/chains')
    async def listing(request):
        value = {'chains': runner.list(asking(request)), 'continuation': continuation_available()}
        if fake:
            value['fake'] = True
        return response(value)

    @server.routes.get('/freevideo/chain/{id}')
    async def get(request):
        try:
            return response({'chain': runner.get(request.match_info['id'], asking(request))})
        except KeyError:
            return response({'error': 'Unknown chain'}, 404)

    @server.routes.post('/freevideo/chain/{id}/cancel')
    async def cancel(request):
        try:
            return response({'chain': runner.cancel(request.match_info['id'])})
        except KeyError:
            return response({'error': 'Unknown chain'}, 404)

    @server.routes.post('/freevideo/chain/{id}/resume')
    async def resume(request):
        try:
            value = await body(request) if request.can_read_body else {}
            return response({'chain': runner.resume(request.match_info['id'], value.get('client_id'))})
        except KeyError:
            return response({'error': 'Unknown chain'}, 404)
        except ValueError as failure:
            return response({'error': str(failure)}, 409)
