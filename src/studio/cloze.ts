export type ClozeDifficulty = "light" | "medium" | "full";

export interface ClozeToken {
  text: string;
  word?: string;
  blank: boolean;
  index: number;
}

export interface PhraseChunk {
  id: number;
  text: string;
  order: number;
}

export interface SpokenWordResult {
  word: string;
  hit: boolean;
}

export interface SpokenDiffResult {
  items: SpokenWordResult[];
  hitCount: number;
  total: number;
  score: number;
}

const STOP_WORDS = new Set([
  "a", "an", "the",
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "done",
  "have", "has", "had",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "and", "or", "but", "so", "yet", "nor", "for",
  "in", "on", "at", "by", "to", "of", "from", "with", "as", "into", "onto",
  "about", "over", "under", "up", "down", "out", "off", "if", "when", "while",
  "then", "than", "that", "which", "who", "whom", "whose", "where", "what",
  "there", "here", "not", "no", "yes", "ok", "okay", "very", "just", "too",
]);

const BOUNDARY_WORDS = new Set([
  "who", "whom", "whose", "which", "that", "what", "where", "when", "while",
  "because", "although", "though", "since", "unless", "until", "if", "whether",
  "but", "and", "or", "so", "yet",
  "in", "on", "at", "by", "for", "with", "from", "into", "about", "through",
  "to", "after", "before", "during", "between", "among", "without", "within",
]);

const UK_TO_US_EXACT: Record<string, string> = {
  colour: "color",
  colours: "colors",
  coloured: "colored",
  colouring: "coloring",
  colourful: "colorful",
  favour: "favor",
  favours: "favors",
  favoured: "favored",
  favouring: "favoring",
  favourite: "favorite",
  favourites: "favorites",
  honour: "honor",
  honours: "honors",
  honoured: "honored",
  honouring: "honoring",
  labour: "labor",
  labours: "labors",
  laboured: "labored",
  labouring: "laboring",
  flavour: "flavor",
  flavours: "flavors",
  flavoured: "flavored",
  humour: "humor",
  humours: "humors",
  humoured: "humored",
  neighbour: "neighbor",
  neighbours: "neighbors",
  neighbourhood: "neighborhood",
  behaviour: "behavior",
  behaviours: "behaviors",
  rumour: "rumor",
  rumours: "rumors",
  harbour: "harbor",
  harbours: "harbors",
  armour: "armor",
  vigour: "vigor",
  odour: "odor",
  glamour: "glamor",
  saviour: "savior",
  centre: "center",
  centres: "centers",
  centred: "centered",
  theatre: "theater",
  theatres: "theaters",
  metre: "meter",
  metres: "meters",
  litre: "liter",
  litres: "liters",
  fibre: "fiber",
  fibres: "fibers",
  kilometre: "kilometer",
  kilometres: "kilometers",
  centimetre: "centimeter",
  centimetres: "centimeters",
  defence: "defense",
  offence: "offense",
  licence: "license",
  practise: "practice",
  practised: "practiced",
  practising: "practicing",
  catalogue: "catalog",
  catalogues: "catalogs",
  dialogue: "dialog",
  dialogues: "dialogs",
  programme: "program",
  programmes: "programs",
  programmed: "programed",
  travelled: "traveled",
  travelling: "traveling",
  traveller: "traveler",
  travellers: "travelers",
  cancelled: "canceled",
  cancelling: "canceling",
  labelled: "labeled",
  labelling: "labeling",
  modelled: "modeled",
  modelling: "modeling",
  jewellery: "jewelry",
  grey: "gray",
  cheque: "check",
  tyre: "tire",
  tyres: "tires",
  mum: "mom",
  maths: "math",
  realise: "realize",
  realised: "realized",
  realises: "realizes",
  realising: "realizing",
  organise: "organize",
  organised: "organized",
  organises: "organizes",
  organising: "organizing",
  organisation: "organization",
  organisations: "organizations",
  recognise: "recognize",
  recognised: "recognized",
  recognises: "recognizes",
  recognising: "recognizing",
  analyse: "analyze",
  analysed: "analyzed",
  analyses: "analyzes",
  analysing: "analyzing",
  apologise: "apologize",
  apologised: "apologized",
  apologising: "apologizing",
  criticise: "criticize",
  criticised: "criticized",
  criticising: "criticizing",
  emphasise: "emphasize",
  emphasised: "emphasized",
  emphasising: "emphasizing",
  modernise: "modernize",
  modernised: "modernized",
  specialise: "specialize",
  specialised: "specialized",
  specialising: "specializing",
  prioritise: "prioritize",
  prioritised: "prioritized",
  personalised: "personalized",
  utilised: "utilized",
  utilise: "utilize",
  customise: "customize",
  customised: "customized",
  minimise: "minimize",
  minimised: "minimized",
  maximise: "maximize",
  maximised: "maximized",
  characterise: "characterize",
  characterised: "characterized",
  socialise: "socialize",
  socialising: "socializing",
  categorise: "categorize",
  categorised: "categorized",
  summarise: "summarize",
  summarised: "summarized",
  visualise: "visualize",
  visualised: "visualized",
};

