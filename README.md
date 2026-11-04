# 🧟 Franken-Swipe

A SillyTavern extension that lets you compare every swipe of a message side by side and stitch the best paragraphs, sentences, dialogue lines, or hand-picked phrases from different swipes into one combined reply.

## Install
In SillyTavern: **Extensions → Install extension**, then paste `https://github.com/serioos/Franken-Swipe`.
Manual: copy this folder to `SillyTavern/public/scripts/extensions/third-party/Franken-Swipe` (or `data/<user>/extensions/Franken-Swipe`) and reload.

## Opening the workspace
- **Button**: a puzzle-piece icon in the message action menu (•••) and/or next to the swipe counter. It only appears on messages with 2+ swipes.
- **Slash command**: `/frankenswipe` (aliases `/franken`, `/fswipe`) opens the latest message; `/frankenswipe 12` opens message #12.
- **Hotkey**: `Alt+Shift+S` by default (configurable).

## Using it
- **Split by**: paragraphs, lines, sentences, dialogue/narration, or freehand.
- **Views**: aligned rows, columns, or a word-level diff between any two swipes (or a swipe vs. your draft).
- **Duplicates** can be dimmed or collapsed; swipes can be hidden with the chips; each swipe shows a similarity bar.
- **Click** a block to add it to the draft (new blocks insert after the selected draft block, or at the end). **Highlight** any text and press *Add selection* to grab a phrase.
- **Draft**: edit per block, drag/arrow reorder, merge with next, cycle the join (␣ space / ↵ line break / ¶ paragraph), undo, or switch to a raw text editor. Live word/char counter.
- **Use whole swipe as base** with the stack icon in a swipe header.
- **Reasoning**: keep primary donor's (auto = swipe contributing the most text), the active swipe's, combine donors', or leave blank.
- **Save**: new swipe, overwrite a chosen swipe, or save & clean up (pick which donor swipes to delete; unused ones are pre-selected).
