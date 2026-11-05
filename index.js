/**
 * Franken-Swipe Extension for SillyTavern
 * Compare multiple swipes side-by-side and stitch paragraphs, lines, sentences,
 * dialogue, or custom text selections into a single combined response.
 *
 * Repository: https://github.com/serioos/Franken-Swipe
 */

const MODULE_NAME = 'franken_swipe';
const EXTENSION_FOLDER_URL = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

const DEFAULT_SETTINGS = Object.freeze({
    buttonPlacement: 'both',           // 'both' | 'swipe_controls' | 'action_menu' | 'none'
    defaultGranularity: 'paragraphs',  // 'paragraphs' | 'lines' | 'sentences' | 'dialogue'
    defaultView: 'rows',               // 'rows' | 'columns' | 'diff'
    defaultSaveMode: 'new_swipe',      // 'new_swipe' | 'overwrite' | 'save_cleanup'
    defaultReasoning: 'primary_donor', // 'primary_donor' | 'active_swipe' | 'combine' | 'none'
    dimDuplicates: true,
    collapseDuplicates: false,
    autoBaseActive: false,
    hotkeyEnabled: true,
    hotkeyCombo: 'Alt+KeyF',
});

const FALLBACK_SETTINGS_HTML = `
<div id="franken_swipe_settings" class="franken-swipe-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-dna"></i> Franken-Swipe</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="fs-settings-description">Compare swipes side-by-side and stitch blocks from different swipes into one combined response.</div>
            <div class="fs-settings-row">
                <label for="fs_setting_button_placement">Trigger Button Placement</label>
                <select id="fs_setting_button_placement" class="text_pole">
                    <option value="both">Swipe Controls &amp; Message Action Menu</option>
                    <option value="swipe_controls">Near Swipe Controls Only</option>
                    <option value="action_menu">Message Action Menu (...) Only</option>
                    <option value="none">Hidden (Slash Command / Hotkey Only)</option>
                </select>
            </div>
            <div class="fs-settings-row">
                <label for="fs_setting_default_granularity">Default Split Granularity</label>
                <select id="fs_setting_default_granularity" class="text_pole">
                    <option value="paragraphs">Paragraphs</option>
                    <option value="lines">Lines (Single Line Breaks)</option>
                    <option value="sentences">Sentences</option>
                    <option value="dialogue">Dialogue vs. Narration</option>
                </select>
            </div>
            <div class="fs-settings-row">
                <label for="fs_setting_default_view">Default Comparison View</label>
                <select id="fs_setting_default_view" class="text_pole">
                    <option value="rows">Aligned Row View</option>
                    <option value="columns">Column View</option>
                    <option value="diff">Visual Diff Mode</option>
                </select>
            </div>
            <div class="fs-settings-row">
                <label for="fs_setting_default_save_mode">Default Save Action</label>
                <select id="fs_setting_default_save_mode" class="text_pole">
                    <option value="new_swipe">Save as New Swipe</option>
                    <option value="overwrite">Overwrite Active Swipe</option>
                    <option value="save_cleanup">Save &amp; Clean Up Unused Swipes</option>
                </select>
            </div>
            <div class="fs-settings-row">
                <label for="fs_setting_default_reasoning">Default Reasoning / Thought Handling</label>
                <select id="fs_setting_default_reasoning" class="text_pole">
                    <option value="primary_donor">Keep Primary Donor Swipe's Reasoning</option>
                    <option value="active_swipe">Keep Active Swipe's Reasoning</option>
                    <option value="combine">Combine Reasoning from Used Donors</option>
                    <option value="none">Leave Reasoning Blank</option>
                </select>
            </div>
            <div class="fs-settings-row fs-settings-checkboxes">
                <label class="checkbox_label" for="fs_setting_dim_duplicates">
                    <input type="checkbox" id="fs_setting_dim_duplicates" />
                    <span>Dim identical duplicate blocks by default</span>
                </label>
                <label class="checkbox_label" for="fs_setting_collapse_duplicates">
                    <input type="checkbox" id="fs_setting_collapse_duplicates" />
                    <span>Collapse identical duplicate blocks by default</span>
                </label>
                <label class="checkbox_label" for="fs_setting_auto_base_active">
                    <input type="checkbox" id="fs_setting_auto_base_active" />
                    <span>Pre-load active swipe as draft base when opening</span>
                </label>
            </div>
            <hr class="sysHR" />
            <div class="fs-settings-row">
                <label class="checkbox_label" for="fs_setting_hotkey_enabled">
                    <input type="checkbox" id="fs_setting_hotkey_enabled" />
                    <span>Enable Keyboard Shortcut (opens latest multi-swipe message)</span>
                </label>
            </div>
            <div class="fs-settings-row fs-hotkey-config-row">
                <label for="fs_setting_hotkey">Shortcut Key Combo</label>
                <div class="fs-hotkey-input-group">
                    <input type="text" id="fs_setting_hotkey" class="text_pole" readonly placeholder="Alt+KeyF" />
                    <button type="button" id="fs_record_hotkey_btn" class="menu_button"><i class="fa-solid fa-keyboard"></i> Record</button>
                </div>
            </div>
            <div class="fs-settings-footer">
                <button type="button" id="fs_open_latest_btn" class="menu_button"><i class="fa-solid fa-dna"></i> Open Franken-Swipe on Latest Message</button>
                <small class="fs-settings-hint">Slash Command: <code>/frankenswipe [mesId]</code> or <code>/fswipe</code></small>
            </div>
        </div>
    </div>
</div>`;

/* ==========================================================================
   State Management & Utilities
   ========================================================================== */

let workspaceState = null;
let isRecordingHotkey = false;
let blockIdCounter = 1;
let decorateDebounceTimer = null;

function nextBlockId() {
    return `fs_blk_${Date.now()}_${blockIdCounter++}`;
}

function safeClone(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
        return structuredClone(obj);
    } catch {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return typeof obj === 'object' ? Object.assign({}, obj) : obj;
        }
    }
}

function getContext() {
    return SillyTavern.getContext();
}

function getSettings() {
    const { extensionSettings } = getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = safeClone(DEFAULT_SETTINGS);
    }
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (extensionSettings[MODULE_NAME][key] === undefined) {
            extensionSettings[MODULE_NAME][key] = val;
        }
    }
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const { saveSettingsDebounced } = getContext();
    if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

