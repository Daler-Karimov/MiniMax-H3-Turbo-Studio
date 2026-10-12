"""What an agent needs to write good FreeVideo prompts, served by GET /freevideo/agent/v1/guide.

Summarised from MiniMax's h3-prompt-writing skill (linked below) and FreeVideo's
own prompt rules; the enhancement job applies the same contract.
"""
from ..default_prompt import DEFAULT_PROMPT
from .schema import CAST_OPERATIONS, DRAMA_OPERATIONS, IMAGE_OPERATIONS, PROJECT_OPERATIONS, SESSION_OPERATIONS

SOURCE = 'https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing'

GUIDE = {
    'source': SOURCE,
    'language': 'Write the sections in English. Keep dialogue, lyrics and visible on-screen text verbatim in '
                'their original language.',
    'tasks': {
        't2va': 'Text only: describe the whole audiovisual timeline.',
        'i2va': 'media.first: the image is the frame at 0.00 s; start from its style, subjects and layout, then '
                'develop forward.',
        'fl2va': 'media.first + media.last: describe one continuous path from the first frame to the last; '
                 'prefer a single shot.',
        'l2va': 'media.last: infer a plausible opening and converge on the image at the end.',
        'ref2va': 'media.references (images, video, audio; experimental): use the six reference sections and '
                  'label every subject.',
    },
    'sections': {
        'base': ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'],
        'ref2va': ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description',
                   'overall_soundscape', 'non_diegetic_music'],
        'format': 'Each section starts on its own line as "name: text", separated by one blank line, in this order.',
    },
    'shots': [
        'Begin the description with [Shot 1] and the visual style and opening composition '
        '(e.g. "Live-action, cinematic, a medium-wide shot frames ...").',
        'Later shots: "[Shot 2] At 00:03.500, the camera cuts to ...". Cut times strictly increase and stay inside '
        'the duration. Cut only for new information; use camera motion for small changes.',
        'Camera motion = type + optional amplitude + speed, written as prose: push in / pull out, pan, truck, tilt, '
        'pedestal, arc shot, tracking shot, static shot, zoom, POV, roll; "with small amplitude", "at slow speed".',
    ],
    'dialogue': [
        'Speakers get stable IDs (S1), (S2) across shots; describe each voice when it first appears.',
        'Spoken words go inside <d>[Language] ...</d>, verbatim: The woman (S1) says: <d>[Chinese] 我们走吧。</d>',
        'Voiceover: "says in an off-screen voiceover: <d>...</d> while his lips remain completely closed."',
        'Visible text goes in double quotes: a neon sign reading "营业中". Never put spoken words in quotes: '
        'quoted words are drawn on screen.',
        'H3 may still caption spoken lines. When the shot should have no captions, end the description with '
        '"No subtitles, no on-screen text." (or "No subtitles or captions." when the shot shows a sign or screen); '
        'it still happens now and then, so ask the VLM whether text is drawn '
        'over the picture and retake with another seed. A captioned frame that seeds the next shot can be cleaned '
        'with the edit recipe operation remove_text.',
    ],
    'sound': [
        'overall_soundscape: 1-4 sentences of ambience, action sounds and breaths; N/A only for silence.',
        'non_diegetic_music: 1-3 sentences of instruments, tempo and dynamics, or N/A.',
    ],
    'references': [
        'Tags are numbered per kind in reference order: <Picture 1>, <Picture 2>, <Video 1>, <Audio 1>. '
        'For keyframes the first frame is <Picture 1> and the last frame the next picture.',
        'Name subjects <Subject 1>, <Subject 2> in subject_definitions and reuse those labels in every section.',
        'Clips are cut to the generated length (at most 15 s); the job result lists any cut.',
    ],
    'timing': [
        'Single-block frames are 24 fps on a 17n+5 grid (6 s -> 6.583 s, 10 s -> 10.125 s). '
        'Generation uses the continuous backend; longer requests split, continue and join automatically. '
        'Continuing (longer than 15 s, or continue_from) needs two-pass text generation: quality "light" '
        'or sampling.two_pass=true, no preview and no media. '
        'Multi-block output is cut to the planned duration. POST /plan shows the chain plan.',
        'Keep the described timeline inside the duration. 4-15 s is the tested range; longer is experimental.',
        'Width and height are multiples of 32. For a size the user names that is not, use the nearest multiple '
        'on each side (1000x560 -> 992x544 or 992x576); a rejected request names them.',
    ],
    'agent_jobs': [
        'GET /capabilities reads the studio cache with the same size/task/material query parameters. '
        'status=computing includes retry_after_seconds; unknown plan estimates have seconds=null.',
        'GET /jobs/{id}?wait=25 waits at most 25 seconds and returns poll_after_ms. Poll the same ID; '
        'disconnecting a wait or SSE does not cancel generation.',
        'Jobs wait behind an active studio chain. GET /queue gives Agent/UI ownership and counts ahead, '
        'without studio prompts. POST /jobs/{id}/cancel cancels only this job.',
        'POST /jobs/{id}/resume continues failed, interrupted or cancelled generation; successful blocks stay. '
        'refine_from is the separate preview second pass. Active or succeeded jobs cannot resume.',
        'Results include the joined library_id and each block library_id/report_id. Fetch videos and thumbnails '
        'with the token at /library/{day}/{run}/file and /thumbnail. MCP freevideo_asset and CLI agent asset use HTTP.',
    ],
    'editing_projects': [
        'GET /projects lists timelines shared with the editor page. First GET /projects/{id} to read revision and clip IDs.',
        'POST /projects/{id}/operations sends revision and 1-64 operations, using whole frames at 24 fps. The batch saves once or changes nothing.',
        'On 409 project_changed, recompute edits from error.project and its current_revision, then send a new request. On clip_busy wait for generation to finish.',
        'POST /projects/{id}/generate reserves pending parts for clip_ids or a start/frames range and fills them as the returned job finishes. POST /projects/{id}/export renders the revision you read; wait for its job.',
        'Reuse ref or Idempotency-Key only for the identical request. Source video/audio/thumbnail URLs require the same Agent token.',
    ],
    'project_routes': [dict(operation=name, method=method, path=path, description=summary)
                       for name, (method, path, summary) in PROJECT_OPERATIONS.items()],
    'editing_images': [
        'POST /images opens a picture as the image editor does; GET /images/{id} reads its document (layers), selection and revision.',
        'POST /images/{id}/operations sends revision and 1-64 operations run with the page\'s own commands; the batch saves once or changes nothing. Layer IDs of new layers are in results[i].new_layer_ids.',
        'Positions and sizes are document pixels; brush points and sizes are fractions of the layer. Repair a picture with heal or clone on its own layer, even when it is locked: each stroke is a step of that layer that undo removes, and the source file never changes. '
        'A new paint layer is empty, so heal and clone there have nothing to work from; paint and gradients go on a paint layer above a locked picture.',
        'On 409 image_changed, recompute from error.image and its current_revision. POST /images/{id}/render makes a PNG input file from the revision you read; use the job result file as a picture source.',
    ],
    'image_routes': [dict(operation=name, method=method, path=path, description=summary)
                     for name, (method, path, summary) in IMAGE_OPERATIONS.items()],
    'sessions': [
        'Create a work conversation with POST /sessions; share a sentence using POST /sessions/{id}/events with type=message and text.',
        'Read /sessions/{id}/events?after=<last event seq>&wait=25 for user messages or confirmation answers. With Accept: text/event-stream, use Last-Event-ID to reconnect.',
        'Only the page user may stop or resume. On stopped_by_user, wait for the user to continue; do not start another session to bypass the stop.',
        'On needs_confirmation nothing changed: wait with freevideo_wait (no id) for the answer, then repeat the same call unchanged. '
        'On declined_by_user do not repeat it; change the plan or ask the user. GET /confirmations shows what asks first.',
    ],
    'session_routes': [dict(operation=name, method=method, path=path, description=summary)
                       for name, (method, path, summary) in SESSION_OPERATIONS.items()],
    'filming': [
        'Filming is for a film of several shots, each picked from takes. One video of any length is one generate '
        'job (longer requests continue and join automatically); to polish an idea first, run enhance, then generate.',
        'Use drama plan → start → get → sheet → choose/reshoot → finish; inspect todo after every change.',
        'At start tell the user the estimated total time; on over_budget decide whether to ask them; '
        'without an estimate report only the current work and elapsed time.',
        'Use get with since=revision and wait=25. changed=false is a compact timeout; retain the last full board.',
        'If paused is set, stop acting and long-wait until the user continues. Only the user may pause/resume.',
        'Continuations wait for the preceding chosen take and use real video continuation; upstream changes reconnect downstream shots.',
        'Reuse ref or Idempotency-Key with identical content for safe replay. External callers cannot supply by.',
        'GET /drama?status=active and connect/hello unfinished identify films to continue. No built-in director loop starts automatically.',
    ],
    'short_drama': [
        'One job = one shot or a few cuts of 5-10 s. Keep character descriptions identical across shots '
        '(same words for face, hair, clothing) and give each speaker the same voice description.',
        'Text alone does not keep a face identical across cuts. For a new scene with the same character, start '
        'from an image of them: a frame of an earlier shot edited into the new framing (media.first with edit), '
        'or a character picture as a reference (experimental).',
        'Continuity: start the next shot from the previous shot\'s last frame: '
        'media.first = {"from_job": "<id>", "frame": "last"}.',
        'Vertical short drama: aspect "9:16" (768x1344 at the native 0.98 MP).',
        'Review: ask the local VLM about sampled frames (kind "vlm", questions[].video) and regenerate weak shots '
        'with another seed (takes) before assembling (kind "assemble").',
        'Use quality "light" with preview=true to check a shot quickly, then refine_from that job.',
    ],
    'example': DEFAULT_PROMPT,
}


