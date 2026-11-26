import type { IeltsHighlight } from "../types";

const EXCLUDE_SELECTOR =
  "input, textarea, button, select, [data-hl-skip], .cbt-qnum, .ltr, .ins-pill-key, .ins-drop-slot, .heading-slot-box, .cbt-fblist, .cbt-playerbar, .cbt-zoom-hint";

const STRUCTURAL_PARENTS = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "COLGROUP",
  "UL",
  "OL",
  "DL",
]);

const BLOCK_NEIGHBORS = new Set([
  "P",
  "DIV",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TD",
  "TH",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "BLOCKQUOTE",
  "BR",
  "HR",
]);

function isInterBlockWhitespace(n: Text, sliceText: string): boolean {
  if (/\S/.test(sliceText)) return false;
  const parentTag = n.parentElement?.tagName ?? "";
  if (STRUCTURAL_PARENTS.has(parentTag)) return true;
  const prevTag = n.previousSibling?.nodeType === 1 ? (n.previousSibling as Element).tagName : "";
  const nextTag = n.nextSibling?.nodeType === 1 ? (n.nextSibling as Element).tagName : "";
  return BLOCK_NEIGHBORS.has(prevTag) || BLOCK_NEIGHBORS.has(nextTag);
}

function textNodes(zone: HTMLElement): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(EXCLUDE_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

export function zoneText(zone: HTMLElement): string {
  return textNodes(zone).map((n) => n.data).join("");
}

function offsetOf(zone: HTMLElement, node: Node, off: number): number {
  const nodes = textNodes(zone);
  if (node.nodeType === Node.TEXT_NODE && nodes.includes(node as Text)) {
    let pos = 0;
    for (const n of nodes) {
      if (n === node) return pos + off;
      pos += n.data.length;
    }
  }
  const p = document.createRange();
  p.setStart(node, off);
  let pos = 0;
  for (const n of nodes) {
    if (n.data.length === 0) continue;
    if (p.comparePoint(n, n.data.length) > 0) break;
    pos += n.data.length;
  }
  return pos;
}

function wrapRange(zone: HTMLElement, s: number, e: number, cls: string, id: string): HTMLElement[] {
  const created: HTMLElement[] = [];
  let pos = 0;
  for (const n of textNodes(zone)) {
    const a = pos;
    const b = pos + n.data.length;
    pos = b;
    const from = Math.max(s, a);
    const to = Math.min(e, b);
    if (from >= to) continue;
    const sliceText = n.data.slice(from - a, to - a);
    if (isInterBlockWhitespace(n, sliceText)) continue;
    const r = document.createRange();
    r.setStart(n, from - a);
    r.setEnd(n, to - a);
    const mark = document.createElement("mark");
    mark.className = cls;
    mark.dataset.id = id;
    try {
      r.surroundContents(mark);
      created.push(mark);
    } catch {
      // Ignore degenerate cross-node edge
    }
  }
  return created;
}

export function applyZoneHighlights(zone: HTMLElement, list: IeltsHighlight[] = []): void {
  const parentsToNormalize = new Set<Node>();
  zone.querySelectorAll("mark.cbt-hl, mark.cbt-note, mark.hl, mark.note").forEach((m) => {
    if (m.parentNode) parentsToNormalize.add(m.parentNode);
    m.replaceWith(...Array.from(m.childNodes));
  });
  parentsToNormalize.forEach((p) => p.normalize());

  // Render plain highlights first, then notes on top so note markers & underlines stay visible
  const sorted = [...list]
    .filter((x) => x.id !== "__scratch__" && x.e > x.s)
    .sort((a, b) => (a.note != null ? 1 : 0) - (b.note != null ? 1 : 0) || a.s - b.s);

  for (const it of sorted) {
    const isNote = it.note != null;
    const marks = wrapRange(zone, it.s, it.e, isNote ? "cbt-note" : "cbt-hl", it.id);
    if (isNote && marks.length > 0) {
      marks[marks.length - 1].dataset.noteEnd = "1";
    }
  }
}

/**
 * Merge a new plain highlight `[s, e)` with any overlapping or touching plain highlights,
 * preserving existing Notes untouched.
 */
export function mergeHighlightRange(
  existing: IeltsHighlight[],
  s: number,
  e: number,
  fullZoneText: string,
  makeId: () => string,
): IeltsHighlight[] {
  const notes = existing.filter((x) => x.note != null || x.id === "__scratch__");
  const plains = existing.filter((x) => x.note == null && x.id !== "__scratch__");
  let ns = s;
  let ne = e;
  const kept: IeltsHighlight[] = [];
  for (const h of plains) {
    if (h.e < ns || h.s > ne) {
      kept.push(h);
    } else {
      ns = Math.min(ns, h.s);
      ne = Math.max(ne, h.e);
    }
  }
  const merged: IeltsHighlight = {
    id: makeId(),
    s: ns,
    e: ne,
    text: fullZoneText.slice(ns, ne).trim().slice(0, 200),
  };
  return [...kept, merged, ...notes];
}

/**
 * Subtract `[s, e)` from any overlapping plain highlights (`note == null`).
 * Supports erasing a middle slice of a longer highlight cleanly!
 */
export function subtractHighlightRange(
  existing: IeltsHighlight[],
  s: number,
  e: number,
  fullZoneText: string,
  makeId: () => string,
): IeltsHighlight[] {
  const out: IeltsHighlight[] = [];
  for (const h of existing) {
    if (h.note != null || h.id === "__scratch__") {
      out.push(h);
      continue;
    }
    if (h.e <= s || h.s >= e) {
      out.push(h);
      continue;
    }
    if (h.s < s) {
      const leftText = fullZoneText.slice(h.s, s);
      if (leftText.trim()) {
        out.push({ id: makeId(), s: h.s, e: s, text: leftText.trim().slice(0, 200) });
      }
    }
    if (h.e > e) {
      const rightText = fullZoneText.slice(e, h.e);
      if (rightText.trim()) {
        out.push({ id: makeId(), s: e, e: h.e, text: rightText.trim().slice(0, 200) });
      }
    }
  }
  return out;
}

export function flashPassageQuotes(zone: HTMLElement, quotes: string[] = []): boolean {
  const parents = new Set<Node>();
  zone.querySelectorAll("mark.cbt-src, mark.src").forEach((m) => {
    if (m.parentNode) parents.add(m.parentNode);
    m.replaceWith(...Array.from(m.childNodes));
  });
  parents.forEach((p) => p.normalize());

  const flat = (s: string) => s.replace(/\s+/g, " ");
  const raw = zoneText(zone);
  const text = flat(raw);
  let firstEl: Element | null = null;
  for (const q of quotes) {
    const needle = flat(q).replace(/\.\.\.|…/g, "").trim();
    const at = text.indexOf(needle);
    if (needle.length < 8 || at < 0) continue;
    let ri = 0;
    let fi = 0;
    while (fi < at && ri < raw.length) {
      if (/\s/.test(raw[ri])) while (/\s/.test(raw[ri + 1] || "")) ri++;
      ri++;
      fi++;
    }
    let re = ri;
    let k = 0;
    while (k < needle.length && re < raw.length) {
      if (/\s/.test(raw[re])) while (/\s/.test(raw[re + 1] || "")) re++;
      re++;
      k++;
    }
    wrapRange(zone, ri, re, "cbt-src", "src");
    firstEl ||= zone.querySelector("mark.cbt-src");
  }
  firstEl?.scrollIntoView({ block: "center", behavior: "smooth" });
  return Boolean(firstEl);
}

export interface SelectionInfo {
  zoneKey: string;
  zoneEl: HTMLElement;
  s: number;
  e: number;
  text: string;
  fullText: string;
  rect: DOMRect;
}

export function extractSelectionInZones(zones: { key: string; el: HTMLElement }[]): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const startEl = r.startContainer.nodeType === 1 ? (r.startContainer as HTMLElement) : r.startContainer.parentElement;
  const endEl = r.endContainer.nodeType === 1 ? (r.endContainer as HTMLElement) : r.endContainer.parentElement;
  if (!startEl || !endEl) return null;
  if (startEl.closest("input, textarea") || endEl.closest("input, textarea")) return null;

  let z = zones.find((item) => item.el.contains(startEl) && item.el.contains(endEl));
  if (!z) {
    const intersecting = zones.filter((item) => {
      try {
        return r.intersectsNode(item.el);
      } catch {
        return false;
      }
    });
    if (intersecting.length === 1) z = intersecting[0];
  }
  if (!z) return null;

  const clamped = r.cloneRange();
  if (!z.el.contains(clamped.startContainer)) clamped.setStart(z.el, 0);
  if (!z.el.contains(clamped.endContainer)) clamped.setEnd(z.el, z.el.childNodes.length);

  const fullText = zoneText(z.el);
  let s = offsetOf(z.el, clamped.startContainer, clamped.startOffset);
  let e = offsetOf(z.el, clamped.endContainer, clamped.endOffset);
  if (s > e) [s, e] = [e, s];
  while (s < e && /\s/.test(fullText[s])) s++;
  while (e > s && /\s/.test(fullText[e - 1])) e--;
  const text = fullText.slice(s, e);
  if (e <= s || !text.trim()) return null;
  const rect = clamped.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { zoneKey: z.key, zoneEl: z.el, s, e, text, fullText, rect };
}