function notify(type, message, title = 'Franken-Swipe') {
    if (window.toastr && typeof window.toastr[type] === 'function') {
        window.toastr[type](message, title);
    } else {
        console.log(`[${title}] (${type}): ${message}`);
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeForComparison(text) {
    return String(text ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/* ==========================================================================
   Reasoning & Swipe Text Extraction
   ========================================================================== */

const INLINE_THINK_REGEX = /^\s*<(think|thinking)>([\s\S]*?)<\/\1>\s*/i;

/**
 * Extracts clean body text and reasoning from a swipe, handling both
 * SillyTavern's `swipe_info[i].extra.reasoning` and inline `<think>` blocks.
 */
function extractSwipeData(msg, swipeIndex) {
    const rawEntry = msg?.swipes?.[swipeIndex];
    const rawSwipe = typeof rawEntry === 'string'
        ? rawEntry
        : String(rawEntry ?? (swipeIndex === Number(msg?.swipe_id ?? 0) ? msg?.mes : '') ?? '');

    const swipeInfo = msg?.swipe_info?.[swipeIndex] ?? {};
    const isCurrentSwipe = Number(msg?.swipe_id ?? 0) === swipeIndex;

    let metadataReasoning = swipeInfo?.extra?.reasoning;
    if ((metadataReasoning === undefined || metadataReasoning === null) && isCurrentSwipe) {
        metadataReasoning = msg?.extra?.reasoning;
    }

    let bodyText = rawSwipe;
    let inlineReasoning = '';
    let inlineTag = null;

    const match = rawSwipe.match(INLINE_THINK_REGEX);
    if (match) {
        inlineTag = match[1];
        inlineReasoning = match[2].trim();
        bodyText = rawSwipe.slice(match[0].length);
    }

    const effectiveReasoning = (metadataReasoning && String(metadataReasoning).trim())
        ? String(metadataReasoning).trim()
        : inlineReasoning;

    return {
        swipeIndex,
        rawSwipe,
        bodyText,
        reasoning: effectiveReasoning || '',
        hasMetadataReasoning: Boolean(metadataReasoning && String(metadataReasoning).trim()),
        inlineTag,
        sendDate: swipeInfo?.send_date || msg?.send_date || null,
        extra: safeClone(swipeInfo?.extra || (isCurrentSwipe ? msg?.extra : {}) || {}),
    };
}

/* ==========================================================================
   Flexible Text Splitting Engine (Paragraphs, Lines, Sentences, Dialogue)
   ========================================================================== */

function splitParagraphIntoSentences(paragraphText) {
    const trimmed = paragraphText.trim();
    if (!trimmed) return [];

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        try {
            const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
            const segments = Array.from(segmenter.segment(trimmed), s => s.segment.trim()).filter(Boolean);
            if (segments.length > 0) return segments;
        } catch {
            // Fall back to regex splitter
        }
    }

    const results = [];
    const sentenceRegex = /[^.!?…]+(?:[.!?…]+["'”’»)*\]]*|\s*$)/g;
    let match;
    while ((match = sentenceRegex.exec(trimmed)) !== null) {
        const piece = match[0].trim();
        if (piece) results.push(piece);
    }
    return results.length > 0 ? results : [trimmed];
}

function splitParagraphIntoDialogue(paragraphText) {
    const trimmed = paragraphText.trim();
    if (!trimmed) return [];

    const dialogueRegex = /("[^"\n]+?"|“[^”\n]+?”|«[^»\n]+?»)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = dialogueRegex.exec(trimmed)) !== null) {
        if (match.index > lastIndex) {
            const narrationPart = trimmed.slice(lastIndex, match.index).trim();
            if (narrationPart) {
                parts.push({ text: narrationPart, kind: 'narration' });
            }
        }
        const dialoguePart = match[0].trim();
        if (dialoguePart) {
            parts.push({ text: dialoguePart, kind: 'dialogue' });
        }
        lastIndex = dialogueRegex.lastIndex;
    }

    if (lastIndex < trimmed.length) {
        const tail = trimmed.slice(lastIndex).trim();
        if (tail) {
            parts.push({ text: tail, kind: 'narration' });
        }
    }

    return parts.length > 0 ? parts : [{ text: trimmed, kind: 'narration' }];
}

function splitSwipeText(text, granularity) {
    const clean = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];

    const paragraphs = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    if (granularity === 'paragraphs') {
        return paragraphs.map((p, idx) => ({
            blockIndex: idx,
            paragraphIndex: idx,
            text: p,
            kind: 'paragraph',
            joinAfter: '\n\n',
            norm: normalizeForComparison(p),
        }));
    }

    if (granularity === 'lines') {
        const lines = clean.split(/\n/).map(l => l.trim()).filter(Boolean);
        return lines.map((l, idx) => ({
            blockIndex: idx,
            paragraphIndex: idx,
            text: l,
            kind: 'line',
            joinAfter: '\n',
            norm: normalizeForComparison(l),
        }));
    }

    if (granularity === 'sentences') {
        const blocks = [];
        paragraphs.forEach((para, pIdx) => {
            const sentences = splitParagraphIntoSentences(para);
            sentences.forEach((s, sIdx) => {
                const isLastInPara = sIdx === sentences.length - 1;
                blocks.push({
                    blockIndex: blocks.length,
                    paragraphIndex: pIdx,
                    text: s,
                    kind: 'sentence',
                    joinAfter: isLastInPara ? '\n\n' : ' ',
                    norm: normalizeForComparison(s),
                });
            });
        });
        return blocks;
    }

    if (granularity === 'dialogue') {
        const blocks = [];
        paragraphs.forEach((para, pIdx) => {
            const segments = splitParagraphIntoDialogue(para);
            segments.forEach((seg, sIdx) => {
                const isLastInPara = sIdx === segments.length - 1;
                blocks.push({
                    blockIndex: blocks.length,
                    paragraphIndex: pIdx,
                    text: seg.text,
                    kind: seg.kind,
                    joinAfter: isLastInPara ? '\n\n' : ' ',
                    norm: normalizeForComparison(seg.text),
                });
            });
        });
        return blocks;
    }

    return [];
}

/* ==========================================================================
   Similarity & Word-Level Visual Diff Engines
   ========================================================================== */

function extractWordShingles(text) {
    const words = normalizeForComparison(text)
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .filter(Boolean);

    if (words.length === 0) return new Set();
    if (words.length < 3) return new Set(words);

    const shingles = new Set();
    for (let i = 0; i < words.length - 1; i++) {
        shingles.add(`${words[i]} ${words[i + 1]}`);
    }
    return shingles;
}

function computeJaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function computeWordDiffHtml(textA, textB) {
    const tokensA = String(textA ?? '').trim().split(/(\s+)/).filter(Boolean);
    const tokensB = String(textB ?? '').trim().split(/(\s+)/).filter(Boolean);

    if (tokensA.length * tokensB.length > 250000) {
        if (normalizeForComparison(textA) === normalizeForComparison(textB)) {
            const safe = escapeHtml(textA);
            return { leftHtml: safe, rightHtml: safe };
        }
        return {
            leftHtml: `<del class="fs-diff-del">${escapeHtml(textA)}</del>`,
            rightHtml: `<ins class="fs-diff-ins">${escapeHtml(textB)}</ins>`,
        };
    }

    const m = tokensA.length;
    const n = tokensB.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (tokensA[i] === tokensB[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    let i = 0;
    let j = 0;
    const leftParts = [];
    const rightParts = [];

    while (i < m && j < n) {
        if (tokensA[i] === tokensB[j]) {
            const escaped = escapeHtml(tokensA[i]);
            leftParts.push(escaped);
            rightParts.push(escaped);
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            const tok = tokensA[i++];
            leftParts.push(/^\s+$/.test(tok) ? tok : `<del class="fs-diff-del">${escapeHtml(tok)}</del>`);
        } else {
            const tok = tokensB[j++];
            rightParts.push(/^\s+$/.test(tok) ? tok : `<ins class="fs-diff-ins">${escapeHtml(tok)}</ins>`);
        }
    }
    while (i < m) {
        const tok = tokensA[i++];
        leftParts.push(/^\s+$/.test(tok) ? tok : `<del class="fs-diff-del">${escapeHtml(tok)}</del>`);
    }
    while (j < n) {
        const tok = tokensB[j++];
        rightParts.push(/^\s+$/.test(tok) ? tok : `<ins class="fs-diff-ins">${escapeHtml(tok)}</ins>`);
    }

    return {
        leftHtml: leftParts.join(''),
        rightHtml: rightParts.join(''),
    };
}

/* ==========================================================================
   Draft Assembly & Reasoning Resolution
   ========================================================================== */

function assembleDraftText(state) {
    if (state.rawEditorMode) {
        return state.rawText;
    }
    if (!state.draftBlocks.length) {
        return '';
    }
    let output = '';
    for (let i = 0; i < state.draftBlocks.length; i++) {
        const blk = state.draftBlocks[i];
        output += blk.text;
        if (i < state.draftBlocks.length - 1) {
            output += blk.joinAfter ?? '\n\n';
        }
    }
    return output;
}

function countStats(text) {
    const clean = String(text ?? '').trim();
    if (!clean) {
        return { words: 0, chars: 0, estTokens: 0 };
    }
    const words = clean.split(/\s+/).filter(Boolean).length;
    const chars = clean.length;
    const estTokens = Math.max(1, Math.round(chars / 3.8));
    return { words, chars, estTokens };
}

function getPrimaryDonorIndex(state) {
    const charCounts = new Map();
    for (const blk of state.draftBlocks) {
        if (typeof blk.swipeIndex === 'number' && blk.swipeIndex >= 0) {
            const prev = charCounts.get(blk.swipeIndex) || 0;
            charCounts.set(blk.swipeIndex, prev + (blk.text?.length || 0));
        }
    }
    let bestSwipe = state.activeSwipeIndex;
    let bestCount = -1;
    for (const [sIdx, count] of charCounts.entries()) {
        if (count > bestCount) {
            bestCount = count;
            bestSwipe = sIdx;
        }
    }
    return bestSwipe;
}

function computeResolvedReasoning(state) {
    if (state.reasoningManuallyEdited) {
        return state.customReasoningText;
    }

    const mode = state.reasoningMode;
    if (mode === 'none') {
        return '';
    }

    if (mode === 'active_swipe') {
        return state.swipes[state.activeSwipeIndex]?.reasoning || '';
    }

    if (mode === 'primary_donor') {
        const primaryIdx = getPrimaryDonorIndex(state);
        return state.swipes[primaryIdx]?.reasoning || '';
    }

    if (mode === 'combine') {
        const usedIndices = [];
        for (const blk of state.draftBlocks) {
            if (typeof blk.swipeIndex === 'number' && blk.swipeIndex >= 0 && !usedIndices.includes(blk.swipeIndex)) {
                usedIndices.push(blk.swipeIndex);
            }
        }
        const indicesToCombine = usedIndices.length > 0
            ? usedIndices
            : [state.activeSwipeIndex];

        const seenNorms = new Set();
        const combinedParts = [];
        for (const idx of indicesToCombine) {
            const r = (state.swipes[idx]?.reasoning || '').trim();
            if (!r) continue;
            const norm = normalizeForComparison(r);
            if (seenNorms.has(norm)) continue;
            seenNorms.add(norm);
            if (indicesToCombine.length > 1) {
                combinedParts.push(`[Swipe #${idx + 1} Reasoning]\n${r}`);
            } else {
                combinedParts.push(r);
            }
        }
        return combinedParts.join('\n\n---\n\n');
    }

    if (mode.startsWith('swipe_')) {
        const idx = Number(mode.replace('swipe_', ''));
        return state.swipes[idx]?.reasoning || '';
    }

    return '';
}

/* ==========================================================================
   Workspace State Preparation & Undo/Redo Stack
   ========================================================================== */

function rebuildParsedSwipes(state) {
    const seenBlockMap = new Map();

    state.parsedSwipes = state.swipes.map((sw) => {
        const blocks = splitSwipeText(sw.bodyText, state.granularity);
        const enrichedBlocks = blocks.map((blk) => {
            let duplicateOf = null;
            if (blk.norm.length > 0) {
                if (seenBlockMap.has(blk.norm)) {
                    duplicateOf = seenBlockMap.get(blk.norm);
                } else {
                    seenBlockMap.set(blk.norm, sw.swipeIndex);
                }
            }
            return {
                ...blk,
                swipeIndex: sw.swipeIndex,
                duplicateOf,
            };
        });
        return {
            ...sw,
            blocks: enrichedBlocks,
        };
    });
}

function pushUndoSnapshot(state) {
    const snapshot = {
        draftBlocks: safeClone(state.draftBlocks),
        rawText: state.rawText,
        rawEditorMode: state.rawEditorMode,
    };
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 40) {
        state.undoStack.shift();
    }
    state.redoStack = [];
}

function performUndo(state) {
    if (state.undoStack.length === 0) return;
    state.redoStack.push({
        draftBlocks: safeClone(state.draftBlocks),
        rawText: state.rawText,
        rawEditorMode: state.rawEditorMode,
    });
    const prev = state.undoStack.pop();
    state.draftBlocks = prev.draftBlocks;
    state.rawText = prev.rawText;
    state.rawEditorMode = prev.rawEditorMode;
    state.replaceTargetId = null;
    renderWorkspace();
}

function performRedo(state) {
    if (state.redoStack.length === 0) return;
    state.undoStack.push({
        draftBlocks: safeClone(state.draftBlocks),
        rawText: state.rawText,
        rawEditorMode: state.rawEditorMode,
    });
    const next = state.redoStack.pop();
    state.draftBlocks = next.draftBlocks;
    state.rawText = next.rawText;
    state.rawEditorMode = next.rawEditorMode;
    state.replaceTargetId = null;
    renderWorkspace();
}

function loadSwipeAsBase(state, swipeIndex) {
    const targetSwipe = state.parsedSwipes[swipeIndex];
    if (!targetSwipe) return;

    pushUndoSnapshot(state);
    state.draftBlocks = targetSwipe.blocks.map(blk => ({
        id: nextBlockId(),
        swipeIndex: blk.swipeIndex,
        sourceBlockIndex: blk.blockIndex,
        text: blk.text,
        kind: blk.kind,
        joinAfter: blk.joinAfter || '\n\n',
        edited: false,
        norm: blk.norm,
    }));
    state.rawText = assembleDraftText({ ...state, rawEditorMode: false });
    state.replaceTargetId = null;
    if (!state.reasoningManuallyEdited) {
        state.customReasoningText = computeResolvedReasoning(state);
    }
    renderWorkspace();
}

function addBlockToDraft(state, donorBlock, customLabel = null) {
    pushUndoSnapshot(state);

    const newDraftBlock = {
        id: nextBlockId(),
        swipeIndex: donorBlock.swipeIndex,
        sourceBlockIndex: donorBlock.blockIndex ?? null,
        customLabel,
        text: donorBlock.text,
        kind: donorBlock.kind || 'paragraph',
        joinAfter: donorBlock.joinAfter || '\n\n',
        edited: false,
        norm: normalizeForComparison(donorBlock.text),
    };

    if (state.rawEditorMode) {
        const sep = state.rawText.trim().length > 0 ? '\n\n' : '';
        state.rawText = `${state.rawText}${sep}${donorBlock.text}`;
        state.draftBlocks.push(newDraftBlock);
        renderWorkspace();
        return;
    }

    if (state.replaceTargetId) {
        const targetIdx = state.draftBlocks.findIndex(b => b.id === state.replaceTargetId);
        if (targetIdx !== -1) {
            newDraftBlock.joinAfter = state.draftBlocks[targetIdx].joinAfter || newDraftBlock.joinAfter;
            state.draftBlocks[targetIdx] = newDraftBlock;
            state.replaceTargetId = null;
            state.rawText = assembleDraftText(state);
            if (!state.reasoningManuallyEdited) {
                state.customReasoningText = computeResolvedReasoning(state);
            }
            renderWorkspace();
            return;
        }
        state.replaceTargetId = null;
    }

    state.draftBlocks.push(newDraftBlock);
    state.rawText = assembleDraftText(state);
    if (!state.reasoningManuallyEdited) {
        state.customReasoningText = computeResolvedReasoning(state);
    }
    renderWorkspace();
}

/* ==========================================================================
   Opening the Franken-Swipe Workspace
   ========================================================================== */

export function openFrankenSwipeWorkspace(messageId) {
    const context = getContext();
    const chat = context.chat;
    const numericId = Number(messageId);

    if (!Array.isArray(chat) || isNaN(numericId) || !chat[numericId]) {
        notify('warning', `Message #${messageId} was not found in the active chat.`);
        return;
    }

    const msg = chat[numericId];
    if (!Array.isArray(msg.swipes) || msg.swipes.length < 2) {
        notify('info', 'This message has fewer than 2 swipes. Generate at least 2 swipes to stitch them together.');
        return;
    }

    // Close any previous modal BEFORE creating the new workspaceState
    closeWorkspaceModal();

    const settings = getSettings();
    const activeSwipeIndex = Math.min(
        Math.max(0, Number(msg.swipe_id ?? 0)),
        msg.swipes.length - 1,
    );

    const swipes = msg.swipes.map((_, idx) => extractSwipeData(msg, idx));
    const shingleSets = swipes.map(s => extractWordShingles(s.bodyText));
    const activeShingles = shingleSets[activeSwipeIndex];

    swipes.forEach((s, idx) => {
        if (idx === activeSwipeIndex) {
            let sum = 0;
            let count = 0;
            shingleSets.forEach((otherSet, oIdx) => {
                if (oIdx !== idx) {
                    sum += computeJaccardSimilarity(activeShingles, otherSet);
                    count++;
                }
            });
            s.similarity = count > 0 ? Math.round((sum / count) * 100) : 100;
        } else {
            s.similarity = Math.round(computeJaccardSimilarity(activeShingles, shingleSets[idx]) * 100);
        }
    });

    workspaceState = {
        messageId: numericId,
        characterName: msg.name || 'Character',
        activeSwipeIndex,
        swipes,
        parsedSwipes: [],
        hiddenSwipes: new Set(),
        granularity: settings.defaultGranularity || 'paragraphs',
        viewMode: settings.defaultView || 'rows',
        dimDuplicates: Boolean(settings.dimDuplicates),
        collapseDuplicates: Boolean(settings.collapseDuplicates),
        diffLeftSource: String(activeSwipeIndex),
        diffRightSource: String(activeSwipeIndex === 0 ? 1 : 0),
        draftBlocks: [],
        rawEditorMode: false,
        rawText: '',
        replaceTargetId: null,
        reasoningMode: settings.defaultReasoning || 'primary_donor',
        reasoningExpanded: false,
        reasoningManuallyEdited: false,
        customReasoningText: '',
        undoStack: [],
        redoStack: [],
        dragSourceIndex: null,
    };

    rebuildParsedSwipes(workspaceState);

    if (settings.autoBaseActive) {
        const baseSwipe = workspaceState.parsedSwipes[activeSwipeIndex];
        if (baseSwipe) {
            workspaceState.draftBlocks = baseSwipe.blocks.map(blk => ({
                id: nextBlockId(),
                swipeIndex: blk.swipeIndex,
                sourceBlockIndex: blk.blockIndex,
                text: blk.text,
                kind: blk.kind,
                joinAfter: blk.joinAfter || '\n\n',
                edited: false,
                norm: blk.norm,
            }));
            workspaceState.rawText = assembleDraftText(workspaceState);
        }
    }

    workspaceState.customReasoningText = computeResolvedReasoning(workspaceState);

    mountWorkspaceModal();
    renderWorkspace();
}

export function openOnLatestMultiSwipeMessage() {
    const { chat } = getContext();
    if (!Array.isArray(chat) || chat.length === 0) {
        notify('warning', 'No active chat loaded.');
        return;
    }

    for (let i = chat.length - 1; i >= 0; i--) {
        if (Array.isArray(chat[i]?.swipes) && chat[i].swipes.length >= 2) {
            openFrankenSwipeWorkspace(i);
            return;
        }
    }

    notify('info', 'No message with 2 or more swipes found in the current chat.');
}

/* ==========================================================================
   Workspace DOM Rendering
   ========================================================================== */

function mountWorkspaceModal() {
    // Remove any existing backdrop DOM element without clearing workspaceState
    document.getElementById('fs_modal_backdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'fs_modal_backdrop';
    backdrop.className = 'fs-modal-backdrop';
    backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) {
            closeWorkspaceModal();
        }
    });

    const workspace = document.createElement('div');
    workspace.id = 'fs_workspace';
    workspace.className = 'fs-workspace';
    backdrop.appendChild(workspace);

    document.body.appendChild(backdrop);
    document.addEventListener('selectionchange', handleFreehandSelectionChange);
}

function closeWorkspaceModal() {
    removeSelectionPopover();
    document.removeEventListener('selectionchange', handleFreehandSelectionChange);
    const existing = document.getElementById('fs_modal_backdrop');
    if (existing) {
        existing.remove();
    }
    workspaceState = null;
}

function getDonorColorClass(swipeIndex) {
    if (typeof swipeIndex !== 'number' || swipeIndex < 0) return 'fs-donor-color-0';
    return `fs-donor-color-${swipeIndex % 8}`;
}

function renderSwipeHeaderCard(sw, isActive) {
    const colorClass = getDonorColorClass(sw.swipeIndex);
    const wordCount = countStats(sw.bodyText).words;
    const hasReasoning = Boolean(sw.reasoning);

    return `
        <div class="fs-swipe-header-card ${colorClass}" data-swipe-index="${sw.swipeIndex}">
            <div class="fs-swipe-header-top">
                <span class="fs-swipe-title">
                    <span>Swipe #${sw.swipeIndex + 1}</span>
                    ${isActive ? '<span class="fs-active-badge">Active</span>' : ''}
                    ${hasReasoning ? '<i class="fa-solid fa-brain" title="Contains reasoning/thought block"></i>' : ''}
                </span>
                <div class="fs-draft-block-actions">
                    <button type="button" class="fs-mini-btn accent fs-use-base-btn" data-swipe-index="${sw.swipeIndex}" title="Populate Draft Builder with all blocks from Swipe #${sw.swipeIndex + 1}">
                        <i class="fa-solid fa-layer-group"></i> Use as Base
                    </button>
                    <button type="button" class="fs-icon-btn fs-hide-swipe-btn" data-swipe-index="${sw.swipeIndex}" title="Hide Swipe #${sw.swipeIndex + 1}">
                        <i class="fa-solid fa-eye-slash"></i>
                    </button>
                </div>
            </div>
            <div class="fs-swipe-meta">
                <span>${wordCount} words &bull; ${sw.blocks.length} blocks</span>
                <span class="fs-sim-bar-wrap" title="${sw.similarity}% word-pair similarity to active swipe">
                    <span>${sw.similarity}% sim</span>
                    <span class="fs-sim-bar"><span class="fs-sim-bar-fill" style="width: ${sw.similarity}%;"></span></span>
                </span>
            </div>
        </div>
    `;
}

function renderDonorBlockCard(blk, state, draftNormSet) {
    const colorClass = getDonorColorClass(blk.swipeIndex);
    const inDraft = (blk.norm && draftNormSet.has(`${blk.swipeIndex}:${blk.blockIndex}`)) || draftNormSet.has(`norm:${blk.norm}`);
    const isDup = blk.duplicateOf !== null && blk.duplicateOf !== undefined;
    const dupClasses = isDup
        ? `is-duplicate ${state.dimDuplicates ? 'dimmed' : ''} ${state.collapseDuplicates ? 'collapsed' : ''}`
        : '';

    let kindBadge = '';
    if (blk.kind === 'dialogue') {
        kindBadge = '<span class="fs-tag-badge dialogue"><i class="fa-solid fa-comment-dots"></i> Dialogue</span>';
    } else if (blk.kind === 'narration') {
        kindBadge = '<span class="fs-tag-badge narration"><i class="fa-solid fa-book-open"></i> Narration</span>';
    }

    const dupBadge = isDup
        ? `<span class="fs-tag-badge dup-badge" title="Identical to a block in Swipe #${blk.duplicateOf + 1}">= Swipe #${blk.duplicateOf + 1}</span>`
        : '';

    const actionHintText = state.replaceTargetId
        ? '<i class="fa-solid fa-arrows-rotate"></i> Click to Replace Target'
        : '<i class="fa-solid fa-plus"></i> Click to Add';

    return `
        <div class="fs-block-card ${colorClass} ${inDraft ? 'in-draft' : ''} ${dupClasses}"
             data-swipe-index="${blk.swipeIndex}"
             data-block-index="${blk.blockIndex}">
            <div class="fs-block-top">
                <div class="fs-block-badges">
                    <span>#${blk.blockIndex + 1}</span>
                    ${kindBadge}
                    ${dupBadge}
                    ${inDraft ? '<span class="fs-tag-badge" style="color:#68d391;"><i class="fa-solid fa-check"></i> In Draft</span>' : ''}
                </div>
                <span class="fs-block-action-hint">${actionHintText}</span>
            </div>
            <div class="fs-block-text" data-swipe-index="${blk.swipeIndex}" data-block-index="${blk.blockIndex}">${escapeHtml(blk.text)}</div>
        </div>
    `;
}

function renderAlignedRowsView(state, visibleSwipes, draftNormSet) {
    if (visibleSwipes.length === 0) {
        return `<div class="fs-draft-empty"><p>All swipes are currently hidden. Click a swipe pill above to show it.</p></div>`;
    }

    const maxBlocks = Math.max(1, ...visibleSwipes.map(s => s.blocks.length));
    const colTemplate = `42px repeat(${visibleSwipes.length}, minmax(260px, 1fr))`;
    const minGridWidth = 52 + visibleSwipes.length * 270;

    const headerCells = visibleSwipes
        .map(sw => renderSwipeHeaderCard(sw, sw.swipeIndex === state.activeSwipeIndex))
        .join('');

    let rowsHtml = '';
    for (let bIdx = 0; bIdx < maxBlocks; bIdx++) {
        const cells = visibleSwipes.map(sw => {
            const blk = sw.blocks[bIdx];
            if (!blk) {
                return `<div class="fs-empty-slot">&mdash;</div>`;
            }
            return renderDonorBlockCard(blk, state, draftNormSet);
        }).join('');

        rowsHtml += `
            <div class="fs-aligned-block-row" style="grid-template-columns: ${colTemplate};">
                <div class="fs-row-index-gutter" title="Block Row #${bIdx + 1}">B${bIdx + 1}</div>
                ${cells}
            </div>
        `;
    }

    return `
        <div class="fs-aligned-grid" style="min-width: ${minGridWidth}px;">
            <div class="fs-aligned-header-row" style="grid-template-columns: ${colTemplate};">
                <div class="fs-row-index-gutter"><i class="fa-solid fa-grip-lines"></i></div>
                ${headerCells}
            </div>
            ${rowsHtml}
        </div>
    `;
}

function renderColumnsView(state, visibleSwipes, draftNormSet) {
    if (visibleSwipes.length === 0) {
        return `<div class="fs-draft-empty"><p>All swipes are currently hidden. Click a swipe pill above to show it.</p></div>`;
    }

    const minGridWidth = visibleSwipes.length * 280;
    const colsHtml = visibleSwipes.map(sw => {
        const blocksHtml = sw.blocks.length > 0
            ? sw.blocks.map(blk => renderDonorBlockCard(blk, state, draftNormSet)).join('')
            : `<div class="fs-empty-slot">Empty swipe</div>`;

        return `
            <div class="fs-swipe-column">
                ${renderSwipeHeaderCard(sw, sw.swipeIndex === state.activeSwipeIndex)}
                ${blocksHtml}
            </div>
        `;
    }).join('');

    return `
        <div class="fs-columns-container" style="grid-template-columns: repeat(${visibleSwipes.length}, minmax(260px, 1fr)); min-width: ${minGridWidth}px;">
            ${colsHtml}
        </div>
    `;
}

function getDiffSourceBlocks(state, sourceKey) {
    if (sourceKey === 'draft') {
        const draftText = assembleDraftText(state);
        const blocks = splitSwipeText(draftText, state.granularity);
        return blocks.map(b => ({ ...b, swipeIndex: -1 }));
    }
    const idx = Number(sourceKey);
    return state.parsedSwipes[idx]?.blocks || [];
}

function renderVisualDiffView(state, draftNormSet) {
    const optionsHtml = (selectedVal) => {
        const swipeOpts = state.swipes.map(s => {
            const sel = String(s.swipeIndex) === String(selectedVal) ? 'selected' : '';
            return `<option value="${s.swipeIndex}" ${sel}>Swipe #${s.swipeIndex + 1}${s.swipeIndex === state.activeSwipeIndex ? ' (Active)' : ''}</option>`;
        }).join('');
        const draftSel = selectedVal === 'draft' ? 'selected' : '';
        return `${swipeOpts}<option value="draft" ${draftSel}>Stitched Draft (Current)</option>`;
    };

    const leftBlocks = getDiffSourceBlocks(state, state.diffLeftSource);
    const rightBlocks = getDiffSourceBlocks(state, state.diffRightSource);
    const maxLen = Math.max(leftBlocks.length, rightBlocks.length, 1);

    let rowsHtml = '';
    for (let i = 0; i < maxLen; i++) {
        const lBlk = leftBlocks[i];
        const rBlk = rightBlocks[i];
        const { leftHtml, rightHtml } = computeWordDiffHtml(lBlk?.text || '', rBlk?.text || '');

        const leftCard = lBlk ? `
            <div class="fs-block-card ${getDonorColorClass(lBlk.swipeIndex)} ${draftNormSet.has(`norm:${lBlk.norm}`) ? 'in-draft' : ''}"
                 data-diff-side="left" data-diff-index="${i}">
                <div class="fs-block-top">
                    <span>#${i + 1} (${state.diffLeftSource === 'draft' ? 'Draft' : `Swipe #${Number(state.diffLeftSource) + 1}`})</span>
                    <span class="fs-block-action-hint"><i class="fa-solid fa-plus"></i> Add to Draft</span>
                </div>
                <div class="fs-block-text">${leftHtml}</div>
            </div>
        ` : `<div class="fs-empty-slot">No corresponding block</div>`;

        const rightCard = rBlk ? `
            <div class="fs-block-card ${getDonorColorClass(rBlk.swipeIndex)} ${draftNormSet.has(`norm:${rBlk.norm}`) ? 'in-draft' : ''}"
                 data-diff-side="right" data-diff-index="${i}">
                <div class="fs-block-top">
                    <span>#${i + 1} (${state.diffRightSource === 'draft' ? 'Draft' : `Swipe #${Number(state.diffRightSource) + 1}`})</span>
                    <span class="fs-block-action-hint"><i class="fa-solid fa-plus"></i> Add to Draft</span>
                </div>
                <div class="fs-block-text">${rightHtml}</div>
            </div>
        ` : `<div class="fs-empty-slot">No corresponding block</div>`;

        rowsHtml += `<div class="fs-diff-row">${leftCard}${rightCard}</div>`;
    }

    return `
        <div class="fs-diff-container">
            <div class="fs-diff-toolbar">
                <div class="fs-diff-selectors">
                    <label>Compare Base (A):</label>
                    <select id="fs_diff_left_select">${optionsHtml(state.diffLeftSource)}</select>
                    <button type="button" id="fs_diff_swap_btn" class="fs-mini-btn" title="Swap Left & Right"><i class="fa-solid fa-right-left"></i></button>
                    <label>Against Target (B):</label>
                    <select id="fs_diff_right_select">${optionsHtml(state.diffRightSource)}</select>
                </div>
                <div class="fs-diff-legend">
                    <span><del class="fs-diff-del">Removed in B</del></span>
                    <span><ins class="fs-diff-ins">Added in B</ins></span>
                </div>
            </div>
            ${rowsHtml}
        </div>
    `;
}

function formatJoinerLabel(joinAfter) {
    if (joinAfter === ' ') return '␣ Space';
    if (joinAfter === '\n') return '↵ Line Break';
    return '¶ Paragraph Break';
}

function renderDraftBuilderPane(state) {
    const baseOptions = state.swipes.map(s => (
        `<option value="${s.swipeIndex}">Load Swipe #${s.swipeIndex + 1} as Base${s.swipeIndex === state.activeSwipeIndex ? ' (Active)' : ''}</option>`
    )).join('');

    const replaceBanner = state.replaceTargetId ? `
        <div class="fs-replace-banner">
            <span><i class="fa-solid fa-crosshairs"></i> <b>Replace Mode Active:</b> Click any donor block on the left to swap it into the highlighted slot.</span>
            <button type="button" id="fs_cancel_replace_btn" class="fs-mini-btn">Cancel</button>
        </div>
    ` : '';

    let bodyContent = '';
    if (state.rawEditorMode) {
        bodyContent = `
            <textarea id="fs_raw_editor" class="fs-raw-editor-textarea" placeholder="Write or edit your full stitched response here...">${escapeHtml(state.rawText)}</textarea>
        `;
    } else if (state.draftBlocks.length === 0) {
        bodyContent = `
            <div class="fs-draft-empty">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <div><b>Your Stitched Draft is Empty</b></div>
                <div>Click any block from the donor swipes on the left to add it here, highlight any arbitrary phrase to grab a selection, or load a full swipe as a starting base.</div>
                <button type="button" id="fs_empty_load_active_btn" class="fs-mini-btn accent">
                    <i class="fa-solid fa-layer-group"></i> Use Active Swipe (#${state.activeSwipeIndex + 1}) as Base
                </button>
            </div>
        `;
    } else {
        bodyContent = state.draftBlocks.map((blk, idx) => {
            const colorClass = getDonorColorClass(blk.swipeIndex);
            const isTarget = state.replaceTargetId === blk.id;
            const donorTitle = blk.customLabel
                ? blk.customLabel
                : (blk.swipeIndex >= 0 ? `Swipe #${blk.swipeIndex + 1}` : 'Custom Block');
            const editedTag = blk.edited ? ' &bull; Edited' : '';

            const joinerBar = idx < state.draftBlocks.length - 1 ? `
                <div class="fs-joiner-bar">
                    <button type="button" class="fs-joiner-pill fs-cycle-joiner-btn" data-index="${idx}" title="Click to toggle how Block #${idx + 1} connects to Block #${idx + 2}">
                        ${formatJoinerLabel(blk.joinAfter)}
                    </button>
                    <button type="button" class="fs-joiner-pill fs-merge-down-btn" data-index="${idx}" title="Merge Block #${idx + 1} and Block #${idx + 2} into one block">
                        <i class="fa-solid fa-link"></i> Merge Down
                    </button>
                </div>
            ` : '';

            return `
                <div class="fs-draft-block ${colorClass} ${isTarget ? 'replace-target' : ''}"
                     draggable="true"
                     data-draft-id="${blk.id}"
                     data-draft-index="${idx}">
                    <div class="fs-draft-block-header">
                        <span class="fs-donor-pill">
                            <i class="fa-solid fa-grip-vertical" style="cursor:grab;"></i>
                            <span>#${idx + 1} &bull; ${escapeHtml(donorTitle)}${editedTag}</span>
                        </span>
                        <div class="fs-draft-block-actions">
                            <button type="button" class="fs-icon-btn fs-target-replace-btn ${isTarget ? 'active' : ''}" data-draft-id="${blk.id}" title="Target this block to replace it with the next donor block you click">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button type="button" class="fs-icon-btn fs-move-up-btn" data-index="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move Block Up">
                                <i class="fa-solid fa-arrow-up"></i>
                            </button>
                            <button type="button" class="fs-icon-btn fs-move-down-btn" data-index="${idx}" ${idx === state.draftBlocks.length - 1 ? 'disabled' : ''} title="Move Block Down">
                                <i class="fa-solid fa-arrow-down"></i>
                            </button>
                            <button type="button" class="fs-icon-btn fs-split-block-btn" data-index="${idx}" title="Split this block into sentences/lines">
                                <i class="fa-solid fa-scissors"></i>
                            </button>
                            <button type="button" class="fs-icon-btn danger fs-delete-block-btn" data-index="${idx}" title="Remove Block">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                    <textarea class="fs-draft-editor-input" data-index="${idx}" rows="${Math.min(8, Math.max(2, Math.ceil(blk.text.length / 72)))}">${escapeHtml(blk.text)}</textarea>
                </div>
                ${joinerBar}
            `;
        }).join('');
    }

    const specificSwipeReasoningOpts = state.swipes.map(s => {
        const val = `swipe_${s.swipeIndex}`;
        const sel = state.reasoningMode === val ? 'selected' : '';
        return `<option value="${val}" ${sel}>Keep Swipe #${s.swipeIndex + 1} Reasoning${s.reasoning ? '' : ' (Empty)'}</option>`;
    }).join('');

    return `
        <div class="fs-draft-header">
            <div class="fs-draft-title-row">
                <span class="fs-draft-title">
                    <i class="fa-solid fa-puzzle-piece"></i>
                    <span>Stitching Workspace (Draft Builder)</span>
                </span>
                <div class="fs-draft-block-actions">
                    <button type="button" id="fs_undo_btn" class="fs-mini-btn" ${state.undoStack.length === 0 ? 'disabled' : ''} title="Undo (Ctrl+Z)">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                    <button type="button" id="fs_redo_btn" class="fs-mini-btn" ${state.redoStack.length === 0 ? 'disabled' : ''} title="Redo (Ctrl+Y)">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                    <button type="button" id="fs_toggle_raw_btn" class="fs-mini-btn ${state.rawEditorMode ? 'accent' : ''}" title="Switch between structured blocks and full raw text editor">
                        <i class="fa-solid ${state.rawEditorMode ? 'fa-cubes' : 'fa-pen-to-square'}"></i>
                        <span>${state.rawEditorMode ? 'Block Editor' : 'Raw Text Editor'}</span>
                    </button>
                </div>
            </div>
            <div class="fs-draft-controls-row">
                <select id="fs_load_base_select" class="fs-base-select">
                    <option value="">+ Populate Draft from Swipe...</option>
                    ${baseOptions}
                </select>
                <div class="fs-draft-block-actions">
                    <button type="button" id="fs_add_custom_block_btn" class="fs-mini-btn" title="Add a blank custom block to write your own transition">
                        <i class="fa-solid fa-plus"></i> Custom Block
                    </button>
                    <button type="button" id="fs_clear_draft_btn" class="fs-mini-btn" ${state.draftBlocks.length === 0 && !state.rawText ? 'disabled' : ''} title="Clear entire draft">
                        <i class="fa-solid fa-eraser"></i> Clear
                    </button>
                </div>
            </div>
        </div>
        ${replaceBanner}
        <div class="fs-draft-body" id="fs_draft_body">
            ${bodyContent}
        </div>
        <div class="fs-reasoning-panel">
            <div class="fs-reasoning-row">
                <span class="fs-reasoning-label">
                    <i class="fa-solid fa-brain"></i>
                    <span>Reasoning / Thought Block:</span>
                </span>
                <select id="fs_reasoning_mode_select" class="fs-reasoning-select">
                    <option value="primary_donor" ${state.reasoningMode === 'primary_donor' ? 'selected' : ''}>Primary Donor Swipe (#${getPrimaryDonorIndex(state) + 1})</option>
                    <option value="active_swipe" ${state.reasoningMode === 'active_swipe' ? 'selected' : ''}>Active Swipe (#${state.activeSwipeIndex + 1})</option>
                    <option value="combine" ${state.reasoningMode === 'combine' ? 'selected' : ''}>Combine Used Donors</option>
                    <option value="none" ${state.reasoningMode === 'none' ? 'selected' : ''}>Leave Blank (None)</option>
                    ${specificSwipeReasoningOpts}
                </select>
                <button type="button" id="fs_toggle_reasoning_preview_btn" class="fs-mini-btn">
                    <i class="fa-solid ${state.reasoningExpanded ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
                    <span>${state.reasoningExpanded ? 'Hide' : 'Inspect / Edit'}</span>
                </button>
            </div>
            ${state.reasoningExpanded ? `
                <textarea id="fs_reasoning_textarea" class="fs-reasoning-preview" placeholder="No reasoning text for this selection (or type custom reasoning here)...">${escapeHtml(state.customReasoningText)}</textarea>
            ` : ''}
        </div>
    `;
}

function renderWorkspace() {
    if (!workspaceState) return;
    const state = workspaceState;
    const container = document.getElementById('fs_workspace');
    if (!container) return;

    try {
        const draftNormSet = new Set();
        for (const blk of state.draftBlocks) {
            if (typeof blk.swipeIndex === 'number' && typeof blk.sourceBlockIndex === 'number') {
                draftNormSet.add(`${blk.swipeIndex}:${blk.sourceBlockIndex}`);
            }
            if (blk.norm) {
                draftNormSet.add(`norm:${blk.norm}`);
            }
        }

        const visibleSwipes = state.parsedSwipes.filter(s => !state.hiddenSwipes.has(s.swipeIndex));

        let comparisonHtml = '';
        if (state.viewMode === 'rows') {
            comparisonHtml = renderAlignedRowsView(state, visibleSwipes, draftNormSet);
        } else if (state.viewMode === 'columns') {
            comparisonHtml = renderColumnsView(state, visibleSwipes, draftNormSet);
        } else {
            comparisonHtml = renderVisualDiffView(state, draftNormSet);
        }

        const swipePillsHtml = state.parsedSwipes.map(sw => {
            const isHidden = state.hiddenSwipes.has(sw.swipeIndex);
            const colorVar = `var(--fs-donor-${sw.swipeIndex % 8})`;
            return `
                <div class="fs-swipe-pill ${isHidden ? 'hidden-swipe' : ''}" data-swipe-index="${sw.swipeIndex}" title="Click to toggle visibility of Swipe #${sw.swipeIndex + 1}">
                    <span class="fs-color-dot" style="background:${colorVar};"></span>
                    <span>Swipe #${sw.swipeIndex + 1}${sw.swipeIndex === state.activeSwipeIndex ? ' ★' : ''}</span>
                    <span class="fs-sim-tag">${sw.similarity}%</span>
                </div>
            `;
        }).join('');

        const assembledText = assembleDraftText(state);
        const draftStats = countStats(assembledText);
        const activeStats = countStats(state.swipes[state.activeSwipeIndex]?.bodyText || '');
        const wordDelta = draftStats.words - activeStats.words;
        const deltaFormatted = wordDelta >= 0 ? `+${wordDelta}` : `${wordDelta}`;
        const isDraftEmpty = draftStats.chars === 0;
        const defaultSave = getSettings().defaultSaveMode || 'new_swipe';

        container.innerHTML = `
            <div class="fs-header">
                <div class="fs-brand">
                    <div class="fs-brand-icon"><i class="fa-solid fa-dna"></i></div>
                    <div>
                        <div class="fs-brand-title">Franken-Swipe</div>
                        <div class="fs-brand-subtitle">Message #${state.messageId} &bull; ${escapeHtml(state.characterName)} &bull; ${state.swipes.length} Swipes</div>
                    </div>
                </div>

                <div class="fs-toolbar">
                    <div class="fs-control-group" title="Change how donor swipes are split into selectable blocks">
                        <span class="fs-control-label">Split</span>
                        <button type="button" class="fs-seg-btn ${state.granularity === 'paragraphs' ? 'active' : ''}" data-granularity="paragraphs">
                            <i class="fa-solid fa-paragraph"></i> Paragraphs
                        </button>
                        <button type="button" class="fs-seg-btn ${state.granularity === 'lines' ? 'active' : ''}" data-granularity="lines">
                            <i class="fa-solid fa-bars-staggered"></i> Lines
                        </button>
                        <button type="button" class="fs-seg-btn ${state.granularity === 'sentences' ? 'active' : ''}" data-granularity="sentences">
                            <i class="fa-solid fa-ellipsis"></i> Sentences
                        </button>
                        <button type="button" class="fs-seg-btn ${state.granularity === 'dialogue' ? 'active' : ''}" data-granularity="dialogue">
                            <i class="fa-solid fa-comments"></i> Dialogue
                        </button>
                    </div>

                    <div class="fs-control-group" title="Switch comparison layout mode">
                        <span class="fs-control-label">View</span>
                        <button type="button" class="fs-seg-btn ${state.viewMode === 'rows' ? 'active' : ''}" data-view="rows">
                            <i class="fa-solid fa-table-cells-large"></i> Aligned Rows
                        </button>
                        <button type="button" class="fs-seg-btn ${state.viewMode === 'columns' ? 'active' : ''}" data-view="columns">
                            <i class="fa-solid fa-table-columns"></i> Columns
                        </button>
                        <button type="button" class="fs-seg-btn ${state.viewMode === 'diff' ? 'active' : ''}" data-view="diff">
                            <i class="fa-solid fa-code-compare"></i> Visual Diff
                        </button>
                    </div>

                    <button type="button" id="fs_toggle_dim_btn" class="fs-toggle-pill ${state.dimDuplicates ? 'active' : ''}" title="Dim blocks that are identical to an earlier swipe">
                        <i class="fa-solid fa-clone"></i> Dim Duplicates
                    </button>

                    <button type="button" id="fs_toggle_collapse_btn" class="fs-toggle-pill ${state.collapseDuplicates ? 'active' : ''}" title="Collapse duplicate blocks">
                        <i class="fa-solid fa-compress"></i> Collapse Dups
                    </button>
                </div>

                <button type="button" id="fs_close_modal_btn" class="fs-close-btn" title="Close Franken-Swipe (Esc)">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="fs-filter-bar">
                <div class="fs-swipe-pills">
                    <span class="fs-control-label"><i class="fa-solid fa-filter"></i> Swipes:</span>
                    ${swipePillsHtml}
                </div>
                <div class="fs-filter-actions">
                    <button type="button" id="fs_grab_selection_btn" class="fs-mini-btn accent" title="Highlight any arbitrary word or phrase in a swipe and click here to add it to your draft">
                        <i class="fa-solid fa-highlighter"></i> Add Highlighted Text
                    </button>
                    <button type="button" id="fs_show_all_swipes_btn" class="fs-mini-btn" ${state.hiddenSwipes.size === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-eye"></i> Show All (${state.swipes.length - state.hiddenSwipes.size}/${state.swipes.length})
                    </button>
                </div>
            </div>

            <div class="fs-body">
                <div class="fs-comparison-pane">
                    <div class="fs-comparison-scroll" id="fs_comparison_scroll">
                        ${comparisonHtml}
                    </div>
                </div>
                <div class="fs-draft-pane">
                    ${renderDraftBuilderPane(state)}
                </div>
            </div>

            <div class="fs-footer">
                <div class="fs-stats-bar">
                    <span class="fs-stat-item">Words: <b>${draftStats.words}</b> <small>(${deltaFormatted} vs active)</small></span>
                    <span>&bull;</span>
                    <span class="fs-stat-item">Chars: <b>${draftStats.chars}</b></span>
                    <span>&bull;</span>
                    <span class="fs-stat-item">Est. Tokens: <b>~${draftStats.estTokens}</b></span>
                    <span>&bull;</span>
                    <span class="fs-stat-item">Blocks: <b>${state.draftBlocks.length}</b></span>
                </div>

                <div class="fs-save-actions">
                    <button type="button" id="fs_save_new_swipe_btn" class="fs-save-btn ${defaultSave === 'new_swipe' ? 'primary' : ''}" ${isDraftEmpty ? 'disabled' : ''} title="Add the stitched response as a brand-new swipe and switch to it">
                        <i class="fa-solid fa-plus-circle"></i> Save as New Swipe
                    </button>
                    <button type="button" id="fs_save_overwrite_btn" class="fs-save-btn ${defaultSave === 'overwrite' ? 'primary' : ''}" ${isDraftEmpty ? 'disabled' : ''} title="Overwrite Swipe #${state.activeSwipeIndex + 1} in place with the stitched response">
                        <i class="fa-solid fa-pen-clip"></i> Overwrite Swipe #${state.activeSwipeIndex + 1}
                    </button>
                    <button type="button" id="fs_save_cleanup_btn" class="fs-save-btn ${defaultSave === 'save_cleanup' ? 'primary' : ''}" ${isDraftEmpty ? 'disabled' : ''} title="Save stitched response and remove unused donor swipes from this message">
                        <i class="fa-solid fa-broom"></i> Save &amp; Clean Up
                    </button>
                </div>
            </div>
        `;

        bindWorkspaceEvents(container, state);
    } catch (err) {
        console.error('[Franken-Swipe] Failed to render workspace:', err);
        container.innerHTML = `
            <div style="padding:24px; color:#ff8590;">
                <h3>Franken-Swipe Render Error</h3>
                <pre>${escapeHtml(err?.stack || err?.message || String(err))}</pre>
                <button type="button" class="fs-mini-btn" onclick="document.getElementById('fs_modal_backdrop')?.remove()">Close</button>
            </div>
        `;
    }
}

/* ==========================================================================
   Workspace Event Binding & Interactive Handlers
   ========================================================================== */

function bindWorkspaceEvents(container, state) {
    container.querySelector('#fs_close_modal_btn')?.addEventListener('click', closeWorkspaceModal);

    container.querySelectorAll('[data-granularity]').forEach(btn => {
        btn.addEventListener('click', () => {
            const newGranularity = btn.getAttribute('data-granularity');
            if (newGranularity && newGranularity !== state.granularity) {
                state.granularity = newGranularity;
                rebuildParsedSwipes(state);
                renderWorkspace();
            }
        });
    });

    container.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const newView = btn.getAttribute('data-view');
            if (newView && newView !== state.viewMode) {
                state.viewMode = newView;
                renderWorkspace();
            }
        });
    });

    container.querySelector('#fs_toggle_dim_btn')?.addEventListener('click', () => {
        state.dimDuplicates = !state.dimDuplicates;
        renderWorkspace();
    });

    container.querySelector('#fs_toggle_collapse_btn')?.addEventListener('click', () => {
        state.collapseDuplicates = !state.collapseDuplicates;
        renderWorkspace();
    });

    container.querySelectorAll('.fs-swipe-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const idx = Number(pill.getAttribute('data-swipe-index'));
            if (state.hiddenSwipes.has(idx)) {
                state.hiddenSwipes.delete(idx);
            } else {
                state.hiddenSwipes.add(idx);
            }
            renderWorkspace();
        });
    });

    container.querySelector('#fs_show_all_swipes_btn')?.addEventListener('click', () => {
        state.hiddenSwipes.clear();
        renderWorkspace();
    });

    container.querySelectorAll('.fs-hide-swipe-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-swipe-index'));
            state.hiddenSwipes.add(idx);
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-use-base-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-swipe-index'));
            loadSwipeAsBase(state, idx);
        });
    });

    container.querySelectorAll('.fs-block-card[data-swipe-index][data-block-index]').forEach(card => {
        card.addEventListener('click', () => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
                return;
            }
            const sIdx = Number(card.getAttribute('data-swipe-index'));
            const bIdx = Number(card.getAttribute('data-block-index'));
            const blk = state.parsedSwipes[sIdx]?.blocks?.[bIdx];
            if (!blk) return;

            if (card.classList.contains('collapsed')) {
                card.classList.remove('collapsed');
                return;
            }

            addBlockToDraft(state, blk);
        });
    });

    container.querySelector('#fs_diff_left_select')?.addEventListener('change', (e) => {
        state.diffLeftSource = e.target.value;
        renderWorkspace();
    });

    container.querySelector('#fs_diff_right_select')?.addEventListener('change', (e) => {
        state.diffRightSource = e.target.value;
        renderWorkspace();
    });

    container.querySelector('#fs_diff_swap_btn')?.addEventListener('click', () => {
        const tmp = state.diffLeftSource;
        state.diffLeftSource = state.diffRightSource;
        state.diffRightSource = tmp;
        renderWorkspace();
    });

    container.querySelectorAll('.fs-block-card[data-diff-side]').forEach(card => {
        card.addEventListener('click', () => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
                return;
            }
            const side = card.getAttribute('data-diff-side');
            const idx = Number(card.getAttribute('data-diff-index'));
            const sourceKey = side === 'left' ? state.diffLeftSource : state.diffRightSource;
            const blocks = getDiffSourceBlocks(state, sourceKey);
            const blk = blocks[idx];
            if (blk) {
                addBlockToDraft(state, blk);
            }
        });
    });

    container.querySelector('#fs_grab_selection_btn')?.addEventListener('click', () => {
        addCurrentHighlightedSelectionToDraft();
    });

    container.querySelector('#fs_undo_btn')?.addEventListener('click', () => performUndo(state));
    container.querySelector('#fs_redo_btn')?.addEventListener('click', () => performRedo(state));

    container.querySelector('#fs_toggle_raw_btn')?.addEventListener('click', () => {
        pushUndoSnapshot(state);
        if (!state.rawEditorMode) {
            state.rawText = assembleDraftText(state);
            state.rawEditorMode = true;
        } else {
            const paragraphs = splitSwipeText(state.rawText, 'paragraphs');
            state.draftBlocks = paragraphs.map((p) => ({
                id: nextBlockId(),
                swipeIndex: -1,
                sourceBlockIndex: null,
                customLabel: 'Edited Draft',
                text: p.text,
                kind: 'paragraph',
                joinAfter: '\n\n',
                edited: true,
                norm: p.norm,
            }));
            state.rawEditorMode = false;
        }
        renderWorkspace();
    });

    container.querySelector('#fs_load_base_select')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val !== '') {
            loadSwipeAsBase(state, Number(val));
        }
    });

    container.querySelector('#fs_empty_load_active_btn')?.addEventListener('click', () => {
        loadSwipeAsBase(state, state.activeSwipeIndex);
    });

    container.querySelector('#fs_add_custom_block_btn')?.addEventListener('click', () => {
        addBlockToDraft(state, {
            swipeIndex: -1,
            blockIndex: null,
            text: '',
            kind: 'paragraph',
            joinAfter: '\n\n',
        }, 'Custom');
    });

    container.querySelector('#fs_clear_draft_btn')?.addEventListener('click', () => {
        pushUndoSnapshot(state);
        state.draftBlocks = [];
        state.rawText = '';
        state.replaceTargetId = null;
        renderWorkspace();
    });

    container.querySelector('#fs_cancel_replace_btn')?.addEventListener('click', () => {
        state.replaceTargetId = null;
        renderWorkspace();
    });

    const rawEditor = container.querySelector('#fs_raw_editor');
    if (rawEditor) {
        rawEditor.addEventListener('input', () => {
            state.rawText = rawEditor.value;
            updateFooterStatsOnly(container, state);
        });
    }

    container.querySelectorAll('.fs-target-replace-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-draft-id');
            state.replaceTargetId = state.replaceTargetId === id ? null : id;
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-move-up-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            if (idx > 0) {
                pushUndoSnapshot(state);
                const tmp = state.draftBlocks[idx - 1];
                state.draftBlocks[idx - 1] = state.draftBlocks[idx];
                state.draftBlocks[idx] = tmp;
                state.rawText = assembleDraftText(state);
                renderWorkspace();
            }
        });
    });

    container.querySelectorAll('.fs-move-down-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            if (idx < state.draftBlocks.length - 1) {
                pushUndoSnapshot(state);
                const tmp = state.draftBlocks[idx + 1];
                state.draftBlocks[idx + 1] = state.draftBlocks[idx];
                state.draftBlocks[idx] = tmp;
                state.rawText = assembleDraftText(state);
                renderWorkspace();
            }
        });
    });

    container.querySelectorAll('.fs-split-block-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            const blk = state.draftBlocks[idx];
            if (!blk) return;

            let subParts = splitParagraphIntoSentences(blk.text);
            let joiner = ' ';
            if (subParts.length <= 1 && blk.text.includes('\n')) {
                subParts = blk.text.split(/\n+/).map(s => s.trim()).filter(Boolean);
                joiner = '\n';
            }
            if (subParts.length <= 1) {
                notify('info', 'This block cannot be split further automatically.');
                return;
            }

            pushUndoSnapshot(state);
            const newBlocks = subParts.map((part, pIdx) => ({
                id: nextBlockId(),
                swipeIndex: blk.swipeIndex,
                sourceBlockIndex: null,
                customLabel: blk.customLabel,
                text: part,
                kind: 'sentence',
                joinAfter: pIdx === subParts.length - 1 ? blk.joinAfter : joiner,
                edited: true,
                norm: normalizeForComparison(part),
            }));
            state.draftBlocks.splice(idx, 1, ...newBlocks);
            state.rawText = assembleDraftText(state);
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-delete-block-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            pushUndoSnapshot(state);
            const removed = state.draftBlocks.splice(idx, 1)[0];
            if (removed && state.replaceTargetId === removed.id) {
                state.replaceTargetId = null;
            }
            state.rawText = assembleDraftText(state);
            if (!state.reasoningManuallyEdited) {
                state.customReasoningText = computeResolvedReasoning(state);
            }
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-cycle-joiner-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            const blk = state.draftBlocks[idx];
            if (!blk) return;
            const order = ['\n\n', '\n', ' '];
            const nextIdx = (order.indexOf(blk.joinAfter) + 1) % order.length;
            blk.joinAfter = order[nextIdx];
            state.rawText = assembleDraftText(state);
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-merge-down-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            if (idx < 0 || idx >= state.draftBlocks.length - 1) return;
            pushUndoSnapshot(state);

            const current = state.draftBlocks[idx];
            const next = state.draftBlocks[idx + 1];
            const glue = current.joinAfter === '\n\n' ? ' ' : (current.joinAfter || ' ');
            const mergedLabel = current.swipeIndex === next.swipeIndex && current.swipeIndex >= 0
                ? `Swipe #${current.swipeIndex + 1}`
                : 'Merged';

            current.text = `${current.text.trim()}${glue}${next.text.trim()}`;
            current.joinAfter = next.joinAfter;
            current.customLabel = mergedLabel;
            current.edited = true;
            current.norm = normalizeForComparison(current.text);

            state.draftBlocks.splice(idx + 1, 1);
            state.rawText = assembleDraftText(state);
            renderWorkspace();
        });
    });

    container.querySelectorAll('.fs-draft-editor-input').forEach(textarea => {
        textarea.addEventListener('input', () => {
            const idx = Number(textarea.getAttribute('data-index'));
            const blk = state.draftBlocks[idx];
            if (!blk) return;
            blk.text = textarea.value;
            blk.edited = true;
            blk.norm = normalizeForComparison(blk.text);
            state.rawText = assembleDraftText(state);
            updateFooterStatsOnly(container, state);
        });
    });

    container.querySelectorAll('.fs-draft-block').forEach(blockEl => {
        blockEl.addEventListener('dragstart', (e) => {
            if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
                e.preventDefault();
                return;
            }
            state.dragSourceIndex = Number(blockEl.getAttribute('data-draft-index'));
            blockEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        blockEl.addEventListener('dragend', () => {
            blockEl.classList.remove('dragging');
            state.dragSourceIndex = null;
        });

        blockEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        blockEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetIndex = Number(blockEl.getAttribute('data-draft-index'));
            const fromIndex = state.dragSourceIndex;
            if (fromIndex === null || fromIndex === targetIndex || isNaN(fromIndex) || isNaN(targetIndex)) {
                return;
            }
            pushUndoSnapshot(state);
            const [moved] = state.draftBlocks.splice(fromIndex, 1);
            state.draftBlocks.splice(targetIndex, 0, moved);
            state.dragSourceIndex = null;
            state.rawText = assembleDraftText(state);
            renderWorkspace();
        });
    });

    container.querySelector('#fs_reasoning_mode_select')?.addEventListener('change', (e) => {
        state.reasoningMode = e.target.value;
        state.reasoningManuallyEdited = false;
        state.customReasoningText = computeResolvedReasoning(state);
        renderWorkspace();
    });

    container.querySelector('#fs_toggle_reasoning_preview_btn')?.addEventListener('click', () => {
        state.reasoningExpanded = !state.reasoningExpanded;
        renderWorkspace();
    });

    container.querySelector('#fs_reasoning_textarea')?.addEventListener('input', (e) => {
        state.reasoningManuallyEdited = true;
        state.customReasoningText = e.target.value;
    });

    container.querySelector('#fs_save_new_swipe_btn')?.addEventListener('click', () => {
        saveStitchedResult(state, 'new_swipe');
    });

    container.querySelector('#fs_save_overwrite_btn')?.addEventListener('click', () => {
        saveStitchedResult(state, 'overwrite');
    });

    container.querySelector('#fs_save_cleanup_btn')?.addEventListener('click', () => {
        saveStitchedResult(state, 'save_cleanup');
    });
}

