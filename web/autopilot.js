// The Agent's own page, beside the studio and the editing view: the card that connects one, and under it what the agent is doing.
import { api } from '../../scripts/api.js';
import { agentActivityList } from './agent_activity.js';
import { agentConnectCard } from './agent_connect.js';
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
    tools.append(settings);
    // The view chosen next takes over once this page has closed; Escape goes back to what is underneath.
    let next = () => studio?.open ? viewChanged('studio', node) : viewChanged('nodes', node);
    const leave = action => { next = action; closeDialog(dialog); };
    const navigation = viewSwitch('autopilot', () => leave(() => studio?.open ? viewChanged('studio', node) : openStudio(node)),
        () => leave(() => showNodes(node, studio)), () => leave(() => openEditorView(node, {studio: studio?.open ? studio : undefined})), () => {});
    header.append(brand, navigation, tools);
    const card = agentConnectCard(t, api, () => dialog.open && dialog.dataset.closing !== 'true');
    const body = el('div', 'fv-autopilot-body'), panel = el('section', 'fv-autopilot-card');
    // The list shows itself once an agent is connected or has jobs, and asks nothing while this page is out of sight.
    // A finished job opens its work in Creations. Continuing it there belongs to the studio, so this page gives way first.
    const jobs = agentActivityList(t, api, {open: async job => (await import('./library.js')).openLibrary(t, {selectedWork: job.work,
        extend: async record => {
            if (dialog.open) await new Promise(done => { dialog.addEventListener('close', done, {once: true}); closeDialog(dialog); });
            return extendVideo(record, node);
        }})});
    panel.append(el('h2', null, card.title), card.element); body.append(panel, jobs.element);
    card.enabled.then(on => { if (!on) panel.hidden = true; });
    dialog.append(header, body);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.onclose = () => {
        card.stop(); jobs.stop(); dialog.remove();
        if (current === dialog) current = null;
        next();
    };
    current = dialog; document.body.append(dialog); dialog.showModal(); viewChanged('autopilot', node); card.sync();
    navigation.querySelector('[data-view=autopilot]').focus();
    return dialog;
}
