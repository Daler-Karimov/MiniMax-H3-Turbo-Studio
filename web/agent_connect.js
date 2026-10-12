import {agentPost} from './agent_session.js';
// Settings section: connect an AI agent (Claude Code, Cursor, scripts) to this FreeVideo.
const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./agent_connect.css', import.meta.url).href; document.head.append(css);

const DOCS = 'https://github.com/FlashML-org/FreeVideo/blob/main/docs/AGENTS.md';
const DOCS_ZH = 'https://github.com/FlashML-org/FreeVideo/blob/main/docs/zh-CN/AGENTS.md';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function ago(iso, t) {
    const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 90) return t('just now', '刚刚');
    if (seconds < 5400) return t(`${Math.round(seconds / 60)} min ago`, `${Math.round(seconds / 60)} 分钟前`);
    if (seconds < 129600) return t(`${Math.round(seconds / 3600)} h ago`, `${Math.round(seconds / 3600)} 小时前`);
    return t(`${Math.round(seconds / 86400)} days ago`, `${Math.round(seconds / 86400)} 天前`);
}

// A command or snippet with a Copy button; falls back to selecting the text.
function copyable(t, label, text, {block = false} = {}) {
    const wrap = el('div', 'fv-agent-copy' + (block ? ' fv-agent-copy-block' : ''));
    const head = el('div', 'fv-agent-copy-head');
    const code = el(block ? 'pre' : 'code', null, text);
    const button = el('button', null, t('Copy', '复制')); button.type = 'button';
    button.setAttribute('aria-label', t('Copy ', '复制') + label);
    button.onclick = async () => {
        try { await navigator.clipboard.writeText(text); button.textContent = t('Copied', '已复制'); }
        catch {
            const range = document.createRange(); range.selectNodeContents(code);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
            button.textContent = t('Selected', '已选中');
        }
        setTimeout(() => { button.textContent = t('Copy', '复制'); }, 1600);
    };
    head.append(el('span', null, label), button);
    wrap.append(head, code);
    return wrap;
}

export function agentConnect(t, api) {
    const section = el('details', 'fv-agent-connect');
    // Agent features can be off in this FreeVideo: the section appears only when they are on.
    section.hidden = true;
    (async () => {
        let on = false;
        try {
            const response = await api.fetchApi('/freevideo/agent', {cache: 'no-store'});
            on = response.ok && (await response.json()).enabled === true;
        } catch { on = false; }
        if (on) section.hidden = false;
        else section.remove();
    })();
    section.append(el('summary', null, t('AI agents', 'AI Agent 接入')));
    const body = el('div', 'fv-agent-connect-body');
    body.append(el('p', 'fv-muted', t('Let Claude Code, Cursor and other AI agents generate, review and edit with FreeVideo on this computer. Their jobs share the queue with yours and appear at the top of the creative workspace.',
        '让 Claude Code、Cursor 等 AI Agent 在这台电脑上用 FreeVideo 生成、审片和剪辑。它们的任务与您的生成共用队列，并显示在创作面板顶部。')));
    const content = el('div', 'fv-agent-connect-content'); content.setAttribute('aria-live', 'polite');
    content.append(el('p', 'fv-muted', t('Loading…', '正在读取…')));
    body.append(content);
    section.append(body);
    let loaded = false;

    async function load() {
        let value;
        try {
            const response = await api.fetchApi('/freevideo/agent/connect', {cache: 'no-store'});
            value = await response.json();
            if (!response.ok) throw new Error(value?.error?.message || response.statusText);
        } catch (error) {
            content.replaceChildren(el('p', 'fv-failure', t('Agent connection is unavailable: ', '无法读取 Agent 接入信息：') + error.message));
            return;
        }
        loaded = true;
        content.replaceChildren();
        content.append(copyable(t, 'Claude Code', value.claude_code),
            copyable(t, t('Claude Desktop, Cursor (mcpServers)', 'Claude Desktop、Cursor（mcpServers）'), JSON.stringify(value.mcp_json, null, 2), {block: true}));
        if (value.cli) content.append(copyable(t, t('Command line', '命令行'), value.cli));
        const facts = el('dl', 'fv-agent-facts');
        const fact = (name, text) => { facts.append(el('dt', null, name), el('dd', null, text)); };
        fact(t('HTTP API', 'HTTP 接口'), value.api);
        fact(t('Token', '令牌'), value.token_from_environment
            ? t('Set by FREEVIDEO_AGENT_TOKEN', '由环境变量 FREEVIDEO_AGENT_TOKEN 指定')
            : value.token_file);
        fact(t('Recent agents', '最近连接的 Agent'), value.agents?.length
            ? value.agents.map(a => `${a.client} · ${ago(a.last_seen, t)}`).join('，')
            : t('None yet', '暂无'));
        content.append(facts);
        const actions = el('div', 'fv-actions fv-agent-actions');
        const docs = el('a', null, t('Agent guide ↗', 'Agent 使用说明 ↗'));
        docs.href = t(DOCS, DOCS_ZH); docs.target = '_blank'; docs.rel = 'noopener noreferrer';
        const reset = el('button', null, t('Reset token', '重置令牌')); reset.type = 'button';
        reset.hidden = !!value.token_from_environment;
        const confirm = el('div', 'fv-agent-confirm'); confirm.hidden = true; confirm.setAttribute('role', 'group');
        const yes = el('button', 'fv-danger', t('Reset', '重置')); yes.type = 'button';
        const no = el('button', null, t('Keep', '保留')); no.type = 'button';
        confirm.append(el('span', null, t('Connected agents will need the new token; MCP servers read it again when they restart.',
            '已连接的 Agent 需要改用新令牌；MCP 服务重启后会自动读取。')), yes, no);
        const status = el('p', 'fv-muted'); status.setAttribute('role', 'status');
        reset.onclick = () => { confirm.hidden = false; reset.hidden = true; no.focus(); };
        no.onclick = () => { confirm.hidden = true; reset.hidden = false; reset.focus(); };
        yes.onclick = async () => {
            yes.disabled = true;
            try {
                const response = await agentPost(api, '/freevideo/agent/connect/reset', {});
                if (!response.ok) throw new Error(response.statusText);
                status.textContent = t('A new token was created. The old one no longer works.', '已生成新令牌，旧令牌已失效。');
            } catch (error) {
                status.className = 'fv-failure'; status.textContent = error.message;
            } finally { yes.disabled = false; confirm.hidden = true; reset.hidden = false; }
        };
        actions.append(docs, reset);
        content.append(actions, confirm, status);
    }
    section.addEventListener('toggle', () => { if (section.open && !loaded) load(); });
    return section;
}
