/** 口音设置（Settings.accent）对应的系统语音语言标签 */
export type Accent = "us" | "uk";
export const ACCENT_LANG: Record<Accent, string> = { us: "en-US", uk: "en-GB" };

const norm = (lang: string) => lang.toLowerCase().replace("_", "-");

/** 语音的语言标签是否和口音一致（en_US、en-GB-oxendict 这类写法也认） */
export function voiceMatchesAccent(lang: string, accent: Accent) {
  const l = norm(lang);
  const want = norm(ACCENT_LANG[accent] ?? ACCENT_LANG.us);
  return l === want || l.startsWith(want + "-");
}

/**
 * 从英语语音里挑一个：先按口音找；用户明确选过的发音人只在口音一致时才用。
 * 没有对应口音的英语语音时退回任意英语语音，不拿其他语言的语音去读英文。
 */
export function chooseVoice<T extends { voiceURI: string; name: string; lang: string }>(
  voices: T[],
  voiceURI: string | null,
  accent: Accent,
): T | undefined {
  const english = voices.filter((v) => norm(v.lang).startsWith("en"));
  const picked = voiceURI ? english.find((v) => v.voiceURI === voiceURI) : undefined;
  if (picked && voiceMatchesAccent(picked.lang, accent)) return picked;
  const same = english.filter((v) => voiceMatchesAccent(v.lang, accent));
  return same.find((v) => /natural|online/i.test(v.name)) ?? same[0] ?? english[0];
}
