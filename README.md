# 英语之道

把"真题"和"背单词"打通的英语学习工具：在真题里点词查词，生词带着真题原句进入记忆复习。

当前是**单机版网页应用（PWA）**：数据存在浏览器本地（IndexedDB），可以"安装"到桌面或手机主屏，离线也能用。

## 功能

- **真题训练**：整套模考，按考试（考研英语一/二、四级、六级）和年份列出套卷
- **专项训练**：按题型（听力、完形、阅读、新题型、翻译、写作）练，每次只做原卷里的一个部分（截取原卷），和整套模考分开计分
- **首页**：只放三件事——接着做题、今日背词、下一个该练的题型
- **原卷做题**：所有试卷都按原卷 PDF 显示；点单词查词（自动还原 studies → study）；点题号或完形空位选答案，空位里直接显示所选的词；交卷判分、看解析；翻译和写作在"作答"面板里写，交卷后对照参考答案；答题卡
- **卷面笔记**：手写笔（支持手写笔压感）、高亮、下划线、便签、橡皮擦，撤销重做；"笔记"面板汇总本卷所有笔记，高亮可以加批注
- **听力播放器**：按段跳转、单段循环、倍速，原文逐句同步高亮，原文里的词也能查
- **生词本**：自动记录真题出处原句，搜索、按试卷筛选、导出 CSV、打印
- **背单词**：FSRS 遗忘曲线调度，认识 / 模糊 / 不认识三档自评，"记错了"可以改评分，单词卡显示真题原句
- **词书**：四级、六级、考研大纲词表，每日新词计划
- **打卡统计**：连续打卡、热力图、未来 7 天复习量、做题正确率
- **答案解析**：交卷后"解析"面板逐题看对错和解析（默认只看错题），解析分【定位】【详解】【排除】等小段，每篇文章可展开全文翻译；官方解析缺失或残缺的由 AI 补写并标注
- **真人发音**：词书里约 6000 个词提前下载了美音、英音真人录音，离线也能播；其他词和句子用系统语音
- **设置**：单词口音（美音 / 英音）、句子发音人、考试倒计时、数据备份导入导出（含卷面笔记）

## 界面

界面组件以团队设计系统 **Grasso** 为准（[设计系统页面](https://claude.ai/artifact/1oMpHtMTbUTVidasT9X2cK)）：

- `src/grasso/` 里的 `bundle.js`、`bundle.css`、`types.d.ts`、`tokens.json` 从设计系统原样复制，不要直接改；`tokens.css` 由 `npm run grasso:tokens` 生成。
- 页面通过 `src/components/ui.tsx`、`src/components/overlay.tsx` 使用 Grasso 组件；页面里的颜色变量（`--primary`、`--surface` 等）都映射到 Grasso 令牌。
- 做题页按 Grasso 的"专业软件工作台"布局：顶栏、工具栏 + 原卷画布、右侧面板、底部听力条和状态栏。
- 卷面快捷键：`V` 选择、`P` 手写笔、`H` 高亮、`U` 下划线、`N` 便签、`E` 橡皮擦、`Esc` 回到选择；`Ctrl+Z` 撤销，`Ctrl+Shift+Z` 重做；选项弹出时按字母键直接选。
- 只做电脑网页端（平板横屏也能用，方便用手写笔做题），最小宽度 1000px。平板上用过手写笔后，手指只用来滚动卷面。

## 开发

需要 Node.js 20 以上。

仓库包含应用源码、图标和 PDF 渲染资源。要在新电脑上使用真题训练、听力和查词，请从本机备份复制 `public/papers/`、`public/audio/` 和 `public/dict/` 到对应目录。重新导入四六级真题时，还需要本机的答案订正表 `scripts/cet_answer_fixes.json`。

```bash
npm install
npm run dev
```

其他命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 类型检查并打包到 `dist/` |
| `npm run preview` | 本地预览打包结果 |
| `npm run check:papers` | 校验试卷 JSON，重新生成试卷目录 |
| `npm run import:kaoyan -- 2019` | 把 `data/raw/kaoyan/` 里的考研英语（一）真题和答案 PDF 导入成原卷（去水印、定位题号和单词） |
| `npm run import:sample` | 从考试院大纲 PDF 导入四级官方样卷（原卷 PDF）；六级用 `python -I scripts/import_neea_sample.py cet6` |
| `npm run inspect:pdf -- 文件.pdf` | 检查一份真题 PDF 能不能直接导入：有没有文字层、是不是乱码、像哪种考试 |
| `npm run organize:cet` | 把放进 `真题/` 的四六级资料包整理成 `真题/四级/2024年12月/2024年12月四级第1套-真题.pdf` 这样的真题库（只收 2015 年以后的真题，硬链接），生成 `真题/清单.md`；加 `-- --clean` 核对后把资料包移到回收站 |
| `npm run build:dict` | 从 ECDICT 重新生成词典数据（需要先把 `ecdict.csv` 放到 `data/raw/ecdict/`） |
| `npm run build:audio` | 用 Windows 自带语音合成示例听力音频 |
| `npm run thumbs` | 给每套试卷生成第一页缩略图 `public/papers/pdf/<id>.thumb.jpg`（真题列表和首页当封面） |
| `npm run polish:explain` | 整理导入时带的解析，写到解析层 `public/papers/explain/`（格式见 docs/试卷数据格式.md） |
| `npm run fetch:word-audio` | 下载词书里所有单词的真人发音到 `public/audio/words/`（有道词典接口，可断点续传；非官方接口，对外发布前要换有授权的来源） |

## 目录

```
docs/                    竞品分析与功能规划、试卷数据格式
public/dict/             词典数据（由 build:dict 生成，约 8MB，按首字母分片按需加载）
public/papers/           试卷 JSON 和目录 index.json；pdf/ 里是原卷和单词坐标
public/audio/            听力音频；words/ 里是单词真人发音（us/、uk/ 和清单 index.json）
scripts/                 数据生成和校验脚本
src/lib/                 数据库、词典、FSRS 调度、试卷类型等
src/components/          可复用组件（查词浮层、听力播放器、热力图…）
src/pages/               页面
```

## 内容与版权

- 词典数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议）。
- 四级样卷来自考试院公开的考试大纲；2019 考研英语（一）真题来自网络公开转载的文字版，只用于内部开发。真题有版权，公开发布前需要取得授权。
- **不要**使用从其他题库网站抓取或下载的题库、PDF、音频和解析。
