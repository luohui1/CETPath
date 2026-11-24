# 设计任务：J 轮——仔细阅读的长难句解析

> 2026-11-19。用户："加入长难句解析……主要是阅读理解的那两篇，其实也只需要这俩"；"UI/UX 和交互比较反人类"。
> 所以只做四六级仔细阅读（Section C，`kind: "reading"`）两篇文章，交互按"少点一下就能看到"来做。

## 1. 数据：`public/papers/syntax/<id>.json`

```jsonc
{
  "id": "cet4-2025-12-1",
  "by": "ai",
  "version": 1,
  "sentences": {
    "2aedd871": {                              // 句子键，同译文层（docs/设计任务-I轮 §0.1）
      "group": "rc1",                          // 哪一篇（题组 id）
      "en": "For decades, researchers who …",  // 原句（卷面 words.json 的 pages[].s，脚本补）
      "main": [                                // 主干，按句中先后；2–5 项
        { "t": "researchers", "r": "主语" },
        { "t": "assumed", "r": "谓语" },
        { "t": "that the ability … was something", "r": "宾语" }
      ],
      "parts": [                               // 从句、修饰成分、特殊结构；0–6 项，可以互相嵌套
        { "t": "who studied how children learn to read", "r": "定语从句", "of": "researchers" }
      ],
      "points": ["主语后面跟了很长的定语从句，谓语 assumed 隔得很远"],  // 难点 1–3 条，每条 ≤ 60 字
      "zh": "几十年来，研究儿童如何学习阅读的研究者一直认为……"         // 按结构拆开后的译文
    }
  }
}
```

- `t`、`of` 必须原样出现在原句里（大小写、空白、弯引号不计，整词匹配）；`r` 只能用 `scripts/build_syntax.py` 里 `ROLES` 的说法。
- 每篇最多 8 句，一般挑 3–6 句真正难的（长度 ≥ 22 词的标成候选，短的倒装、强调句也可以挑）。
- 不涉及答案，交卷前也能看。文件不存在时界面上什么都不显示，不报错。

## 2. 生成：`scripts/build_syntax.py`

```
python -I scripts/build_syntax.py todo data/cache/syntax-work        # 每套列出仔细阅读两篇的句子（*是候选）
# AI 子代理照 DIR/<id>.in.txt 写 DIR/<id>.out.json：{"键": {main, parts, points, zh}}
python -I scripts/build_syntax.py check data/cache/syntax-work <id>  # 自查
python -I scripts/build_syntax.py merge data/cache/syntax-work       # 校验通过的写进 public/papers/syntax/
python -I scripts/build_syntax.py status | show <id>
```

文章在卷面上的范围：第一篇从 Section C 的标题起，后一篇从上一篇最后一题的题号起，到这一篇第一题的题号止；
标题、指导语、题干、选项按句子过滤掉。

## 3. 界面

入口都不新开弹窗，用已有的底部条和停靠区：

1. **卷面**：有解析的句子每个词下面一道浅蓝虚线（`.w.pw.is-long`），不铺底色、不挡字。
2. **长按一句**：这句是长难句时，底部条直接放长难句解析（标题"长难句解析"），不是只有译文——少点一下。
3. **点句里的词**：查词卡多一个"长难句"按钮，点了收起卡片、底部条放解析，卷面上这句淡黄底。
4. **停靠区"长难句 N"标签**：按篇列出，每句一行（原句前两行 + 成分小章），点一句卷面滚到那句、底部条放解析；正在看的那句浅蓝底。
   竖屏抽屉里点了先把抽屉降到最低一档，解析作为抽屉的临时标签。

解析卡（`src/exam/SyntaxCard.tsx`）：原句上直接画结构——主干加粗、下划线按成分上色（主语蓝、谓语红、宾语/表语/补足语绿），
修饰成分用琥珀色 `[ ]` 括起来并编号；下面依次是主干一行、修饰成分（编号对得上括号）、难点、译文（18px，同译文层）。
