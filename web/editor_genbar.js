// The editor owns its generation controls; progress can use the optional component.
import {createFirstFrameSwitch} from './editor_first_frame.js';
import {createEditorReferences} from './editor_references.js';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const timeEstimate = (seconds, t) => seconds == null ? '' : seconds < 60
    ? t(`about ${Math.max(1, Math.ceil(seconds))} s`, `约 ${Math.max(1, Math.ceil(seconds))} 秒`)
    : t(`about ${Math.ceil(seconds / 60)} minutes`, `约 ${Math.ceil(seconds / 60)} 分钟`);
export function createEditorGenbar(host, {state, t, actions, text = ''}) {
    const hint = el('span', 'fv-ed-gen-hint');
    const input = el('input', 'fv-ed-description'); input.type = 'text'; input.value = text;
    const generate = el('button', 'fv-ed-generate'), cancel = el('button', null, t('Cancel', '取消')), resume = el('button', null, t('Continue', '继续'));
    for (const button of [generate, cancel, resume]) button.type = 'button';
    host.append(hint, input, generate, cancel, resume);
    const firstFrame = createFirstFrameSwitch(host, {state, t, actions});
    input.after(firstFrame.element);
    // Reference pictures for a part that starts fresh: thumbnails and a small "+" before the description.
    const references = actions.references ? createEditorReferences({t, source: actions.references.source, size: actions.references.size, error: actions.error, notify: actions.references.notify}) : null;
    if (references) input.before(references.element);
    let status = null, serial = 0, disposed = false, submitting = false, previewSelection = null, estimateCache = null;
    async function render() {
        if (disposed) return;
        const current = ++serial, selection = previewSelection || state.selection;
        const busy = submitting || ['queued', 'running', 'cancelling'].includes(status?.state);
        const stopped = ['failed', 'cancelled', 'interrupted'].includes(status?.state);
        const selected = !!selection && (!!previewSelection || (actions.supportedSelection?.() ?? true));
        host.dataset.mode = busy ? 'running' : selected ? 'selected' : 'idle';
        hint.hidden = !busy; input.hidden = generate.hidden = busy;
        input.disabled = !selected || busy;
        input.placeholder = selected ? t('Describe this part', '描述这一段')
            : '';
        input.setAttribute('aria-label', t('Description', '描述'));
        generate.classList.toggle('fv-primary', selected && !busy);
        cancel.hidden = !busy; resume.hidden = !stopped;
        if (busy) {
            const blocks = status?.blocks || [], done = blocks.filter(block => block.state === 'done').length;
            const number = Math.min(blocks.length || 1, Math.max(done, status?.chainProgress?.index || 0) + 1), count = blocks.length || 1;
            const remaining = status?.chainProgress?.overall?.remaining_seconds ?? (blocks.every(block => Number.isFinite(block.remaining_seconds)) ? blocks.reduce((sum, block) => sum + block.remaining_seconds, 0) : null);
            hint.textContent = t(`Part ${number}/${count}`, `第 ${number}/${count} 段`)
                + (remaining != null ? ' · ' + timeEstimate(remaining, t) : '');
        }
        firstFrame.update(busy);
        references?.update(busy, busy ? undefined : !!actions.references.visible());
        generate.textContent = t('Generate', '生成');
        generate.disabled = busy || !!previewSelection || !selected || !actions.canGenerate?.(input.value);
        generate.title = '';
        if (selected && !busy) {
            const key = JSON.stringify(selection);
            if (estimateCache?.key === key) generate.textContent += estimateCache.label;
            const seconds = await actions.estimate(selection);
            if (disposed || current !== serial) return;
            const label = seconds == null ? '' : ' · ' + timeEstimate(seconds, t);
            estimateCache = {key, label};
            generate.textContent = t('Generate', '生成') + label;
        }
    }
    input.oninput = () => { state.setRangeText(input.value); render(); };
    generate.onclick = async () => {
        submitting = true; render();
        try { await actions.generate({target: 'both', text: input.value}); }
        catch (error) { actions.error(error); }
        finally { submitting = false; render(); }
    };
    cancel.onclick = () => actions.cancel().catch(actions.error);
    resume.onclick = () => actions.resume().catch(actions.error);
    const unsubscribe = state.subscribe(event => {
        if (event.type === 'selection' && state.selection?.kind === 'range') {
            if (state.rangeText === null) state.setRangeText(input.value);
            else if (input.value !== state.rangeText) input.value = state.rangeText;
        }
        if (event.type === 'selection' && state.selection?.kind === 'clip') {
            const selected = state.record.tracks.flatMap(track => track.clips).find(clip => state.selection.ids.includes(clip.id) && clip.pending);
            // A part with no description of its own keeps what is typed, as a new range does.
            if (selected?.text) input.value = selected.text;
        }
        if (event.type === 'selection' || event.type === 'record') render();
    });
    render();
    return {element: host, getText() { return input.value; }, update(value) { status = value; render(); }, preview(selection) { previewSelection = selection; render(); }, setText(value) { input.value = value || ''; state.setRangeText(input.value); render(); },
        dispose() { disposed = true; ++serial; unsubscribe(); references?.dispose(); }};
}

// A missing optional module leaves the editor's existing progress in place.
export async function loadEditorComponents(load = path => import(path)) {
    const results = await Promise.allSettled([load('./block_progress.js')]);
    return {blocks: results[0].status === 'fulfilled' ? results[0].value : null};
}

// What a part's progress reads from each message: Studio's displayed percentage while it
// shows this part, never a stage's own fraction (one loading step or one pass), which
// read as the part's showed a part still generating as finished.
export function blockMessages(messages, snapshot = () => null) {
    return messages.map(message => {
        const part = {...message}, shown = snapshot(message); delete part.display_fraction;
        return shown ? {...part, ...shown} : part;
    });
}
export function editorBlockStates(job, messages = [], resolve = null) {
    if (resolve) return resolve(job, messages);
    const states = {pending: 'waiting', queued: 'waiting', running: 'generating', done: 'done',
        failed: 'failed', cancelled: 'stopped', interrupted: 'stopped'};
    return Object.fromEntries((job.blocks || []).map(block => {
        const live = messages.find(message => message.chain?.id === job.id && message.chain?.block === block.id);
        const running = block.state === 'running' || block.state === 'queued';
        const fraction = block.state === 'done' ? 1 : running && live
            ? Number.isFinite(live.percent) ? live.percent / 100 : live.bar ?? live.overall?.fraction ?? block.fraction
            : block.fraction;
        return [block.id, {state: running && live ? 'generating' : states[block.state] || 'waiting',
            fraction: Math.max(0, Math.min(1, fraction || 0)),
            remainingSeconds: running && live ? live.remaining_seconds ?? live.overall?.remaining_seconds ?? block.remaining_seconds ?? null
                : block.remaining_seconds ?? null}];
    }));
}
