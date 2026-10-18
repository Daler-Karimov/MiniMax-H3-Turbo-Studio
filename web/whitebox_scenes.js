// The ready-made white-model scenes: one is started with the page's chat session, and the Agent's backend
// renders it through this page's whitebox worker and then puts the confirm card into that conversation.
import { agentGet, agentPost } from './agent_session.js';

export const SCENE_TEXT = Object.freeze({
    icon: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
    label: ['Ready-made', '现成场景'], name: ['Start from a ready-made white-model scene', '用现成的白模场景开始'],
    preparing: ['Preparing the white model…', '正在准备白模…'], failed: ['The white model could not be made: ', '白模没有做成：'],
    timeout: ['The white model took too long and was not made. Try again.', '白模等了太久，没有做成，请重试。'],
});

export async function sceneList(api) {
    const response = await agentGet(api, '/freevideo/agent/whitebox/presets');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = (await response.json())?.presets;
    return Array.isArray(rows) ? rows.filter(row => typeof row?.id === 'string' && typeof row.name === 'string') : [];
}

export async function startScene(api, preset, session) {
    const response = await agentPost(api, '/freevideo/agent/whitebox/try', {preset, ...(session ? {session} : {})});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value?.error?.message || value?.error?.code || `HTTP ${response.status}`);
    return value?.id || null;
}

// Resolves with the scene's last state: 'ready' (the card follows), 'failed' (with error), or 'timeout'.
export async function watchScene(api, id, {every = 3000, limit = 180000, stopped = () => false, wait = ms => new Promise(done => setTimeout(done, ms))} = {}) {
    for (let waited = 0; waited < limit && !stopped(); waited += every) {
        try {
            const response = await agentGet(api, `/freevideo/agent/whitebox/${encodeURIComponent(id)}`);
            if (response.ok) {
                const value = await response.json();
                if (value?.status === 'ready' || value?.status === 'failed') return value;
            }
        } catch { /* Asked again on the next turn. */ }
        await wait(every);
    }
    return {status: 'timeout'};
}
