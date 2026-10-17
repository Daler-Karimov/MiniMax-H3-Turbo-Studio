// Set this to the first product release that ships the showcase and Agent workflow.
// Each eligible product version gets one chapter in the existing guide.json seen list.
export const SHOWCASE_START_VERSION = '0.4.10';
// The ready-made white-model scene the showcase's button starts.
export const SHOWCASE_SCENE = 'car';
export const SHOWCASE_ASSET = new URL('./assets/entry-showcase.webp', import.meta.url).href;
export const SHOWCASE_TEXT = {
    title: ['From whitebox animation to finished video', '从白模动画到写实视频'],
    try: ['Get started', '开始使用'],
    close: ['Close', '关闭'],
    example: [
        "A red race car hits the end of a straight at full speed and throws itself into a corner, the rear sliding out in a controlled drift with a little tyre smoke, while the camera orbits half a circle around the car and then follows it out of the bend. Sunny circuit with red and white kerbs, grandstands and green grass, realistic paint and tarmac, strong sense of speed, smooth camera. Roaring engine and the squeal of tyres.",
        "一辆红色赛车在直道尽头全速冲入弯道，车尾受控地甩出，带起少许轮胎烟，镜头绕车半圈后跟着它驶出弯道。晴天的赛道，红白相间的路缘石、看台和绿草地，写实的漆面和柏油路，速度感强，镜头平滑。引擎轰鸣，轮胎尖啸。",
    ],
};

const parts = version => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)
    ? version.split('.').map(Number) : null;

export function showcaseChapter(version, start = SHOWCASE_START_VERSION) {
    const current = parts(version), minimum = parts(start);
    if (!current || !minimum) return null;
    for (let i = 0; i < 3; i++) {
        if (current[i] < minimum[i]) return null;
        if (current[i] > minimum[i]) break;
    }
    return {id: `entry-showcase:${version}`, group: 'showcase', added: true};
}

// Decode before drawing: a missing, corrupt or oversized local asset never leaves
// an empty card. Fetch failures are deliberately quiet, like unreadable guide records.
export async function loadShowcaseImage(src = SHOWCASE_ASSET) {
    let url;
    try {
        const reply = await fetch(src, {signal: AbortSignal.timeout(4000)});
        if (!reply.ok) return null;
        const blob = await reply.blob();
        if (!blob.size || blob.size > 2_000_000) return null;
        url = URL.createObjectURL(blob);
        const image = new Image(); image.alt = ''; image.src = url;
        await image.decode();
        return image;
    } catch { return null; }
    finally { if (url) URL.revokeObjectURL(url); }
}
