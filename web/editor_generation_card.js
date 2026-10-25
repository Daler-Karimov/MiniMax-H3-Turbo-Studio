// Generation settings inspector block for Edit mode matching Create mode (Studio)
import * as model from './editor_model.js';
import { frameShapes } from './frame_sizes.js';
import { canvasDimensions, imageSizeSelection } from './studio_size.js';
import { icon } from './result_actions.js';

const el = (tag, cls = null, text = null) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};

export function createEditorGenCard({ state, t, actions }) {
    const container = el('div', 'fv-ed-gen-card');

    const isRu = () => {
        try {
            const lang = new URLSearchParams(location.search).get('freevideo_lang') || navigator.language;
            return String(lang).toLowerCase().startsWith('ru');
        } catch { return false; }
    };
    const tr = (en, ru) => isRu() ? ru : t(en, en);

    // ==========================================
    // Section 1: Frame & duration (Формат и длительность)
    // ==========================================
    const frameSection = el('section', 'fv-section');
    const frameHead = el('div', 'fv-section-head');
    frameHead.append(el('span', 'fv-label', tr('Frame & duration', 'Формат и длительность')));
    frameSection.append(frameHead);

    const shapes = el('div', 'fv-shapes');
    const shapeButtons = new Map();

    const shapeDefs = [
        ['16:9', '16:9', 16 / 9, tr('Landscape (16:9)', 'Горизонтально (16:9)')],
        ['9:16', '9:16', 9 / 16, tr('Portrait (9:16)', 'Вертикально (9:16)')],
        ['1:1', '1:1', 1, tr('Square (1:1)', 'Квадрат (1:1)')],
        ['input', tr('Image', 'По фото'), null, tr('Match image ratio', 'По пропорциям кадра')]
    ];

    for (const [id, label, r, tooltip] of shapeDefs) {
        const btn = el('button', 'fv-shape');
        btn.type = 'button';
        btn.dataset.ratio = id;
        btn.title = tooltip;
        btn.setAttribute('aria-label', tooltip);
        btn.append(el('span', 'fv-shape-icon'), el('span', 'fv-shape-label', label));
        btn.onclick = async () => {
            try {
                if (id === 'input') {
                    await matchInputRatio();
                } else {
                    applyAspect(id, r);
                }
            } catch (err) {
                console.warn('[FreeVideo] Error setting aspect ratio:', err);
            }
        };
        shapeButtons.set(id, btn);
        shapes.append(btn);
    }
    frameSection.append(shapes);

    // Fields: Resolution dropdown + Duration input
    const fields = el('div', 'fv-fields');

    // Resolution dropdown
    const resField = el('label', 'fv-field');
    resField.append(el('span', null, tr('Resolution', 'Четкость')));
    const resSelectWrap = el('div', 'fv-resolution-select');
    const mpSelect = el('select');
    mpSelect.setAttribute('aria-label', tr('Resolution', 'Четкость'));
    for (const n of [.5, .75, .98, 1.5, 2]) {
        const opt = el('option', null, n === .98 ? `${n} MP · ${tr('Recommended', 'Рекоменд.')}` : `${n} MP`);
        opt.value = String(n);
        mpSelect.append(opt);
    }
    mpSelect.value = '0.98';

    const resolutionValue = el('span', 'fv-resolution-value');
    resolutionValue.setAttribute('aria-hidden', 'true');
    function syncResolutionLabel() {
        const val = Number(mpSelect.value);
        resolutionValue.textContent = isNaN(val) ? (mpSelect.value || '0.98 MP') : `${val.toFixed(2)} MP`;
    }
    syncResolutionLabel();

    const chevron = icon('chevron');
    resSelectWrap.append(mpSelect, resolutionValue, chevron);
    resField.append(resSelectWrap);

    mpSelect.onchange = () => {
        syncResolutionLabel();
        applyResolution(Number(mpSelect.value) || 0.98);
    };
    mpSelect.oninput = syncResolutionLabel;

    // Duration input
    const durField = el('label', 'fv-field');
    durField.append(el('span', null, tr('Duration, s', 'Длительность, с')));
    const secondsInput = el('input');
    secondsInput.type = 'number';
    secondsInput.min = '1.625';
    secondsInput.max = '60';
    secondsInput.step = '0.5';
    secondsInput.value = '5.0';
    secondsInput.setAttribute('aria-label', t('Duration in seconds', 'Длительность (сек)'));
    durField.append(secondsInput);

    secondsInput.onchange = () => {
        const val = Math.max(1.625, Number(secondsInput.value) || 5.0);
        secondsInput.value = String(val);
        applyDuration(val);
    };

    fields.append(resField, durField);
    frameSection.append(fields);

    // Dimensions note (e.g. 1280 × 768)
    const canvasNote = el('div', 'fv-canvas-note');
    const dimSpan = el('span', 'fv-dim-text', '');
    canvasNote.append(dimSpan);
    frameSection.append(canvasNote);

    // ==========================================
    // Section 2: Quality (Качество)
    // ==========================================
    const qualitySection = el('section', 'fv-section');
    const qualityHead = el('div', 'fv-section-head');
    qualityHead.append(el('span', 'fv-label', tr('Quality', 'Качество')));
    qualitySection.append(qualityHead);

    const qualities = [
        { id: 'Light', label: 'Light', base_steps: 8, refine_steps: 3, two_pass: true, desc: tr('Fast (8+3 steps)', 'Быстрый (8+3 шага)') },
        { id: 'Medium', label: 'Medium', base_steps: 8, refine_steps: 3, two_pass: true, desc: tr('Balanced (8+3 steps)', 'Баланс (8+3 шага)') },
        { id: 'High', label: 'High', base_steps: 16, refine_steps: 3, two_pass: false, desc: tr('High (16 steps)', 'Высокое (16 шагов)') },
        { id: 'Max', label: 'Max', base_steps: 20, refine_steps: 3, two_pass: false, desc: tr('Maximum (20 steps)', 'Максимум (20 шагов)') }
    ];
    const qualityPills = el('div', 'fv-quality-pills');
    const qualityButtons = new Map();

    for (const q of qualities) {
        const btn = el('button', 'fv-quality-btn', q.label);
        btn.type = 'button';
        btn.title = q.desc;
        btn.setAttribute('aria-label', q.label);
        btn.onclick = () => {
            applyQuality(q);
        };
        qualityButtons.set(q.id, btn);
        qualityPills.append(btn);
    }
    qualitySection.append(qualityPills);

    // Two-pass row
    const twoPassRow = el('div', 'fv-two-pass fv-pass-row');
    twoPassRow.append(el('span', null, tr('Two-pass', 'Двойной проход')));
    const passMode = el('div', 'fv-pass-mode');
    passMode.setAttribute('role', 'radiogroup');
    passMode.setAttribute('aria-label', tr('Two-pass sampling', 'Двойной проход'));

    const passOptions = [
        ['off', tr('Off', 'Откл.')],
        ['on', tr('On', 'Вкл.')],
        ['preview', tr('Preview', 'Превью')]
    ].map(([mode, label]) => {
        const btn = el('button', null, label);
        btn.type = 'button';
        btn.dataset.mode = mode;
        btn.setAttribute('role', 'radio');
        btn.onclick = () => choosePassMode(mode);
        passMode.append(btn);
        return btn;
    });
    twoPassRow.append(passMode);
    qualitySection.append(twoPassRow);

    container.append(frameSection, qualitySection);

    // ==========================================
    // Actions / Logic
    // ==========================================
    function getPixels() {
        return Number(mpSelect.value) || 0.98;
    }

    function applyAspect(aspectId, ratio) {
        const pixels = getPixels();
        const r = ratio || (16 / 9);
        const [w, h] = canvasDimensions(pixels, r);
        try {
            state.apply(t('Frame size', 'Размер кадра'), record => {
                return model.setPictureSize(record, w, h);
            });
        } catch (e) {
            console.error('[FreeVideo] Error applying aspect size:', e);
        }
        updateUI();
    }

    async function matchInputRatio() {
        const activeSlots = actions.getActiveSlots ? actions.getActiveSlots() : null;
        const slotImg = activeSlots?.first || activeSlots?.last;
        let matched = false;

        if (slotImg && slotImg.file) {
            try {
                const img = new Image();
                img.src = slotImg.file.startsWith('/') || slotImg.file.startsWith('http')
                    ? slotImg.file
                    : `/view?filename=${encodeURIComponent(slotImg.file)}&type=input`;
                await img.decode();
                if (img.naturalWidth && img.naturalHeight) {
                    const r = img.naturalWidth / img.naturalHeight;
                    applyAspect('input', r);
                    matched = true;
                }
            } catch (err) {
                console.warn('[FreeVideo] Could not load slot image dimensions:', err);
            }
        }

        if (!matched && state.record?.tracks) {
            const vTrack = state.record.tracks.find(tr => tr.id === 'v1');
            const firstClip = vTrack?.clips?.find(c => c.source);
            if (firstClip) {
                const src = actions.sources ? actions.sources.get?.(`work:${firstClip.source.id}`) : null;
                if (src?.width && src?.height) {
                    const r = src.width / src.height;
                    applyAspect('input', r);
                    matched = true;
                }
            }
        }

        if (!matched) {
            actions.notify?.(t('Add an image or video to match its ratio.', 'Добавьте изображение или видео для определения пропорций.'));
        }
    }

    function applyResolution(pixels) {
        const curW = state.record?.width || 1280;
        const curH = state.record?.height || 768;
        const ratio = curW / curH;
        const [w, h] = canvasDimensions(pixels, ratio);
        try {
            state.apply(t('Resolution', 'Разрешение'), record => {
                return model.setPictureSize(record, w, h);
            });
        } catch (e) {
            console.error('[FreeVideo] Error applying resolution:', e);
        }
        updateUI();
    }

    function applyDuration(sec) {
        try {
            state.apply(t('Duration', 'Длительность'), record => {
                return model.setSettings(record, { seconds: sec });
            });
            if (state.selection?.kind === 'range') {
                const frames = Math.round(sec * 24);
                state.select({ ...state.selection, frames });
            }
        } catch (e) {
            console.error('[FreeVideo] Error applying duration:', e);
        }
        updateUI();
    }

    function applyQuality(q) {
        try {
            state.apply(t('Generation settings', 'Настройки генерации'), record => {
                return model.setSettings(record, {
                    quality: q.id,
                    base_steps: q.base_steps,
                    refine_steps: q.refine_steps,
                    two_pass: q.two_pass
                });
            });
        } catch (e) {
            console.error('[FreeVideo] Error applying quality:', e);
        }
        updateUI();
    }

    function choosePassMode(mode) {
        const delta = {};
        if (mode === 'off') {
            delta.two_pass = false;
            delta.refine_steps = 3;
            delta.preview = false;
        } else if (mode === 'on') {
            delta.two_pass = true;
            delta.refine_steps = 3;
            delta.preview = false;
        } else if (mode === 'preview') {
            delta.two_pass = true;
            delta.refine_steps = 3;
            delta.preview = true;
        }
        try {
            state.apply(t('Two-pass sampling', 'Двойной проход'), record => {
                return model.setSettings(record, delta);
            });
        } catch (e) {
            console.error('[FreeVideo] Error applying pass mode:', e);
        }
        updateUI();
    }

    function updateUI() {
        const record = state.record || {};
        const width = record.width || 1280;
        const height = record.height || 768;
        const ratio = width / height;

        // Find nearest aspect shape
        let currentShape = 'custom';
        const presets = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1]];
        const match = presets.find(([, r]) => Math.abs(Math.log(ratio / r)) < 0.05);
        if (match) currentShape = match[0];

        for (const [id, btn] of shapeButtons) {
            btn.setAttribute('aria-pressed', String(id === currentShape));
        }

        // Update resolution options & value
        const pixels = (width * height) / (1024 ** 2);
        const sizeSel = imageSizeSelection(pixels, ratio, width, height);
        if (sizeSel?.value) {
            const nearestStr = String(sizeSel.value);
            let opt = [...mpSelect.options].find(o => o.value === nearestStr);
            if (!opt) {
                opt = el('option', null, `${sizeSel.value.toFixed(2)} MP`);
                opt.value = nearestStr;
                mpSelect.append(opt);
            }
            mpSelect.value = nearestStr;
        }
        syncResolutionLabel();

        // Update dimension text
        dimSpan.textContent = `${width} × ${height}`;

        // Update settings: duration, quality, two_pass
        const s = record.settings || {};
        if (document.activeElement !== secondsInput) {
            secondsInput.value = String(s.seconds || 5.0);
        }

        const currentQuality = s.quality || (s.base_steps === 8 ? 'Light' : s.base_steps === 12 ? 'Medium' : s.base_steps === 16 ? 'High' : s.base_steps === 20 ? 'Max' : 'Light');
        for (const [id, btn] of qualityButtons) {
            const active = (id === currentQuality);
            btn.classList.toggle('fv-active', active);
            btn.setAttribute('aria-checked', String(active));
        }

        const currentMode = s.two_pass === false ? 'off' : s.preview === true ? 'preview' : 'on';
        for (const btn of passOptions) {
            const active = (btn.dataset.mode === currentMode);
            btn.setAttribute('aria-checked', String(active));
        }
    }

    updateUI();

    return {
        element: container,
        update: updateUI
    };
}