function updateFooterStatsOnly(container, state) {
    const statsBar = container.querySelector('.fs-stats-bar');
    if (!statsBar) return;
    const assembled = assembleDraftText(state);
    const draftStats = countStats(assembled);
    const activeStats = countStats(state.swipes[state.activeSwipeIndex]?.bodyText || '');
    const wordDelta = draftStats.words - activeStats.words;
    const deltaFormatted = wordDelta >= 0 ? `+${wordDelta}` : `${wordDelta}`;

    statsBar.innerHTML = `
        <span class="fs-stat-item">Words: <b>${draftStats.words}</b> <small>(${deltaFormatted} vs active)</small></span>
        <span>&bull;</span>
        <span class="fs-stat-item">Chars: <b>${draftStats.chars}</b></span>
        <span>&bull;</span>
        <span class="fs-stat-item">Est. Tokens: <b>~${draftStats.estTokens}</b></span>
        <span>&bull;</span>
        <span class="fs-stat-item">Blocks: <b>${state.draftBlocks.length}</b></span>
    `;

    const isEmpty = draftStats.chars === 0;
    container.querySelectorAll('.fs-save-btn').forEach(btn => {
        btn.disabled = isEmpty;
    });
}

/* ==========================================================================
   Freehand Text Selection Popover & Snippet Grabber
   ========================================================================== */

