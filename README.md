# 🧬 Franken-Swipe for SillyTavern

**Franken-Swipe** is an interactive swipe comparison and response-stitching workspace for [SillyTavern](https://github.com/SillyTavern/SillyTavern).

When generating multiple swipes on a message, no single swipe is always perfect—**Swipe #1** might have the best opening paragraph, **Swipe #3** might have the sharpest dialogue in the middle, and **Swipe #4** might have the best ending. **Franken-Swipe** lets you visually compare every swipe side-by-side, see how they differ, and stitch paragraphs, lines, individual sentences, dialogue blocks, or arbitrary highlighted snippets into one combined response.

---

## ✨ Features

### 1. Easy Access & Triggers
- **In-Chat Trigger Buttons:** Automatically appears next to the swipe counter (`Stitch (N)`) and/or inside the message action menu (`...`) on any message with 2 or more swipes.
- **Slash Commands:** Run `/frankenswipe` (or `/fswipe` / `/stitch`) to open the workspace on the latest multi-swipe message, or `/frankenswipe 14` to open it on message `#14`.
- **Custom Hotkey:** Press `Alt+F` (or record your own custom shortcut in Extension Settings) to immediately launch Franken-Swipe on the latest multi-swipe message.

### 2. Flexible Text Splitting (Granularity)
Switch how donor swipes are broken down on the fly without losing your current draft:
- **Paragraphs:** Split by paragraph breaks.
- **Lines:** Split by single line breaks.
- **Sentences:** Smart sentence segmentation so you can swap out a single weak sentence inside an otherwise great paragraph.
- **Dialogue vs. Narration:** Automatically separates spoken dialogue (`"..."`, `“...”`, `«...»`) from narration and action blocks, tagging each with `💬 Dialogue` or `📖 Narration`.
- **Freehand Text Selection:** Highlight any arbitrary word, phrase, or clause inside any swipe card and click the floating **+ Add Selection to Draft** popover.

### 3. Viewing & Comparison Modes
- **Aligned Row View:** Aligns Block #1 of every swipe side-by-side in Row 1, Block #2 in Row 2, and so on—making it easy to compare openings, middles, and endings across swipes.
- **Column View:** Shows each swipe as its own vertical column of selectable blocks with sticky headers.
- **Visual Diff Mode:** Word-level LCS diffing between any two swipes—or between any swipe and your **Current Stitched Draft**—highlighting added words in green and removed words in red.
- **Duplicate Dimming & Filtering:** Automatically dims or collapses blocks that are identical to an earlier swipe (`= Swipe #1`), and lets you toggle individual swipes on/off from the top filter bar.
- **Similarity Indicator:** Displays a word-pair Jaccard similarity score and meter on every swipe so you can immediately spot near-duplicates versus wildly different takes.

### 4. The Stitching Workspace (Draft Builder)
- **Click-to-Add & Donor Badges:** Click any block on the left to add it to your draft. Each block in your draft carries a color-coded badge (`Swipe #1`, `Swipe #3`, `Selection (#2)`) matching its donor swipe.
- **Use a Swipe as a Base & Replace-in-Place:** Click **Use as Base** on any swipe to populate the draft with all of its blocks, then click the **Target for Replace (`🔄`)** icon on any weak block in your draft and click a replacement block from another swipe to swap it in place.
- **Reordering, Splitting & Merging:** Drag-and-drop blocks, use `↑` / `↓` buttons, toggle block joiners (`¶ Paragraph Break`, `↵ Line Break`, `␣ Space`), split a block into sentences (`✂️`), or click **Merge Down (`🔗`)** to fuse adjacent blocks together.
- **Live Editing & Raw Text Mode:** Edit the text of any individual block directly, or switch to **Raw Text Editor** mode to polish the entire assembled response as one document. Includes full **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y`) history.
- **Live Length Counter:** Tracks word count (with `+/-` delta against the active swipe), character count, block count, and estimated token count.

### 5. Reasoning / Thought Block Support
Supports both SillyTavern's `swipe_info.extra.reasoning` metadata and inline `<think>...</think>` blocks:
- **Keep Primary Donor's Reasoning:** Automatically uses the reasoning from whichever swipe contributed the most text to your stitched draft.
- **Keep Active Swipe's Reasoning:** Preserves the currently active swipe's reasoning.
- **Combine Used Donors:** Concatenates and deduplicates reasoning from all swipes used in the draft.
- **Specific Swipe / Blank / Custom Edit:** Pick a specific swipe's reasoning, leave it blank, or expand the **Inspect / Edit** drawer to tweak the reasoning text manually.

### 6. Saving Options
- **Save as New Swipe:** Appends the stitched response as a brand-new swipe and switches to it.
- **Overwrite Current Swipe:** Replaces the active swipe in place.
- **Save & Clean Up:** Saves the stitched response and removes unused donor swipes to keep your chat file clean.

---

## 📦 Installation

1. Open **SillyTavern**.
2. Go to the **Extensions** panel (top-right stacked cubes icon) → **Install Extension**.
3. Paste the repository URL:
   ```text
   https://github.com/serioos/Franken-Swipe
4. Click Install for all users (or Install just for me) and reload SillyTavern if prompted.