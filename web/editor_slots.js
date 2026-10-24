// Two-slot Start/End media widget for Edit mode (below prompt textarea)
import { uploadMedia } from './media_upload.js';
import { captureVideoFrame } from './frame_extractor.js';
import { api } from '../../scripts/api.js';

const el = (tag, cls = null, text = null) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};

export function createEditorSlots({ state, t, actions }) {
    const container = el('div', 'fv-ed-slots');

    // Internal state for slots: role -> { file, url, blob, isAuto, name }
    const slotState = { first: null, last: null };
    const manualCleared = { first: null, last: null };
    let currentSelectionId = null;

    function viewURL(file) {
        if (!file) return '';
        const split = file.lastIndexOf('/');
        return api.apiURL('/view?' + new URLSearchParams({
            filename: file.slice(split + 1),
            subfolder: split < 0 ? '' : file.slice(0, split),
            type: 'input'
        }));
    }

    function makeSlot(role, titleText, iconChar) {
        const slot = el('div', `fv-ed-slot fv-ed-slot-${role}`);
        slot.dataset.role = role;

        // Header
        const header = el('div', 'fv-ed-slot-header');
        const title = el('span', 'fv-ed-slot-title', titleText);
        const clearBtn = el('button', 'fv-ed-slot-clear', '✕');
        clearBtn.type = 'button';
        clearBtn.title = t('Clear', 'Очистить');
        clearBtn.hidden = true;
        header.append(title, clearBtn);

        // Dropzone
        const dropzone = el('div', 'fv-ed-slot-dropzone');
        const fileInput = el('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*';
        fileInput.hidden = true;

        const emptyArea = el('div', 'fv-ed-slot-empty');
        const iconSpan = el('span', 'fv-ed-slot-icon', iconChar);
        const labelSpan = el('span', 'fv-ed-slot-label', t('Drag & drop or click', 'Перетащите или нажмите'));
        emptyArea.append(iconSpan, labelSpan);

        const previewArea = el('div', 'fv-ed-slot-preview');
        previewArea.hidden = true;
        const thumb = el('img', 'fv-ed-slot-thumb');
        const nameLabel = el('span', 'fv-ed-slot-label');
        const tagBadge = el('span', 'fv-ed-slot-tag');
        previewArea.append(thumb, nameLabel, tagBadge);

        dropzone.append(fileInput, emptyArea, previewArea);
        slot.append(header, dropzone);

        function updateUI() {
            const data = slotState[role];
            if (data && (data.url || data.file || data.blob)) {
                slot.classList.add('fv-ed-slot-filled');
                emptyArea.hidden = true;
                previewArea.hidden = false;
                clearBtn.hidden = false;

                if (data.blob && !data.url) {
                    thumb.src = URL.createObjectURL(data.blob);
                } else if (data.url) {
                    thumb.src = data.url;
                }
                nameLabel.textContent = data.name || (data.file ? data.file.split('/').pop() : '');
                tagBadge.textContent = data.isAuto ? t('Auto', 'Авто') : t('Custom', 'Свой');
                tagBadge.className = `fv-ed-slot-tag ${data.isAuto ? 'fv-tag-auto' : 'fv-tag-custom'}`;
            } else {
                slot.classList.remove('fv-ed-slot-filled');
                emptyArea.hidden = false;
                previewArea.hidden = true;
                clearBtn.hidden = true;
                thumb.src = '';
                nameLabel.textContent = '';
            }
        }

        clearBtn.onclick = (e) => {
            e.stopPropagation();
            slotState[role] = null;
            manualCleared[role] = currentSelectionId;
            updateUI();
            actions.onSlotsChanged?.();
        };

        dropzone.onclick = () => fileInput.click();

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            fileInput.value = '';
            await handleFile(file);
        };

        async function handleFile(file) {
            try {
                slot.style.opacity = '0.5';
                const res = await uploadMedia(api, file);
                const fileName = res.file || res.name;
                slotState[role] = {
                    file: fileName,
                    url: viewURL(fileName),
                    blob: null,
                    isAuto: false,
                    name: file.name
                };
                manualCleared[role] = null;
                updateUI();
                actions.onSlotsChanged?.();
            } catch (err) {
                console.error('[FreeVideo] Slot upload error:', err);
            } finally {
                slot.style.opacity = '1';
            }
        }

        slot.ondragover = (e) => {
            e.preventDefault();
            slot.classList.add('fv-ed-slot-dragover');
        };
        slot.ondragleave = () => slot.classList.remove('fv-ed-slot-dragover');
        slot.ondrop = async (e) => {
            e.preventDefault();
            slot.classList.remove('fv-ed-slot-dragover');
            const file = e.dataTransfer?.files?.[0];
            if (file) await handleFile(file);
        };

        return { slot, updateUI };
    }

    const slotStart = makeSlot('first', t('Start', 'Начало'), '📁');
    const slotEnd = makeSlot('last', t('End', 'Конец'), '🏁');

    container.append(slotStart.slot, slotEnd.slot);

    async function syncWithTimeline() {
        const sel = state.selection;
        const selKey = sel ? JSON.stringify(sel) : 'none';
        if (selKey !== currentSelectionId) {
            currentSelectionId = selKey;
            // Reset auto state when selection changes if not custom-locked
            if (slotState.first?.isAuto) slotState.first = null;
            if (slotState.last?.isAuto) slotState.last = null;
        }

        // Query surrounding media from editor
        const surrounding = actions.getSurroundingMedia?.();
        if (surrounding) {
            // Check start frame
            if (!slotState.first && manualCleared.first !== currentSelectionId && surrounding.leftUrl) {
                try {
                    const blob = await captureVideoFrame(surrounding.leftUrl, surrounding.leftTime || 0);
                    slotState.first = {
                        file: null,
                        blob,
                        url: URL.createObjectURL(blob),
                        isAuto: true,
                        name: t('From left clip', 'Кадр из левого видео')
                    };
                } catch (e) {
                    console.warn('[FreeVideo] Could not capture left frame for slot:', e);
                }
            }

            // Check end frame
            if (!slotState.last && manualCleared.last !== currentSelectionId && surrounding.rightUrl) {
                try {
                    const blob = await captureVideoFrame(surrounding.rightUrl, surrounding.rightTime || 0);
                    slotState.last = {
                        file: null,
                        blob,
                        url: URL.createObjectURL(blob),
                        isAuto: true,
                        name: t('From right clip', 'Кадр из правого видео')
                    };
                } catch (e) {
                    console.warn('[FreeVideo] Could not capture right frame for slot:', e);
                }
            }
        }

        slotStart.updateUI();
        slotEnd.updateUI();
    }

    return {
        element: container,
        sync: syncWithTimeline,
        getActiveMedia() {
            return {
                first: slotState.first,
                last: slotState.last
            };
        },
        async ensureUploaded() {
            // Ensure any auto-captured blobs are uploaded to ComfyUI before generate
            const out = {};
            for (const role of ['first', 'last']) {
                const item = slotState[role];
                if (item) {
                    if (item.file) {
                        out[role] = item.file;
                    } else if (item.blob) {
                        const up = await uploadMedia(api, item.blob);
                        item.file = up.file || up.name;
                        out[role] = item.file;
                    }
                }
            }
            return out;
        },
        dispose() {}
    };
}