let pendingSelectionData = null;

function removeSelectionPopover() {
    const existing = document.getElementById('fs_selection_popover');
    if (existing) existing.remove();
    pendingSelectionData = null;
}

function handleFreehandSelectionChange() {
    if (!workspaceState) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        removeSelectionPopover();
        return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
        removeSelectionPopover();
        return;
    }

    const anchorEl = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;

    const comparisonScroll = document.getElementById('fs_comparison_scroll');
    if (!anchorEl || !comparisonScroll || !comparisonScroll.contains(anchorEl)) {
        removeSelectionPopover();
        return;
    }

    const blockCard = anchorEl.closest('.fs-block-card');
    const swipeIndexAttr = blockCard?.getAttribute('data-swipe-index');
    const swipeIndex = swipeIndexAttr !== null && swipeIndexAttr !== undefined ? Number(swipeIndexAttr) : -1;

    pendingSelectionData = {
        text: selectedText,
        swipeIndex: isNaN(swipeIndex) ? -1 : swipeIndex,
    };

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    let popover = document.getElementById('fs_selection_popover');
    if (!popover) {
        popover = document.createElement('div');
        popover.id = 'fs_selection_popover';
        popover.className = 'fs-selection-popover';
        popover.innerHTML = `
            <button type="button" id="fs_popover_add_btn" class="fs-mini-btn accent">
                <i class="fa-solid fa-plus"></i> Add Selection to Draft
            </button>
        `;
        document.body.appendChild(popover);

        popover.querySelector('#fs_popover_add_btn')?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addCurrentHighlightedSelectionToDraft();
        });
    }

    const top = Math.max(12, rect.top - 42);
    const left = Math.min(window.innerWidth - 220, Math.max(12, rect.left + rect.width / 2 - 85));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}

