// Generation settings inspector block for the "Edit" tab (Quality, Two-pass, Steps)
import * as model from './editor_model.js';

const el = (tag, cls = null, text = null) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};

export function createEditorGenCard({ state, t, actions }) {
    const container = el('div', 'fv-ed-gen-card');

    const header = el('div', 'fv-ed-gen-card-head');
    const title = el('span', 'fv-ed-adjust-label', 'Настройки генерации');
    header.append(title);

    // Quality row
    const qRow = el('div', 'fv-ed-gen-row');
    const qLabel = el('span', 'fv-ed-gen-sublabel', 'Качество');
    const qPills = el('div', 'fv-ed-pills');
    const qualities = [
        { id: 'Light', label: 'Light', base_steps: 8, refine_steps: 3, two_pass: true, desc: 'Быстрый (8+3 шага)' },
        { id: 'Medium', label: 'Medium', base_steps: 12, refine_steps: 3, two_pass: true, desc: 'Баланс (12+3 шага)' },
        { id: 'High', label: 'High', base_steps: 16, refine_steps: 0, two_pass: false, desc: 'Высокое (16 шагов)' },
        { id: 'Max', label: 'Max', base_steps: 20, refine_steps: 0, two_pass: false, desc: 'Максимум (20 шагов)' }
    ];
    const pillButtons = new Map();
    for (const q of qualities) {
        const btn = el('button', 'fv-ed-pill-btn', q.label);
        btn.type = 'button';
        btn.title = q.desc;
        btn.onclick = () => {
            applySettings({
                quality: q.id,
                base_steps: q.base_steps,
                refine_steps: q.refine_steps,
                two_pass: q.two_pass
            });
        };
        pillButtons.set(q.id, btn);
        qPills.append(btn);
    }
    qRow.append(qLabel, qPills);

    // Two-pass row
    const tpRow = el('div', 'fv-ed-gen-row fv-ed-gen-row-inline');
    const tpLabel = el('span', 'fv-ed-gen-sublabel', 'Two-pass');
    const tpButtons = el('div', 'fv-ed-toggle-group');
    const btnOn = el('button', 'fv-ed-toggle-btn', 'On');
    btnOn.type = 'button';
    btnOn.onclick = () => {
        applySettings({ two_pass: true, refine_steps: 3 });
    };
    const btnOff = el('button', 'fv-ed-toggle-btn', 'Off');
    btnOff.type = 'button';
    btnOff.onclick = () => {
        applySettings({ two_pass: false, refine_steps: 0 });
    };
    tpButtons.append(btnOn, btnOff);
    tpRow.append(tpLabel, tpButtons);

    container.append(header, qRow, tpRow);

    function getSettings() {
        return state.record?.settings || {};
    }

    function applySettings(delta) {
        try {
            state.apply(t('Change generation settings', 'Изменение настроек генерации'), record => {
                const next = model.copy(record);
                next.settings = { ...(next.settings || {}), ...delta };
                return model.finish(next);
            });
        } catch (e) {
            console.error('[FreeVideo] Error saving settings:', e);
            if (state.record) {
                state.record.settings = { ...(state.record.settings || {}), ...delta };
            }
        }
        updateUI();
    }

    function updateUI() {
        const s = getSettings();
        const currentQuality = s.quality || (s.base_steps === 8 ? 'Light' : s.base_steps === 12 ? 'Medium' : s.base_steps === 16 ? 'High' : s.base_steps === 20 ? 'Max' : 'Light');
        for (const [id, btn] of pillButtons) {
            btn.classList.toggle('fv-active', id === currentQuality);
        }
        const tp = s.two_pass !== false;
        btnOn.classList.toggle('fv-active', tp);
        btnOff.classList.toggle('fv-active', !tp);
    }

    updateUI();

    return {
        element: container,
        update: updateUI
    };
}
