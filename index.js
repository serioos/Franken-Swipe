/*
 * Franken-Swipe — SillyTavern third-party extension
 * Compare every swipe of a message and stitch the best parts into one new response.
 * Uses only the public SillyTavern.getContext() API (no relative imports), so it
 * works regardless of the folder name / install location.
 */
(() => {
    'use strict';

    const MODULE = 'franken_swipe';
    const NAME = 'Franken-Swipe';
    const DEFAULTS = {
        triggerLocation: 'both',      // menu | swipes | both | none
        granularity: 'paragraphs',    // paragraphs | lines | sentences | dialogue | freehand
        layout: 'rows',               // rows | columns | diff
        dupMode: 'dim',               // dim | collapse | off
        saveMode: 'new',              // new | overwrite | clean
        reasoningMode: 'primary',     // primary | active | combine | blank
        confirmOverwrite: true,
        hotkeyEnabled: true,
        hotkey: 'Alt+Shift+S',
    };

    /* ===================================================================
     * Pure helpers (splitting, similarity, diff) — exported for tests
     * =================================================================== */

    const SEGMENTER = (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null;

    const normKey = (t) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
    const wordsOf = (t) => (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
    const wordCount = (t) => (t.match(/\S+/g) || []).length;

    function splitSentences(par) {
        let raws;
        if (SEGMENTER) raws = Array.from(SEGMENTER.segment(par), s => s.segment);
        else raws = par.match(/[^.!?…]+(?:[.!?…]+["”’')\]*_]*|$)\s*/g) || [par];
        return raws.map(r => ({ text: r.trim(), sep: /\n\s*$/.test(r) ? '\n' : ' ' })).filter(x => x.text);
    }

    function splitDialogue(par) {
        const parts = [];
        const re = /“[^”]*”|"[^"]*"|[^"“”]+|["“”]/g;
        let m;
        while ((m = re.exec(par))) {
            const raw = m[0];
            const isDia = raw.length > 1 && /^["“]/.test(raw) && /["”]$/.test(raw);
            const type = isDia ? 'dialogue' : 'narration';
            const last = parts[parts.length - 1];
            if (last && last.kind === type) last.raw += raw; else parts.push({ raw, kind: type });
        }
        return parts.map(p => ({ text: p.raw.trim(), kind: p.kind, sep: ' ' })).filter(p => p.text);
    }

    /** Split text into selectable blocks: [{text, sep, kind?}] */
    function splitBlocks(text, gran) {
        const out = [];
        const t = String(text || '').replace(/\r\n?/g, '\n').trim();
        if (!t) return out;
        if (gran === 'freehand') return [{ text: t, sep: '\n\n' }];
        if (gran === 'lines') {
            let blankBefore = false;
            for (const line of t.split('\n')) {
                const s = line.trim();
                if (!s) { blankBefore = true; continue; }
                if (blankBefore && out.length) out[out.length - 1].sep = '\n\n';
                blankBefore = false;
                out.push({ text: s, sep: '\n' });
            }
            return out;
        }
        const paras = t.split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean);
        if (gran === 'paragraphs') return paras.map(p => ({ text: p, sep: '\n\n' }));
        for (const p of paras) {
            const pieces = gran === 'sentences' ? splitSentences(p) : splitDialogue(p);
            pieces.forEach((pc, i) => { if (i === pieces.length - 1) pc.sep = '\n\n'; out.push(pc); });
        }
        return out;
    }

    function shingles(t) {
        const w = wordsOf(t), set = new Set();
        if (w.length < 2) { w.forEach(x => set.add(x)); return set; }
        for (let i = 0; i < w.length - 1; i++) set.add(w[i] + ' ' + w[i + 1]);
        return set;
    }
    function jaccard(a, b) {
        if (!a.size && !b.size) return 1;
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        return inter / (a.size + b.size - inter);
    }

    function lcsDiff(a, b, same) {
        let s = 0;
        while (s < a.length && s < b.length && same(a[s], b[s])) s++;
        let ea = a.length, eb = b.length;
        while (ea > s && eb > s && same(a[ea - 1], b[eb - 1])) { ea--; eb--; }
        const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
        const ops = [];
        for (let i = 0; i < s; i++) ops.push({ t: 'eq', a: a[i], b: b[i] });
        if (n * m > 4e6) {
            A.forEach(x => ops.push({ t: 'del', a: x }));
            B.forEach(x => ops.push({ t: 'ins', b: x }));
        } else {
            const w = m + 1, dp = new Uint16Array((n + 1) * w);
            for (let i = n - 1; i >= 0; i--) {
                for (let j = m - 1; j >= 0; j--) {
                    dp[i * w + j] = same(A[i], B[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
                }
            }
            let i = 0, j = 0;
            while (i < n && j < m) {
                if (same(A[i], B[j])) { ops.push({ t: 'eq', a: A[i], b: B[j] }); i++; j++; }
                else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: 'del', a: A[i++] });
                else ops.push({ t: 'ins', b: B[j++] });
            }
            while (i < n) ops.push({ t: 'del', a: A[i++] });
            while (j < m) ops.push({ t: 'ins', b: B[j++] });
        }
        for (let i = ea; i < a.length; i++) ops.push({ t: 'eq', a: a[i], b: b[eb + (i - ea)] });
        return ops;
    }

    const isWs = (x) => /^\s+$/.test(x);
    function diffWords(a, b) {
        let ta = a.match(/\s+|\S+/g) || [], tb = b.match(/\s+|\S+/g) || [];
        let same = (x, y) => (isWs(x) && isWs(y)) || x === y;
        if (ta.length * tb.length > 4e6) {
            ta = a.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [];
            tb = b.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [];
            same = (x, y) => x.trim() === y.trim();
        }
        return lcsDiff(ta, tb, same);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { splitBlocks, shingles, jaccard, diffWords, normKey, wordCount };
        return; // Node test environment: stop before touching the DOM
    }

    /* ===================================================================
     * SillyTavern glue
     * =================================================================== */

    const getCtx = () => SillyTavern.getContext();

    function getSettings() {
        const c = getCtx();
        if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = {};
        const s = c.extensionSettings[MODULE];
        for (const k of Object.keys(DEFAULTS)) if (s[k] === undefined) s[k] = DEFAULTS[k];
        return s;
    }
    const persist = () => getCtx().saveSettingsDebounced();

    function h(tag, attrs = {}, kids = []) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'style') el.style.cssText = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of [].concat(kids)) {
            if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        }
        return el;
    }
    const icon = (cls) => h('i', { class: 'fa-solid ' + cls });
    const ibtn = (cls, title, onclick, extra = '') => h('button', { type: 'button', class: 'fs-ibtn ' + extra, title, onclick }, [icon(cls)]);
    function sel(opts, value, onchange, cls = '') {
        const s = h('select', { class: 'fs-select text_pole ' + cls });
        for (const [v, l] of opts) {
            const o = h('option', { value: v, text: l });
            if (String(v) === String(value)) o.selected = true;
            s.append(o);
        }
        s.addEventListener('change', () => onchange(s.value));
        return s;
    }
    const color = (i) => `hsl(${(i * 57 + 10) % 360} 65% 55%)`;
    let uidN = 0;
    const uid = () => 'fb' + (++uidN) + Date.now().toString(36);

    async function confirmDlg(text) {
        const c = getCtx();
        try {
            if (c.callGenericPopup && c.POPUP_TYPE) return !!(await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM));
        } catch { /* fall through */ }
        return window.confirm(text);
    }

    const getExtra = (mes, i) => (i === mes.swipe_id ? (mes.extra || {}) : (mes.swipe_info?.[i]?.extra || {}));

    /* ===================================================================
     * Workspace state
     * =================================================================== */
    let S = null;         // state
    let overlay = null;   // root element
    let els = {};         // cached element refs
    let selTimer = null;
    let pendingSel = null;

    const visibleSwipes = () => S.swipes.filter(s => !s.hidden);

    function openLatest(forcedId = null) {
        const c = getCtx();
        if (!c.chat?.length) return toastr.info('No messages in this chat.', NAME);
        const id = (forcedId != null && !Number.isNaN(forcedId)) ? forcedId : c.chat.length - 1;
        openWorkspace(id);
    }

    function openWorkspace(mesId) {
        const c = getCtx();
        const mes = c.chat[mesId];
        if (!mes) return toastr.warning('Message not found.', NAME);
        if (!Array.isArray(mes.swipes) || mes.swipes.length < 2) {
            return toastr.info(`Message #${mesId} needs at least two swipes.`, NAME);
        }
        if (overlay) closeWorkspace(true);
        const st = getSettings();
        const swipes = mes.swipes.map((text, i) => {
            const ex = getExtra(mes, i);
            return { idx: i, text: String(text ?? ''), reasoning: String(ex.reasoning || ''), extra: ex, hidden: false, sh: null, sim: null, cache: null };
        });
        const cur = mes.swipe_id ?? 0;
        const other = swipes.find(s => s.idx !== cur);
        S = {
            mesId, mes, swipes, gran: st.granularity, layout: st.layout, dup: st.dupMode,
            draft: [], sel: null, raw: false, rawText: '', rawBase: '', undo: [], dirty: false,
            diffA: String(cur), diffB: String(other ? other.idx : cur),
            primary: 'auto', saveMode: st.saveMode, reasoningMode: st.reasoningMode, target: cur,
        };
        buildOverlay();
        computeSims();
        renderToolbar(); renderSource(); renderDraft(); renderFoot();
    }

    async function closeWorkspace(force = false) {
        if (!overlay) return;
        if (!force && S?.dirty && joinDraft().trim()) {
            if (!(await confirmDlg('Discard your stitched draft?'))) return;
        }
        document.removeEventListener('selectionchange', onSelectionChange);
        overlay.remove(); overlay = null; els = {}; S = null; pendingSel = null;
    }

    /* ---------- draft model ---------- */
    function joinDraft() {
        if (S.raw) return S.rawText;
        return S.draft.map((b, i) => b.text + (i < S.draft.length - 1 ? b.sep : '')).join('');
    }
    function pushUndo() {
        S.undo.push(JSON.stringify(S.draft));
        if (S.undo.length > 60) S.undo.shift();
    }
    function undo() {
        if (S.raw) leaveRaw();
        const prev = S.undo.pop();
        if (!prev) return;
        S.draft = JSON.parse(prev); S.sel = null;
        renderDraft(); renderSource(); renderFoot();
    }
    function enterRaw() { S.rawText = joinDraft(); S.rawBase = S.rawText; S.raw = true; }
    function leaveRaw() {
        if (!S.raw) return;
        S.raw = false;
        if (S.rawText === S.rawBase) return; // untouched -> keep block structure
        pushUndo();
        const old = new Map(S.draft.map(d => [d.text.trim(), d]));
        S.draft = S.rawText.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean).map(p => {
            const o = old.get(p);
            return { id: uid(), text: p, sep: '\n\n', src: o?.src ?? null, srcs: o?.srcs ?? [], from: o?.from ?? null, kind: null };
        });
        S.sel = null;
    }
    function addBlock(b, afterId = null) {
        if (S.raw) { leaveRaw(); renderToolbar(); }
        pushUndo();
        const nb = {
            id: uid(), text: b.text, sep: b.sep || '\n\n', src: b.src ?? null,
            srcs: b.src != null ? [b.src] : [], from: b.from || null, kind: b.kind || null,
        };
        let pos = S.draft.length;
        const ref = afterId ?? S.sel;
        const ri = S.draft.findIndex(x => x.id === ref);
        if (ri >= 0) pos = ri + 1;
        S.draft.splice(pos, 0, nb);
        S.sel = nb.id; S.dirty = true;
        renderDraft(); renderSource(); renderFoot();
        els.draftBody.querySelector(`[data-id="${nb.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return nb;
    }
    function moveBlock(id, toIndex) {
        const from = S.draft.findIndex(d => d.id === id);
        if (from < 0 || toIndex < 0 || toIndex >= S.draft.length || from === toIndex) return;
        pushUndo();
        const [b] = S.draft.splice(from, 1);
        S.draft.splice(toIndex, 0, b);
        S.dirty = true; renderDraft();
    }
    function removeBlock(id) {
        pushUndo();
        S.draft = S.draft.filter(d => d.id !== id);
        if (S.sel === id) S.sel = null;
        S.dirty = true; renderDraft(); renderSource(); renderFoot();
    }
    function mergeNext(i) {
        const a = S.draft[i], b = S.draft[i + 1];
        if (!a || !b) return;
        pushUndo();
        a.text = a.text.replace(/\s+$/, '') + ' ' + b.text.replace(/^\s+/, '');
        a.sep = b.sep;
        a.srcs = [...new Set([...(a.srcs || []), ...(b.srcs || [])])];
        a.from = null; a.kind = null;
        S.draft.splice(i + 1, 1);
        S.dirty = true; renderDraft(); renderSource(); renderFoot();
    }
    async function useBase(idx) {
        if (S.draft.length && !(await confirmDlg(`Replace the current draft with all of swipe #${idx + 1}?`))) return;
        pushUndo();
        S.raw = false;
        const g = S.gran === 'freehand' ? 'paragraphs' : S.gran;
        S.draft = splitBlocks(S.swipes[idx].text, g).map((b, i) => ({
            id: uid(), text: b.text, sep: b.sep, src: idx, srcs: [idx], from: `${idx}|${g}|${i}`, kind: b.kind || null,
        }));
        S.sel = null; S.dirty = true;
        renderToolbar(); renderDraft(); renderSource(); renderFoot();
    }

    function donorWeights() {
        const w = {};
        for (const d of S.draft) {
            const srcs = d.srcs?.length ? d.srcs : (d.src != null ? [d.src] : []);
            for (const i of srcs) w[i] = (w[i] || 0) + d.text.length / srcs.length;
        }
        return w;
    }
    function primaryDonor() {
        if (S.primary !== 'auto') return +S.primary;
        const w = donorWeights();
        let best = null, bv = -1;
        for (const k of Object.keys(w)) if (w[k] > bv) { bv = w[k]; best = +k; }
        return best ?? S.mes.swipe_id;
    }

    /* ---------- similarity & duplicates ---------- */
    function computeSims() {
        const vis = visibleSwipes();
        for (const s of S.swipes) if (!s.sh) s.sh = shingles(s.text);
        for (const s of S.swipes) {
            const others = vis.filter(o => o !== s);
            s.sim = others.length ? others.reduce((a, o) => a + jaccard(s.sh, o.sh), 0) / others.length : null;
        }
    }
    function blocksOf(sw) {
        if (!sw.cache || sw.cache.gran !== S.gran) sw.cache = { gran: S.gran, blocks: splitBlocks(sw.text, S.gran) };
        return sw.cache.blocks;
    }
    function computeDups(vis) {
        const keySets = new Map(vis.map(s => [s, new Set(blocksOf(s).map(b => normKey(b.text)))]));
        for (const s of vis) {
            for (const b of blocksOf(s)) {
                const k = normKey(b.text);
                b.dups = k ? vis.filter(o => o !== s && keySets.get(o).has(k)).length : 0;
            }
        }
    }

    /* ===================================================================
     * UI construction
     * =================================================================== */
    function buildOverlay() {
        els.title = h('div', { class: 'fs-title' });
        els.toolbar = h('div', { class: 'fs-toolbar' });
        els.source = h('div', { class: 'fs-source' });
        els.counter = h('span', { class: 'fs-counter' });
        els.undoBtn = ibtn('fa-rotate-left', 'Undo last draft change', undo);
        els.rawBtn = h('button', { type: 'button', class: 'fs-btn', onclick: toggleRaw }, [icon('fa-pen-to-square'), ' Raw edit']);
        els.draftBody = h('div', { class: 'fs-draft-body' });
        els.foot = h('div', { class: 'fs-draft-foot' });
        els.selBtn = h('button', { type: 'button', class: 'fs-selbtn', style: 'display:none' }, [icon('fa-plus'), ' Add selection']);
        els.selBtn.addEventListener('mousedown', e => e.preventDefault());
        els.selBtn.addEventListener('click', () => {
            if (!pendingSel) return;
            addBlock({ text: pendingSel.text, sep: ' ', src: pendingSel.src, from: null });
            window.getSelection()?.removeAllRanges();
            els.selBtn.style.display = 'none'; pendingSel = null;
        });

        const clearBtn = h('button', { type: 'button', class: 'fs-btn', onclick: async () => {
            if (!S.draft.length && !S.rawText) return;
            if (!(await confirmDlg('Clear the whole draft?'))) return;
            pushUndo(); S.draft = []; S.raw = false; S.rawText = ''; S.sel = null;
            renderToolbar(); renderDraft(); renderSource(); renderFoot();
        } }, [icon('fa-trash'), ' Clear']);

        overlay = h('div', { id: 'franken_swipe_overlay', class: 'fs-overlay' }, [
            h('div', { class: 'fs-window' }, [
                h('div', { class: 'fs-head' }, [els.title, ibtn('fa-xmark', 'Close (Esc)', () => closeWorkspace(), 'fs-close')]),
                els.toolbar,
                h('div', { class: 'fs-main' }, [
                    els.source,
                    h('div', { class: 'fs-draftpanel' }, [
                        h('div', { class: 'fs-draft-head' }, [
                            h('b', { text: 'Stitched draft' }), els.counter,
                            h('span', { class: 'fs-spacer' }), els.undoBtn, els.rawBtn, clearBtn,
                        ]),
                        els.draftBody, els.foot,
                    ]),
                ]),
                els.selBtn,
            ]),
        ]);
        const c = getCtx();
        const who = S.mes.name || c.name2 || 'message';
        els.title.append(icon('fa-puzzle-piece'), ` Franken-Swipe — #${S.mesId} · ${who} · ${S.swipes.length} swipes`);
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.dataset.bg = '1'; });
        overlay.addEventListener('click', e => { if (e.target === overlay && overlay.dataset.bg) closeWorkspace(); delete overlay.dataset.bg; });
        document.body.append(overlay);
        document.addEventListener('selectionchange', onSelectionChange);
    }

    function toggleRaw() {
        if (S.raw) leaveRaw(); else enterRaw();
        renderDraft(); renderSource(); renderFoot();
    }

    function renderToolbar() {
        const t = els.toolbar; t.replaceChildren();
        const diff = S.layout === 'diff';
        const gran = sel([['paragraphs', 'Paragraphs'], ['lines', 'Lines'], ['sentences', 'Sentences'], ['dialogue', 'Dialogue / narration'], ['freehand', 'Freehand (select text)']],
            S.gran, v => { S.gran = v; renderSource(); });
        gran.disabled = diff;
        const seg = h('div', { class: 'fs-seg' }, [['rows', 'Aligned rows', 'fa-table-list'], ['columns', 'Columns', 'fa-table-columns'], ['diff', 'Diff', 'fa-code-compare']]
            .map(([v, l, ic]) => h('button', { type: 'button', class: 'fs-segbtn' + (S.layout === v ? ' active' : ''), onclick: () => { S.layout = v; renderToolbar(); renderSource(); } }, [icon(ic), ' ', l])));
        const dup = sel([['dim', 'Dim duplicates'], ['collapse', 'Collapse duplicates'], ['off', 'Show duplicates']], S.dup, v => { S.dup = v; renderSource(); });
        dup.disabled = diff;
        const chips = h('div', { class: 'fs-chips' }, S.swipes.map(sw => h('button', {
            type: 'button', class: 'fs-chip' + (sw.hidden ? ' off' : ''), style: `--fs-c:${color(sw.idx)}`,
            title: 'Click to hide / show this swipe', onclick: () => { sw.hidden = !sw.hidden; computeSims(); renderToolbar(); renderSource(); },
        }, [h('span', { class: 'fs-dot' }), `#${sw.idx + 1}`, sw.idx === S.mes.swipe_id ? ' ★' : '',
            sw.sim != null && !sw.hidden ? h('small', { text: ` ${Math.round(sw.sim * 100)}%` }) : ''])));
        t.append(
            h('label', {}, ['Split by ', gran]), seg, h('label', {}, [dup]),
            h('span', { class: 'fs-spacer' }), h('span', { class: 'fs-muted', text: 'Swipes:' }), chips,
        );
    }

    function headerEl(sw) {
        const pct = sw.sim != null ? Math.round(sw.sim * 100) : null;
        return h('div', { class: 'fs-colhead', style: `--fs-c:${color(sw.idx)}` }, [
            h('span', { class: 'fs-dot' }),
            h('b', { text: `Swipe #${sw.idx + 1}` }),
            sw.idx === S.mes.swipe_id ? h('span', { class: 'fs-badge', text: 'current' }) : '',
            pct != null ? h('span', { class: 'fs-sim', title: `Average similarity to the other visible swipes: ${pct}%` }, [
                h('span', { class: 'fs-simbar' }, [h('span', { style: `width:${pct}%` })]), h('small', { text: pct + '%' }),
            ]) : '',
            h('span', { class: 'fs-spacer' }),
            h('small', { class: 'fs-muted', text: wordCount(sw.text) + 'w' }),
            ibtn('fa-layer-group', 'Use this whole swipe as the base of the draft', () => useBase(sw.idx)),
            ibtn('fa-eye-slash', 'Hide this swipe', () => { sw.hidden = true; computeSims(); renderToolbar(); renderSource(); }),
        ]);
    }

    function blockEl(sw, b, i) {
        const key = `${sw.idx}|${S.gran}|${i}`;
        const used = S.draft.some(d => d.from === key);
        const free = S.gran === 'freehand';
        const dupCls = S.dup !== 'off' && b.dups ? (S.dup === 'collapse' ? ' fs-dup fs-collapsed' : ' fs-dup') : '';
        const el = h('div', {
            class: 'fs-block' + dupCls + (used ? ' fs-used' : '') + (b.kind ? ' fs-' + b.kind : '') + (free ? ' fs-freehand' : ''),
            style: `--fs-c:${color(sw.idx)}`, dataset: { sw: sw.idx },
            title: free ? 'Select any text, then press “Add selection”' : (b.dups ? `Identical in ${b.dups} other swipe(s) — click to add` : 'Click to add to the draft'),
        }, [
            h('div', { class: 'fs-block-text', text: b.text }),
            !free ? h('span', { class: 'fs-addicon' }, [icon(used ? 'fa-check' : 'fa-plus')]) : '',
            S.dup !== 'off' && b.dups ? h('span', { class: 'fs-eq', text: '=×' + (b.dups + 1) }) : '',
            b.kind ? h('span', { class: 'fs-kind', text: b.kind === 'dialogue' ? '“ ”' : '✱' }) : '',
        ]);
        if (!free) {
            el.addEventListener('click', () => {
                if (String(window.getSelection() || '').trim()) return; // user is selecting text
                addBlock({ text: b.text, sep: b.sep, src: sw.idx, from: key, kind: b.kind });
            });
        }
        return el;
    }

    function renderSource() {
        const root = els.source;
        const scroll = root.scrollTop;
        root.replaceChildren();
        if (S.layout === 'diff') { renderDiff(root); return; }
        const vis = visibleSwipes();
        if (!vis.length) { root.append(h('div', { class: 'fs-empty-msg', text: 'All swipes are hidden. Use the chips above to show some.' })); return; }
        computeDups(vis);
        const grid = h('div', { class: 'fs-grid fs-' + S.layout, style: `--fs-cols:${vis.length}` });
        if (S.layout === 'rows') {
            vis.forEach(sw => grid.append(headerEl(sw)));
            const max = Math.max(...vis.map(s => blocksOf(s).length));
            for (let r = 0; r < max; r++) {
                vis.forEach(sw => {
                    const b = blocksOf(sw)[r];
                    grid.append(b ? blockEl(sw, b, r) : h('div', { class: 'fs-block fs-none' }));
                });
            }
        } else {
            vis.forEach(sw => {
                const col = h('div', { class: 'fs-col' }, [headerEl(sw)]);
                blocksOf(sw).forEach((b, i) => col.append(blockEl(sw, b, i)));
                grid.append(col);
            });
        }
        root.append(grid);
        root.scrollTop = scroll;
    }

    function textOfChoice(v) { return v === 'draft' ? joinDraft() : S.swipes[+v].text; }

    function runsFrag(ops, side) {
        const frag = document.createDocumentFragment();
        let cur = null, curType = null;
        const flush = () => { if (cur !== null) { frag.append(curType === 'eq' ? document.createTextNode(cur) : h('span', { class: curType === 'del' ? 'fs-del' : 'fs-ins', text: cur })); } cur = null; };
        for (const op of ops) {
            if (side === 'a' && op.t === 'ins') continue;
            if (side === 'b' && op.t === 'del') continue;
            const txt = side === 'a' ? op.a : op.b;
            if (op.t !== curType) { flush(); curType = op.t; cur = ''; }
            cur += txt;
        }
        flush();
        return frag;
    }

    function renderDiff(root) {
        const opts = [...S.swipes.map(s => [String(s.idx), `Swipe #${s.idx + 1}` + (s.idx === S.mes.swipe_id ? ' (current)' : '')]), ['draft', 'Current draft']];
        const ta = textOfChoice(S.diffA), tb = textOfChoice(S.diffB);
        const ops = diffWords(ta, tb);
        const removed = ops.filter(o => o.t === 'del' && !isWs(o.a)).length;
        const added = ops.filter(o => o.t === 'ins' && !isWs(o.b)).length;
        const sim = Math.round(jaccard(shingles(ta), shingles(tb)) * 100);
        const bar = h('div', { class: 'fs-diffbar' }, [
            'Compare ', sel(opts, S.diffA, v => { S.diffA = v; renderSource(); }),
            ibtn('fa-right-left', 'Swap sides', () => { [S.diffA, S.diffB] = [S.diffB, S.diffA]; renderSource(); }),
            ' with ', sel(opts, S.diffB, v => { S.diffB = v; renderSource(); }),
            h('span', { class: 'fs-spacer' }),
            h('span', { class: 'fs-muted', text: `${sim}% similar · ` }),
            h('span', { class: 'fs-del', text: `−${removed}` }), ' ', h('span', { class: 'fs-ins', text: `+${added}` }),
        ]);
        const pane = (v, label, side) => h('div', { class: 'fs-diffcol', style: `--fs-c:${v === 'draft' ? 'var(--SmartThemeBorderColor,#888)' : color(+v)}`, dataset: { sw: v === 'draft' ? '' : v } }, [
            h('div', { class: 'fs-colhead' }, [h('span', { class: 'fs-dot' }), h('b', { text: label }),
                v !== 'draft' ? ibtn('fa-layer-group', 'Use this whole swipe as the base of the draft', () => useBase(+v)) : '']),
            h('div', { class: 'fs-diffpane' }, [runsFrag(ops, side)]),
        ]);
        const label = v => v === 'draft' ? 'Current draft' : `Swipe #${+v + 1}`;
        root.append(bar, h('div', { class: 'fs-diffgrid' }, [pane(S.diffA, label(S.diffA) + '  (removed = red)', 'a'), pane(S.diffB, label(S.diffB) + '  (added = green)', 'b')]),
            h('div', { class: 'fs-muted fs-diffhint', text: 'Tip: highlight any words in either pane and press “Add selection” to grab them into your draft.' }));
    }

    /* ---------- draft panel ---------- */
    function autosize(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }

    function cardEl(d, i) {
        const srcs = d.srcs?.length ? d.srcs : (d.src != null ? [d.src] : []);
        const c = srcs.length ? color(srcs[0]) : 'var(--SmartThemeBorderColor,#888)';
        const ta = h('textarea', { class: 'fs-ta text_pole', rows: 1, spellcheck: 'true' });
        ta.value = d.text;
        ta.addEventListener('input', () => { d.text = ta.value; d.edited = true; S.dirty = true; autosize(ta); updateCounter(); });
        ta.addEventListener('focus', () => { S.sel = d.id; card.classList.add('fs-sel'); els.draftBody.querySelectorAll('.fs-card.fs-sel').forEach(x => { if (x !== card) x.classList.remove('fs-sel'); }); });
        const sepLabel = { ' ': '␣', '\n': '↵', '\n\n': '¶' };
        const sepTitle = { ' ': 'Joins to next block with a space', '\n': 'Joins to next block with a line break', '\n\n': 'Followed by a paragraph break' };
        const handle = h('span', { class: 'fs-handle', draggable: 'true', title: 'Drag to reorder' }, [icon('fa-grip-vertical')]);
        const card = h('div', { class: 'fs-card' + (S.sel === d.id ? ' fs-sel' : ''), style: `--fs-c:${c}`, dataset: { id: d.id } }, [
            h('div', { class: 'fs-cardbar' }, [
                handle,
                h('span', { class: 'fs-badge', style: `background:${c}`, text: srcs.length ? srcs.map(s => '#' + (s + 1)).join('+') : '✎ custom' }),
                d.kind ? h('small', { class: 'fs-muted', text: d.kind }) : '',
                d.edited ? h('small', { class: 'fs-muted', text: 'edited' }) : '',
                h('span', { class: 'fs-spacer' }),
                h('button', { type: 'button', class: 'fs-ibtn fs-sepbtn', title: (sepTitle[d.sep] || '') + ' (click to change)', onclick: () => {
                    d.sep = d.sep === ' ' ? '\n' : d.sep === '\n' ? '\n\n' : ' '; S.dirty = true; renderDraft();
                } }, [sepLabel[d.sep] || '¶']),
                ibtn('fa-arrow-up', 'Move up', () => moveBlock(d.id, i - 1)),
                ibtn('fa-arrow-down', 'Move down', () => moveBlock(d.id, i + 1)),
                ibtn('fa-down-left-and-up-right-to-center', 'Merge with the next block', () => mergeNext(i)),
                ibtn('fa-plus', 'Insert an empty custom block below', () => { const nb = addBlock({ text: '', sep: '\n\n' }, d.id); setTimeout(() => els.draftBody.querySelector(`[data-id="${nb.id}"] textarea`)?.focus(), 30); }),
                ibtn('fa-trash-can', 'Remove block', () => removeBlock(d.id), 'fs-danger'),
            ]),
            ta,
        ]);
        handle.addEventListener('dragstart', e => { S.dragId = d.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); try { e.dataTransfer.setDragImage(card, 10, 10); } catch { /* ignore */ } });
        handle.addEventListener('dragend', () => { S.dragId = null; els.draftBody.querySelectorAll('.fs-dragover').forEach(x => x.classList.remove('fs-dragover')); });
        card.addEventListener('dragover', e => { if (S.dragId) { e.preventDefault(); card.classList.add('fs-dragover'); } });
        card.addEventListener('dragleave', () => card.classList.remove('fs-dragover'));
        card.addEventListener('drop', e => { e.preventDefault(); card.classList.remove('fs-dragover'); if (S.dragId) moveBlock(S.dragId, i); S.dragId = null; });
        requestAnimationFrame(() => autosize(ta));
        return card;
    }

    function updateCounter() {
        const t = joinDraft();
        const vis = visibleSwipes();
        const avg = vis.length ? Math.round(vis.reduce((a, s) => a + wordCount(s.text), 0) / vis.length) : 0;
        els.counter.textContent = `${wordCount(t)} words · ${t.length} chars` + (avg ? ` · avg swipe ${avg}w` : '');
        els.undoBtn.disabled = !S.undo.length;
        els.rawBtn.classList.toggle('active', S.raw);
        els.rawBtn.replaceChildren(icon(S.raw ? 'fa-table-cells-large' : 'fa-pen-to-square'), S.raw ? ' Block view' : ' Raw edit');
    }

    function renderDraft() {
        const body = els.draftBody;
        const scroll = body.scrollTop;
        body.replaceChildren();
        if (S.raw) {
            const ta = h('textarea', { class: 'fs-raw text_pole', spellcheck: 'true' });
            ta.value = S.rawText;
            ta.addEventListener('input', () => { S.rawText = ta.value; S.dirty = true; updateCounter(); });
            body.append(ta);
        } else {
            if (!S.draft.length) {
                body.append(h('div', { class: 'fs-empty-msg' }, [
                    h('div', { text: 'Your draft is empty.' }),
                    h('div', { class: 'fs-muted', text: 'Click blocks on the left to add them, press the stack icon on a swipe header to start from a whole swipe, or highlight any text and use “Add selection”.' }),
                ]));
            }
            S.draft.forEach((d, i) => body.append(cardEl(d, i)));
            body.append(h('button', { type: 'button', class: 'fs-btn fs-addcustom', onclick: () => {
                const nb = addBlock({ text: '', sep: '\n\n' }, S.draft.at(-1)?.id ?? null);
                setTimeout(() => body.querySelector(`[data-id="${nb.id}"] textarea`)?.focus(), 30);
            } }, [icon('fa-plus'), ' Custom snippet']));
        }
        body.scrollTop = scroll;
        updateCounter();
    }

    function renderFoot() {
        const f = els.foot; f.replaceChildren();
        const labelled = (t, el) => h('label', { class: 'fs-lab' }, [h('span', { text: t }), el]);
        const mode = sel([['new', 'Save as new swipe'], ['overwrite', 'Overwrite a swipe'], ['clean', 'Save & clean up…']], S.saveMode, v => { S.saveMode = v; renderFoot(); });
        const row1 = h('div', { class: 'fs-footrow' }, [labelled('Save', mode)]);
        if (S.saveMode === 'overwrite') {
            row1.append(labelled('Target', sel(S.swipes.map(s => [String(s.idx), `Swipe #${s.idx + 1}` + (s.idx === S.mes.swipe_id ? ' (current)' : '')]), String(S.target), v => { S.target = +v; })));
        }
        const rsn = sel([['primary', 'Primary donor’s'], ['active', 'Active swipe’s'], ['combine', 'Combine donors’'], ['blank', 'Leave blank']], S.reasoningMode, v => { S.reasoningMode = v; renderFoot(); });
        const row2 = h('div', { class: 'fs-footrow' }, [labelled('Reasoning', rsn)]);
        if (S.reasoningMode === 'primary') {
            const auto = primaryDonor();
            const don = sel([['auto', `Auto (→ #${auto + 1})`], ...S.swipes.map(s => [String(s.idx), `Swipe #${s.idx + 1}`])], S.primary, v => { S.primary = v; renderFoot(); });
            row2.append(labelled('Primary donor', don));
        }
        const save = h('button', { type: 'button', class: 'fs-btn fs-save menu_button', onclick: doSave }, [icon('fa-floppy-disk'), ' Save stitched swipe']);
        const cancel = h('button', { type: 'button', class: 'fs-btn', onclick: () => closeWorkspace() }, 'Cancel');
        f.append(row1, row2, h('div', { class: 'fs-footrow fs-footbtns' }, [cancel, save]));
    }

    /* ---------- freehand selection grabber ---------- */
    function onSelectionChange() {
        clearTimeout(selTimer);
        selTimer = setTimeout(() => {
            if (!overlay) return;
            const sel = window.getSelection();
            const hide = () => { els.selBtn.style.display = 'none'; pendingSel = null; };
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
            const txt = sel.toString().trim();
            if (!txt) return hide();
            const node = sel.anchorNode;
            const host = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('.fs-block-text, .fs-diffpane');
            if (!host || !els.source.contains(host)) return hide();
            const swEl = host.closest('[data-sw]');
            const src = swEl && swEl.dataset.sw !== '' ? +swEl.dataset.sw : null;
            pendingSel = { text: txt, src };
            const r = sel.getRangeAt(0).getBoundingClientRect();
            const wr = els.selBtn.parentElement.getBoundingClientRect();
            els.selBtn.style.display = 'inline-flex';
            const bw = els.selBtn.offsetWidth || 120;
            els.selBtn.style.left = Math.max(4, Math.min(r.left - wr.left, wr.width - bw - 8)) + 'px';
            els.selBtn.style.top = Math.max(4, r.bottom - wr.top + 6) + 'px';
        }, 120);
    }

    /* ===================================================================
     * Saving
     * =================================================================== */
    function buildReasoning() {
        const pick = (i) => {
            const sw = S.swipes[i];
            if (!sw || !sw.reasoning.trim()) return null;
            return { reasoning: sw.reasoning, duration: sw.extra.reasoning_duration, type: sw.extra.reasoning_type };
        };
        switch (S.reasoningMode) {
            case 'blank': return null;
            case 'active': return pick(S.mes.swipe_id);
            case 'primary': return pick(primaryDonor());
            case 'combine': {
                const ids = Object.keys(donorWeights()).map(Number).sort((a, b) => a - b);
                const parts = ids.map(i => S.swipes[i].reasoning.trim()).filter(Boolean);
                return parts.length ? { reasoning: parts.join('\n\n---\n\n'), type: 'manual' } : null;
            }
            default: return null;
        }
    }

    function askCleanup() {
        return new Promise(resolve => {
            const used = new Set(Object.keys(donorWeights()).map(Number));
            const rows = S.swipes.map(s => {
                const cb = h('input', { type: 'checkbox' });
                cb.checked = !used.has(s.idx);
                const prev = s.text.replace(/\s+/g, ' ').slice(0, 90);
                return { s, cb, el: h('label', { class: 'fs-cleanrow', style: `--fs-c:${color(s.idx)}` }, [
                    cb, h('span', { class: 'fs-dot' }), h('b', { text: `#${s.idx + 1}` }),
                    used.has(s.idx) ? h('span', { class: 'fs-badge', text: 'used' }) : h('span', { class: 'fs-badge fs-badge-off', text: 'unused' }),
                    h('small', { class: 'fs-muted', text: prev + (s.text.length > 90 ? '…' : '') }),
                ]) };
            });
            const done = (v) => { modal.remove(); resolve(v); };
            const setAll = (fn) => rows.forEach(r => { r.cb.checked = fn(r.s); });
            const modal = h('div', { class: 'fs-modal' }, [h('div', { class: 'fs-modalbox' }, [
                h('h3', { text: 'Clean up donor swipes' }),
                h('div', { class: 'fs-muted', text: 'Checked swipes will be permanently deleted after your stitched swipe is saved. By default only swipes that contributed nothing to the draft are selected.' }),
                h('div', { class: 'fs-btnrow' }, [
                    h('button', { type: 'button', class: 'fs-btn', onclick: () => setAll(s => !used.has(s.idx)) }, 'Select unused'),
                    h('button', { type: 'button', class: 'fs-btn', onclick: () => setAll(() => true) }, 'Select all'),
                    h('button', { type: 'button', class: 'fs-btn', onclick: () => setAll(() => false) }, 'Select none'),
                ]),
                h('div', { class: 'fs-cleanlist' }, rows.map(r => r.el)),
                h('div', { class: 'fs-btnrow fs-end' }, [
                    h('button', { type: 'button', class: 'fs-btn', onclick: () => done(null) }, 'Back'),
                    h('button', { type: 'button', class: 'fs-btn menu_button fs-save', onclick: () => done(rows.filter(r => r.cb.checked).map(r => r.s.idx)) }, 'Save & delete selected'),
                ]),
            ])]);
            els.selBtn.parentElement.append(modal);
        });
    }

    async function doSave() {
        if (!S) return;
        const text = joinDraft().trim();
        if (!text) return toastr.warning('The draft is empty.', NAME);
        const c = getCtx();
        const mes = c.chat[S.mesId];
        if (mes !== S.mes || mes.swipes.length !== S.swipes.length) {
            return toastr.error('The message changed while the workspace was open. Close and reopen Franken-Swipe.', NAME);
        }
        if (S.saveMode === 'overwrite' && getSettings().confirmOverwrite &&
            !(await confirmDlg(`Overwrite swipe #${S.target + 1} with the stitched text?`))) return;
        let remove = [];
        if (S.saveMode === 'clean') {
            const r = await askCleanup();
            if (r === null) return;
            remove = r;
        }

        // 1) make sure swipe_info exists & the active swipe's extra is synced back
        mes.extra = mes.extra || {};
        if (!Array.isArray(mes.swipe_info)) mes.swipe_info = [];
        while (mes.swipe_info.length < mes.swipes.length) {
            mes.swipe_info.push({ send_date: mes.send_date, gen_started: mes.gen_started, gen_finished: mes.gen_finished, extra: {} });
        }
        mes.swipe_info[mes.swipe_id].extra = structuredClone(mes.extra);

        // 2) build the new extra (+ reasoning handling)
        const baseIdx = S.saveMode === 'overwrite' ? S.target : mes.swipe_id;
        const extra = structuredClone(mes.swipe_info[baseIdx]?.extra || {});
        for (const k of ['token_count', 'display_text', 'gen_id', 'reasoning', 'reasoning_duration', 'reasoning_type']) delete extra[k];
        const r = buildReasoning();
        if (r) {
            extra.reasoning = r.reasoning;
            if (r.duration != null) extra.reasoning_duration = r.duration;
            extra.reasoning_type = r.type || 'manual';
        }

        // 3) write the swipe
        let newIdx;
        const now = new Date().toISOString();
        if (S.saveMode === 'overwrite') {
            newIdx = S.target;
            mes.swipes[newIdx] = text;
            mes.swipe_info[newIdx] = { ...(mes.swipe_info[newIdx] || {}), extra };
        } else {
            mes.swipes.push(text);
            mes.swipe_info.push({ send_date: now, gen_started: null, gen_finished: null, extra });
            newIdx = mes.swipes.length - 1;
        }
        // 4) optional clean-up (never touches the stitched swipe)
        for (const i of [...remove].sort((a, b) => b - a)) {
            if (i === newIdx) continue;
            mes.swipes.splice(i, 1); mes.swipe_info.splice(i, 1);
            if (i < newIdx) newIdx--;
        }
        // 5) activate the stitched swipe
        mes.swipe_id = newIdx;
        mes.mes = mes.swipes[newIdx];
        mes.extra = structuredClone(mes.swipe_info[newIdx].extra || {});

        // 6) refresh UI + persist
        try {
            if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(S.mesId, mes);
            else if (typeof c.reloadCurrentChat === 'function') await c.reloadCurrentChat();
        } catch (e) { console.warn(`[${NAME}] updateMessageBlock failed`, e); }
        const mesEl = document.querySelector(`#chat .mes[mesid="${S.mesId}"]`);
        if (mesEl) {
            const counter = mesEl.querySelector('.swipes-counter');
            if (counter) counter.textContent = `${mes.swipe_id + 1}\u200b/\u200b${mes.swipes.length}`;
            const left = mesEl.querySelector('.swipe_left');
            if (left) left.style.display = 'flex';
        }
        await c.saveChat();
        try {
            const ev = c.eventTypes || c.event_types;
            if (ev?.MESSAGE_UPDATED) await c.eventSource.emit(ev.MESSAGE_UPDATED, S.mesId);
        } catch { /* ignore */ }

        const msg = S.saveMode === 'overwrite' ? `Swipe #${newIdx + 1} overwritten.` :
            (remove.length ? `Stitched swipe saved; ${remove.length} swipe(s) removed.` : 'Stitched swipe saved as a new swipe.');
        toastr.success(msg, NAME);
        closeWorkspace(true);
        scheduleInject();
    }

    /* ===================================================================
     * Triggers: buttons, slash command, hotkey
     * =================================================================== */
    function syncButton(host, cls, want, make) {
        const existing = host.querySelector('.' + cls);
        if (want && !existing) host.append(make());
        else if (!want && existing) existing.remove();
    }
    function injectButtons() {
        const c = getCtx();
        const loc = getSettings().triggerLocation;
        document.querySelectorAll('#chat .mes').forEach(el => {
            const m = c.chat?.[+el.getAttribute('mesid')];
            const ok = !!m && Array.isArray(m.swipes) && m.swipes.length >= 2;
            const menu = el.querySelector('.extraMesButtons');
            if (menu) syncButton(menu, 'fs-btn-menu', ok && (loc === 'menu' || loc === 'both'), () =>
                h('div', { class: 'mes_button fs-open-btn fs-btn-menu fa-solid fa-puzzle-piece interactable', title: 'Franken-Swipe: stitch swipes together', tabindex: '0', role: 'button' }));
            const sw = el.querySelector('.swipeRightBlock');
            if (sw) syncButton(sw, 'fs-btn-swipe', ok && (loc === 'swipes' || loc === 'both'), () =>
                h('div', { class: 'fs-open-btn fs-btn-swipe fa-solid fa-puzzle-piece interactable', title: 'Franken-Swipe: stitch swipes together', tabindex: '0', role: 'button' }));
        });
    }
    let injectTimer = null;
    function scheduleInject() { clearTimeout(injectTimer); injectTimer = setTimeout(injectButtons, 120); }

    function comboFrom(e) {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        let key = e.key;
        if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
        else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
        else if (key.length === 1) key = key.toUpperCase();
        else if (key === ' ') key = 'Space';
        parts.push(key);
        return parts.join('+');
    }

    function registerSlash() {
        const c = getCtx();
        const cb = async (_args, value) => {
            const v = String(value ?? '').trim();
            openLatest(v === '' ? null : parseInt(v, 10));
            return '';
        };
        try {
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                name: 'frankenswipe',
                aliases: ['franken', 'fswipe'],
                callback: cb,
                helpString: 'Open the Franken-Swipe workspace on the latest message, or on the message id you pass. Example: <code>/frankenswipe 12</code>',
                unnamedArgumentList: [c.SlashCommandArgument.fromProps({
                    description: 'message id (optional, defaults to the latest message)',
                    typeList: c.ARGUMENT_TYPE ? [c.ARGUMENT_TYPE.NUMBER] : [],
                    isRequired: false,
                })],
                returns: 'nothing',
            }));
        } catch (e) {
            console.warn(`[${NAME}] new slash API failed, trying legacy`, e);
            try { c.registerSlashCommand?.('frankenswipe', cb, ['franken', 'fswipe'], 'Open Franken-Swipe on the latest message', true, true); } catch { /* ignore */ }
        }
    }

    /* ===================================================================
     * Settings panel
     * =================================================================== */
    function settingsHtml() {
        const opt = (v, l) => `<option value="${v}">${l}</option>`;
        return `
<div class="franken-swipe-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🧟 Franken-Swipe</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="fs-set">
        <label>Trigger button location
          <select class="text_pole" data-fs="triggerLocation">
            ${opt('menu', 'Message action menu (•••)')}${opt('swipes', 'Next to swipe controls (last message)')}${opt('both', 'Both')}${opt('none', 'Hidden (slash command / hotkey only)')}
          </select></label>
        <label>Default split granularity
          <select class="text_pole" data-fs="granularity">
            ${opt('paragraphs', 'Paragraphs')}${opt('lines', 'Lines')}${opt('sentences', 'Sentences')}${opt('dialogue', 'Dialogue / narration')}${opt('freehand', 'Freehand (select text)')}
          </select></label>
        <label>Default layout
          <select class="text_pole" data-fs="layout">${opt('rows', 'Aligned rows')}${opt('columns', 'Columns')}${opt('diff', 'Visual diff')}</select></label>
        <label>Identical blocks
          <select class="text_pole" data-fs="dupMode">${opt('dim', 'Dim by default')}${opt('collapse', 'Collapse by default')}${opt('off', 'Show normally')}</select></label>
        <label>Default save behavior
          <select class="text_pole" data-fs="saveMode">${opt('new', 'Save as new swipe')}${opt('overwrite', 'Overwrite a swipe')}${opt('clean', 'Save & clean up donors')}</select></label>
        <label>Default reasoning handling
          <select class="text_pole" data-fs="reasoningMode">${opt('primary', 'Keep primary donor’s reasoning')}${opt('active', 'Keep active swipe’s reasoning')}${opt('combine', 'Combine donors’ reasoning')}${opt('blank', 'Leave blank')}</select></label>
        <label class="checkbox_label"><input type="checkbox" data-fs="confirmOverwrite"><span>Ask before overwriting a swipe</span></label>
        <label class="checkbox_label"><input type="checkbox" data-fs="hotkeyEnabled"><span>Enable keyboard shortcut (opens the latest message)</span></label>
        <label>Shortcut <small>(click the box, then press the combo)</small>
          <div class="fs-hkrow"><input type="text" class="text_pole" id="fs_hotkey" readonly><button type="button" class="menu_button" id="fs_hotkey_reset">Reset</button></div></label>
        <small class="fs-muted">Slash command: <code>/frankenswipe</code> (aliases <code>/franken</code>, <code>/fswipe</code>) — optionally followed by a message id.</small>
      </div>
    </div>
  </div>
</div>`;
    }

    function initSettings() {
        const st = getSettings();
        const wrap = document.createElement('div');
        wrap.innerHTML = settingsHtml();
        (document.getElementById('extensions_settings2') || document.getElementById('extensions_settings')).append(wrap);
        wrap.querySelectorAll('[data-fs]').forEach(el => {
            const k = el.dataset.fs;
            if (el.type === 'checkbox') el.checked = !!st[k]; else el.value = st[k];
            el.addEventListener('change', () => {
                st[k] = el.type === 'checkbox' ? el.checked : el.value;
                persist();
                if (k === 'triggerLocation') injectButtons();
            });
        });
        const hk = wrap.querySelector('#fs_hotkey');
        hk.value = st.hotkey;
        hk.addEventListener('keydown', e => {
            e.preventDefault(); e.stopPropagation();
            const combo = comboFrom(e);
            if (!combo) return;
            if (!(e.ctrlKey || e.metaKey || e.altKey)) return toastr.info('Include Ctrl or Alt in the shortcut.', NAME);
            st.hotkey = combo; hk.value = combo; persist();
        });
        wrap.querySelector('#fs_hotkey_reset').addEventListener('click', () => { st.hotkey = DEFAULTS.hotkey; hk.value = st.hotkey; persist(); });
    }

    /* ===================================================================
     * Init
     * =================================================================== */
    function init() {
        const c = getCtx();
        getSettings();
        initSettings();
        registerSlash();

        document.addEventListener('click', e => {
            const b = e.target.closest?.('.fs-open-btn');
            if (!b) return;
            e.preventDefault(); e.stopPropagation();
            const mes = b.closest('.mes');
            if (mes) openWorkspace(+mes.getAttribute('mesid'));
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.classList?.contains('fs-open-btn')) { e.target.click(); return; }
            if (e.key === 'Escape' && overlay && !document.querySelector('dialog[open]')) { e.stopPropagation(); closeWorkspace(); return; }
            const st = getSettings();
            if (!st.hotkeyEnabled || overlay) return;
            if (comboFrom(e) === st.hotkey) { e.preventDefault(); openLatest(); }
        }, true);

        const chat = document.getElementById('chat');
        if (chat) new MutationObserver(scheduleInject).observe(chat, { childList: true, subtree: true });
        const ev = c.eventTypes || c.event_types || {};
        for (const name of ['CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED']) {
            if (ev[name]) c.eventSource.on(ev[name], scheduleInject);
        }
        scheduleInject();
        console.log(`[${NAME}] loaded`);
    }

    jQuery(() => { try { init(); } catch (e) { console.error(`[${NAME}] init failed`, e); } });
})();