function addCurrentHighlightedSelectionToDraft() {
    if (!workspaceState) return;

    let text = pendingSelectionData?.text || '';
    let swipeIndex = pendingSelectionData?.swipeIndex ?? -1;

    if (!text) {
        const sel = window.getSelection();
        text = sel ? sel.toString().trim() : '';
    }

    if (!text) {
        notify('info', 'Highlight any word, sentence, or phrase inside a donor swipe first.');
        return;
    }

    const label = swipeIndex >= 0 ? `Selection (#${swipeIndex + 1})` : 'Selection';
    addBlockToDraft(workspaceState, {
        swipeIndex,
        blockIndex: null,
        text,
        kind: 'selection',
        joinAfter: ' ',
    }, label);

    window.getSelection()?.removeAllRanges();
    removeSelectionPopover();
}

/* ==========================================================================
   Saving Stitched Result Back to SillyTavern Chat
   ========================================================================== */

async function saveStitchedResult(state, saveMode) {
    const context = getContext();
    const msg = context.chat?.[state.messageId];
    if (!msg) {
        notify('error', 'Target message no longer exists in chat.');
        return;
    }

    const stitchedBody = assembleDraftText(state).trim();
    if (!stitchedBody) {
        notify('warning', 'Cannot save an empty draft.');
        return;
    }

    const resolvedReasoning = (state.reasoningManuallyEdited
        ? state.customReasoningText
        : computeResolvedReasoning(state)).trim();

    const primaryDonorIdx = getPrimaryDonorIndex(state);
    const donorData = state.swipes[primaryDonorIdx] || state.swipes[state.activeSwipeIndex] || {};

    let finalSwipeText = stitchedBody;
    if (resolvedReasoning && donorData.inlineTag && !donorData.hasMetadataReasoning) {
        finalSwipeText = `<${donorData.inlineTag}>\n${resolvedReasoning}\n</${donorData.inlineTag}>\n\n${stitchedBody}`;
    }

    if (!Array.isArray(msg.swipes)) {
        msg.swipes = [msg.mes || ''];
    }
    if (!Array.isArray(msg.swipe_info)) {
        msg.swipe_info = [];
    }
    while (msg.swipe_info.length < msg.swipes.length) {
        msg.swipe_info.push({
            send_date: msg.send_date,
            gen_started: msg.gen_started,
            gen_finished: msg.gen_finished,
            extra: safeClone(msg.extra || {}),
        });
    }

    const nowIso = new Date().toISOString();
    const baseExtra = safeClone(donorData.extra || msg.extra || {});
    delete baseExtra.display_text;

    if (resolvedReasoning) {
        baseExtra.reasoning = resolvedReasoning;
        if (!baseExtra.reasoning_type) {
            baseExtra.reasoning_type = 'edited';
        }
    } else {
        delete baseExtra.reasoning;
        delete baseExtra.reasoning_duration;
        delete baseExtra.reasoning_signature;
    }

    const newSwipeInfoEntry = {
        send_date: msg.send_date || nowIso,
        gen_started: msg.gen_started || nowIso,
        gen_finished: nowIso,
        extra: baseExtra,
    };

    let targetSwipeId = 0;

    if (saveMode === 'new_swipe') {
        msg.swipes.push(finalSwipeText);
        msg.swipe_info.push(newSwipeInfoEntry);
        targetSwipeId = msg.swipes.length - 1;
    } else if (saveMode === 'overwrite') {
        targetSwipeId = Math.min(Math.max(0, state.activeSwipeIndex), msg.swipes.length - 1);
        msg.swipes[targetSwipeId] = finalSwipeText;
        msg.swipe_info[targetSwipeId] = newSwipeInfoEntry;
    } else if (saveMode === 'save_cleanup') {
        msg.swipes = [finalSwipeText];
        msg.swipe_info = [newSwipeInfoEntry];
        targetSwipeId = 0;
    }

    msg.swipe_id = targetSwipeId;
    msg.mes = finalSwipeText;
    msg.extra = Object.assign({}, msg.extra || {}, safeClone(baseExtra));
    delete msg.extra.display_text;

    if (!resolvedReasoning && msg.extra) {
        delete msg.extra.reasoning;
    }

    if (typeof context.updateMessageBlock === 'function') {
        context.updateMessageBlock(state.messageId, msg, { rerenderMessage: true });
    }

    const mesEl = document.querySelector(`#chat .mes[mesid="${state.messageId}"]`);
    if (mesEl) {
        mesEl.setAttribute('swipeid', String(msg.swipe_id));
        const counterEl = mesEl.querySelector('.swipes-counter');
        if (counterEl) {
            counterEl.textContent = `${msg.swipe_id + 1}\u200b/\u200b${msg.swipes.length}`;
        }
    }

    if (context.eventSource && context.event_types) {
        if (context.event_types.MESSAGE_SWIPED) {
            await context.eventSource.emit(context.event_types.MESSAGE_SWIPED, state.messageId);
        }
        if (context.event_types.MESSAGE_UPDATED) {
            await context.eventSource.emit(context.event_types.MESSAGE_UPDATED, state.messageId);
        }
    }

    if (typeof context.saveChatConditional === 'function') {
        await context.saveChatConditional();
    } else if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }

    decorateAllChatMessages(true);
    closeWorkspaceModal();

    if (saveMode === 'new_swipe') {
        notify('success', `Saved stitched response as Swipe #${targetSwipeId + 1}!`);
    } else if (saveMode === 'overwrite') {
        notify('success', `Overwrote Swipe #${targetSwipeId + 1} with stitched response!`);
    } else {
        notify('success', 'Saved stitched response and cleaned up unused donor swipes!');
    }
}

