# 设计任务：G 轮——滑动流畅、卷面清晰、不遮字、解析干脆、手机能进

> 2026-11-03 晚，用户在 iPad 和手机上用过 F 轮之后的反馈（原话）："自带浏览器比较卡、进不去；整体滑动确实很卡；试卷电子化了还是很多比较糊；点击单词或者选项可能会遮挡原字符；解析不干脆。"（还有一句"标签机制也有问题"，在等用户说明，先不动。）
>
> 这一轮全是做题页的硬伤，按下面的顺序做：**§1 滑动 → §3 遮挡 → §4 解析 → §2 清晰 → §5 手机**。每一节都有验收标准和要报的数字。
>
> 相关文件：`src/exam/ExamRoom.tsx`（页面布局、工具栏、缩放、三个滚动监听）、`src/exam/PaperPages.tsx`（`ExamPage` 画布渲染、`WordLayer` 单词框、`QuestionMarker`/`BlankMarker`/`ChoicePanel`、`queueRender`）、`src/exam/InkLayer.tsx`（手写、高亮，三层全页 SVG）、`src/exam/ThumbRail.tsx`、`src/components/WordPopover.tsx`（查词卡）、`src/components/WordText.tsx`（`WordClick`）、`src/exam/Explanation.tsx`（解析卡，答题卡面板和错题本也用它）、`src/lib/marks.ts`（`wordAt`、`wordRange`）、`src/lib/db.ts`、`src/pages/PaperReader.tsx`、`scripts/import_cet.py`（`shrink_images`）。上一轮的改动见 F 轮实施报告（会话笔记里的 `F轮-实施报告.md`）。
>
> 规则不变：视觉按「考场与文具」，密度按 `docs/设计任务-A轮-现代化.md` 第 11 节；触屏目标 ≥ 40px；平板尺寸 820×1180、1180×820、1024×768 都要截图；不是 git 仓库，不要 commit；做完 `npm run build`，局域网 4173 的预览要是新版。

## 1. 滑动很卡（iPad、手机都卡）

我看过代码，按可能性排的原因，逐条做、逐条量：

1. **画布只增不减。** `ExamPage` 里 `visible` 一旦为 true 就不再变回去，9 页扫描卷在 DPR 2 下是 9 张约 1640×2320 的画布，约 137MB 位图常驻；iPad Safari 在这个量级上合成就开始掉帧，手机更甚。
   - 只给视口上方 1 屏、下方 2 屏以内的页留画布（`IntersectionObserver` 的 `rootMargin` 改成 `"100% 0px 200% 0px"`，离开就 `canvas.width = canvas.height = 0` 并把 `visible` 置回 false，再进来重画）。
   - 离开范围的页显示一个占位：页内一张低清缩略图拉伸（缩略图栏已经画过一遍，缓存成 `ImageBitmap`/dataURL 复用），或者干脆浅灰纸面 + 页码。用户快速滚过时允许糊，停下来 300ms 内要清楚。
   - `queueRender` 改成**按离视口中心的距离排优先级**的队列：最近的页先画；一页还没开始画就已经离开范围的，取消。缩略图栏的 9 张小图排在可见页之后。
2. **每页几百个单词框。** `WordLayer` 每页 400–960 个绝对定位的 `span`（全卷 4000–8000 个节点），`content-visibility: auto` 只在新 Safari 上有效。改成**不建单词框，按坐标命中**：
   - 点/手指 tap/笔双击 → 用 `wordAt(data.w, x / scale, y / scale)` 找词（F 轮手指 tap 已经这么做了），`WordClick` 的 `rect` 由词框算出来，`el` 改成可选；`WordPopover` 里 `hit.el.classList.add("is-active")` 改成由卷面自己画一个描边框（见 §3）。
   - 只给**需要显示**的词建元素：生词本里的词（`is-vocab`）、查找命中（`is-hit`/`is-hit-cur`）、当前查的词、解析"在卷面上标出"的闪烁——每页通常不到 30 个。
   - 鼠标悬停的手型和框可以不要（没有元素就没有 hover），`cursor: text` 放在整页上即可。
   - 受影响的地方都要改：`ExamRoom.tsx` 约 703–723 行手指 tap、`InkLayer.lookupAt`、`FindBar` 命中、`flashWords`、`WordTextProvider`。
3. **三个滚动监听各自 rAF + setState**（当前页、当前部分、收起工具栏）。合成一个监听；确认滚动时 `ExamPage` 不重渲染（React DevTools Profiler 录一段滚动，`ExamPage` 应该 0 次 render；如果有，找出哪个 prop 每次都是新对象——`times`、`limits`、`flags`、`struck`、`answers`、`items.get(...)`）。
4. **每页的大模糊阴影** `0 12px 32px -12px` 在 Safari 滚动时反复重绘。换成 1px `var(--line)` 描边 + `0 1px 2px` 的浅影（纸的感觉够了）。
5. **每页三层全页 SVG，其中两层 `mix-blend-multiply`**（`InkLayer` 的高亮层、闪烁层、笔迹层）。混合模式会让每页多出独立的合成层。没有高亮的页不挂高亮层，没有闪烁时不挂闪烁层，笔迹层不用混合模式。
6. **缩略图栏**打开试卷时就用 pdf.js 画 9 张小图，和正文抢主线程。排到可见页之后（见第 1 条），或者第一页直接用 `public/papers/pdf/<id>.thumb.jpg`。
7. 顺手检查：`InkLayer` 在选择工具下有没有非 passive 的 `touchmove`/`pointermove` 监听或 `preventDefault`；卷面容器 `touch-pan-x touch-pan-y` 保留。

