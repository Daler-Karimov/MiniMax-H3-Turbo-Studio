import {copyName} from './editor_model.js';
import {generationSize} from './editor_generation.js';
// HTTP and scheduling live here; records and editing stay in the data modules.
const clockDefault = {now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id)};
const copy = value => structuredClone(value);
const memoryProjects = new Map();
const fakeJobs = new Map();
const fakeSources = new Map();
const errorFor = response => Object.assign(new Error('editor_request'), {status: response.status});
const post = value => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
export const sourceKey = source => source ? `${source.kind}:${source.id}` : null;
export const chainRoute = (id, action) => '/freevideo/chain' + (id ? '/' + encodeURIComponent(id) : '') + (action ? '/' + action : '');

// Debounce from the first edit, rather than postponing indefinitely while dragging.
// Writes are serialized; a response supplies metadata to the next snapshot only.
const savedContent = record => JSON.stringify({...record, id: null, revision: 0});
const OUTBOX = 'fv-editor-outbox';
const operationId = () => globalThis.crypto?.randomUUID?.().replaceAll('-', '') || Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
const lockName = session => OUTBOX + ':' + session;
function holdSession(session = operationId()) {
    let release = () => {}; const owner = {session, held: !globalThis.navigator?.locks};
    let ready = Promise.resolve();
    if (globalThis.navigator?.locks) {
        ready = new Promise(resolve => {
            navigator.locks.request(lockName(session), () => { owner.held = true; resolve(); return new Promise(done => { release = done; }); });
        });
    }
    return Object.assign(owner, {ready, dispose: () => ready.then(() => release())});
}
function outbox() {
    const rows = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(OUTBOX + ':')) continue;
            try { const entry = JSON.parse(localStorage.getItem(key)); if (entry?.session && entry.project) rows.push([key, entry]); } catch {}
        }
        // Preserve pending records written by the previous page version.
        const legacy = JSON.parse(localStorage.getItem(OUTBOX) || '{}');
        for (const [key, entry] of Object.entries(legacy)) if (entry?.project) rows.push([key, {...entry, legacy: true}]);
    } catch {}
    return rows;
}
function saveOutbox(session, entry) {
    if (typeof localStorage === 'undefined') return false;
    try {
        if (entry) {
            if (new TextEncoder().encode(JSON.stringify(entry.project)).length > 2 * 1024 * 1024) {
                console.info('[FreeVideo editor] Record exceeds 2 MB; outbox skipped.'); return false;
            }
            localStorage.setItem(lockName(session), JSON.stringify(entry));
        } else localStorage.removeItem(lockName(session));
        return true;
    } catch { console.info('[FreeVideo editor] Local outbox unavailable.'); return false; }
}
export function createSaveQueue({write, read, onSaved = () => {}, onConflict = () => {}, onCopied = () => {},
    onMemory = () => {}, onError = () => {}, onStatus = () => {}, clock = clockDefault, delay = 600,
    initial = null, getRecord = null, copySuffix = ' (copy)', session = null, create = null, attempt: resumedAttempt = null}) {
    const owner = session || holdSession();
    let pending = null, inFlight = null, timer = null, heartbeat = null, meta = null, retry = 0, disposed = false;
    let memory = false, memoryNoticed = false, lastSaved = initial && copy(initial), failed = false, copied = false, retained = false;
    let createOperation = create || (initial?.id ? null : operationId());
    let attempt = resumedAttempt && copy(resumedAttempt);
    const localKey = owner.session;
    function retain(record) {
        if (!owner.held) { owner.ready.then(() => { if (!disposed && (pending || attempt || inFlight)) retain({...((getRecord?.() || pending) ?? record), ...(meta || {})}); }); return false; }
        retained = saveOutbox(localKey, {session: localKey, id: record.id, project: copy(record), baseline: lastSaved, create: createOperation, attempt: copy(attempt), updated_at: clock.now()});
        if (heartbeat === null && !disposed) heartbeat = clock.setTimeout(() => {
            heartbeat = null;
            if (pending || attempt || inFlight) retain({...((getRecord?.() || pending) ?? record), ...(meta || {})});
        }, 10000);
        return retained;
    }
    function schedule(ms) {
        if (disposed || timer !== null) return;
        timer = clock.setTimeout(() => { timer = null; drain(); }, ms);
    }
    async function drain() {
        if (disposed || inFlight || (!pending && !attempt)) return inFlight;
        if (!attempt) { attempt = {operation: operationId(), project: {...pending, ...(meta || {})}}; pending = null; }
        const sent = attempt.project, body = copy(sent); failed = false;
        if (!body.id) createOperation ||= operationId();
        retain(pending || body);
        inFlight = (async () => {
            await owner.ready;
            try {
                if (disposed) return;
                if (memory) { attempt = null; onSaved(body, true, localKey); return; }
                const response = await write(body, createOperation, attempt.operation);
                if (disposed) return;
                if (response.status === 404) {
                    attempt = null; memory = true;
                    if (!memoryNoticed) { memoryNoticed = true; onMemory(); }
                    onSaved(body, true, localKey); return;
                }
                if (response.status === 409) {
                    const conflict = await response.json();
                    const remote = await read(body.id || conflict.id);
                    if (disposed) return;
                    if (!remote) throw errorFor(response);
                    const latest = copy(getRecord?.() || pending || sent);
                    if (lastSaved && savedContent(remote) === savedContent(lastSaved)) {
                        meta = {id: remote.id, revision: remote.revision};
                    } else {
                        meta = {id: null, revision: 0}; createOperation = operationId();
                        latest.name = copyName(latest.name, copySuffix);
                        onConflict({...latest, ...meta}, copySuffix);
                        copied = true;
                    }
                    attempt = null; pending = {...latest, ...meta}; retain(pending); retry = 0; return;
                }
                if (!response.ok) throw errorFor(response);
                const saved = (await response.json()).project;
                if (disposed) return;
                attempt = null;
                if (pending && savedContent(pending) === savedContent(sent)) pending = null;
                meta = {id: saved.id, revision: saved.revision}; retry = 0; lastSaved = copy(saved);
                onSaved(saved, false);
                if (copied) { copied = false; onCopied(saved); }
                if (pending) retain({...pending, ...meta});
                else { saveOutbox(localKey, null); retained = false; clock.clearTimeout(heartbeat); heartbeat = null; }
            } catch (error) {
                failed = true;
                if (!disposed) {
                    retain({...(pending || sent), ...(meta || {})});
                    schedule(Math.min(30000, 1000 * 2 ** retry++)); onError(error);
                }
            }
        })().finally(() => {
            inFlight = null; onStatus();
            if ((pending || attempt) && timer === null && !disposed && !failed) drain();
        });
        return inFlight;
    }
    return {
        enqueue(record) { if (!disposed) { pending = copy(record); if (!record.id) createOperation ||= operationId(); retain({...pending, ...(meta || {})}); schedule(delay); } },
        async flush() {
            clock.clearTimeout(timer); timer = null;
            if (inFlight) await inFlight;
            clock.clearTimeout(timer); timer = null;
            while ((pending || attempt) && !disposed) {
                await drain();
                if (failed) break;
                if (inFlight) await inFlight;
                clock.clearTimeout(timer); timer = null;
            }
        },
        reset(record = null, recovery = null) {
            pending = recovery ? copy(recovery.project) : null; attempt = recovery?.attempt ? copy(recovery.attempt) : null;
            meta = null; retry = 0; copied = false; retained = false; lastSaved = copy(recovery ? recovery.baseline : record);
            createOperation = recovery?.create || (record?.id ? null : operationId());
            clock.clearTimeout(timer); timer = null; clock.clearTimeout(heartbeat); heartbeat = null;
            if (pending || attempt) { retain(pending || attempt.project); schedule(delay); } else saveOutbox(localKey, null);
        },
        get recovery() { return {project: copy({...(pending || attempt?.project), ...(meta || {})}), baseline: copy(lastSaved), create: createOperation, attempt: copy(attempt)}; },
        dispose({discard = false} = {}) { disposed = true; clock.clearTimeout(timer); timer = null; clock.clearTimeout(heartbeat); heartbeat = null; if (discard) saveOutbox(localKey, null); if (!session) owner.dispose(); },
        get dirty() { return !!pending || !!attempt || !!inFlight; },
        get locallyRetained() { return retained; },
    };
}