export function findMarksOnTarget(
  target: HTMLElement | null,
  zones: { key: string; el: HTMLElement }[],
): { zoneKey: string; zoneEl: HTMLElement; ids: string[]; rect: DOMRect } | null {
  if (!target) return null;
  const topMark = target.closest("mark.cbt-hl, mark.cbt-note, mark.hl, mark.note") as HTMLElement | null;
  if (!topMark) return null;
  const z = zones.find((item) => item.el.contains(topMark));
  if (!z) return null;
  const ids: string[] = [];
  for (
    let m: HTMLElement | null = topMark;
    m && z.el.contains(m);
    m = m.parentElement?.closest("mark.cbt-hl, mark.cbt-note, mark.hl, mark.note") ?? null
  ) {
    if (m.dataset.id && !ids.includes(m.dataset.id)) ids.push(m.dataset.id);
  }
  if (!ids.length) return null;
  return { zoneKey: z.key, zoneEl: z.el, ids, rect: topMark.getBoundingClientRect() };
}

export interface ClickedWordHit {
  word: string;
  sentence: string;
  rect: DOMRect;
  tokens: string[];
  tokenIndex: number;
}

/**
 * Extract exact clicked English word, its enclosing sentence, and its DOM bounding rect
 * for CETPath's `WordCard` lookup (used ONLY when lookup toggle is unlocked).
 */