**怎么量**（做之前先量一次，做完再量一次，两组数字都写进报告）：Chrome DevTools → 设备模式 820×1180、DPR 2 → Performance 面板，CPU 4× slowdown → 打开 `cet4-2025-12-1`（扫描卷 9 页）和 `cet6-2023-12-2`（矢量卷），各录一段 8 秒的匀速滚动。指标：滚动过程中最长任务（ms）、掉帧比例、同时存活的画布数、`ExamPage` render 次数。目标：最长任务 < 50ms，掉帧 < 5%，存活画布 ≤ 4。

## 2. 扫描件"糊"

先说事实（我用 PyMuPDF 量过 `public/papers/pdf/`）：**27 套扫描卷全部是 288–300dpi 的整页 JPEG**，其余 36 套是矢量文字；没有低分辨率的来源问题。所以"糊"出在显示这一侧：

- 画布像素 = CSS 像素 × DPR（上限 2）。iPad 竖屏贴合宽度时要 200dpi 左右，150% 时约 300dpi（刚好 1:1），**200% 时要 400dpi，300dpi 的扫描被放大，就软了**。
- 捏合缩放时画布先被 CSS 拉伸，停手 220ms 后才重画；而重画队列里排着 9 页 + 9 张缩略图、一次只画一页，**可见页可能要等好几秒才清楚**。用户看到的多半是这个。

做法：

1. §1 的优先级队列做完，可见页在停手后 300ms 内重画完（扫描页在 iPad 上画一页约 100–200ms，可接受）。缩放中把拉伸的画布用 `image-rendering: auto`（默认）即可，不要 pixelated。
2. 导入侧（`scripts/import_cet.py` 的 `shrink_images`）：现在把所有原件压到 300dpi、JPEG 质量 72。改成：原件 ≥ 360dpi 的保留到 **360dpi**，质量 **78**，并在 `levels()` 之后加一次轻微锐化（PIL `ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=3)`）。**先只重做 `cet4-2025-12-1` 一套**（重做前把原 PDF 复制到 `data/cache/pdf-before-g/`），在 iPad 尺寸、200% 下截同一块区域（Part II 第 1 题那几行）前后对比，连同文件大小（现在 4.9MB）一起放进报告；我看过再决定是否全量。点词坐标是 PDF 点，不受影响。
3. 不要碰矢量卷；`MAX_CANVAS_PIXELS` 保持 12M（Safari 上限约 16.7M）。

## 3. 点单词、点题号会遮住原文 → 底部"答题条"

现在的两个浮层（题号旁的 `G.Popover` 选项框、单词下方的 `WordPopover`）无论放上还是放下都会盖住正在读的几行。改成**一个机制：卷面上只做标记，内容都在卷面底部的一条里**。

1. **答题条**（新组件，放在 `ExamRoom` 的卷面容器底边、状态条之上；听力条打开时叠在听力条上方）：高 56px，白底、上边一条 `var(--line)`，`--elev-2`。
   - 点题号（或完形空位）：题号描蓝框（现状保留），答题条滑上来：`第 3 题 · Ⓐ Ⓑ Ⓒ Ⓓ · 解析 · 标记 · ✕`。字母是 44px 圆钮，选中实心蓝；Shift+字母划掉、R 标记、A–D 直接选，键盘逻辑沿用 `useChoiceKeys`。选词填空、完形（选项是词）用带文字的小胶囊，最多两行、超出横向滚动，条高最多 96px。
   - 点单词：同一条换成查词：`charity /ˈtʃærəti/ 🔊 · n. 慈善，慈善机构；仁爱 · 更多 · + 生词本`，一行，释义截断；"更多"把条展开成底部抽屉（最高 40% 卷面高）显示全部释义和原句。
   - "解析"：条展开成底部抽屉（最高 45% 卷面高，内部滚动）放 §4 的解析卡；再点"解析"或 ✕ 收回；卷面不动、题号保持描蓝。全真模拟交卷前没有"解析"。
   - 同一时间只有一种内容（点词替换题目，点题目替换词）；点卷面空白、Esc 关闭；**卷面滚动不关闭**（它是停靠的，不是浮层）。
   - 鼠标和触屏都用这一套，删掉 `QuestionMarker`/`BlankMarker` 里的 `G.Popover` 和 `ExamRoom` 里的浮动 `WordPopover`（`WordPopover` 组件如果别的页还在用就留着，做题页不用）。
   - 条上只有这一行，没有任何说明小字。