/* ==========================================================================
   Chat UI Trigger Buttons (Swipe Controls Footer Bar & Message Action Menu)
   ========================================================================== */

function decorateMessageElement(mesEl, forceRebuild = false) {
    if (!(mesEl instanceof HTMLElement)) return;
    const mesIdAttr = mesEl.getAttribute('mesid');
    if (mesIdAttr === null) return;
    const mesId = Number(mesIdAttr);

    const { chat } = getContext();
    const msg = chat?.[mesId];
    const placement = getSettings().buttonPlacement || 'both';
    const swipeCount = Array.isArray(msg?.swipes) ? msg.swipes.length : 0;

    if (!msg || swipeCount < 2 || placement === 'none') {
        mesEl.querySelectorAll('.fs-mes-action-btn, .fs-swipe-bar, .fs-swipe-trigger-btn').forEach(el => el.remove());
        return;
    }

    const currentSignature = `${placement}:${swipeCount}`;
    if (!forceRebuild && mesEl.getAttribute('data-fs-sig') === currentSignature) {
        const hasAction = Boolean(mesEl.querySelector('.fs-mes-action-btn'));
        const hasSwipeBar = Boolean(mesEl.querySelector('.fs-swipe-bar'));
        const needsAction = placement === 'both' || placement === 'action_menu';
        const needsSwipeBar = placement === 'both' || placement === 'swipe_controls';
        if (hasAction === needsAction && hasSwipeBar === needsSwipeBar) {
            return;
        }
    }

    mesEl.querySelectorAll('.fs-mes-action-btn, .fs-swipe-bar, .fs-swipe-trigger-btn').forEach(el => el.remove());
    mesEl.setAttribute('data-fs-sig', currentSignature);

    const triggerOpen = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dynamicMesId = Number(mesEl.getAttribute('mesid'));
        openFrankenSwipeWorkspace(isNaN(dynamicMesId) ? mesId : dynamicMesId);
    };

    // 1. Button inside Message Action Menu (.extraMesButtons / .mes_buttons)
    if (placement === 'both' || placement === 'action_menu') {
        const extraButtons = mesEl.querySelector('.extraMesButtons') || mesEl.querySelector('.mes_buttons');
        if (extraButtons) {
            const actionBtn = document.createElement('div');
            actionBtn.className = 'mes_button fa-solid fa-dna interactable fs-mes-action-btn';
            actionBtn.title = `Franken-Swipe: Compare & stitch ${swipeCount} swipes`;
            actionBtn.setAttribute('tabindex', '0');
            actionBtn.addEventListener('click', triggerOpen);
            extraButtons.prepend(actionBtn);
        }
    }

    // 2. Pill button inside its own clean right-aligned bar at the bottom of .mes_block
    //    (Never placed inside .swipe_right or .swipes-counter, so it never overlaps arrows or numbers)
    if (placement === 'both' || placement === 'swipe_controls') {
        const mesBlock = mesEl.querySelector('.mes_block');
        if (mesBlock) {
            const swipeBar = document.createElement('div');
            swipeBar.className = 'fs-swipe-bar';

            const pillBtn = document.createElement('button');
            pillBtn.type = 'button';
            pillBtn.className = 'fs-swipe-trigger-btn interactable';
            pillBtn.title = `Open Franken-Swipe (${swipeCount} swipes available)`;
            pillBtn.innerHTML = `<i class="fa-solid fa-dna"></i><span>Stitch (${swipeCount})</span>`;
            pillBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            pillBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
            pillBtn.addEventListener('click', triggerOpen);

            swipeBar.appendChild(pillBtn);
            mesBlock.appendChild(swipeBar);
        }
    }
}