# How an agent is expected to work once a user has asked for something. Only what this version can honour.
RULES = [
    'Finish the job. When the user asks for a video, keep going until the finished video exists. Decide ordinary '
    'things yourself: how to split shots, how many takes, which take to keep. Tell the user what you decided in '
    'one or two sentences at the end, not along the way.',
    'Solve problems yourself first. Every error has a next field, and often details with alternatives; these are '
    'steps that work on this computer. Not enough graphics memory: use a listed alternative (a lower resolution '
    'or a shorter video) and try again. A take is not good: make another; if it is still not good after two more, '
    'describe it a different way instead of repeating the request. The queue is busy: wait with wait=25 on the '
    'job, never in a tight loop. The connection dropped or FreeVideo restarted: connect again, read the job list, '
    'and continue; resend an unanswered request with the same ref, and never generate again what is already done.',
    'Do not stop to report progress. A long task is not a reason to stop or to ask whether to go on.',
    'Ask the user only when you would have to change the content or style they asked for, when the work will '
    'take clearly longer than you told them at the start, or when you would have to delete or overwrite their '
    'own works or edits.',
    'Stay inside FreeVideo. Do not touch other files on this computer. Never change back something the user '
    'edited. When the user tells you to stop, stop: cancel what you started and start nothing new.',
    'Cast before you shoot. Search the cast library first. Use the card the user named, or one that clearly '
    'matches; ask if you are unsure. Create a card only when none fits: from the user\'s photos if they gave any, '
    'otherwise make its reference pictures with POST /cast/{id}/generate. '
    'Before shooting, tell the user the casting in one sentence. Later shots use the card\'s current pictures. '
    'Keep cards you made so later films can reuse them.',
]