2. **卷面上的标记本身也不能盖字**（这些我在截图里确认过）：
   - 查过的词的"当前"框：透明底 + `0 0 0 1.5px var(--blue)` 描边，不要填充。
   - 选词填空、排序题那种题号在行中间的，选中的字母现在画在题号**上方 26px**（`badge` 的 `inline` 分支），正好压在上一行文字上。改成把字母画在题号框**里面**（蓝底白字的小胶囊盖住题号本身，题号是可以盖的，上一行不行）。
   - 标记小书签 `FlagBadge` 在题号右上角 `top - 10`，也压上一行。放到题号右侧、垂直居中。
   - 单题用时 `TimeTag` 在题号右下 `left: x1 + 3`，正好压在选项 "A)" 开头。挪到左页边（和选中字母同一列、字母下方）；题号在行中间的不显示用时（答题卡上有）。
   - 完形空位里填的词（`BlankMarker` 的 `fill`）已经是按空位宽度缩字号，保留。
3. 验收：iPad 竖屏和横屏各截三张：答题条开着（题目）、答题条开着（单词）、解析抽屉开着；每张里被点的那一题、那一行的原文完整可见。

## 4. 解析"不干脆"

现在的解析卡是一张表（定位 / 思路 / 逐项 / 生词 …），每行一个 40px 的小标签列，读完才知道为什么选 B。改成**先给结论**。`ExplanationCard`（`src/exam/Explanation.tsx`）重做，答题卡面板、错题本、答题条抽屉共用：

1. 第一行：**答案 B**（衬线 18px）；交卷后或练习模式下追加"你选了 A"（红）；AI 补写的加 `AI 解析` 小章。
2. 第二行：**一句话结论**，普通字号，不超过 48 字。来源优先级：`fields.brief`（现在还没有，以后由结构化脚本生成）→ `fields.reasoning` 的第一句（在第一个 。；！处截断；选词、完形取 `grammar` 和 `meaning` 各第一句，拼成"语法…；语义…"）→ 纯文本解析里 【详解】 段的第一句。去掉"本题考查""根据题干定位到原文"这类开头套话（正则去掉常见的 6–8 种即可，不要过度）。
3. 第三行：定位句原文（衬线）+ `在卷面上标出` / `听这一句`（现有逻辑），前面不要"定位"标签列；没有定位句就没有这一行。
4. 然后只有一个 **展开** 按钮：完整思路、逐项、对照表、生词（含"+ 生词本"）、译文、要点/亮点、"解析有问题"全部在里面，默认收起。
5. 去掉 40px 标签列的网格；展开区内用行内加粗的小标题。
6. 没有解析的题还是一句"这道题暂时没有解析"。
7. 验收：在答题条抽屉里打开 `cet4-2025-12-1` 第 26 题（阅读）和第 36 题（选词）各截一张，收起状态三行以内读完。

## 5. 手机自带浏览器"进不去"

现象：首页能开，进试卷一直"正在加载试卷"。`PaperReader` 第 127 行用 `useLiveQuery` 读 `db.attempts`，这类内嵌/自带浏览器的 IndexedDB 常常打开了不回调，页面就永远等着。F 轮的 Safari 唤醒（`db.ts` 末尾）只对 Safari 生效，保留。

做法——**数据库没响应就退到内存库，照样能做题**：

1. `npm i fake-indexeddb`（运行时依赖，内存实现的 IndexedDB，约 30KB gz）。
2. `src/lib/db.ts`：读 `sessionStorage` 里的 `yz-memory-db`（访问要 try/catch），为 `"1"` 时 `new Dexie("yingyu-zhidao", { indexedDB: fakeIndexedDB, IDBKeyRange: fakeIDBKeyRange })`，并导出 `memoryDb: boolean`。
3. 看门狗：`src/main.tsx` 里 `Promise.race([db.open(), 5 秒超时])`；超时且不是内存库、且本次会话没重试过（`yz-memory-db-tried`）→ 写两个标记，`location.reload()`。成功打开就什么都不做。
4. `memoryDb` 为 true 时，应用外壳顶部一行（不要红）："这个浏览器的本地数据库没响应，这次的记录不会保存；用 Chrome 或 Safari 打开可以保存。"
5. 自测：DevTools 里加载前执行 `indexedDB.open = () => ({})`（让它永不回调），刷新后应在 5 秒内自动切到内存库并能打开试卷、选答案、交卷；再把 `indexedDB.open` 恢复，刷新后正常。
6. 手机"比较卡"靠 §1。

## 6. "标签机制也有问题"

在等用户说明是哪个（题号旁的作答标记、便签、标记待检查、还是浏览器标签页）。先不动。

## 7. 报告

写 `G轮-实施报告.md`（放在会话笔记目录，和 F 轮一样），包括：§1 前后两组数字；§2 的前后对比截图和文件大小；§3、§4 的截图；§5 的自测结果；改了哪些文件；没做或没验证的。

**不要动**：`ListeningBar.tsx` 的播放逻辑、`scripts/` 里除 `import_cet.py` 的其他脚本、`public/papers/` 里除 §2 那一套以外的数据、`docs/`。
