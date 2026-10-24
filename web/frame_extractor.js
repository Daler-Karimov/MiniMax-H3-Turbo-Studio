// Helper to extract a single video frame as a PNG file blob from a video URL in the browser
export async function captureVideoFrame(videoUrl, timeSeconds = 0) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.preload = 'auto';
        v.muted = true;
        v.src = videoUrl;

        let timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Video frame capture timed out'));
        }, 10000);

        function cleanup() {
            clearTimeout(timeout);
            v.onloadedmetadata = null;
            v.onseeked = null;
            v.onerror = null;
            v.src = '';
            v.remove();
        }

        v.onloadedmetadata = () => {
            const duration = v.duration || 1;
            const targetTime = Math.max(0, Math.min(timeSeconds, duration - 0.05));
            v.currentTime = targetTime;
        };

        v.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = v.videoWidth || 1344;
                canvas.height = v.videoHeight || 768;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    cleanup();
                    if (!blob) {
                        reject(new Error('Failed to create frame blob'));
                        return;
                    }
                    const file = new File([blob], `frame-${Date.now()}.png`, { type: 'image/png' });
                    resolve(file);
                }, 'image/png');
            } catch (err) {
                cleanup();
                reject(err);
            }
        };

        v.onerror = () => {
            cleanup();
            reject(new Error('Failed to load video for frame capture'));
        };
    });
}