def connection_guide(root, base):
    """Public bootstrap text contains locations and commands, never credential values."""
    import json
    from pathlib import Path
    from .mcp import client_config
    from .schema import PREFIX, contracts
    config = client_config(root)
    token_file = str(Path(root).resolve() / 'agent' / 'token')
    # The executable/API/credential locations come from this running installation.
    example = '\n'.join([
        'import json, pathlib, urllib.request',
        'base = ' + repr(base + PREFIX),
        'token = pathlib.Path(' + repr(token_file) + ').read_text().strip()',
        'def call(method, path, body=None):',
        '    data = None if body is None else json.dumps(body).encode()',
        '    req = urllib.request.Request(base + path, data=data, method=method,',
        '        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})',
        '    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))',
        '    with opener.open(req) as response: return json.load(response)',
        'call("POST", "/connect/hello", {"client": "Local Agent", "via": "http"})',
        'print(call("GET", ""))',
        '# Only after the user asks for a video:',
        '# job = call("POST", "/jobs", {"prompt": "USER_REQUEST", "ref": "shot-1"})["job"]',
        '# job = call("GET", "/jobs/" + job["id"] + "?wait=25")',
        '# Poll the same ID until succeeded. Retry a lost submission using the same ref.',
        '# Download base origin + job["result"]["video"]["url"] with the same Authorization header.',
    ])
    return dict(api=base + PREFIX, token_file=token_file, claude_code=config['claude_code'],
        codex=config['codex'], mcp_json=config['mcp_json'], command=config['command'],
        authentication='Read the token file and put its contents in the Authorization: Bearer header. '
                       'Do not print it, show it to the user, or write it to another file.',
        session='Newly configured tools are usually unavailable in the current session. Use this local HTTP '
                'API in this session; the tools will be available in your next session.',
        hello=dict(method='POST', url=base + PREFIX + '/connect/hello', body=dict(client='Local Agent', via='http')),
        capabilities=[dict(method=method, endpoint=PREFIX + suffix, description=row['summary'])
                      for (method, suffix), row in contracts().items()
                      if not suffix.startswith('/freevideo/') and not suffix.startswith('/connect')],
        first_reply='After connecting, first reply in the user\'s language. In plain words, explain the available '
                    'features listed here and give two or three requests they can say. Do not start any task yourself; '
                    'wait for the user to ask.',
        rules=RULES,
        fallback='If you cannot run commands, read local files, or reach this computer, tell the user honestly '
                 'in their language: I cannot connect to the program on your computer; you need an AI assistant '
                 'installed on your computer. Do not install a workaround.',
        http_example=example, docs=dict(guide=base + PREFIX + '/guide', openapi=base + PREFIX + '/openapi.json'))