export function decorateAllChatMessages(forceRebuild = false) {
    const messages = document.querySelectorAll('#chat .mes');
    messages.forEach(mesEl => decorateMessageElement(mesEl, forceRebuild));
}

function scheduleDecorateChatMessages(forceRebuild = false) {
    if (decorateDebounceTimer) {
        clearTimeout(decorateDebounceTimer);
    }
    decorateDebounceTimer = setTimeout(() => {
        decorateDebounceTimer = null;
        decorateAllChatMessages(forceRebuild);
    }, 80);
}

/* ==========================================================================
   Keyboard Shortcuts & Slash Command Registration
   ========================================================================== */

function formatKeyEventCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    const ignoredCodes = new Set([
        'ControlLeft', 'ControlRight',
        'ShiftLeft', 'ShiftRight',
        'AltLeft', 'AltRight',
        'MetaLeft', 'MetaRight',
    ]);

    if (!ignoredCodes.has(e.code)) {
        parts.push(e.code || e.key.toUpperCase());
    }
    return parts.join('+');
}

function handleGlobalKeydown(e) {
    // 1. Hotkey Recorder in Settings
    if (isRecordingHotkey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
            isRecordingHotkey = false;
            updateHotkeyRecorderUI();
            return;
        }
        const combo = formatKeyEventCombo(e);
        if (!['Ctrl', 'Alt', 'Shift', 'Meta'].includes(combo.split('+').pop())) {
            const settings = getSettings();
            settings.hotkeyCombo = combo;
            saveSettings();
            isRecordingHotkey = false;
            updateHotkeyRecorderUI();
            notify('success', `Franken-Swipe shortcut set to ${combo}`);
        }
        return;
    }

    // 2. Inside Workspace Modal shortcuts (Escape, Ctrl+Z, Ctrl+Y)
    if (workspaceState) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeWorkspaceModal();
            return;
        }
        const activeTag = document.activeElement?.tagName;
        const inTextInput = activeTag === 'TEXTAREA' || activeTag === 'INPUT';
        if (!inTextInput && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
            e.preventDefault();
            performUndo(workspaceState);
            return;
        }
        if (!inTextInput && (e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
            e.preventDefault();
            performRedo(workspaceState);
            return;
        }
        return;
    }

    // 3. Global Hotkey Trigger to open Franken-Swipe on latest message
    const settings = getSettings();
    if (!settings.hotkeyEnabled || !settings.hotkeyCombo) return;

    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
        if (!e.altKey && !e.ctrlKey && !e.metaKey) return;
    }

    const pressedCombo = formatKeyEventCombo(e);
    if (pressedCombo.toLowerCase() === settings.hotkeyCombo.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        openOnLatestMultiSwipeMessage();
    }
}