export function detectClickedWord(ev: MouseEvent): ClickedWordHit | null {
  const target = ev.target as HTMLElement | null;
  if (!target || target.closest("input, textarea, button, select, a, [data-word-card], .cbt-ctxmenu, .cbt-floatbar")) {
    return null;
  }
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return null;

  let textNode: Text | null = null;
  let offset = 0;
  const docAny = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (docAny.caretPositionFromPoint) {
    const pos = docAny.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (pos?.offsetNode.nodeType === Node.TEXT_NODE) {
      textNode = pos.offsetNode as Text;
      offset = pos.offset;
    }
  } else if (docAny.caretRangeFromPoint) {
    const rng = docAny.caretRangeFromPoint(ev.clientX, ev.clientY);
    if (rng?.startContainer.nodeType === Node.TEXT_NODE) {
      textNode = rng.startContainer as Text;
      offset = rng.startOffset;
    }
  }
  if (!textNode) return null;
  const str = textNode.data;
  if (!str) return null;

  const isWordChar = (c: string) => /[A-Za-z'’-]/.test(c);
  let i = offset;
  if (i >= str.length || !isWordChar(str[i])) {
    if (i > 0 && isWordChar(str[i - 1])) i--;
    else return null;
  }
  let s = i;
  let e = i + 1;
  while (s > 0 && isWordChar(str[s - 1])) s--;
  while (e < str.length && isWordChar(str[e])) e++;
  while (s < e && !/[A-Za-z]/.test(str[s])) s++;
  while (e > s && !/[A-Za-z]/.test(str[e - 1])) e--;
  const word = str.slice(s, e);
  if (word.length < 2) return null;

  const wordRange = document.createRange();
  wordRange.setStart(textNode, s);
  wordRange.setEnd(textNode, e);
  const rect = wordRange.getBoundingClientRect();
  if (
    ev.clientX < rect.left - 8 ||
    ev.clientX > rect.right + 8 ||
    ev.clientY < rect.top - 8 ||
    ev.clientY > rect.bottom + 8
  ) {
    return null;
  }

  const block = textNode.parentElement?.closest("p, li, td, div, .cbt-sent") ?? textNode.parentElement;
  const blockText = (block?.textContent ?? str).replace(/\s+/g, " ").trim();
  const sentences = blockText.split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((sn) => sn.includes(word)) ?? blockText.slice(0, 320);
  const tokens = sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [word];
  const tokenIndex = Math.max(
    0,
    tokens.findIndex((t) => t.toLowerCase() === word.toLowerCase()),
  );

  return { word, sentence, rect, tokens, tokenIndex };
}
