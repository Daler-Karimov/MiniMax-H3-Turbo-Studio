// Records are saved on the generation node: {name, words, added}. A phrase
// already written by the user has added=false, so it is never removed or
// reinserted after a manual edit. A missing table entry means lookup is pending.
function removeInsertion(prompt, words) {
    const index = prompt.indexOf(words);
    if (index < 0) return prompt;
    const before = prompt.slice(0, index), after = prompt.slice(index + words.length);
    const following = after.match(/^\s*,\s*/);
    if (following) return before + after.slice(following[0].length);
    const preceding = before.match(/,\s*$/);
    return (preceding ? before.slice(0, -preceding[0].length) : before) + after;
}

export function reconcileLoraTriggers(prompt, records, rows, wordsByName) {
    prompt = String(prompt ?? '');
    const names = [...new Set(rows.filter(row => row.enabled !== false && row.name).map(row => row.name))];
    const active = new Set(names);
    const previous = new Map((Array.isArray(records) ? records : [])
        .filter(row => row && typeof row.name === 'string' && typeof row.words === 'string' && row.words)
        .map(row => [row.name, {...row}]));
    const words = name => Object.hasOwn(wordsByName, name) ? String(wordsByName[name] ?? '').trim() : undefined;
    const retained = new Map([...previous].filter(([name, row]) => active.has(name)
        && (words(name) === undefined || words(name) === row.words)));
    const needed = new Set(names.map(name => words(name) ?? retained.get(name)?.words).filter(Boolean));
    const removed = new Set();
    for (const old of previous.values()) {
        if (old.added && !retained.has(old.name) && !needed.has(old.words) && !removed.has(old.words)) {
            prompt = removeInsertion(prompt, old.words); removed.add(old.words);
        }
    }
    // Shared phrases have joint ownership, including when one model replaces
    // another with the same phrase. Remove them only after the last owner leaves.
    const owned = new Set([...previous.values()].filter(row => row.added && prompt.includes(row.words)).map(row => row.words));
    const next = [], prefix = [];
    for (const name of names) {
        if (retained.has(name)) { next.push(retained.get(name)); continue; }
        const phrase = words(name);
        if (!phrase) continue;
        const present = [...prefix, prompt].join(', ').toLowerCase().includes(phrase.toLowerCase());
        const added = !present || owned.has(phrase);
        if (!present) { prefix.push(phrase); owned.add(phrase); }
        next.push({name, words: phrase, added});
    }
    return {prompt: [...prefix, ...(prompt ? [prompt] : [])].join(', '), records: next};
}
