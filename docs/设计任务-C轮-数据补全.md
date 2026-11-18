# 设计任务：C 轮——数据补全（听力逐字稿、补导入、答案核对工具）

> 写给实施者的任务书。2026-11-03。只动 `scripts/`、`public/papers/`、`data/cache/`，不动 `src/`。可以和前端的改动并行。

## 1. 听力逐字稿对齐（最重要）

现状：有录音的 28 套四六级卷，`public/papers/<id>.json` 里 `audio.segments[].lines[]` 只有 `start`/`end`（ffmpeg 按静音切出来的"句"），`text` 几乎都是空串（只有读题那句标了 `Question N`）。做题页的精听面板因此只能显示"第 N 句"。

目标：每一句都有英文原文，做题页能逐句看、点词查词、盲听再显示。

来源：每套的解析 PDF（`真题/四级/<年月>/…-解析.pdf`，`真题/manifest.json` 里有映射）后半部分有"听力原文 / Listening Script"。文字层可用的直接取；扫描件用 `data/cache/cet-ocr/` 里已有的识别结果（`scripts/cet_ocr.py` 有缓存读取函数），没识别过的页用它识别。

做法（新脚本 `scripts/align_transcripts.py`，并让 `import_cet.py` 导入时顺手调用，重导不丢）：

1. **切出原文**：从"听力原文"标题起，到"参考答案/全文翻译/Part III"等止。去掉页眉页脚、页码、水印行。
2. **分到段**：按标题 `News Report One/Two/Three`、`Conversation One/Two`、`Passage One/Two/Three`（和 `Section A/B/C`）对应到 `segments[].id`（`news1`、`conv1`、`pass1`……）。标题识别要容错（OCR 会把 One 识成 0ne）。读题的句子 `Questions 1 and 2 are based on…`、`1. What…`/`Question 1. What…` 要留下并标成 `Question N` 行。
3. **分句**：按 `. ? !` 后接空格大写切；对话里 `M:`/`W:` 开头的是说话人，记到 `speaker`（M/W），说话人切换处一定断句。
4. **对到时间**：段内 OCR 句数 ≈ 静音切出的行数时一一对应；不等时用动态规划：每行的时长 ∝ 分给它的字符数（英文约 15 字符/秒，可按整段实际比例校准），允许一行对多句、一句对多行（合并或拆分 lines，拆分按字符比例切时间），代价 = |时长 − 字符数/语速| 之和最小。`Question N` 的行优先锚定：原文里的 `Question N` 必须落在已标 `Question N` 的那行上（锚点把 DP 切成小段，稳得多）。
5. **写回**：`lines[].text`、`lines[].speaker`，保留原有 `start/end`（拆分的除外）。整段录音的 3 套（只有一个 `all` 段）也要对：先按 `Question N` 锚点和题组题号把整段切成 8 段再对。
6. **自检**：每套输出对齐报告——每段句数/行数、未对上的句子、平均语速是否在 2–3.5 词/秒之间；语速异常的段打印出来人工看。跑完 `node scripts/check-papers.mjs`。

验收：28 + 3 套每段 ≥ 90% 的行有 `text`；在应用里打开 `cet4-2024-06-1` 的听力面板能看到逐句英文（开发服务器要重启才读到新 JSON）；`Question N` 行的时间和之前一致。

## 2. 补导入只差几个答案的卷子

`npm run import:cet -- --all --no-ocr` 会列出每套的状态和原因。约 35 套是"答案没取全，缺 [n, n]"只差 1–4 题。逐套看解析 PDF 里那几题的答案是怎么写的（常见：两栏版式串行、`答案为 C)` 的括号变体、`【答案】C`、表格式答案栏、答案和题号在不同行），把句式加进 `scripts/cet_answers.py`，再导。

硬规则（已有，别放松）：选词填空答案不能重复；整块和按栏取出的答案不一致就不要；解析引用的英文要 ≥ 60% 在原卷里（`quote_overlap`）；`scripts/cet_answer_fixes.json` 里的人工更正优先。

导完：`node scripts/check-papers.mjs`、`npm run polish:explain`、`npm run thumbs`；新导入卷子的听力也要跑第 1 节的对齐。报告：新增了哪几套，还剩哪些、各差什么。

## 3. 答案核对工具（给人用）

`scripts/answer_audit.py`：对每套卷子，把答案键和解析正文里说的答案（`polish_explanations.py` 里的 `ANSWER_SAID` 正则）、以及解析层 `explain/<id>.json` 里 AI 解析结尾的答案三者对一遍，输出一张表：不一致的题、哪一套、三方各说什么。目的是让人花 10 分钟抽查，不是自动改。顺便把选词填空的答案字母和原卷词库顺序核一遍（`A–O` 对应的词要在原卷里能找到）。

## 4. 交付

- 新脚本写进 `package.json`：`align:transcripts`、`audit:answers`
- `docs/试卷数据格式.md` 加一节"听力逐字稿"（`lines[].text/speaker` 的来源和对齐方法）
- 最后报告：对齐覆盖率表（每套 % 行有文字）、新导入的卷子、核对工具发现的不一致项
