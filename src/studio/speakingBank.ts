export type SpeakingCategory = "cet46" | "ielts" | "toefl" | "kaoyan";

export const SPEAKING_CATEGORIES: { id: SpeakingCategory; name: string; short: string }[] = [
  { id: "cet46", name: "四六级口语", short: "四六级" },
  { id: "ielts", name: "雅思口语", short: "雅思" },
  { id: "toefl", name: "托福口语", short: "托福" },
  { id: "kaoyan", name: "考研复试", short: "考研复试" },
];

export interface SpeakingItem {
  id: string;
  category: SpeakingCategory;
  partLabel: string;
  prepSec: number;
  talkSec: number;
  title: string;
  promptEn: string;
  promptZh: string;
  followUps?: string[];
  keyPhrases: { en: string; zh: string }[];
  sampleEn: string;
  sampleZh: string;
  audioUrl?: string;
}

export const BUILTIN_SPEAKING_ITEMS: SpeakingItem[] = [
  // ==================== 四六级口语 CET-SET ====================
  {
    id: "cet-warmup-hometown",
    category: "cet46",
    partLabel: "热身问答 · CET-SET",
    prepSec: 15,
    talkSec: 30,
    title: "介绍你的家乡与变化",
    promptEn: "Where is your hometown, and what is the biggest change you have noticed there in recent years?",
    promptZh: "你的家乡在哪里？近年来你在那里注意到的最大变化是什么？",
    keyPhrases: [
      { en: "be located in", zh: "坐落于" },
      { en: "undergo dramatic changes", zh: "经历巨大变化" },
      { en: "public transportation", zh: "公共交通" },
    ],
    sampleEn:
      "I come from a medium-sized city in central China known for its pleasant pace of life. Over the past few years, the biggest change has been the expansion of green parks and convenient metro lines, which make daily commuting much greener and less stressful for local residents.",
    sampleZh:
      "我来自中国中部一座以生活节奏惬意著称的中等城市。过去几年最大的变化是城市绿地公园的扩建以及便捷地铁线路的开通，让当地居民的日常出行更环保、也更轻松。",
  },
  {
    id: "cet-read-digital",
    category: "cet46",
    partLabel: "短文朗读 · CET-SET6",
    prepSec: 45,
    talkSec: 60,
    title: "数字阅读与深度思考",
    promptEn:
      "Read the short passage aloud with clear pronunciation, natural pausing, and proper stress:\n\nWhile digital devices give us instant access to vast amounts of information, they also fragment our attention. Reading long-form books helps rebuild patience, sharpen critical thinking, and turn scattered facts into lasting understanding.",
    promptZh: "朗读短文并注意意群停顿、重音与连读，之后可用 1–2 句话总结观点。",
    keyPhrases: [
      { en: "instant access to", zh: "即时获取" },
      { en: "fragment our attention", zh: "使注意力碎片化" },
      { en: "lasting understanding", zh: "持久的理解" },
    ],
    sampleEn:
      "While digital devices give us instant access to vast amounts of information, they also fragment our attention. Reading long-form books helps rebuild patience, sharpen critical thinking, and turn scattered facts into lasting understanding.",
    sampleZh:
      "虽然数字设备让我们能够即时获取海量信息，但也使我们的注意力趋于碎片化。阅读长篇书籍有助于重建耐心、磨砺批判性思维，并将零散的事实转化为持久的理解。",
  },
  {
    id: "cet-pres-ai-learning",
    category: "cet46",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "人工智能工具与大学生学习",
    promptEn:
      "How can college students use artificial intelligence tools responsibly without weakening their own independent thinking?",
    promptZh: "大学生应如何负责任地使用人工智能工具，同时不削弱自身的独立思考能力？",
    followUps: [
      "Have you ever noticed a drawback when relying too much on AI tools?",
      "Should universities set clear rules for AI use in coursework?",
    ],
    keyPhrases: [
      { en: "serve as a learning partner", zh: "充当学习伙伴" },
      { en: "verify the reasoning", zh: "核验推理过程" },
      { en: "over-reliance on", zh: "过度依赖" },
    ],
    sampleEn:
      "I think the key is treating AI as a tutor rather than a shortcut. First, students should try drafting an outline or solving a problem on their own before asking AI for feedback. Second, whenever AI gives an explanation or translates a difficult passage, we need to verify the logic and rewrite ideas in our own words. Used this way, technology speeds up routine work while keeping our judgment sharp.",
    sampleZh:
      "我认为关键在于把人工智能当作导师而非捷径。首先，学生在向 AI 寻求反馈前，应先自己尝试列提纲或解题；其次，每当 AI 给出解释或翻译难句时，我们要核查其逻辑并用自己的语言重新表达。如此使用，技术能加速常规任务，同时保持判断力的敏锐。",
  },
  {
    id: "cet-pres-parttime",
    category: "cet46",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "大学生兼职实习利弊",
    promptEn:
      "Some students spend lots of time on part-time jobs during university. What benefits and challenges does this bring?",
    promptZh: "一些大学生在读期间花很多时间兼职，这会带来哪些益处与挑战？",
    followUps: ["What kind of part-time work is most valuable for your major?"],
    keyPhrases: [
      { en: "practical experience", zh: "实践经验" },
      { en: "strike a balance between", zh: "在……之间取得平衡" },
      { en: "time management", zh: "时间管理" },
    ],
    sampleEn:
      "Taking a part-time job or internship in college offers clear advantages. It allows students to apply textbook knowledge in real workplaces, build communication skills, and gain financial independence. However, working too many hours can eat into study time and leave students exhausted before exams. Therefore, setting a weekly limit and choosing roles related to future career goals is the wisest approach.",
    sampleZh:
      "在大学期间做兼职或实习优势明显：能把课本知识应用到真实职场中，锻炼沟通能力并获得经济独立。不过，工作时间过长会挤占学习精力，让学生在考前疲惫不堪。因此，限定每周工时并选择与职业目标相关的岗位是最明智的做法。",
  },
  {
    id: "cet-pres-green-life",
    category: "cet46",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "校园绿色低碳生活方式",
    promptEn: "What small but practical habits can young people adopt to live a more environmentally friendly life on campus?",
    promptZh: "年轻人在校园里可以养成哪些微小却切实可行的环保习惯？",
    followUps: ["Why do some people fail to stick to green habits even when they care about the planet?"],
    keyPhrases: [
      { en: "cut down on single-use plastics", zh: "减少一次性塑料使用" },
      { en: "collective impact", zh: "集体影响力" },
      { en: "food waste", zh: "食物浪费" },
    ],
    sampleEn:
      "Living sustainably on campus doesn't require huge sacrifices. Carrying a reusable tumbler, turning off dormitory lights before leaving, and ordering only as much food as we can finish in the canteen are all simple steps. When thousands of students repeat these habits every day, the collective reduction in waste and energy becomes remarkable.",
    sampleZh:
      "校园低碳生活并不需要做出巨大牺牲。随身携带可重复使用的水杯、离开宿舍前随手关灯、在食堂按需点餐避免剩饭，都是很简单的举动。当成千上万的学生每天坚持这些习惯时，积累起来的节能减废效果就会非常可观。",
  },
  {
    id: "cet-pres-stress",
    category: "cet46",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "应对学业与就业压力",
    promptEn: "How do you usually cope with academic pressure before major exams or deadlines?",
    promptZh: "你在重大考试或截止日期前通常如何调节学业压力？",
    keyPhrases: [
      { en: "break tasks into smaller steps", zh: "将任务拆分为小步骤" },
      { en: "blow off steam", zh: "释放压力" },
      { en: "maintain a regular routine", zh: "保持规律作息" },
    ],
    sampleEn:
      "When exams pile up, panic usually comes from seeing everything as one giant mountain. I cope by breaking my revision into concrete 40-minute blocks and ticking off each completed task. Every evening I also go for a brisk 20-minute walk without my phone, which clears my head and keeps my sleep schedule steady.",
    sampleZh:
      "当考试扎堆时，焦虑往往源于把所有任务看成一座大山。我的应对办法是把复习拆成一个个具体的 40 分钟小块，完成一项勾掉一项。每天晚上我还会不带手机快走 20 分钟，既能理清思绪，也能稳住作息。",
  },
  {
    id: "cet-pair-online-offline",
    category: "cet46",
    partLabel: "双人互动 · CET-SET",
    prepSec: 60,
    talkSec: 90,
    title: "传统文化如何在青年群体中焕发活力",
    promptEn:
      "Traditional festivals and intangible heritage are gaining popularity among young Chinese people. Discuss two effective ways to keep traditional culture engaging for younger generations.",
    promptZh: "传统节日与非遗文化正在年轻人中走红。请论述两种让传统文化持续吸引年轻一代的有效方式。",
    followUps: [
      "What makes cultural creative products at museums so appealing today?",
      "Could excessive commercialization harm the true meaning of heritage?",
    ],
    keyPhrases: [
      { en: "intangible cultural heritage", zh: "非物质文化遗产" },
      { en: "blend tradition with modern design", zh: "将传统与现代设计融合" },
      { en: "interactive experience", zh: "互动体验" },
    ],
    sampleEn:
      "To keep traditional culture alive among young people, we should focus on relevance and participation. On one hand, museums and artisans can combine classic motifs with modern everyday items, turning heritage from glass-case exhibits into things young people actually enjoy using. On the other hand, short documentaries and hands-on workshops let students experience crafts like paper-cutting or tea making firsthand, creating an emotional bond that lasts.",
    sampleZh:
      "要让传统文化在年轻人中保持生命力，关键在于贴近感与参与感。一方面，博物馆与手艺人可以把经典纹样融入现代日用品设计，让非遗从玻璃展柜走进日常使用；另一方面，精良短片与线下手工体验坊能让学生亲手感受剪纸或制茶工艺，从而建立持久的情感共鸣。",
  },
  {
    id: "cet-pres-short-video",
    category: "cet46",
    partLabel: "个人陈述 · CET-SET6",
    prepSec: 45,
    talkSec: 60,
    title: "短视频平台的双刃剑效应",
    promptEn: "Short-video platforms bring entertainment and quick tutorials, yet many people worry about addiction. What is your view?",
    promptZh: "短视频平台带来了娱乐与高效微课，但不少人担忧其成瘾性。你如何看待？",
    keyPhrases: [
      { en: "double-edged sword", zh: "双刃剑" },
      { en: "algorithmic recommendations", zh: "算法推荐" },
      { en: "consume content intentionally", zh: "有意识地浏览内容" },
    ],
    sampleEn:
      "Short videos are a classic double-edged sword. On the positive side, they make science demos, language tips, and cooking tutorials accessible in under three minutes. Yet algorithmic feeds are engineered to keep viewers swiping endlessly, which quietly drains time and weakens deep focus. Personally, I limit my daily screen time and follow only educational creators.",
    sampleZh:
      "短视频是典型的双刃剑。积极的一面在于，它让科普实验、语言技巧和烹饪教学在三分钟内变得触手可及；但算法推荐的设计初衷就是让人无休止地刷下去，悄悄消耗时间并削弱专注力。我个人会限制每日屏幕使用时长，并只关注优质知识类创作者。",
  },
  {
    id: "cet-pres-teamwork",
    category: "cet46",
    partLabel: "个人陈述 · CET-SET",
    prepSec: 45,
    talkSec: 60,
    title: "团队合作中的分歧处理",
    promptEn: "When group members disagree on how to complete a project, what is the best way to resolve the conflict?",
    promptZh: "当小组成员对项目方案产生分歧时，化解矛盾的最佳方式是什么？",
    keyPhrases: [
      { en: "find common ground", zh: "寻求共识" },
      { en: "focus on the goal rather than egos", zh: "聚焦目标而非意气之争" },
      { en: "weigh the pros and cons", zh: "权衡利弊" },
    ],
    sampleEn:
      "Disagreements in teamwork are completely normal, provided we handle them constructively. Instead of debating who is right, the team should list the core goal, ask each member to explain the reasoning behind their idea in two minutes, and test the strongest parts of each proposal. Focusing on evidence rather than personal pride usually brings everyone back onto the same page.",
    sampleZh:
      "团队中的分歧完全正常，关键在于建设性地处理。与其争论谁对谁错，团队不如先明确共同目标，请每位成员用两分钟说明方案依据，并提炼各方案的优势进行整合。把焦点放在客观依据而非个人面子上，往往能让大家迅速达成一致。",
  },

  // ==================== 雅思口语 IELTS ====================
  {
    id: "ielts-p1-work-study",
    category: "ielts",
    partLabel: "IELTS Part 1",
    prepSec: 5,
    talkSec: 30,
    title: "Work or Study · 学业与日常偏好",
    promptEn: "What subject are you studying (or what work do you do), and what part of it do you find most interesting?",
    promptZh: "你目前在学什么专业（或从事什么工作）？其中哪部分最吸引你？",
    followUps: [
      "Do you prefer studying early in the morning or late at night?",
      "How has the way you study changed compared with high school?",
    ],
    keyPhrases: [
      { en: "hands-on projects", zh: "动手实践项目" },
      { en: "bridge theory and real life", zh: "连接理论与现实生活" },
      { en: "a sense of accomplishment", zh: "成就感" },
    ],
    sampleEn:
      "I'm currently a university student majoring in engineering. What fascinates me most isn't memorizing formulas, but working on practical design projects where you see an idea on paper turn into a working model. That moment when a problem finally clicks gives me a huge sense of accomplishment.",
    sampleZh:
      "我目前是一名工科本科生。最吸引我的不是背诵公式，而是做动手设计项目——看着纸面上的构思一步步变成能运转的实物，问题豁然开朗的那一刻非常有成就感。",
  },
  {
    id: "ielts-p1-music",
    category: "ielts",
    partLabel: "IELTS Part 1",
    prepSec: 5,
    talkSec: 30,
    title: "Music & Focus · 听音乐的习惯",
    promptEn: "When do you usually listen to music, and do you ever listen to songs while studying or working?",
    promptZh: "你通常在什么时候听音乐？学习或工作时听歌吗？",
    followUps: ["What kind of music helps you unwind after a long day?"],
    keyPhrases: [
      { en: "instrumental tracks", zh: "纯音乐/器乐曲" },
      { en: "block out background noise", zh: "隔绝环境噪音" },
      { en: "shift my mood", zh: "转换心情" },
    ],
    sampleEn:
      "I usually put on music while commuting or cooking dinner to shift out of work mode. When I'm reading or writing essays, though, songs with lyrics distract me, so I switch to soft instrumental tracks or rain sounds to block out cafe noise.",
    sampleZh:
      "我通常在通勤或做饭时放音乐，帮助自己从工作状态切换出来。不过阅读或写论文时带歌词的歌容易让我分心，所以我只听轻柔的纯音乐或白噪音来隔绝周围的杂音。",
  },
  {
    id: "ielts-p1-transport",
    category: "ielts",
    partLabel: "IELTS Part 1",
    prepSec: 5,
    talkSec: 30,
    title: "Public Transport · 出行方式",
    promptEn: "What form of transport do you use most often, and how could public transport in your city be improved?",
    promptZh: "你最常使用哪种交通工具？你所在城市的公共交通还可以如何改进？",
    keyPhrases: [
      { en: "rush hour congestion", zh: "早晚高峰拥堵" },
      { en: "predictable arrival time", zh: "可预期的到站时间" },
      { en: "last-mile connection", zh: "最后一公里接驳" },
    ],
    sampleEn:
      "I rely mainly on the subway because the arrival times are completely predictable, even during evening rush hour. If one thing could be improved, it would be better shaded walkways and clearer transfer signs connecting metro exits to nearby bus stops.",
    sampleZh:
      "我平时主要坐地铁，因为哪怕在晚高峰，到站时间也完全可预期。如果要提一条改进建议，我希望地铁口到周边公交站之间的换乘指示和遮阳通道能做得更完善。",
  },
  {
    id: "ielts-p2-person",
    category: "ielts",
    partLabel: "IELTS Part 2 · 题卡",
    prepSec: 60,
    talkSec: 120,
    title: "人物题：敬佩的一位老师或长辈",
    promptEn:
      "Describe a person who inspired you to do something interesting or improved the way you learn.\n\nYou should say:\n• who this person is\n• how you got to know them\n• what they said or did\n• and explain why their influence mattered to you.",
    promptZh: "描述一位曾激励你做出有趣尝试或改善你学习方法的人（何时认识、具体做法与对你的深远影响）。",
    keyPhrases: [
      { en: "patient yet rigorous", zh: "耐心而严谨" },
      { en: "change my mindset", zh: "改变我的思维定式" },
      { en: "break down complex problems", zh: "拆解复杂问题" },
    ],
    sampleEn:
      "I'd like to talk about my high-school physics teacher, Mr. Lin. When I first entered senior high, I was terrified of long problem sets and memorized solutions mechanically. After I failed a midterm, Mr. Lin didn't criticize my score; instead, he sat down with me for twenty minutes and asked me to draw the scenario before touching a single equation. He said, 'If you can picture what happens in three seconds, half the math solves itself.' From then on, I stopped cramming formulas and started questioning how concepts actually work. That habit still shapes how I approach difficult readings and research today.",
    sampleZh:
      "我想谈谈我的高中物理老师林老师。刚上高中时我特别怕大题，总是机械背解题模板。一次期中考砸后，林老师没有责怪我的分数，而是留了我二十分钟，让我先画情景草图再动公式。他对我说：“只要脑子里能在三秒内还原物理过程，算式自然就出来了。”从那以后我不再死记硬背，而是习惯先理解底层原理。这个思维习惯至今仍在帮助我攻克长难句阅读和科研难题。",
  },
  {
    id: "ielts-p2-skill",
    category: "ielts",
    partLabel: "IELTS Part 2 · 题卡",
    prepSec: 60,
    talkSec: 120,
    title: "事件题：通过反复练习学会的新技能",
    promptEn:
      "Describe a practical skill you learned outside school that took patience and practice.\n\nYou should say:\n• what the skill was\n• why you decided to learn it\n• how you practiced and overcame difficulties\n• and explain how you feel about having this skill now.",
    promptZh: "描述一项你在校外学到的、需要耐心练习的实用技能（缘由、克服困难的过程及现在的感受）。",
    keyPhrases: [
      { en: "hit a plateau", zh: "遇到瓶颈期" },
      { en: "muscle memory", zh: "肌肉记忆" },
      { en: "consistent daily practice", zh: "每天坚持练习" },
    ],
    sampleEn:
      "Two summers ago, I taught myself touch-typing and keyboard shortcuts because watching myself hunt and peck while writing essays felt painfully slow. For the first ten days my accuracy dropped even lower than before, and I was tempted to look down at the keys. To fix that, I covered my hands with a light towel and practiced fifteen minutes every night on short articles. After three weeks, my fingers built real muscle memory, and today my typing speed has nearly doubled without any effort.",
    sampleZh:
      "两年前的暑假，我自学了盲打和常用快捷键，因为写论文时低头“一指禅”实在太慢了。头十天准确率比以前还低，好几次差点破功偷看键盘。后来我干脆拿条薄毛巾盖住手，每晚对着短文练十五分钟。三周后手指形成了肌肉记忆，现在不用低头，打字速度也翻了将近一倍。",
  },
  {
    id: "ielts-p2-place",
    category: "ielts",
    partLabel: "IELTS Part 2 · 题卡",
    prepSec: 60,
    talkSec: 120,
    title: "地点题：让你感到平静并恢复精力的地方",
    promptEn:
      "Describe an outdoor or indoor place near where you live where you go to relax and recharge.\n\nYou should say:\n• where it is and what it looks like\n• when you usually go there\n• what you do there\n• and explain why it helps you unwind.",
    promptZh: "描述一个离你住处不远、能让你放松充电的地方（位置外貌、常去时间、常做的事与解压原因）。",
    keyPhrases: [
      { en: "tucked away from", zh: "隐匿于喧嚣之外" },
      { en: "a welcome escape from", zh: "难得的避风港" },
      { en: "clear my mind", zh: "放空思绪" },
    ],
    sampleEn:
      "My favorite spot to recharge is a quiet riverside path about ten minutes' walk from my apartment. Unlike busy shopping streets, the path is lined with tall willow trees and wooden benches overlooking slow-moving water. I usually go there around sunset on weekends, leave my headphones in my pocket, and just watch local retirees walking their dogs or flying kites. Listening to wind through the leaves instead of notifications immediately slows my breathing and gives me fresh perspective.",
    sampleZh:
      "我最喜欢的充电之地是离公寓步行十分钟的一条静谧河畔步道。和热闹的商业街不同，小路两旁种满垂柳，岸边摆着木长椅。我常在周末日落时分过去，把耳机揣进兜里，单纯看看老人遛狗或放风筝。耳边只有风吹树叶的沙沙声而不是手机通知，很快就能让我静下心来。",
  },
  {
    id: "ielts-p2-timesaver",
    category: "ielts",
    partLabel: "IELTS Part 2 · 题卡",
    prepSec: 60,
    talkSec: 120,
    title: "方法题：显著提高效率的一个日常改变",
    promptEn:
      "Describe an effective change you made in your daily routine that saved you time or boosted efficiency.\n\nYou should say:\n• what the change was\n• what problem you had before\n• how you put it into practice\n• and explain how much difference it has made.",
    promptZh: "描述你在日常生活中做出的一项节省时间或提升效率的改变。",
    keyPhrases: [
      { en: "batch similar tasks together", zh: "将同类任务打包处理" },
      { en: "context switching", zh: "注意力/任务切换损耗" },
      { en: "free up unbroken blocks of time", zh: "腾出整块专注时间" },
    ],
    sampleEn:
      "A small change that saved me hours every week was batching my errands and messages instead of reacting to every ping immediately. Previously, I checked group chats every ten minutes while studying, which broke my concentration and turned a one-hour assignment into three. Now I silence non-urgent alerts until noon and 6 PM, handle every message at once, and protect the morning purely for demanding reading and listening practice.",
    sampleZh:
      "有个小习惯每周帮我省下好几个小时，就是把杂事和回消息集中打包处理，而不是手机一响就马上点开。以前学习时每十分钟看一次群消息，注意力被切碎，一小时的作业能拖成三小时。现在我把非紧急通知静音，统一在中午十二点和傍晚六点集中回复，把上午的整块黄金时间留给精读和精听。",
  },
  {
    id: "ielts-p3-tech-rel",
    category: "ielts",
    partLabel: "IELTS Part 3 · 深度追问",
    prepSec: 10,
    talkSec: 60,
    title: "深度探讨：即时通讯是拉近还是疏远了人际关系",
    promptEn: "Do messaging apps bring friends and families closer together, or do they weaken genuine face-to-face connection?",
    promptZh: "即时通讯软件究竟拉近了亲友关系，还是削弱了真实的面对面交流？",
    followUps: [
      "Why do younger people often prefer texting over making a voice call?",
    ],
    keyPhrases: [
      { en: "bridge geographical distance", zh: "跨越地理距离" },
      { en: "superficial interaction", zh: "浅层互动" },
      { en: "non-verbal cues", zh: "非语言信号" },
    ],
    sampleEn:
      "I think messaging apps do both, depending on how people use them. For friends living in different cities or time zones, quick voice notes and photo updates keep everyday warmth alive across huge distances. Yet when people sit at the same dinner table staring at separate screens, digital chatter replaces genuine conversation, where tone of voice and eye contact build real trust.",
    sampleZh:
      "我认为这取决于使用方式。对于异地或跨时区的亲友而言，随手发送语音和生活照片跨越了地理距离，维系了日常温度；但如果大家明明坐在同一张餐桌前却各自低头刷手机，线上闲聊就取代了需要眼神交流和语气感知的真实沟通。",
  },
  {
    id: "ielts-p3-city-life",
    category: "ielts",
    partLabel: "IELTS Part 3 · 深度追问",
    prepSec: 10,
    talkSec: 60,
    title: "深度探讨：大城市发展与历史街区保护",
    promptEn: "When cities modernize quickly, should historic neighborhoods be preserved even if land is expensive?",
    promptZh: "在城市快速现代化过程中，即使地价高昂，历史街区是否也应当被保留？",
    keyPhrases: [
      { en: "collective memory", zh: "集体记忆" },
      { en: "adaptive reuse", zh: "活化利用/适应性改造" },
      { en: "uniform skyline", zh: "千篇一律的城市天际线" },
    ],
    sampleEn:
      "Yes, preserving historic quarters is essential, though it works best through adaptive reuse rather than freezing buildings like empty museums. Modern glass skyscrapers look nearly identical from one metropolis to another, whereas old brick lanes hold a city's character and collective memory. Renovating the interiors for bookstores, studios, or community cafes keeps heritage both financially viable and vibrant.",
    sampleZh:
      "应当保护历史街区，但最好的方式是“活化利用”而非把老建筑封存成空洞的标本。现代玻璃幕墙高楼在各大都市几乎如出一辙，唯有老砖巷弄承载着一座城市的性格与集体记忆。如果能保留外部风貌，同时将内部改造成书店、工作室或社区咖啡馆，就能兼具文化温度与经济活力。",
  },

  // ==================== 托福口语 TOEFL Independent ====================
  {
    id: "toefl-t1-study-mode",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "独立学习 vs 小组学习",
    promptEn:
      "Some students prefer to study alone in a quiet room, while others prefer studying in a small group so they can discuss ideas. Which do you prefer and why?",
    promptZh: "有些学生喜欢在安静的房间里独自学习，另一些则喜欢小组讨论。你更倾向哪一种？请给出两个理由或具体例子。",
    keyPhrases: [
      { en: "control my own pace", zh: "掌控自己的节奏" },
      { en: "uncover blind spots", zh: "发现思维盲区" },
      { en: "for the following two reasons", zh: "基于以下两个原因" },
    ],
    sampleEn:
      "Personally, I strongly prefer studying alone first and joining a group only for quick review. On one hand, studying solo gives me full control over my pace: when I already understand a chapter, I can skim ahead, and when a sentence is dense, I can replay it three times without feeling rushed. On the other hand, group sessions often drift into casual chat about unrelated topics. Staying solo keeps my focus unbroken and cuts study time in half.",
    sampleZh:
      "就我个人而言，我更倾向于先独自学习，只在最后阶段简单和小组核对。一方面，独自学习让我能完全掌控节奏：熟悉的内容快速过，遇到难句可以反复听读三遍而不用迁就他人速度；另一方面，小组学习往往容易聊偏。独自学习能保持整块专注，让效率提高一倍。",
  },
  {
    id: "toefl-t1-city-town",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "毕业后留在超大城市还是选择宜居二三线城市",
    promptEn:
      "After graduation, would you prefer starting your career in a bustling major metropolis or in a smaller, quieter city? Use details and examples.",
    promptZh: "毕业后你更愿意在繁华大都市开启职业生涯，还是选择安静宜居的小城市？请用细节与例子说明。",
    keyPhrases: [
      { en: "career mobility", zh: "职业流动与晋升空间" },
      { en: "cost of living", zh: "生活成本" },
      { en: "diverse industries", zh: "多元产业环境" },
    ],
    sampleEn:
      "Right after graduation, I'd definitely choose a major metropolis for the first three to five years. First, big cities concentrate innovative companies and mentors under one roof, meaning if one role doesn't fit, you have far more room to pivot and grow quickly. Second, attending open lectures, workshops, and industry meetups pushes you to stay sharp. Even though rent is higher, early-career exposure pays off over the long run.",
    sampleZh:
      "刚毕业的头三到五年，我一定会选择大都市。首先，大城市汇聚了更多创新企业和资深前辈，即便第一份工作不够契合，也有更多转岗和成长空间；其次，丰富的公开讲座与行业交流能倒逼自己不断进步。虽然房租偏高，但职业初期的眼界积累从长远看非常划算。",
  },
  {
    id: "toefl-t1-online-class",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "线上视频课 vs 线下实体课堂",
    promptEn:
      "Do you agree or disagree that recorded online courses can completely replace traditional in-person university lectures?",
    promptZh: "你是否赞同“录播网课可以完全取代传统大学线下课堂”？请说明理由。",
    keyPhrases: [
      { en: "flexible scheduling", zh: "灵活安排时间" },
      { en: "spontaneous debate", zh: "即兴思想碰撞" },
      { en: "peer accountability", zh: "同伴监督氛围" },
    ],
    sampleEn:
      "I disagree that recorded online classes can replace physical lectures entirely. While online videos are awesome for pausing and rewatching complex explanations at 1.25x speed, in-person classrooms provide real-time chemistry you can't stream. When a professor pauses after a bold question and students debate face to face, ideas stick in your memory much longer. Plus, walking into a classroom creates natural discipline that stops procrastination.",
    sampleZh:
      "我不同意录播网课能完全取代线下课堂。虽然网课非常适合按 1.25 倍速或反复暂停回看难点讲解，但实体课堂拥有屏幕无法替代的即时互动张力——教授抛出问题、同学们当面争鸣时激发的记忆远比单向看视频深刻。此外，走进教室本身也提供了天然的自律约束。",
  },
  {
    id: "toefl-t1-spend-save",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "积攒存款 vs 消费旅行和技能课程",
    promptEn:
      "Is it better for young adults to save extra money for the future or spend it on travel and learning experiences right now?",
    promptZh: "对刚步入社会的年轻人来说，是把结余存起来应对未来更好，还是趁现在花在旅行和体验学习上更好？",
    keyPhrases: [
      { en: "emergency cushion", zh: "应急资金缓冲" },
      { en: "broaden one's horizon", zh: "拓宽视野" },
      { en: "compound benefit", zh: "复利价值" },
    ],
    sampleEn:
      "I think spending thoughtfully on experiences—after setting aside a modest emergency cushion—is the smarter move. Material gadgets lose value within a year, whereas taking a specialized course or traveling to an unfamiliar region expands how you think and solve problems for decades. When I saved up for a volunteer camp two summers ago, I built confidence and friendships that no bank statement could ever match.",
    sampleZh:
      "我认为在留出基本应急存款的前提下，更值得把钱花在经历与成长上。电子产品不到一年就会贬值，但一次专项课程或走出舒适区的旅行所开拓的眼界会受益几十年。前年夏天我用攒下的钱参加了一次跨城支教营，收获的自信与挚友是账面存款无法比拟的。",
  },
  {
    id: "toefl-t1-boss-feedback",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "工作/学业评价：严厉直接指出问题 vs 温和鼓励为主",
    promptEn:
      "When you receive feedback on your work, do you prefer a teacher or manager who points out mistakes directly or one who focuses mainly on encouragement?",
    promptZh: "当老师或上司对你进行评价时，你更喜欢直截了当指出错误的人，还是以肯定鼓励为主的人？",
    keyPhrases: [
      { en: "pinpoint flaws quickly", zh: "快速定位漏洞" },
      { en: "actionable advice", zh: "可落地的改进建议" },
      { en: "polite vagueness", zh: "礼貌的含糊其辞" },
    ],
    sampleEn:
      "I prefer direct, constructive criticism paired with specific fixes. First, blunt feedback saves time because polite vagueness often hides a real flaw until it's too late to repair before a deadline. Last semester, my lab advisor pointed out three shaky assumptions in my draft on the spot, which hurt for five minutes—yet fixing them lifted our paper's grade from a B to an A.",
    sampleZh:
      "我更喜欢带有具体修改建议的直接批评。首先，直白指出问题最省时间——过于委婉的含糊表扬常常会掩盖隐患，等到截止前才发现就来不及了。上学期导师当场挑出我论文草稿里的三个逻辑漏洞，虽然当下有点受挫，但及时改完后成绩直接从 B 提到了 A。",
  },
  {
    id: "toefl-t1-library-budget",
    category: "toefl",
    partLabel: "TOEFL Task 1 · 15s / 45s",
    prepSec: 15,
    talkSec: 45,
    title: "学校预算投向：升级实验室与图书馆 vs 修建体育休闲设施",
    promptEn:
      "If your university received a large donation, should it spend the money on modernizing laboratories and libraries or building new sports and recreation centers?",
    promptZh: "如果大学获得一笔大额捐赠，应优先投入升级实验室与图书馆，还是新建体育休闲中心？",
    keyPhrases: [
      { en: "core academic mission", zh: "核心学术使命" },
      { en: "long-term return", zh: "长期回报" },
      { en: "hands-on research", zh: "前沿实验研究" },
    ],
    sampleEn:
      "In my view, modernizing labs and libraries clearly deserves top priority. A university's core mission is producing knowledge and preparing students for competitive careers, and outdated lab instruments hold back serious research. Once students graduate with stronger portfolios built in top-notch labs, they earn more and often donate back to support campus athletics as well.",
    sampleZh:
      "我认为升级实验室与图书馆理应排在首位。大学的核心使命是科研育人与培养专业竞争力，陈旧的实验仪器和数据库会直接拖慢研究步伐。当学生在更优质的科研环境中做出成果、走上理想岗位后，反而有余力反哺母校去建设更好的体育与休闲设施。",
  },

  // ==================== 考研复试口语 ====================
  {
    id: "ky-retest-intro",
    category: "kaoyan",
    partLabel: "考研复试 · 英文自我介绍",
    prepSec: 30,
    talkSec: 90,
    title: "1分钟至1分半学术型英文自我介绍",
    promptEn:
      "Good morning! Could you briefly introduce yourself, your undergraduate background, and why you wish to pursue graduate study here?",
    promptZh: "早上好！请简要做个英文自我介绍，说明你的本科背景以及选择在这里攻读研究生的原因。",
    keyPhrases: [
      { en: "lay a solid foundation in", zh: "在……方面打下扎实基础" },
      { en: "spark my curiosity", zh: "激发了我的探索欲" },
      { en: "deepen my expertise", zh: "深化我的专业造诣" },
    ],
    sampleEn:
      "Good morning, professors. I'm glad to be here today. Over the past four years as an undergraduate, I've built a solid foundation in core coursework while maintaining a steady ranking in the top twenty percent of my class. During my junior year, I assisted on an applied research project analyzing real-world data, which sparked my strong interest in solving open-ended problems independently. I applied to your university because of the faculty's impressive work in this exact direction, and I hope to contribute both diligence and fresh energy during my master's studies.",
    sampleZh:
      "各位教授早上好，很荣幸参加今天的复试。本科四年我在专业核心课程上打下了扎实基础，成绩稳居年级前 20%。大三期间我参与了一项基于真实数据的应用研究项目，这激发了我独立探索前沿问题的浓厚兴趣。之所以报考贵校，正是被导师团队在该方向的深耕成果所吸引，希望未来能在硕士阶段踏实钻研、有所贡献。",
  },
  {
    id: "ky-retest-project",
    category: "kaoyan",
    partLabel: "考研复试 · 科研与毕设",
    prepSec: 20,
    talkSec: 60,
    title: "介绍印象最深的一段本科项目或毕业设计",
    promptEn:
      "Could you tell us about a research project or your undergraduate thesis, especially the biggest challenge you overcame?",
    promptZh: "请介绍一项你参与过的科研项目或你的本科毕业设计，重点谈谈你在其中攻克的最大困难。",
    followUps: [
      "What was your specific role in the team?",
      "If you could redo that project today, what would you improve?",
    ],
    keyPhrases: [
      { en: "identify the root cause", zh: "定位根本原因" },
      { en: "iterate through solutions", zh: "反复迭代优化方案" },
      { en: "validate with controlled experiments", zh: "通过对照实验验证" },
    ],
    sampleEn:
      "In my senior thesis, I focused on improving model accuracy under noisy real-world inputs. Initially, our baseline performed well on clean lab datasets but dropped sharply on field samples. Instead of tweaking parameters blindly, I carefully inspected dozens of failed cases and realized the distortion came from inconsistent preprocessing. After writing an automated normalization step and running controlled comparisons, the error rate fell by nearly twenty percent. That taught me the habit of diagnosing root causes before optimizing.",
    sampleZh:
      "在我的本科毕业设计中，我主要研究如何提升系统在嘈杂真实输入下的准确率。起初基准方案在标准数据集上表现很好，一到真实样本效果就明显下滑。我没有盲目调参，而是逐条排查了数十个出错样本，发现误差源于预处理标准不统一。重写归一化校验流程并做对照实验后，错误率降低了近 20%。这段经历让我养成了先定位根因再动手优化的科研习惯。",
  },
  {
    id: "ky-retest-why-uni",
    category: "kaoyan",
    partLabel: "考研复试 · 择校与研究方向",
    prepSec: 15,
    talkSec: 60,
    title: "为什么报考本专业与本校？",
    promptEn: "Why did you choose this particular discipline and our department for your master's degree?",
    promptZh: "你为什么选择报考本专业以及我们学院攻读硕士学位？",
    keyPhrases: [
      { en: "bridge theory with practical demand", zh: "兼具学术前沿与实际应用价值" },
      { en: "interdisciplinary atmosphere", zh: "跨学科研究氛围" },
      { en: "align closely with my interests", zh: "与我的研究兴趣高度契合" },
    ],
    sampleEn:
      "Two reasons drew me closely to your department. First, the curriculum strikes an ideal balance between solid theoretical rigor and real-world industry relevance, rather than treating research in isolation. Second, I've read several recent papers published by professors here on efficient optimization, and their clear problem-driven style matches what I hope to pursue. Being immersed in this collaborative academic environment would help me grow from a passive learner into an independent researcher.",
    sampleZh:
      "主要有两方面原因吸引我报考贵院。第一，贵院的培养方案兼具扎实的理论深度与产业应用导向，不是闭门造车；第二，我拜读过学院几位教授近年来在高效优化方向发表的论文，问题意识非常鲜明，与我期望的研究路线高度契合。置身这样开放协作的学术氛围中，能帮助我从被动学习者成长为独立研究者。",
  },
  {
    id: "ky-retest-plan",
    category: "kaoyan",
    partLabel: "考研复试 · 读研规划",
    prepSec: 15,
    talkSec: 60,
    title: "研究生三年学业与科研规划",
    promptEn: "Do you have a concrete study plan for the next two or three years if you are admitted to our program?",
    promptZh: "如果顺利录取，你对未来两到三年的研究生阶段有什么具体规划？",
    keyPhrases: [
      { en: "narrow down a specific topic", zh: "聚焦具体研究课题" },
      { en: "literature review", zh: "文献综述" },
      { en: "publish quality work / graduate with solid competence", zh: "产出高质量成果并练就过硬本领" },
    ],
    sampleEn:
      "If fortunate enough to be admitted, I've mapped my graduate years into three stages. In the first year, I plan to complete core courses with strong grades while reading classic and recent top-journal literature to spot promising gaps. In the second year, I aim to dive deep into lab experiments and regular seminar discussions, ideally producing at least one solid paper or technical report. In the final year, I will polish my thesis thoroughly and prepare for either doctoral research or specialized R&D roles.",
    sampleZh:
      "如果有幸获得录取机会，我将研究生阶段分为三个步骤：研一高质量修完核心课程，并精读本领域经典与最新顶刊文献以确定具体切入点；研二全身心投入课题实验与组会讨论，争取产出一篇扎实的学术论文或高质量研究报告；研三精心打磨学位论文，为进一步深造攻博或进入核心研发岗位做好充分准备。",
  },
  {
    id: "ky-retest-weakness",
    category: "kaoyan",
    partLabel: "考研复试 · 优缺点与抗压",
    prepSec: 15,
    talkSec: 60,
    title: "你的优势、短板及如何克服科研挫折",
    promptEn: "What is your greatest strength as a learner, and what is one weakness you are actively working to improve?",
    promptZh: "作为一名学生，你最大的学习优势是什么？目前仍在着力改进的一点短板又是什么？",
    keyPhrases: [
      { en: "stick with a tough problem", zh: "啃硬骨头的韧劲" },
      { en: "perfectionism at the early stage", zh: "起步阶段过度追求完美" },
      { en: "seek timely feedback", zh: "及时寻求反馈" },
    ],
    sampleEn:
      "My biggest strength is persistence when facing unfamiliar material—once I set a clear milestone, I won't back down just because the first few attempts fail. As for weaknesses, I used to spend too long polishing minor details before asking mentors for early feedback, which occasionally slowed progress. Recently, I've corrected this by sharing brief weekly summaries early so mistakes get caught right at the start.",
    sampleZh:
      "我最大的优势在于面对未知知识时的钻研韧劲——一旦设定明确目标，不会因为头几次碰壁就轻言放弃。至于短板，以前我在拿不准的细节上容易反复纠结、不敢过早向老师请教，导致推进偏慢。最近我已经改成在起步阶段先做简短周报主动沟通，把方向偏差尽早消灭在萌芽阶段。",
  },
  {
    id: "ky-retest-hometown-uni",
    category: "kaoyan",
    partLabel: "考研复试 · 本科院校与成长",
    prepSec: 15,
    talkSec: 60,
    title: "如何看待自己本科四年的遗憾与收获",
    promptEn: "Looking back at your undergraduate years, what is the most valuable lesson you learned beyond textbooks?",
    promptZh: "回望本科四年，除了课本知识之外，你收获的最宝贵一课是什么？",
    keyPhrases: [
      { en: "take ownership of my learning", zh: "真正为自己的学习负责" },
      { en: "self-directed reading", zh: "自主拓展阅读" },
      { en: "step outside my comfort zone", zh: "走出舒适区" },
    ],
    sampleEn:
      "The biggest lesson I learned outside textbooks was taking full ownership of my growth. In freshman year, I waited passively for teachers to assign homework. Later, when joining an interdisciplinary competition with senior students, I had to search literature in English and pick up new tools overnight on my own. That taught me that true competence is built in the hours nobody mandates.",
    sampleZh:
      "本科期间书本之外最大的收获，是学会了完全为自己的成长负责。大一时我还停留在等老师布置作业的被动模式；后来和学长学姐组队参加跨学科竞赛，我被迫连夜检索英文文献并自学新工具。那段经历让我彻底明白，真正的实力都是在无人强制的自主投入时间里练出来的。",
  },
];

