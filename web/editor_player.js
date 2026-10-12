import {isText} from './editor_text_model.js';
import * as model from './editor_model.js';
import {pictureSession} from './editor_picture_session.js';
import {createPreviewPicture} from './editor_preview_picture.js';
import {sourceKey, mediaURL} from './editor_store.js';
import {clipPictureSize, createPictureGuide} from './editor_frame.js';
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
export function audioSeconds(clip, sourceFrame) {
    // The chain receipt counts samples at 32 kHz, even if the media is 48 kHz.
    return clip.splice ? clip.splice.audio_samples / 32000 + (sourceFrame - clip.splice.frames) / 24 : sourceFrame / 24;
}
export const transportTime = frames => {
    const seconds = Math.floor(Math.max(0, frames) / 24);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export function createEditorPlayer(host, transport, {state, sources, api, t, preservePreview = () => false}) {
    const frame = el('div', 'fv-ed-picture'); frame.setAttribute('aria-label', t('Video preview', '视频预览'));
    const empty = el('div', 'fv-ed-empty-preview'), pictureIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pictureIcon.setAttribute('viewBox', '0 0 24 24'); pictureIcon.setAttribute('aria-hidden', 'true');
    const picturePath = document.createElementNS(pictureIcon.namespaceURI, 'path');
    picturePath.setAttribute('d', 'M3 4h18v16H3zM3 16l5-6 5 6 3-4 5 6M15 8h.01'); pictureIcon.append(picturePath);
    empty.append(pictureIcon); frame.append(empty);
    const closePreview = el('button', 'fv-ed-preview-close'); closePreview.type = 'button'; closePreview.hidden = true;
    closePreview.setAttribute('aria-label', t('Close preview', '关闭预览'));
    const closeIcon = document.createElementNS(pictureIcon.namespaceURI, 'svg'), closePath = document.createElementNS(pictureIcon.namespaceURI, 'path');
    closeIcon.setAttribute('viewBox', '0 0 16 16'); closeIcon.setAttribute('aria-hidden', 'true'); closePath.setAttribute('d', 'm4 4 8 8M12 4l-8 8'); closeIcon.append(closePath); closePreview.append(closeIcon); frame.append(closePreview);
    const videos = [el('video'), el('video')]; videos.forEach(video => { video.playsInline = true; video.preload = 'auto'; video.controls = false; video.setAttribute('aria-hidden', 'true'); frame.append(video); });
    const audio = [el('audio'), el('audio')]; audio.forEach(value => { value.preload = 'auto'; frame.append(value); });
    const pictureGuide = createPictureGuide(host, frame, {state, t});
    const pictureEdit = pictureSession(state, t);
    const picturePreview = createPreviewPicture(host, frame, {state, t});
    const playButton = el('button', 'fv-ed-play'); playButton.type = 'button'; playButton.title = t('Space', '空格');
    const time = el('span', 'fv-ed-time'); time.setAttribute('aria-live', 'off'); transport.append(playButton, time);
    let active = 0, clipId = null, playing = false, disposed = false, raf = null, clockStart = 0, frameStart = 0, ticking = false, preview = null, previewSize = null, previewProject = null;
    let audioContext = null, textRenderer = null;
    const gains = new WeakMap(), volumePreview = new Map();
    const clipVolume = clip => volumePreview.get(clip?.id) ?? clip?.volume ?? 1;
    function volume(media, value) {
        // HTMLMediaElement stops at 1. A GainNode implements the record's 0–2 range.
        if (value > 1 || gains.has(media)) {
            try {
                audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
                if (!gains.has(media)) { const source = audioContext.createMediaElementSource(media), gain = audioContext.createGain(); source.connect(gain); gain.connect(audioContext.destination); gains.set(media, gain); }
                media.volume = 1; gains.get(media).gain.value = value; if (playing) audioContext.resume().catch(() => {}); return;
            } catch { /* Browser without Web Audio: retain sound up to unity. */ }
        }
        media.volume = Math.min(1, Math.max(0, value));
    }
    function seekMedia(media, url, seconds, running, gain = 1) {
        const changed = media.dataset.source !== url;
        if (changed) { media.pause(); media.dataset.source = url; media.src = url; media.load(); }
        media._editorTime = Math.max(0, seconds); media._editorRunning = running;
        volume(media, gain);
        if (media.readyState >= 1 && (changed || !running || Math.abs(media.currentTime - seconds) > .08)) {
            try { media.currentTime = Math.max(0, seconds); } catch {}
        }
        if (running) { if (media.paused) media.play().catch(() => {}); } else media.pause();
    }
    function stopMedia(media) { media.pause(); media._editorRunning = false; }
    for (const media of [...videos, ...audio]) {
        media.onloadedmetadata = () => { if (disposed) return; try { media.currentTime = media._editorTime || 0; } catch {} if (media._editorRunning) media.play().catch(() => {}); };
    }
    function located(record, position) {
        // The model owns which content covers the frame. Normalize its query rows.
        const value = model.at(record, position);
        const rows = Array.isArray(value) ? value : Object.entries(value || {}).map(([track, row]) => ({track, ...row}));
        const result = new Map();
        for (const row of rows) {
            if (!row) continue;
            const track = row.track?.id || row.track || row.trackId;
            const clip = row.clip || (row.id ? row : null);
            if (clip) result.set(track, {clip, frame: row.frame ?? row.sourceFrame ?? clip.in + position - clip.start});
        }
        return result;
    }
    function render() {
        if (disposed) return;
        // The total is what export writes (picture and sound); text past it is not exported.
        const record = state.record, position = state.playhead, total = model.exportFrames(record);
        const hasContent = record.tracks.some(track => track.clips.some(clip => clip.source || isText(clip)));
        empty.hidden = hasContent || preview?.tagName === 'VIDEO'; frame.dataset.empty = String(!empty.hidden);
        playButton.disabled = !total || !hasContent;
        time.textContent = `${transportTime(position)} / ${transportTime(total)}`;
        if (playButton.dataset.playing !== String(playing)) {
            playButton.dataset.playing = String(playing);
            const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); glyph.setAttribute('viewBox', '0 0 16 16'); glyph.setAttribute('aria-hidden', 'true'); glyph.style.width = glyph.style.height = '16px';
            const path = document.createElementNS(glyph.namespaceURI, 'path'); path.setAttribute('d', playing ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'm5 3 8 5-8 5z'); path.setAttribute('fill', 'currentColor'); glyph.append(path); playButton.replaceChildren(glyph);
        }
        playButton.setAttribute('aria-label', playing ? t('Pause', '暂停') : t('Play', '播放'));
        const shown = Math.min(position, Math.max(0, model.duration(record) - 1));
        const map = located(record, shown), videoRow = pictureEdit.previewRow(map.get('v1'), shown), clip = videoRow?.clip;
        const source = clip?.source && sources.get(sourceKey(clip.source));
        const hasPicture = !!source?.video && !source.missing;
        const fallbackSize = record.size_mode === 'fixed' || record.tracks[0].clips.some(c => c.source) ? record : {width: 1344, height: 768};
        pictureGuide.update({size: previewSize || (hasPicture && clipPictureSize(clip, sources)) || fallbackSize, record, clip,
            preview: !!preview, playing});
        if (!hasPicture) {
            clipId = null; videos.forEach(video => { video.classList.remove('fv-ed-visible'); stopMedia(video); });
        } else if (clipId !== clip.id) {
            const url = mediaURL(api, source.video);
            if (videos[1 - active].dataset.source === url) active = 1 - active;
            clipId = clip.id;
        }
        const linked = hasPicture ? [...map.values()].find(row => row.clip.id === clip.link) : null;
        const separate = !!linked?.clip.splice || !hasPicture;
        if (hasPicture) {
            const video = videos[active]; video.muted = !linked || separate;
            seekMedia(video, mediaURL(api, source.video), (videoRow.frame + (playing ? 0 : .5)) / 24, playing && map.get('v1')?.clip.id === clip.id, clipVolume(linked?.clip));
            videos.forEach((value, index) => { value.classList.toggle('fv-ed-visible', index === active); if (index !== active) stopMedia(value); });
        }
        picturePreview.update({clip: hasPicture ? clip : null, size: hasPicture && clipPictureSize(clip, sources), video: videos[active], preview: !!preview, playing});
        let slot = 0;
        for (const [track, row] of map) {
            if (isText(row.clip) || track === 'v1' || (hasPicture && row.clip.link === clip.id && !separate)) continue;
            const metadata = sources.get(sourceKey(row.clip.source));
            if (!metadata || metadata.missing || slot >= audio.length) continue;
            const url = mediaURL(api, metadata.audio); if (!url) continue;
            seekMedia(audio[slot++], url, audioSeconds(row.clip, row.frame), playing, clipVolume(row.clip));
        }
        while (slot < audio.length) stopMedia(audio[slot++]);
        const next = record.tracks[0].clips.find(value => value.start >= (clip ? clip.start + clip.frames : position) && value.source);
        const metadata = next && sources.get(sourceKey(next.source));
        if (metadata?.video && !metadata.missing) {
            const idle = videos[1 - active]; idle.muted = true;
            if (idle.dataset.source !== mediaURL(api, metadata.video)) seekMedia(idle, mediaURL(api, metadata.video), next.in / 24, false);
        }
        textRenderer?.();
    }
    function tick(now) {
        if (!playing || disposed) return;
        const total = model.exportFrames(state.record), position = frameStart + Math.max(0, Math.floor((now - clockStart) * 24 / 1000)), last = Math.max(0, total - 1);
        ticking = true; state.seek(Math.min(position, last)); ticking = false; render();
        if (position >= total) { pause(); return; }
        raf = requestAnimationFrame(tick);
    }
    const pictureLayout = record => JSON.stringify([record.width, record.height, record.tracks, record.replacements]);
    function clearPreview() { if (preview) { preview.onended = null; preview.pause(); preview.removeAttribute('src'); preview.load(); preview.remove(); preview = null; } previewSize = previewProject = null; closePreview.hidden = true; }
    closePreview.onclick = () => { clearPreview(); render(); };
    function play() {
        if (disposed || playing || playButton.disabled) return;
        clearPreview(); if (state.playhead >= Math.max(0, model.exportFrames(state.record) - 1)) state.seek(0);
        playing = true; clockStart = performance.now(); frameStart = state.playhead; render(); raf = requestAnimationFrame(tick);
    }
    function pause() { playing = false; cancelAnimationFrame(raf); [...videos, ...audio].forEach(stopMedia); render(); }
    playButton.onclick = () => playing ? pause() : play();
    const unsubscribe = state.subscribe(event => {
        if (event.type === 'selection') { if (pictureEdit.panelOpen && pictureEdit.selected()) clearPreview(); render(); return; }
        if (event.type !== 'playhead' && event.type !== 'record') return;
        if (preview && preservePreview()) previewProject = pictureLayout(state.record);
        else if (event.type === 'playhead' || previewProject !== pictureLayout(state.record)) clearPreview();
        if (playing && !ticking) { clockStart = performance.now(); frameStart = state.playhead; }
        render();
    });
    const stopPictureEdit = pictureEdit.subscribe(() => {
        // Draft geometry updates in picturePreview; only a changed preview part
        // needs media routing, otherwise slider/crop movement would re-seek video.
        const row = pictureEdit.previewRow(located(state.record, state.playhead).get('v1'), state.playhead);
        if (preview && pictureEdit.panelOpen && pictureEdit.selected()) { clearPreview(); render(); }
        else if ((row?.clip.id || null) !== clipId) render();
    });
    render();
    return {element: frame, picturePreview, play, pause, toggle: () => playing ? pause() : play(), refresh: render,
        clearPreview() { clearPreview(); render(); },
        get playing() { return playing; },
        setTextRenderer(callback) { textRenderer = callback; },
        previewVolume(id, value) { volumePreview.set(id, value); render(); },
        clearVolumePreview() { volumePreview.clear(); render(); },
        async previewSource(source) {
            if (disposed) return;
            const previousSize = previewSize || {width: state.record.width, height: state.record.height};
            pause(); clearPreview(); const metadata = sources.get(sourceKey(source)); if (!metadata?.video && !metadata?.audio) { render(); return; }
            preview = el(metadata.video ? 'video' : 'audio', 'fv-ed-source-preview'); preview.controls = true; preview.playsInline = true;
            if (metadata.video && Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.width >= 2 && metadata.height >= 2)
                previewSize = {width: metadata.width, height: metadata.height};
            else if (!metadata.video) previewSize = previousSize;
            previewProject = pictureLayout(state.record);
            preview.onended = () => { clearPreview(); render(); };
            preview.src = mediaURL(api, metadata.video || metadata.audio); frame.append(preview); closePreview.hidden = false; render(); preview.play().catch(() => {});
        },
        dispose() { disposed = true; playing = false; cancelAnimationFrame(raf); unsubscribe(); stopPictureEdit(); clearPreview();
            [...videos, ...audio].forEach(media => { media.pause(); media.onloadedmetadata = null; media.removeAttribute('src'); delete media.dataset.source; media.load(); media.remove(); }); playButton.onclick = closePreview.onclick = null; picturePreview.dispose(); pictureGuide.dispose(); audioContext?.close().catch(() => {}); },
    };
}
