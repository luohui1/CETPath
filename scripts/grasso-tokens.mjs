// 把团队设计系统 Grasso 的 tokens.json 转成 CSS 变量：src/grasso/tokens.css。
// 设计系统更新后：把新的 tokens.json、bundle.js、bundle.css、index.d.ts（改名 types.d.ts）
// 放进 src/grasso/，再运行 npm run grasso:tokens
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/grasso");
const t = JSON.parse(await readFile(path.join(dir, "tokens.json"), "utf8"));

// 颜色别名 "{blue}" -> var(--blue)；只有浅色一个主题
const value = (v) => {
  const raw = typeof v === "object" ? Object.values(v)[0] : v;
  return String(raw).replace(/^\{([\w.-]+)\}$/, "var(--$1)");
};

const lines = [];
for (const tok of t.color.tokens) lines.push(`  --${tok.name}: ${value(tok.value)};`);
for (const [k, v] of Object.entries(t.type.families)) lines.push(`  --font-${k}: ${v};`);
for (const fam of ["spacing", "radius", "shadow", "blur"]) {
  for (const tok of t[fam]?.tokens ?? []) lines.push(`  --${tok.name}: ${value(tok.value)};`);
}

const css = `/* ${t.name} — generated from tokens.json by scripts/grasso-tokens.mjs */\n:root {\n${lines.join("\n")}\n}\n`;
await writeFile(path.join(dir, "tokens.css"), css);
console.log(`tokens.css：${lines.length} 个变量`);