function registerFrankenSwipeSlashCommands() {
    const context = getContext();
    const { SlashCommandParser, SlashCommand, ARGUMENT_TYPE, SlashCommandArgument } = context;

    const executeCallback = (_namedArgs, unnamedArgs) => {
        const argStr = String(unnamedArgs ?? '').trim();
        if (argStr !== '' && !isNaN(Number(argStr))) {
            openFrankenSwipeWorkspace(Number(argStr));
        } else {
            openOnLatestMultiSwipeMessage();
        }
        return '';
    };

    if (SlashCommandParser && SlashCommand && typeof SlashCommandParser.addCommandObject === 'function') {
        try {
            const unnamedArgList = (SlashCommandArgument && ARGUMENT_TYPE) ? [
                SlashCommandArgument.fromProps({
                    description: 'Optional message ID (defaults to latest message with 2+ swipes)',
                    typeList: [ARGUMENT_TYPE.NUMBER],
                    isRequired: false,
                }),
            ] : [];

            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: 'frankenswipe',
                aliases: ['fswipe', 'stitch'],
                callback: executeCallback,
                unnamedArgumentList: unnamedArgList,
                helpString: 'Opens the Franken-Swipe workspace to compare and stitch swipes together. Usage: /frankenswipe [messageId]',
            }));
            return;
        } catch (err) {
            console.warn('[Franken-Swipe] SlashCommandParser registration fallback:', err);
        }
    }

    if (typeof context.registerSlashCommand === 'function') {
        context.registerSlashCommand('frankenswipe', executeCallback, ['fswipe', 'stitch'], 'Opens the Franken-Swipe stitching workspace.');
    }
}

/* ==========================================================================
   Extension Settings Panel Initialization
   ========================================================================== */

function updateHotkeyRecorderUI() {
    const input = document.getElementById('fs_setting_hotkey');
    const btn = document.getElementById('fs_record_hotkey_btn');
    const settings = getSettings();
    if (input) {
        input.value = isRecordingHotkey ? 'Press key combo (Esc to cancel)...' : (settings.hotkeyCombo || 'Alt+KeyF');
    }
    if (btn) {
        btn.innerHTML = isRecordingHotkey
            ? '<i class="fa-solid fa-circle-stop"></i> Cancel'
            : '<i class="fa-solid fa-keyboard"></i> Record';
    }
}

async function initSettingsPanel() {
    if (document.getElementById('franken_swipe_settings')) return;

    let html = FALLBACK_SETTINGS_HTML;
    try {
        const response = await fetch(`${EXTENSION_FOLDER_URL}/settings.html`);
        if (response.ok) {
            html = await response.text();
        }
    } catch {
        // Fallback inline template is used seamlessly
    }

    const targetContainer = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!targetContainer) return;

    targetContainer.insertAdjacentHTML('beforeend', html);

    const settings = getSettings();

    const bindSelect = (id, key, onChangeExtra) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = settings[key];
        el.addEventListener('change', () => {
            settings[key] = el.value;
            saveSettings();
            if (onChangeExtra) onChangeExtra();
        });
    };

    const bindCheckbox = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = Boolean(settings[key]);
        el.addEventListener('change', () => {
            settings[key] = el.checked;
            saveSettings();
        });
    };

    bindSelect('fs_setting_button_placement', 'buttonPlacement', () => decorateAllChatMessages(true));
    bindSelect('fs_setting_default_granularity', 'defaultGranularity');
    bindSelect('fs_setting_default_view', 'defaultView');
    bindSelect('fs_setting_default_save_mode', 'defaultSaveMode');
    bindSelect('fs_setting_default_reasoning', 'defaultReasoning');

    bindCheckbox('fs_setting_dim_duplicates', 'dimDuplicates');
    bindCheckbox('fs_setting_collapse_duplicates', 'collapseDuplicates');
    bindCheckbox('fs_setting_auto_base_active', 'autoBaseActive');
    bindCheckbox('fs_setting_hotkey_enabled', 'hotkeyEnabled');

    updateHotkeyRecorderUI();

    document.getElementById('fs_record_hotkey_btn')?.addEventListener('click', () => {
        isRecordingHotkey = !isRecordingHotkey;
        updateHotkeyRecorderUI();
    });

    document.getElementById('fs_open_latest_btn')?.addEventListener('click', () => {
        openOnLatestMultiSwipeMessage();
    });
}

/* ==========================================================================
   Extension Lifecycle & Event Hooks
   ========================================================================== */

function setupChatObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    const observer = new MutationObserver((mutations) => {
        let shouldRefresh = false;
        for (const mutation of mutations) {
            // Ignore mutations caused by our own Franken-Swipe buttons
            const target = mutation.target;
            if (target instanceof HTMLElement && (
                target.classList.contains('fs-swipe-bar') ||
                target.classList.contains('fs-swipe-trigger-btn') ||
                target.classList.contains('fs-mes-action-btn')
            )) {
                continue;
            }
            if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
                shouldRefresh = true;
                break;
            }
        }
        if (shouldRefresh) {
            scheduleDecorateChatMessages(false);
        }
    });

    observer.observe(chatEl, { childList: true, subtree: true });
}

jQuery(async () => {
    const context = getContext();
    await initSettingsPanel();
    registerFrankenSwipeSlashCommands();
    document.addEventListener('keydown', handleGlobalKeydown, true);

    const refreshButtons = () => {
        scheduleDecorateChatMessages(false);
    };

    if (context.eventSource && context.event_types) {
        const et = context.event_types;
        const events = [
            et.APP_READY,
            et.CHAT_CHANGED,
            et.MESSAGE_RECEIVED,
            et.MESSAGE_SWIPED,
            et.MESSAGE_UPDATED,
            et.MESSAGE_EDITED,
            et.MESSAGE_DELETED,
            et.CHARACTER_MESSAGE_RENDERED,
            et.USER_MESSAGE_RENDERED,
            et.GENERATION_ENDED,
        ].filter(Boolean);

        for (const evt of events) {
            context.eventSource.on(evt, refreshButtons);
        }
    }

    setupChatObserver();
    scheduleDecorateChatMessages(true);
    console.log('[Franken-Swipe] Extension loaded and ready.');
});