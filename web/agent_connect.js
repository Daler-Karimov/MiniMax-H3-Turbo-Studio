import {agentGet} from './agent_session.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// null means no connection has been seen; '' remembers a connection without a name.
export function connectionState(copied, status, previousName, t) {
    if (status?.connected === true) return {color: 'green', text: status.client?.trim() || t('Connected', '已连接'), buttonText: t('Copy', '复制')};
    if (previousName != null) {
        const name = previousName || 'Agent';
        return {color: 'gray', text: t(`${name} disconnected`, `${name} 已断开`), buttonText: t('Reconnect', '重新连接')};
    }
    return {color: 'gray', text: copied ? t('Waiting for connection…', '等待连接…') : t('Not connected', '未连接'), buttonText: t('Copy', '复制')};
}

export function connectionSentence(address, t) {
    const url = address + '/freevideo/agent';
    return t(`Connect to FreeVideo: open ${url} and follow the instructions.`, `请连接 FreeVideo：打开 ${url} 并按说明操作。`);
}

// Shown under the status line, only when the service says editing cannot run here; connecting still works.
export function editingNote(status, t) {
    return status?.editing === false ? t('The agent cannot edit videos or images for now.', 'Agent 暂时不能剪辑和修图。') : '';
}

// Whether this FreeVideo has the Agent interface on. Any failure counts as off: the surface shows nothing.
export async function agentInterfaceEnabled(api) {
    try {
        const response = await api.fetchApi('/freevideo/agent', {cache: 'no-store'});
        return response.ok && (await response.json()).enabled === true;
    } catch { return false; }
}

// The card alone: who can connect, the sentence, one light and one button. It belongs to whichever surface
// shows it. shown() says whether the user can see it now; the surface calls sync() whenever that may have changed.
export function agentConnectCard(t, api, shown = () => true) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./agent_connect.css', import.meta.url).href; document.head.append(css);
    const body = el('div', 'fv-agent-connect-body');
    const subtitle = el('p', 'fv-muted', t('Claude Code, Codex, FreeToken and others', 'Claude Code、Codex、FreeToken 等'));
    const sentence = el('p', 'fv-agent-sentence');
    const note = el('p', 'fv-agent-note'); note.hidden = true;
    const actions = el('div', 'fv-agent-connect-actions');
    const status = el('div', 'fv-agent-connect-status'); status.setAttribute('role', 'status');
    const dot = el('span', 'fv-agent-connect-dot'); dot.setAttribute('aria-hidden', 'true');
    const label = el('span'); status.append(dot, label);
    const button = el('button', 'fv-primary'); button.type = 'button'; button.disabled = true;
    actions.append(status, button); body.append(subtitle, sentence, actions, note);

    let copied = false, feedback = false, previousName = null, value = null;
    let timer, feedbackTimer, controller, generation = 0;
    const active = () => body.isConnected && shown();
    function render() {
        const state = connectionState(copied, value, previousName, t);
        dot.dataset.color = state.color; label.textContent = state.text;
        button.textContent = feedback ? t('Copied', '已复制') : state.buttonText;
        note.textContent = editingNote(value, t); note.hidden = !note.textContent;
    }
    render();

    button.onclick = async () => {
        const text = sentence.textContent;
        try { await navigator.clipboard.writeText(text); }
        catch {
            const range = document.createRange(); range.selectNodeContents(sentence);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        }
        if (!active()) return;
        copied = true;
        if (value?.connected !== true) previousName = null;
        feedback = true; render();
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => { feedback = false; render(); }, 2000);
    };

    function stop() {
        generation++; clearTimeout(timer); timer = null;
        controller?.abort(); controller = null;
        clearTimeout(feedbackTimer); feedback = false; render();
    }
    async function poll() {
        const current = generation;
        const request = new AbortController(); controller = request;
        try {
            if (!sentence.textContent) {
                // The sentence carries no parameter: the server gives the agent the language this card showed.
                const response = await api.fetchApi('/freevideo/agent/connect?lang=' + t('en', 'zh'), {cache: 'no-store', signal: request.signal});
                if (!response.ok) return;
                const connect = await response.json();
                if (current !== generation || !active()) return;
                if (!connect.address) return;
                sentence.textContent = connectionSentence(connect.address, t);
                button.disabled = false;
            }
            const response = await agentGet(api, '/freevideo/agent/v1/connect/status', {signal: request.signal});
            if (!response.ok) return;
            const next = await response.json();
            if (current !== generation || !active()) return;
            value = next;
            if (value.connected === true) previousName = value.client?.trim() || previousName || '';
            render();
        } catch { /* Keep the last observed state and retry while expanded. */ }
        finally {
            if (current === generation) {
                controller = null;
                if (active()) timer = setTimeout(poll, 3000);
            }
        }
    }
    function sync() {
        if (!active()) { stop(); return; }
        if (!controller && !timer) poll();
    }
    // Resolves to whether this FreeVideo has the Agent interface on; a surface shows nothing when it is off.
    const enabled = agentInterfaceEnabled(api);
    return {element: body, title: t('Connect an agent', '连接 Agent'), enabled, sync, stop};
}

// Settings: the card as one collapsible section of the dialog.
export function agentConnect(t, api) {
    let observer, dialog;
    const section = el('details', 'fv-agent-connect');
    section.hidden = true;
    const card = agentConnectCard(t, api, () => !section.hidden && section.open && section.dataset.expanded !== 'false'
        && (!dialog || dialog.open && dialog.dataset.closing !== 'true'));
    section.append(el('summary', null, card.title), card.element);
    function close() {
        card.stop(); observer?.disconnect(); observer = null;
        dialog?.removeEventListener('close', close); dialog = null;
    }
    section.addEventListener('toggle', () => {
        if (!observer) {
            dialog = section.closest('dialog');
            observer = new MutationObserver(card.sync);
            observer.observe(section, {attributes: true, attributeFilter: ['open', 'hidden', 'data-expanded']});
            if (dialog) {
                observer.observe(dialog, {attributes: true, attributeFilter: ['open', 'data-closing']});
                dialog.addEventListener('close', close);
            }
        }
        card.sync();
    });
    card.enabled.then(on => {
        if (on) section.hidden = false;
        else { close(); section.remove(); }
    });
    return section;
}