let optionalIeltsCache: Promise<SpeakingItem[]> | null = null;

/**
 * 如果服务器上额外部署了 `/ielts/speaking.json` 题库，静默合并进「雅思口语」分类；
 * 严格校验 JSON 响应头，避免 SPA 路由回落返回的 index.html 被误解析。
 */
export function loadOptionalIeltsSpeaking(): Promise<SpeakingItem[]> {
  if (!optionalIeltsCache) {
    optionalIeltsCache = (async () => {
      try {
        const res = await fetch("/ielts/speaking.json");
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok || !/json/i.test(ct)) return [];
        const raw = (await res.json()) as {
          topics?: Array<{
            id?: string;
            name?: string;
            kind?: "part1" | "part2";
            title?: string;
            titleZh?: string;
            questions?: Array<{
              id?: string;
              part?: number;
              question?: string;
              hint?: string;
              answer?: string;
              model?: string;
              examiner?: Array<{ accent?: string; src?: string }>;
              q?: string;
              qZh?: string;
              sample?: string;
              sampleZh?: string;
              audio?: string;
            }>;
          }>;
        };
        const out: SpeakingItem[] = [];
        for (const t of raw.topics ?? []) {
          const qs = t.questions ?? [];
          // 每个话题取首道代表题，避免上千小题铺开导致列表过长
          const rep =
            qs.find((x) => x.id && (x.question || x.q) && (t.kind !== "part2" || x.part === 2)) ??
            qs.find((x) => x.id && (x.question || x.q));
          if (!rep || !rep.id) continue;
          const promptEn = (rep.question || rep.q || "").trim();
          if (!promptEn) continue;
          const part = rep.part === 2 ? 2 : rep.part === 3 ? 3 : 1;
          const followUps = qs
            .filter((x) => x !== rep && (x.question || x.q))
            .map((x) => (x.question || x.q || "").trim())
            .filter(Boolean)
            .slice(0, 4);
          out.push({
            id: `ielts-ext-${rep.id}`,
            category: "ielts",
            partLabel: `IELTS Part ${part}`,
            prepSec: part === 2 ? 60 : 10,
            talkSec: part === 2 ? 120 : 45,
            title: t.titleZh || t.title || t.name || `IELTS Part ${part}`,
            promptEn,
            promptZh: rep.hint || rep.qZh || "",
            ...(followUps.length ? { followUps } : {}),
            keyPhrases: [],
            sampleEn: rep.answer || rep.sample || "",
            sampleZh: rep.sampleZh || "",
            audioUrl: rep.model || rep.audio || rep.examiner?.[0]?.src,
          });
        }
        return out;
      } catch {
        return [];
      }
    })();
  }
  return optionalIeltsCache;
}
