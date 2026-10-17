// Bundled tutorial copy, a short form of docs/zh-CN/使用说明.md; keep them consistent.
// Only finished chapters are listed. Add a chapter here when it is written, with its picture row in scripts/tutorial_pictures.json.
export const TUTORIAL_CHAPTERS = [
    {
        id: 'reference-video',
        title: {zh: '参考图生成视频', en: 'Make a video from reference images'},
        summary: {zh: '让参考图里的人物、物品或场景出现在视频中。', en: 'Use people, objects or places from reference images in a video.'},
        media: {
            type: 'image',
            src: {zh: 'reference-video-1.webp', en: 'reference-video-2.webp'},
            alt: {zh: '创作面板：素材区域和参考图已用红框标出。', en: 'The creation panel, with the Media section and a reference image outlined in red.'},
        },
        steps: {
            zh: ['在创作面板的“素材”里添加图片，每张可选作参考、首帧或尾帧。', '在描述里输入 @ 选一张图，并说明它在画面里做什么，例如“<Picture 1> 里的女孩在海边奔跑”。', '点“生成视频”。'],
            en: ['Add images under "Media" in the creation panel and set each one as a reference, first frame, or last frame.', 'Type @ in the prompt and choose an image, then say what it does in the scene, for example "The girl in <Picture 1> runs along the beach".', 'Choose "Generate video".'],
        },
        limits: {
            zh: ['参考图生成还在试验中，人物外观不一定每次一致；换一张更清晰的正面图再试。', '首帧和尾帧可以一起用，但暂时不能和参考图一起用。', '首帧、尾帧会按画幅居中裁切；参考图保持原比例。'],
            en: ['Reference generation is experimental, so a character may look different between runs. A clearer, front-facing image helps.', 'First and last frames can be used together, but not with reference images yet.', 'First and last frames are center-cropped to the frame shape. Reference images keep their proportions.'],
        },
    },
    {
        id: 'long-video',
        title: {zh: '连续的长视频', en: 'Make a longer video'},
        summary: {zh: '填写更长的时长自动分段生成，也可以逐段接着生成。', en: 'Enter a longer duration to generate in parts, or continue one part at a time.'},
        media: {
            type: 'image',
            src: {zh: 'long-video-1.webp', en: 'long-video-2.webp'},
            alt: {zh: '创作面板：时长输入框和“可生成范围”入口已用红框标出。', en: 'The creation panel, with the duration field and "Available sizes and lengths" control outlined in red.'},
        },
        steps: {
            zh: ['把时长填长一些，会自动分段生成；“可生成范围”里可以查看每种尺寸能生成多长、大约要多久。', '点“生成视频”。', '想接着做下去，在生成好的视频上点“接着生成”。', '也可以到“剪辑视图”里一段段接。'],
            en: ['Enter a longer duration. It is made in parts automatically. "Available sizes and lengths" shows how long each size can be and about how long it takes.', 'Choose "Generate video".', 'To carry on from a finished video, click "Extend" on its result.', 'Or add parts one by one in "Edit".'],
        },
        limits: {
            zh: ['一条视频最多 5 段，创作面板里时长最多填 60 秒。', '分段生成和接着生成需要 NVIDIA 显卡，Mac 上不支持。', '接得越多，衔接处越容易变化；能切镜头的地方，直接切镜头开始新的一段。'],
            en: ['A video has at most 5 parts, and the creation panel accepts up to 60 seconds.', 'Generating in parts and Extend need an NVIDIA graphics card and are not available on Mac.', 'The more parts are joined, the more the joins may change. Where a cut fits, cut to a new shot and start a fresh part.'],
        },
    },
    {
        id: 'editor-extend-refs',
        title: {zh: '在剪辑视图延长时加参考图', en: 'Add reference images when extending in Edit'},
        summary: {zh: '用参考图引导接着生成的那一段。', en: 'Use reference images to guide the next part.'},
        media: {
            type: 'image',
            src: {zh: 'editor-extend-refs-1.webp', en: 'editor-extend-refs-2.webp'},
            alt: {zh: '剪辑视图：选中的接续段和描述框旁的参考图入口已用红框标出。', en: 'The Edit view, with the selected continuation and the reference image control beside the prompt outlined in red.'},
        },
        steps: {
            zh: ['选中要接着生成的那一段。', '点描述框旁的 +，上传或生成图片，最多 3 张。', '写一句描述，再点“生成”。'],
            en: ['Select the part to continue.', 'Click + next to the prompt to upload or generate images, up to 3.', 'Describe it, then choose "Generate".'],
        },
        limits: {
            zh: ['接着上一段生成时最多用 3 张参考图，不用首帧和尾帧。', '剪辑视图里只能加图片；参考视频和音频在创作面板的“素材”里添加。', '同样最多 5 段，需要 NVIDIA 显卡，Mac 上不支持。'],
            en: ['A part that continues the previous one uses up to 3 reference images and no first or last frames.', 'Edit takes images only. Add reference videos and audio under "Media" in the creation panel.', 'The same 5-part limit applies, and an NVIDIA graphics card is required. Not available on Mac.'],
        },
    },
];
