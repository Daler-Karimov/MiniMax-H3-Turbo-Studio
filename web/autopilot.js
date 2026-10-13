// The Agent's own page, beside the studio and the editing view: the card that connects one, then the conversation with it.
import { api } from '../../scripts/api.js';
import { agentConnectCard, connectionLabel } from './agent_connect.js';
import { about, agentChat, jobFraction, jobName } from './autopilot_chat.js';
import { openEditorView } from './editor_loader.js';
import { closeDialog } from './motion.js';
import { openSetup } from './setup.js';
import { extendVideo, openStudio, showNodes } from './studio.js';
import { viewChanged, viewSwitch } from './view_navigation.js';
import { wordmark } from './wordmark.js';

const languageOverride = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('freevideo_lang') : null;
const cn = languageOverride === 'zh' || (languageOverride !== 'en'
    && String(navigator.language || '').toLowerCase().startsWith('zh'));
const t = (en, zh) => cn ? zh : en;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let current = null;
// Opens above the studio when one is open, as the editing view does, so going back finds it as it was.
export function openAutopilotView(node, {studio = null} = {}) {
    if (current?.open) { viewChanged('autopilot', node); return current; }
    studio?.querySelectorAll('video,audio').forEach(media => media.pause());
    const dialog = el('dialog', 'fv-studio fv-autopilot'); dialog.setAttribute('aria-label', t('Autopilot', 'AI 全自动'));
    const header = el('header', 'fv-header'), brand = el('div', 'fv-brand'), tools = el('div', 'fv-header-actions');
    brand.append(wordmark());
    const settings = el('button', 'fv-quiet', t('Settings', '设置')); settings.type = 'button'; settings.onclick = openSetup;
    // The one place this page says who is connected, and beside it what that agent is making now.
    const lamp = el('button', 'fv-autopilot-lamp'), lampText = el('span'); lamp.type = 'button'; lamp.append(el('i'), lampText);
    const now = el('div', 'fv-autopilot-now'), go = el('button', 'fv-autopilot-now-go'), halt = el('button', 'fv-autopilot-now-stop'); now.hidden = true;
    const ring = el('i'), name = el('span', 'fv-autopilot-now-name'), more = el('span'), percent = el('b'), eta = el('em');
    go.type = halt.type = 'button'; go.append(ring, name, more, percent, eta); now.append(go, halt);
    halt.title = t('Stop all', '全部停止'); halt.setAttribute('aria-label', halt.title);
    const line = el('i', 'fv-autopilot-line');
    tools.append(now, lamp, settings);
    // The view chosen next takes over once this page has closed; Escape goes back to what is underneath.
    let next = () => studio?.open ? viewChanged('studio', node) : viewChanged('nodes', node);
    const leave = action => { next = action; closeDialog(dialog); };
    const navigation = viewSwitch('autopilot', () => leave(() => studio?.open ? viewChanged('studio', node) : openStudio(node)),
        () => leave(() => showNodes(node, studio)), () => leave(() => openEditorView(node, {studio: studio?.open ? studio : undefined})), () => {});
    header.append(brand, navigation, tools, line);
    const inSight = () => dialog.open && dialog.dataset.closing !== 'true';
    const body = el('div', 'fv-autopilot-body');
    const card = agentConnectCard(t, api, () => inSight() && !card.element.hidden);
    // Leaving for another view waits until this page has closed, so the view underneath is never covered twice.
    const closed = () => dialog.open ? new Promise(done => { dialog.addEventListener('close', done, {once: true}); closeDialog(dialog); }) : null;
    const chat = agentChat(t, api, {shown: inSight,
        // A finished video opens as its work in Creations. Continuing it there belongs to the studio, so this page gives way first.
        open: async job => (await import('./library.js')).openLibrary(t, {selectedWork: job.work, back: t('Back to Autopilot', '返回 AI 全自动'),
            extend: async record => { await closed(); return extendVideo(record, node); }}),
        edit: job => leave(() => openEditorView(node, {studio: studio?.open ? studio : undefined, work: {id: job.work, video: `FreeVideo/${job.work}/video.mp4`, geometry: {width: job.width, height: job.height, seconds: job.seconds}}})),
        changed: view => { last = view; show(); }});
    // With no agent the card stands alone in the middle. Once one has connected the conversation stays, also after
    // it disconnects; the light then leads back to the card.
    let last = {known: false, agent: {}, current: null, active: 0, any: false}, on = null, wantCard = false, currentId = null;
    function show() {
        const connected = last.agent.connected === true, label = connectionLabel(last.agent, t);
        if (connected) wantCard = false;
        const ready = on === true && last.known, talking = ready && (connected || (last.any && !wantCard));
        // The card gives way to the conversation: typing can start at once.
        const arrived = talking && chat.element.hidden && (card.element.contains(document.activeElement) || document.activeElement === lamp);
        card.element.hidden = !ready || talking; chat.element.hidden = !talking;
        if (arrived) chat.input.focus();
        body.dataset.view = talking ? 'chat' : 'connect';
        lamp.hidden = !ready; lamp.dataset.color = label.color; lampText.textContent = label.text; lamp.disabled = connected || !last.any;
        const job = talking ? last.current : null;
        now.hidden = !job; line.dataset.on = String(!!job);
        if (job) {
            const fraction = jobFraction(job), running = job.status === 'running';
            currentId = job.id; name.textContent = jobName(job, t); more.textContent = last.active > 1 ? `+${last.active - 1}` : '';
            percent.textContent = running ? `${Math.round(fraction * 100)}%` : '';
            eta.textContent = running && job.progress?.remaining_seconds > 0 ? about(job.progress.remaining_seconds, t) : '';
            ring.style.setProperty('--p', String(fraction * 100)); line.style.width = `${fraction * 100}%`;
        }
        card.sync();
    }
    lamp.onclick = () => { wantCard = !wantCard; show(); };
    go.onclick = () => chat.scrollToJob(currentId);
    halt.onclick = () => chat.stopAll();
    body.append(card.element, chat.element);
    card.enabled.then(value => { on = value; show(); if (value) chat.sync(); });
    show();
    dialog.append(header, body);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.onclose = () => {
        card.stop(); chat.stop(); dialog.remove();
        if (current === dialog) current = null;
        next();
    };
    current = dialog; document.body.append(dialog); dialog.showModal(); viewChanged('autopilot', node); show();
    navigation.querySelector('[data-view=autopilot]').focus();
    return dialog;
}
