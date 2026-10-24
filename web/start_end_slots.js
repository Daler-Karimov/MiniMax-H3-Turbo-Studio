// Two-cell start and end media picker directly under "Describe your scene".
import { uploadMedia } from './media_upload.js';

const el = (tag, cls = null, text = null) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};

export function createStartEndSlots({ node, getMediaNode, extension, syncExtension, t, api }) {
    const container = el('div', 'fv-slots-widget');
    const grid = el('div', 'fv-slots-grid');
    const statusLine = el('div', 'fv-slots-status');
    const statusBadge = el('span', 'fv-slots-status-badge');
    const statusText = el('span', 'fv-slots-status-text');
    statusLine.append(statusBadge, statusText);

    function viewURL(file, type = 'input') {
        if (!file) return '';
        const split = file.lastIndexOf('/');
        return api.apiURL('/view?' + new URLSearchParams({
            filename: file.slice(split + 1),
            subfolder: split < 0 ? '' : file.slice(0, split),
            type,
        }));
    }

    function getRows() {
        const m = getMediaNode?.();
        if (!m) return [];
        const w = m.widgets?.find(w => w.name === 'assets');
        try {
            const arr = JSON.parse(w?.value || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function setRows(rows) {
        const m = getMediaNode?.();
        if (!m) return;
        const w = m.widgets?.find(w => w.name === 'assets');
        if (w) {
            w.value = JSON.stringify(rows);
            m.graph?.change();
            window.dispatchEvent(new CustomEvent('freevideo-media', { detail: m.id }));
        }
    }

    function makeSlot(role, titleText, hintText, iconChar) {
        const slot = el('div', `fv-slot fv-slot-${role}`);
        slot.dataset.role = role;

        // Header
        const header = el('div', 'fv-slot-header');
        const title = el('span', 'fv-slot-title', titleText);
        const clearBtn = el('button', 'fv-slot-clear', '✕');
        clearBtn.type = 'button';
        clearBtn.title = t('Clear', 'Очистить');
        clearBtn.hidden = true;
        header.append(title, clearBtn);

        // Body / Dropzone
        const dropzone = el('div', 'fv-slot-dropzone');
        const fileInput = el('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*';
        fileInput.hidden = true;

        const emptyArea = el('div', 'fv-slot-empty');
        const iconSpan = el('span', 'fv-slot-icon', iconChar);
        const labelSpan = el('span', 'fv-slot-label', t('Drag & drop or click', 'Перетащите или кликните'));
        const hintSpan = el('span', 'fv-slot-hint', hintText);
        emptyArea.append(iconSpan, labelSpan, hintSpan);

        const previewArea = el('div', 'fv-slot-preview');
        previewArea.hidden = true;
        const img = el('img');
        const video = el('video');
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        const nameBadge = el('span', 'fv-slot-filename');
        previewArea.append(img, video, nameBadge);

        dropzone.append(fileInput, emptyArea, previewArea);
        slot.append(header, dropzone);

        // Click to browse
        dropzone.addEventListener('click', (e) => {
            if (e.target === clearBtn || e.target.closest('.fv-slot-clear')) return;
            fileInput.click();
        });

        // File select
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            fileInput.value = '';
            await handleFile(file);
        });

        // Drag & drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('fv-slot-dragover');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('fv-slot-dragover');
        });
        dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropzone.classList.remove('fv-slot-dragover');
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            await handleFile(file);
        });

        // Clear
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let rows = getRows().filter(r => r.role !== role);
            setRows(rows);
            updateUI();
        });

        async function handleFile(file) {
            emptyArea.style.opacity = '0.5';
            labelSpan.textContent = t('Uploading…', 'Загрузка…');
            try {
                const res = await uploadMedia(api, file);
                const fileName = res.name || res.file;
                let rows = getRows().filter(r => r.role !== role);
                rows.push({ file: fileName, role, enabled: true });
                setRows(rows);
            } catch (err) {
                console.error('[FreeVideo] Slot upload error:', err);
                alert(err.message || 'Upload error');
            } finally {
                emptyArea.style.opacity = '1';
                labelSpan.textContent = t('Drag & drop or click', 'Перетащите или кликните');
                updateUI();
            }
        }

        function setContent(item) {
            if (!item || item.enabled === false) {
                emptyArea.hidden = false;
                previewArea.hidden = true;
                clearBtn.hidden = true;
                slot.classList.remove('fv-slot-filled');
            } else {
                emptyArea.hidden = true;
                previewArea.hidden = false;
                clearBtn.hidden = false;
                slot.classList.add('fv-slot-filled');
                const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(item.file);
                const url = viewURL(item.file);
                if (isVideo) {
                    img.hidden = true;
                    video.hidden = false;
                    video.src = url;
                } else {
                    video.hidden = true;
                    img.hidden = false;
                    img.src = url;
                }
                const shortName = item.file.split('/').pop().split('\\').pop();
                nameBadge.textContent = shortName;
            }
        }

        return { slot, setContent };
    }

    const slotStart = makeSlot('first', '🎬 1. Начало (фото или видео)', 'Точка старта сцены', '📁');
    const slotEnd = makeSlot('last', '🏁 2. Конец (фото или видео)', 'Целевой финал / склейка', '🏁');

    grid.append(slotStart.slot, slotEnd.slot);
    container.append(grid, statusLine);

    function updateUI() {
        const rows = getRows();
        const first = rows.find(r => r.role === 'first' && r.enabled !== false);
        const last = rows.find(r => r.role === 'last' && r.enabled !== false);

        slotStart.setContent(first);
        slotEnd.setContent(last);

        if (first && last) {
            statusBadge.textContent = '🔄 Склейка / Морфинг';
            statusBadge.className = 'fv-slots-status-badge fv-badge-morph';
            statusText.textContent = 'Генерация бесшовного перехода из Начала в Конец (FL2V)';
        } else if (first && !last) {
            statusBadge.textContent = '🎬 Точка старта';
            statusBadge.className = 'fv-slots-status-badge fv-badge-start';
            statusText.textContent = 'Генерация начинается с исходного кадра/видео (I2V / Продление)';
        } else if (!first && last) {
            statusBadge.textContent = '🏁 Целевой финал';
            statusBadge.className = 'fv-slots-status-badge fv-badge-end';
            statusText.textContent = 'Генерация разворачивается с приходом в финальный кадр (L2V)';
        } else {
            statusBadge.textContent = '📝 Текст в видео';
            statusBadge.className = 'fv-slots-status-badge fv-badge-text';
            statusText.textContent = 'Обе ячейки свободны — генерация с чистого листа по описанию';
        }
    }

    window.addEventListener('freevideo-media', updateUI);
    updateUI();

    return {
        element: container,
        refresh: updateUI,
        dispose() {
            window.removeEventListener('freevideo-media', updateUI);
        }
    };
}