def connection_text(value):
    import json
    return '\n'.join([
        'Connect to FreeVideo on this computer', value['api'], '', value['authentication'],
        'Token file: ' + value['token_file'], '', 'Claude Code:', value['claude_code'], '',
        'Codex:', value['codex'], '', 'Other MCP clients:', json.dumps(value['mcp_json'], indent=2), '',
        value['session'], '', 'Local HTTP (Python):', value['http_example'], '',
        'Available in this version:', *['- ' + row['description'] for row in value['capabilities']], '',
        value['first_reply'], value['fallback'], '',
        'How to work once the user has asked for something:',
        *['%d. %s' % (number, rule) for number, rule in enumerate(value['rules'], 1)], '',
        'More detail: ' + value['docs']['guide'], 'API contract: ' + value['docs']['openapi'], '',
    ])


GUIDE['agent_jobs'] += [
    'Use ref or the Idempotency-Key header on submissions and resume. The same key and content return '
    'the original job IDs (HTTP 200); changed content with the same key returns idempotency_conflict. Keys are kept per client name. '
    'Keys survive restart. Batch-level ref names the whole request; row refs still name earlier dependencies.',
    'Upload media content with POST /media. HTTP accepts no local absolute paths; MCP and CLI read local files '
    'before uploading. Unknown fields are rejected and every batch is validated before it is recorded.',
    'limits.seconds in the status reply is what this installation can make now. While continuation is false, '
    'one block (15 s) is the longest video; plan and submit refuse longer requests with continuation_unavailable.',
    'features in the status reply names what this installation offers; false means not usable now (for example '
    'chain.auto while continuation is false), and a missing name means not offered here.',
]
GUIDE['rules'] = RULES
from .errors import ERRORS
GUIDE['errors'] = {code: dict(status=status, retryable=retryable, message=message, next=action)
                   for code, (status, retryable, message, action) in ERRORS.items()}


# Same operation descriptions as the guarded routes, MCP and CLI.
GUIDE['filming_routes'] = [dict(operation=name, method=method, path=path, description=summary)
    for name, (method, path, summary) in DRAMA_OPERATIONS.items()]
GUIDE['cast_routes'] = [dict(operation=name, method=method, path=path, description=summary)
    for name, (method, path, summary) in CAST_OPERATIONS.items()]
GUIDE['cast'] = [
    'A card is a character or setting: name, a one-sentence English description used in prompts, up to six '
    'labelled pictures (front, three_quarter, side, back, face, sheet, other) and an optional 2 to 15 s voice.',
    'Changes need the revision you read (body revision or If-Match); stale_revision returns the current card in '
    'error.card. Fields the user changed return changed_by_user: keep the user\'s version.',
    'Film with a card by setting characters.<key>.card. Cards are read when each take is submitted. Shots that '
    'continue the previous one carry no references (cast_reference inherited); POST /drama/plan shows each shot\'s cast. '
    'A shot with a carded character is at most 15 s; continue it in the next shot to go longer.',
    'POST /cast/{id}/generate makes reference pictures from the description as a normal job (face=true adds a close-up). '
    'When the job ends the card gets the sharpest frames (labels guessed, label_guess) and a new revision; a failure '
    'sets generate_error and keeps the pictures. If the user changed the pictures (meanwhile, or before an agent asked), '
    'they go to candidates.',
]