const ISE_KEEP = new Set([
  "arise", "advise", "comprise", "compromise", "despise", "devise", "disguise",
  "enterprise", "exercise", "franchise", "improvise", "merchandise", "otherwise",
  "paradise", "precise", "promise", "revise", "rise", "supervise", "surprise",
  "televise", "wise", "likewise", "clockwise",
]);

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function normalizeAnswerWord(input: string): string {
  const s = input
    .normalize("NFKC")
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "")
    .toLowerCase();
  if (!s) return "";
  if (UK_TO_US_EXACT[s]) return UK_TO_US_EXACT[s];
  // 常见英式 -ise/-ised/-ising -> -ize...（避开 promise/surprise 等原生拼写）
  const iseMatch = s.match(/^([a-z]{3,})is(e|ed|es|ing|er|ers|ation|ations)$/);
  if (iseMatch && !ISE_KEEP.has(`${iseMatch[1]}ise`) && !ISE_KEEP.has(s)) {
    return `${iseMatch[1]}iz${iseMatch[2]}`;
  }
  return s;
}

export function isAnswerMatch(input: string, expected: string): boolean {
  const a = normalizeAnswerWord(input);
  const b = normalizeAnswerWord(expected);
  return !!a && a === b;
}

const TOKEN_SPLIT_RE = /([A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*)/g;
const IS_WORD_RE = /^[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*$/;

export function buildClozeTokens(
  sentence: string,
  keySeed: string,
  difficulty: ClozeDifficulty = "light",
): ClozeToken[] {
  const parts = sentence.split(TOKEN_SPLIT_RE).filter((p) => p.length > 0);
  const tokens: ClozeToken[] = [];
  const wordMeta: { tokenIdx: number; wordIdx: number; raw: string; norm: string; isNumber: boolean; isProper: boolean; isStop: boolean }[] = [];

  let wordIdx = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (IS_WORD_RE.test(part)) {
      const norm = normalizeAnswerWord(part);
      const isNumber = /^\d+$/.test(part);
      const isProper = wordIdx > 0 && /^[A-Z]/.test(part) && part !== "I" && !isNumber;
      const isStop = STOP_WORDS.has(norm);
      tokens.push({ text: part, word: part, blank: false, index: tokens.length });
      wordMeta.push({
        tokenIdx: tokens.length - 1,
        wordIdx,
        raw: part,
        norm,
        isNumber,
        isProper,
        isStop,
      });
      wordIdx++;
    } else {
      tokens.push({ text: part, blank: false, index: tokens.length });
    }
  }

  if (wordMeta.length === 0) return tokens;

  if (difficulty === "full") {
    for (const m of wordMeta) {
      tokens[m.tokenIdx].blank = true;
    }
    return tokens;
  }

  let eligible = wordMeta.filter((m) => {
    if (difficulty === "light") {
      return !m.isStop && !m.isProper && !m.isNumber && m.norm.length >= 3;
    }
    // medium: 实词与数字
    return !m.isStop && (m.norm.length >= 2 || m.isNumber);
  });

  if (eligible.length === 0) {
    eligible = wordMeta.filter((m) => !m.isStop);
  }
  if (eligible.length === 0) {
    eligible = wordMeta.filter((m) => m.norm.length >= 2);
  }
  if (eligible.length === 0) {
    eligible = wordMeta;
  }

  const ratio = difficulty === "light" ? 0.25 : 0.55;
  const maxBlanks = difficulty === "light" ? 5 : eligible.length;
  const count = Math.min(maxBlanks, eligible.length, Math.max(1, Math.round(eligible.length * ratio)));

  const ranked = [...eligible].sort((a, b) => {
    const ha = fnv1a(`${keySeed}:${difficulty}:${a.wordIdx}:${a.norm}`);
    const hb = fnv1a(`${keySeed}:${difficulty}:${b.wordIdx}:${b.norm}`);
    return ha - hb || a.wordIdx - b.wordIdx;
  });

  for (const picked of ranked.slice(0, count)) {
    tokens[picked.tokenIdx].blank = true;
  }
  return tokens;
}

export function buildPhraseChunks(sentence: string, keySeed: string): PhraseChunk[] {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return words.map((w, i) => ({ id: i, text: w, order: i }));
  }

  let groups: string[][] = [];
  if (words.length <= 3) {
    groups = words.map((w) => [w]);
  } else {
    let cur: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const clean = w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
      const rem = words.length - i;
      const shouldBreakBefore =
        cur.length >= 2 &&
        rem >= 2 &&
        (BOUNDARY_WORDS.has(clean) || cur.length >= 5);
      if (shouldBreakBefore) {
        groups.push(cur);
        cur = [w];
      } else {
        cur.push(w);
      }
      const hasMajorPunct = /[,;:?!]$|--$|—$/.test(w);
      if (hasMajorPunct && cur.length >= 2 && words.length - i - 1 >= 1) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) {
      if (cur.length === 1 && groups.length > 0 && groups[groups.length - 1].length < 4) {
        groups[groups.length - 1].push(cur[0]);
      } else {
        groups.push(cur);
      }
    }

    // 合并过碎块直到 <= 8 块
    while (groups.length > 8) {
      let bestIdx = 0;
      let bestLen = Infinity;
      for (let i = 0; i < groups.length - 1; i++) {
        const pairLen = groups[i].length + groups[i + 1].length;
        if (pairLen < bestLen) {
          bestLen = pairLen;
          bestIdx = i;
        }
      }
      groups.splice(bestIdx, 2, [...groups[bestIdx], ...groups[bestIdx + 1]]);
    }

    // 过长整块再切分，保证一般长句至少 3 块
    while (groups.length < 3 && Math.max(...groups.map((g) => g.length)) >= 2) {
      let maxIdx = 0;
      for (let i = 1; i < groups.length; i++) {
        if (groups[i].length > groups[maxIdx].length) maxIdx = i;
      }
      const target = groups[maxIdx];
      if (target.length < 2) break;
      const mid = Math.ceil(target.length / 2);
      groups.splice(maxIdx, 1, target.slice(0, mid), target.slice(mid));
    }
  }

  const ordered: PhraseChunk[] = groups.map((g, i) => ({
    id: i,
    text: g.join(" "),
    order: i,
  }));

  if (ordered.length <= 1) return ordered;

  // 确定性 Fisher-Yates 洗牌，并保证不与原序完全相同
  const shuffled = [...ordered];
  let seed = fnv1a(`${keySeed}:${sentence}`);
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = nextRand() % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.some((c, i) => c.order !== i)) break;
  }
  if (shuffled.every((c, i) => c.order === i)) {
    const first = shuffled.shift()!;
    shuffled.push(first);
  }
  return shuffled;
}

export function diffSpokenWords(reference: string, spoken: string): SpokenDiffResult {
  const refMatches = reference.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) ?? [];
  const spMatches = spoken.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) ?? [];

  const refNorm = refMatches.map((w) => normalizeAnswerWord(w));
  const spNorm = spMatches.map((w) => normalizeAnswerWord(w));
  const n = refNorm.length;
  const m = spNorm.length;

  if (n === 0) return { items: [], hitCount: 0, total: 0, score: 100 };
  if (m === 0) {
    return {
      items: refMatches.map((word) => ({ word, hit: false })),
      hitCount: 0,
      total: n,
      score: 0,
    };
  }

  // 标准 LCS DP
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (refNorm[i] && refNorm[i] === spNorm[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const hits = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (refNorm[i] && refNorm[i] === spNorm[j]) {
      hits[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const hitCount = hits.filter(Boolean).length;
  return {
    items: refMatches.map((word, idx) => ({ word, hit: hits[idx] })),
    hitCount,
    total: n,
    score: Math.round((hitCount / n) * 100),
  };
}