// No overlapping polls and no delivery after disposal, including a slow response.
export function createPoller(read, deliver, {clock = clockDefault, interval = 2000, onError = () => {}} = {}) {
    let active = true, timer = null, running = null;
    async function poll() {
        if (!active || running) return running;
        running = (async () => {
            try { const value = await read(); if (active && await deliver(value) === false) active = false; }
            catch (error) { if (active) onError(error); }
        })().finally(() => {
            running = null;
            if (active) timer = clock.setTimeout(() => { timer = null; poll(); }, interval);
        });
        return running;
    }
    poll();
    return {poll, dispose() { active = false; clock.clearTimeout(timer); }};
}

export function interpolate(points, seconds) {
    const rows = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && y >= 0).sort((a, b) => a[0] - b[0]);
    if (!rows.length) return null;
    if (rows.length === 1) return rows[0][1];
    let i = rows.findIndex(([x]) => x >= seconds);
    if (i < 1) i = seconds <= rows[0][0] ? 1 : rows.length - 1;
    const [a, b] = [rows[i - 1], rows[i]];
    return b[0] === a[0] ? b[1] : Math.max(0, a[1] + (seconds - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
}
// The reply groups its numbers by quality level. An edit keeps the panel's steps,
// not a level's name, so the level is the one those steps describe (as the
// creative panel's range view picks it); other steps have no numbers.
function capabilityTier(reply, settings) {
    const tiers = reply.tiers;
    if (!tiers || typeof tiers !== 'object') return reply;
    if (tiers[settings?.tier]) return tiers[settings.tier];
    const steps = Number(settings?.base_steps), twoPass = !!settings?.two_pass;
    return Object.values(tiers).find(tier => tier.steps === steps && tier.two_pass === twoPass
        && (!twoPass || Number(settings?.refine_steps) === 3)) || {};
}
export function capabilityPoints(reply, {width, height, settings = {}}) {
    const tier = capabilityTier(reply, settings);
    const i = reply.sizes?.findIndex(size => size.width === width && size.height === height) ?? -1;
    const max = Array.isArray(tier.max_seconds) ? tier.max_seconds[i] : tier.max_seconds;
    const known = Array.isArray(tier.max_frames) ? tier.max_frames[i] : tier.max_frames;
    const maxRequestFrames = Number.isSafeInteger(known) && known >= 0 ? known
        : Number.isFinite(max) ? Math.max(39, 5 + 17 * Math.ceil((24 * max - 5) / 17)) : null;
    const longest = continues => {
        if (maxRequestFrames === null) return 15;
        for (let seconds = 30; seconds >= 2; seconds--) {
            const frames = continues ? 17 * Math.ceil(seconds * 24 / 17) + 22 : Math.max(39, 5 + 17 * Math.ceil((seconds * 24 - 5) / 17));
            if (frames <= maxRequestFrames) return seconds;
        }
        return 2; // The final request check reports too_long when even 2s cannot fit.
    };
    const estimates = i >= 0 && Array.isArray(tier.estimate_seconds?.[i]) ? tier.estimate_seconds[i] : tier.estimate_seconds;
    const lengths = reply.lengths || reply.seconds || [5, 10, 15];
    return {maxSeconds: longest(false), maxFollowSeconds: longest(true), maxRequestFrames,
        points: lengths.map((length, j) => [Number(length.seconds ?? length),
            Array.isArray(estimates) ? estimates[j] : estimates?.[length.seconds ?? length]])};
}
export function mediaURL(api, value) {
    if (!value) return null;
    if (/^(?:https?:|blob:|data:|\/)/.test(value)) return api.apiURL?.(value) || value;
    const i = value.lastIndexOf('/');
    const path = '/view?' + new URLSearchParams({filename: value.slice(i + 1), subfolder: value.slice(0, Math.max(0, i)), type: 'output'});
    return api.apiURL?.(path) || path;
}

export function createEditorStore(api, {t = en => en, notify = () => {}, clock = clockDefault, pollMs = 2000} = {}) {
    const sources = new Map(), sourceReads = new Map(), watchers = new Set(), pollers = new Set(), once = new Set();
    let recovered = null, capabilityPoll = null;
    let disposed = false; const uploads = new Set();
    const session = holdSession();
    const notice = (key, en, zh) => { if (!once.has(key)) { once.add(key); notify(t(en, zh)); } };
    const request = (path, options) => api.fetchApi(path, options);
    async function json(path, options, fallback = null) {
        const response = await request(path, options);
        if (response.status === 404) return fallback;
        if (!response.ok) throw errorFor(response);
        return response.json();
    }
    function cache(values) {
        for (const [key, value] of Object.entries(values || {})) sources.set(key, value);
        if (!disposed) for (const fn of watchers) fn();
    }
    async function load(query) {
        // Finish the retained edit before allowing a different project to replace it.
        if (recovered) return copy(recovered.project);
        const value = await json('/freevideo/editor/project?' + new URLSearchParams(query));
        if (value?.project) { cache(value.sources); return value.project; }
        if (query.id) return copy(memoryProjects.get(query.id) || (query.id === 'memory' ? memoryProjects.get('memory') : null));
        return copy([...memoryProjects.values()].find(record => record.tracks[0].clips[0]?.source?.id === query.work) || null);
    }
    function watch(read, deliver) {
        const poller = createPoller(read, deliver, {clock, interval: pollMs}); pollers.add(poller);
        return () => { poller.dispose(); pollers.delete(poller); };
    }
    function fakeEnabled() { try { return localStorage.getItem('fv-editor-fake') === '1'; } catch { return false; } }
    function persistFake(job) {
        fakeJobs.set(job.id, copy(job));
        try { localStorage.setItem('fv-editor-job:' + job.id, JSON.stringify(job)); } catch {}
    }
    function fakeJob(id) {
        if (fakeJobs.has(id)) return fakeJobs.get(id);
        try { const value = JSON.parse(localStorage.getItem('fv-editor-job:' + id)); if (value) fakeJobs.set(id, value); return value; } catch { return null; }
    }
    function fakeState(id) {
        const job = fakeJob(id); if (!job) return null;
        let elapsed = job.elapsed + (job.active ? clock.now() - job.started : 0);
        let failed = false;
        const blocks = job.blocks.map(block => {
            const fraction = Math.max(0, Math.min(1, elapsed / 4000)); elapsed -= 4000;
            const material = job.materials.find(row => (row.geometry?.frames || row.frames || 0) >= block.frames);
            let state = fraction === 1 ? 'done' : fraction > 0 ? 'running' : 'pending';
            if (failed || (!job.active && state !== 'done')) state = 'cancelled';
            const error = !material ? 'no_material' : block.text.startsWith('!fail') ? 'gpu_memory' : null;
            if (error && fraction > 0 && !failed) { state = 'failed'; failed = true; }
            const output = state === 'done' ? material?.video : null;
            if (output) {
                const metadata = {...material.geometry, _fallback: true, video: mediaURL(api, output), audio: mediaURL(api, output),
                    path: output, has_video: true, has_audio: true, sample_rate: 32000, missing: false,
                    thumbnail: api.apiURL?.('/freevideo/library/thumbnail?' + new URLSearchParams({id: material.id}))};
                fakeSources.set('generated:' + output, metadata); sources.set('generated:' + output, metadata);
            }
            return {...block, state, fraction: state === 'done' ? 1 : fraction, inputs: {frames: block.frames}, output,
                skip_frames: block.after ? 22 : 0, skip_audio_samples: block.after ? 29333 : 0,
                remaining_seconds: Math.ceil((1 - fraction) * 4), error};
        });
        return {id, state: failed ? 'failed' : blocks.every(b => b.state === 'done') ? 'done' : job.active ? 'running' : 'cancelled', blocks};
    }
    async function startFake(payload) {
        const rows = await json('/freevideo/library?limit=48', undefined, {items: []});
        const id = 'fake-' + (globalThis.crypto?.randomUUID?.() || clock.now() + '-' + Math.random());
        persistFake({id, blocks: copy(payload.blocks), materials: rows.items || [], elapsed: 0, started: clock.now(), active: true});
        return fakeState(id);
    }
    const store = {
        sources, cache,
        async recoverOutbox() {
            await session.ready;
            for (const [key, entry] of outbox()) {
                if (entry.session === session.session) continue;
                const recover = async () => {
                    // Re-read after claiming; another recovering page may have finished.
                    if (!entry.legacy && localStorage.getItem(key) !== JSON.stringify(entry)) return;
                    const q = createSaveQueue({clock, initial: entry.baseline, create: entry.create, attempt: entry.attempt,
                        session: {session: entry.session || operationId(), held: true, ready: Promise.resolve()},
                        copySuffix: t(' (copy)', '（副本）'), read: id => store.load(id),
                        write: (record, create, operation) => request('/freevideo/editor/project', post({project: record, operation, ...(create ? {create} : {})})),
                        onSaved: (record, memory, local) => { if (memory) memoryProjects.set(local, copy(record)); try { localStorage.setItem('fv-editor-last', record.id || local); } catch {} },
                        onCopied: () => notice('conflict', 'This edit changed elsewhere. Your changes here were saved as a copy.', '这条剪辑在别处改过，这里的改动已存为副本')});
                    try {
                        q.enqueue(entry.project); await q.flush();
                        if (q.dirty) {
                            // Transfer the unresolved request and latest edit to this live
                            // session before releasing the abandoned session's lock.
                            const value = {...q.recovery, session: session.session, updated_at: clock.now()};
                            if (!saveOutbox(session.session, value)) return;
                            recovered = value;
                            if (!entry.legacy) localStorage.removeItem(key);
                            try { localStorage.setItem('fv-editor-last', value.project.id || session.session); } catch {}
                        }
                        if (entry.legacy && (!q.dirty || recovered)) {
                            const rows = JSON.parse(localStorage.getItem(OUTBOX) || '{}');
                            if (JSON.stringify(rows[key]) === JSON.stringify({...entry, legacy: undefined})) { delete rows[key]; localStorage.setItem(OUTBOX, JSON.stringify(rows)); }
                        }
                    } finally { q.dispose(); }
                };
                if (globalThis.navigator?.locks && entry.session) {
                    await navigator.locks.request(lockName(entry.session), {ifAvailable: true}, lock => lock ? recover() : undefined);
                } else if (clock.now() - (entry.updated_at || 0) > 60000) await recover();
                if (recovered) break;
            }
        }, load: id => load({id}), byWork: work => load({work}),
        async projects() {
            const value = await json('/freevideo/editor/projects', undefined, {items: []});
            return value.items || [];
        },
        createSaveQueue(state, {onStatus = () => {}} = {}) {
            const queue = createSaveQueue({clock, session, onStatus, initial: state.record, getRecord: () => state.record, copySuffix: t(' (copy)', '（副本）'), write: (record, create, operation) => { const options = post({project: record, operation, ...(create ? {create} : {})}); return request('/freevideo/editor/project', {...options, keepalive: new TextEncoder().encode(options.body).length < 60000}); },
                read: id => store.load(id),
                onSaved: (record, memory, local) => {
                    memoryProjects.set(record.id || local, copy({...state.record, id: record.id, revision: record.revision}));
                    state.adopt({id: record.id, revision: record.revision});
                    try { localStorage.setItem('fv-editor-last', record.id || local); } catch {}
                    if (memory) memoryProjects.set(record.id || local, copy(state.record));
                },
                onConflict: (record, nameSuffix) => { state.adopt({id: null, revision: 0, nameSuffix}); },
                onCopied: () => notice('conflict', 'This edit changed elsewhere. Your changes here were saved as a copy.', '这条剪辑在别处改过，这里的改动已存为副本'),
                onMemory: () => notice('memory', 'Changes are kept in this page. Restart after updating to save them to disk.', '改动暂存在这个页面里，更新后重启即可保存到磁盘。'),
                // Automatic retries stay quiet; switching away while unsaved warns in editor.js.
                onError: () => {}});
            const reset = queue.reset;
            queue.reset = record => { const entry = recovered; recovered = null; reset(record, entry); };
            return queue;
        },
        async getSources(keys, {refresh = false} = {}) {
            const missing = [...new Set(keys)].filter(key => refresh || !sources.has(key) || sources.get(key)._fallback);
            if (!missing.length) return sources;
            const signature = missing.slice().sort().join('\n');
            if (!sourceReads.has(signature)) {
                const query = new URLSearchParams(); missing.forEach(key => query.append('key', key));
                sourceReads.set(signature, (async () => {
                    const value = await json('/freevideo/editor/sources?' + query, undefined, {sources: {}});
                    cache(value.sources);
                    for (const key of missing) if (fakeSources.has(key) && (!sources.has(key) || sources.get(key).missing)) sources.set(key, fakeSources.get(key));
                })().finally(() => sourceReads.delete(signature)));
            }
            await sourceReads.get(signature); return sources;
        },
        subscribeSources(fn) { watchers.add(fn); return () => watchers.delete(fn); },
        async waveform(key, points = 200) {
            return (await json('/freevideo/editor/waveform?' + new URLSearchParams({key, points}), undefined, {peaks: []})).peaks || [];
        },
        async works(before = null) {
            const query = new URLSearchParams({limit: '24'}); if (before) query.set('before', before);
            const value = await json('/freevideo/library?' + query, {cache: 'no-store'}, {items: [], next: null});
            const fallback = {};
            for (const row of value.items || []) if (row.video && row.id && !sources.has(`work:${row.id}`)) {
                fallback[`work:${row.id}`] = {...row.geometry, _fallback: true, video: mediaURL(api, row.video), audio: mediaURL(api, row.video),
                    has_video: true, has_audio: row.has_audio !== false, path: row.video, missing: false,
                    thumbnail: api.apiURL?.('/freevideo/library/thumbnail?' + new URLSearchParams({id: row.id})) || '/freevideo/library/thumbnail?' + new URLSearchParams({id: row.id})};
            }
            if (Object.keys(fallback).length) cache(fallback);
            return value;
        },
        async imports() { return (await json('/freevideo/editor/imports', undefined, {items: []})).items || []; },
        watchImports(fn) { return watch(() => store.imports(), items => { fn(items); return true; }); },
        upload(file, progress = () => {}) {
            if (disposed) return Promise.reject(new Error('editor_closed'));
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const release = () => { uploads.delete(upload); xhr.onload = xhr.onerror = null; xhr.upload.onprogress = null; };
                const upload = {xhr, release, reject}; uploads.add(upload);
                xhr.open('POST', api.apiURL?.('/freevideo/editor/import') || '/freevideo/editor/import');
                xhr.setRequestHeader('X-FreeVideo-Filename', encodeURIComponent(file.name));
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
                xhr.onload = () => {
                    release();
                    if (xhr.status === 404) { notice('import', 'Import is unavailable until you restart after updating.', '更新后重启即可导入素材。'); resolve(null); return; }
                    if (xhr.status < 200 || xhr.status >= 300) { reject(errorFor(xhr)); return; }
                    try { resolve(JSON.parse(xhr.responseText).import); } catch (error) { reject(error); }
                };
                xhr.onerror = () => { release(); reject(new Error('import_failed')); };
                try { xhr.send(file); } catch (error) { release(); reject(error); }
            });
        },
        capabilities(options, onReady = () => {}) {
            capabilityPoll?.dispose();
            const size = generationSize(options);
            const fallback = {maxSeconds: 15, maxFollowSeconds: 15, maxRequestFrames: null, estimate: () => null, generationSize: size};
            if (disposed) return fallback;
            const started = clock.now();
            let active = true, timer = null;
            const controller = new AbortController();
            const poller = {dispose() {
                active = false; clock.clearTimeout(timer); controller.abort(); pollers.delete(poller);
            }};
            capabilityPoll = poller; pollers.add(poller);
            async function read() {
                try {
                    const reply = await json('/freevideo/capabilities?' + new URLSearchParams(size), {signal: controller.signal});
                    if (!active || disposed) return;
                    if (reply?.status === 'computing') {
                        const seconds = Number(reply.retry_after_seconds);
                        const delay = clock.now() - started >= 60000 ? 10000
                            : Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, Math.min(60000, seconds * 1000)) : 1000;
                        timer = clock.setTimeout(() => { timer = null; read(); }, delay);
                        return;
                    }
                    if (!reply || (reply.status && reply.status !== 'ready')) { poller.dispose(); return; }
                    // Advertised presets must not change the size we just asked
                    // about: both estimates and the final request use this size.
                    const value = capabilityPoints(reply, {...options, ...size});
                    const ready = {maxSeconds: value.maxSeconds, maxFollowSeconds: value.maxFollowSeconds, maxRequestFrames: value.maxRequestFrames,
                        sizes: reply.sizes, generationSize: size,
                        estimate: frames => interpolate(value.points, frames / 24)};
                    onReady(ready); poller.dispose();
                } catch { if (active) poller.dispose(); }
            }
            // The first HTTP response can itself be slow. Editing starts with
            // these limits; only the callback publishes a measured capability.
            read(); return fallback;
        },
        async startChain(payload) {
            if (fakeEnabled()) return startFake(payload);
            const value = await json(chainRoute(), post(payload));
            if (!value) { console.info('[FreeVideo editor] Chain endpoint absent; using the local fake generator.'); return startFake(payload); }
            return value.chain;
        },
        async chain(id) { return id.startsWith('fake-') ? fakeState(id) : (await json(chainRoute(id)))?.chain || null; },
        watchChain(id, fn) { return watch(() => store.chain(id), fn); },
        async chainAction(id, action) {
            if (id.startsWith('fake-')) {
                const job = fakeJob(id); if (!job) return null;
                if (action === 'cancel' && job.active) { job.elapsed += clock.now() - job.started; job.active = false; }
                if (action === 'resume' && !job.active) { job.started = clock.now(); job.active = true; }
                persistFake(job); return fakeState(id);
            }
            const payload = action === 'resume' && api.clientId ? {client_id: api.clientId} : {};
            return (await json(chainRoute(id, action), post(payload)))?.chain || null;
        },
        async export(id, revision, options) {
            const value = await json('/freevideo/editor/export', post({id, revision, ...(options && Object.keys(options).length ? {options} : {})}));
            if (!value) notice('export', 'Export is unavailable until you restart after updating.', '更新后重启即可导出。');
            return value?.export || null;
        },
        watchExport(id, fn) { return watch(async () => (await json('/freevideo/editor/export?' + new URLSearchParams({id})))?.export || null, fn); },
        cancelExport: id => json('/freevideo/editor/export/cancel', post({id})),
        dispose() { disposed = true; session.dispose(); for (const poller of pollers) poller.dispose(); pollers.clear(); watchers.clear();
            for (const upload of [...uploads]) { upload.release(); upload.xhr.abort(); upload.reject(new Error('editor_closed')); } },
    };
    return store;
}
