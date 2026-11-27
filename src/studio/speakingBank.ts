export type SpeakingCategory = "cet4" | "cet6" | "kaoyan1" | "ielts";

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
  // ==================== 四级口语 CET-SET4 (8 题) ====================
  {
    id: "cet4-warmup-hometown",
    category: "cet4",
    partLabel: "Task 1 · 热身问答",
    prepSec: 15,
    talkSec: 30,
    title: "介绍你的家乡与近年变化",
    promptEn: "Where is your hometown, and what is the biggest change you have noticed there in recent years?",
    promptZh: "你的家乡在哪里？近年来你在那里注意到的最大变化是什么？",
    keyPhrases: [
      { en: "be located in", zh: "坐落于" },
      { en: "undergo noticeable changes", zh: "经历明显变化" },
      { en: "convenient public transport", zh: "便捷的公共交通" },
    ],
    sampleEn:
      "I come from a quiet city in central China famous for its local snacks. Over the past few years, the biggest change is that more neighborhood parks and clean metro lines have opened, so commuting and evening walks are much easier for residents.",
    sampleZh:
      "我来自中国中部一座以特色小吃闻名的安逸城市。过去几年最大的变化是家门口多了不少社区公园和干净便捷的地铁线路，大家日常通勤和傍晚散步都轻松了许多。",
  },
  {
    id: "cet4-read-campus-reading",
    category: "cet4",
    partLabel: "Task 2 · 短文朗读",
    prepSec: 45,
    talkSec: 60,
    title: "放慢节奏，重拾纸质阅读的专注",
    promptEn:
      "Read the passage aloud with clear pronunciation, natural pausing, and proper stress:\n\nReading a full book requires patience that short phone messages rarely train. When students set aside twenty quiet minutes after dinner to turn real pages, their vocabulary grows naturally and their minds feel calmer before sleep.",
    promptZh: "清晰流畅朗读短文，注意停顿、重音与连读。",
    keyPhrases: [
      { en: "set aside twenty quiet minutes", zh: "留出二十分钟安静时间" },
      { en: "turn real pages", zh: "翻阅纸质书页" },
      { en: "feel calmer before sleep", zh: "睡前心境更平和" },
    ],
    sampleEn:
      "Reading a full book requires patience that short phone messages rarely train. When students set aside twenty quiet minutes after dinner to turn real pages, their vocabulary grows naturally and their minds feel calmer before sleep.",
    sampleZh:
      "读完一整本书需要耐心，而手机上的短消息很少锻炼这种能力。如果学生能在晚饭后留出二十分钟静静翻阅纸质书页，词汇量会自然增长，睡前的心境也会更加平和。",
  },
  {
    id: "cet4-qa-club",
    category: "cet4",
    partLabel: "Task 2 · 考官问答",
    prepSec: 15,
    talkSec: 30,
    title: "一次有意义的校园社团或志愿经历",
    promptEn: "Have you ever joined a university club or volunteer activity? What did you learn from it?",
    promptZh: "你参加过大学社团或志愿活动吗？从中收获了什么？",
    keyPhrases: [
      { en: "help incoming freshmen settle in", zh: "帮助大一新生适应校园" },
      { en: "step out of my shell", zh: "走出舒适圈，变得更开朗" },
      { en: "work smoothly with strangers", zh: "与陌生伙伴顺畅配合" },
    ],
    sampleEn:
      "Yes, last September I volunteered to welcome incoming freshmen at the railway station. Guiding tired students to dorms and answering endless questions taught me how to stay patient under pressure and cooperate smoothly with classmates I had just met.",
    sampleZh:
      "有的，去年九月我报名担任迎新志愿者，在火车站引导新生。带着疲惫的新生去宿舍并耐心解答各种问题，让我学会了在忙碌中保持耐心，也学会了和新认识的同学顺畅配合。",
  },
  {
    id: "cet4-pres-study-place",
    category: "cet4",
    partLabel: "Task 3 · 个人陈述（1分钟）",
    prepSec: 45,
    talkSec: 60,
    title: "图书馆自习 vs 宿舍线上学习",
    promptEn: "Compare studying in the university library with studying online in a dormitory. Which helps you learn better?",
    promptZh: "对比在图书馆自习与在宿舍上网课学习的利弊，你认为哪种更有助于学习？",
    followUps: ["What distracts students most when they study in their dorm rooms?"],
    keyPhrases: [
      { en: "focused atmosphere", zh: "专注氛围" },
      { en: "be tempted to lie down", zh: "容易忍不住躺下" },
      { en: "stay alert and disciplined", zh: "保持清醒与自律" },
    ],
    sampleEn:
      "Although studying in a dormitory saves walking time, I learn much better in the university library. Seeing everyone around me quietly reading creates a focused atmosphere that stops me from checking my phone every five minutes. In the dorm, seeing my bed right beside the desk always makes it tempting to take a nap instead of finishing assignments on time.",
    sampleZh:
      "虽然在宿舍学习能省去往返路程，但我在图书馆的效率高得多。周围所有人都在安静看书，这种专注氛围会督促我别老掏手机；而在宿舍里，床就在书桌旁边，很容易学着学着就想小睡一觉，拖慢进度。",
  },
  {
    id: "cet4-pres-exercise",
    category: "cet4",
    partLabel: "Task 3 · 个人陈述（1分钟）",
    prepSec: 45,
    talkSec: 60,
    title: "规律运动如何缓解考试压力",
    promptEn: "How does regular physical exercise help college students deal with academic stress?",
    promptZh: "规律的体育锻炼如何帮助大学生应对学业压力？",
    keyPhrases: [
      { en: "clear my head", zh: "清空思绪、放松大脑" },
      { en: "improve sleep quality", zh: "改善睡眠质量" },
      { en: "return to my desk refreshed", zh: "精神焕发地回到书桌前" },
    ],
    sampleEn:
      "Regular exercise is one of the cheapest and best ways to relieve exam stress. Whenever I feel stuck memorizing vocabulary or writing essays, jogging three laps around the campus track clears my head immediately. After sweating for half an hour, I sleep deeper at night and return to my desk the next morning feeling far more energetic.",
    sampleZh:
      "规律运动是性价比最高的减压方式。每当我背单词背到烦躁或者写论文卡壳时，去学校操场慢跑三圈，脑子很快就能清醒下来。出汗半小时后晚上睡得更香，第二天早上精力也更充沛。",
  },
  {
    id: "cet4-pres-spending",
    category: "cet4",
    partLabel: "Task 3 · 个人陈述（1分钟）",
    prepSec: 45,
    talkSec: 60,
    title: "大学生如何养成理性消费习惯",
    promptEn: "What practical steps can students take to manage their monthly allowance wisely?",
    promptZh: "大学生可以采取哪些实用做法来合理规划每月生活费？",
    keyPhrases: [
      { en: "track daily expenses", zh: "记录日常开销" },
      { en: "tell needs from impulse buys", zh: "区分刚需与冲动消费" },
      { en: "wait twenty-four hours before paying", zh: "下单前冷静二十四小时" },
    ],
    sampleEn:
      "Managing a monthly budget well comes down to two simple habits. First, recording every coffee or online order in a small app quickly shows where money disappears. Second, using a twenty-four-hour rule for non-essential items helps cut impulse shopping, leaving enough savings for books or holiday train tickets home.",
    sampleZh:
      "规划好每月预算其实靠两个简单习惯：第一是用记账小工具记下每一杯奶茶和网购开销，很快就能看清钱都花哪了；第二是对非必需品实行“冷静 24 小时后再买”，这样就能少掉很多冲动消费，把钱省给买书或假期回家的车票。",
  },
  {
    id: "cet4-pair-freshmen",
    category: "cet4",
    partLabel: "Task 4 · 双人互动陈述",
    prepSec: 60,
    talkSec: 90,
    title: "帮助大一新生快速融入大学生活",
    promptEn:
      "Many freshmen feel anxious during their first month at university. Discuss two practical ways senior students and schools can help them adapt.",
    promptZh: "许多大一新生在入学第一个月感到迷茫焦虑。请谈谈高年级同学和学校帮助他们适应的两种有效方法。",
    followUps: ["What surprised you most during your own first semester?"],
    keyPhrases: [
      { en: "peer mentoring pairs", zh: "高年级朋辈帮扶结对" },
      { en: "time-management workshops", zh: "时间管理主题分享会" },
      { en: "make new friends naturally", zh: "自然地结交新朋友" },
    ],
    sampleEn:
      "Two practical measures can make a freshman's first month much warmer. First, pairing each freshman dorm with a helpful sophomore mentor lets newcomers ask honest questions about course selection, canteens, and library seats. Second, organizing relaxed weekend ice-breaker games or campus walks helps shy students make friends quickly instead of feeling lonely.",
    sampleZh:
      "有两个贴心举措能让新生入学第一个月暖心很多：第一是为每个新生寝室结对一位靠谱的学长学姐，方便大家随时打听选课、食堂和图书馆占座技巧；第二是组织轻松的周末破冰游戏或校园漫步，让性格内向的新生也能自然交到朋友。",
  },
  {
    id: "cet4-pair-festival",
    category: "cet4",
    partLabel: "Task 4 · 双人互动陈述",
    prepSec: 60,
    talkSec: 90,
    title: "传统节日文化体验如何走进校园",
    promptEn:
      "Talk about how universities can organize interesting activities to let students experience traditional Chinese festivals.",
    promptZh: "谈谈大学如何通过有趣的校园活动让同学们真正体验中国传统节日文化。",
    keyPhrases: [
      { en: "hands-on craft booths", zh: "动手体验手工摊位" },
      { en: "make seasonal snacks together", zh: "一起制作时令节气美食" },
      { en: "learn the story behind each custom", zh: "了解习俗背后的故事" },
    ],
    sampleEn:
      "To make traditional festivals truly exciting on campus, events should focus on hands-on fun rather than dry lectures. For example, setting up outdoor stalls during Mid-Autumn or Dragon Boat Festival where students make mooncakes, fold paper lanterns, or weave colorful bracelets gets everyone involved. When friends share snacks they cooked together, cultural traditions feel vivid and memorable.",
    sampleZh:
      "要让校园传统节日活动真正吸引同学，重在动手参与而不是干巴巴听讲座。比如在中秋节或端午节在校园搭起体验摊位，让大家一起做月饼、扎花灯或者编五彩绳。和朋友分享亲手做出来的节日点心时，传统文化才会变得鲜活又难忘。",
  },

  // ==================== 六级口语 CET-SET6 (8 题) ====================
  {
    id: "cet6-read-digital",
    category: "cet6",
    partLabel: "短文朗读 · CET-SET6",
    prepSec: 45,
    talkSec: 60,
    title: "数字阅读与深度思考",
    promptEn:
      "Read the short passage aloud with clear pronunciation, natural pausing, and proper stress:\n\nWhile digital devices give us instant access to vast amounts of information, they also fragment our attention. Reading long-form books helps rebuild patience, sharpen critical thinking, and turn scattered facts into lasting understanding.",
    promptZh: "朗读短文并注意意群停顿、重音与连读。",
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
    id: "cet6-pres-ai-learning",
    category: "cet6",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "人工智能工具与大学生独立思考",
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
    id: "cet6-pres-short-video",
    category: "cet6",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "短视频平台的双刃剑与信息节制",
    promptEn: "Short-video platforms bring entertainment and quick tutorials, yet many people worry about addiction. What is your view?",
    promptZh: "短视频平台带来了娱乐与高效微课，但不少人担忧其成瘾性。你如何看待？",
    followUps: ["What content filters or habits work best to prevent endless scrolling?"],
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
    id: "cet6-pres-parttime",
    category: "cet6",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "大学生兼职实习与学业平衡",
    promptEn:
      "Some students spend lots of time on part-time jobs during university. What benefits and challenges does this bring?",
    promptZh: "一些大学生在读期间花很多时间兼职或实习，这会带来哪些益处与挑战？",
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
    id: "cet6-pres-teamwork",
    category: "cet6",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "团队分歧中的建设性沟通与共识",
    promptEn: "When group members disagree on how to complete a project, what is the best way to resolve the conflict?",
    promptZh: "当小组成员对项目方案产生分歧时，化解矛盾并高效推进的最佳方式是什么？",
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
  {
    id: "cet6-pres-green-life",
    category: "cet6",
    partLabel: "个人陈述 · 1分钟",
    prepSec: 45,
    talkSec: 60,
    title: "校园绿色低碳与可持续发展实践",
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
    id: "cet6-pair-heritage",
    category: "cet6",
    partLabel: "双人互动 · CET-SET6",
    prepSec: 60,
    talkSec: 90,
    title: "非物质文化遗产在青年群体中的创新传播",
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
    id: "cet6-deep-lifelong",
    category: "cet6",
    partLabel: "考官追问 · CET-SET6",
    prepSec: 30,
    talkSec: 60,
    title: "快速变革时代，大学最应培养的核心能力",
    promptEn: "In a rapidly changing job market, what core ability should higher education prioritize most beyond memorizing textbook facts?",
    promptZh: "在就业市场快速变化、知识迭代加速的今天，高等教育除课本知识外最应优先培养什么核心能力？",
    keyPhrases: [
      { en: "self-directed learning", zh: "自主学习能力" },
      { en: "cross-disciplinary perspective", zh: "跨学科视野" },
      { en: "question assumptions thoughtfully", zh: "审慎地质疑既有前提" },
    ],
    sampleEn:
      "Beyond specialized knowledge, universities should cultivate independent learning and critical judgment above everything else. Specific tools or software learned freshman year often change by graduation, whereas students who know how to read unfamiliar research, evaluate competing arguments, and learn new skills systematically can adapt to almost any career shift with confidence.",
    sampleZh:
      "除了专业知识，大学最该优先培养自主学习能力与批判性判断力。大一学过的具体软件或工具到毕业时往往已经更新换代，但只要具备拆解陌生文献、甄别正反论据并系统自学的底层能力，无论未来行业如何变化都能从容应对。",
  },

  // ==================== 考研复试口语 (8 题) ====================
  {
    id: "ky-retest-intro",
    category: "kaoyan1",
    partLabel: "复试必考 · 英文自我介绍",
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
    category: "kaoyan1",
    partLabel: "复试必考 · 科研与毕设",
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
    category: "kaoyan1",
    partLabel: "高频提问 · 择校与研究方向",
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
    category: "kaoyan1",
    partLabel: "高频提问 · 读研规划",
    prepSec: 15,
    talkSec: 60,
    title: "研究生阶段学业与科研规划",
    promptEn: "Do you have a concrete study plan for the next two or three years if you are admitted to our program?",
    promptZh: "如果顺利录取，你对未来两到三年的研究生阶段有什么具体规划？",
    keyPhrases: [
      { en: "narrow down a specific topic", zh: "聚焦具体研究课题" },
      { en: "literature review", zh: "文献综述" },
      { en: "graduate with solid competence", zh: "练就扎实的科研本领毕业" },
    ],
    sampleEn:
      "If fortunate enough to be admitted, I've mapped my graduate years into three stages. In the first year, I plan to complete core courses with strong grades while reading classic and recent top-journal literature to spot promising gaps. In the second year, I aim to dive deep into lab experiments and regular seminar discussions, ideally producing at least one solid paper or technical report. In the final year, I will polish my thesis thoroughly and prepare for either doctoral research or specialized R&D roles.",
    sampleZh:
      "如果有幸获得录取机会，我将研究生阶段分为三个步骤：研一高质量修完核心课程，并精读本领域经典与最新顶刊文献以确定具体切入点；研二全身心投入课题实验与组会讨论，争取产出一篇扎实的学术论文或高质量研究报告；研三精心打磨学位论文，为进一步深造攻博或进入核心研发岗位做好充分准备。",
  },
  {
    id: "ky-retest-weakness",
    category: "kaoyan1",
    partLabel: "高频提问 · 优缺点与抗压",
    prepSec: 15,
    talkSec: 60,
    title: "个人学术优势、短板及改进方式",
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
    id: "ky-retest-lesson",
    category: "kaoyan1",
    partLabel: "个人经历 · 自主学习与成长",
    prepSec: 15,
    talkSec: 60,
    title: "本科四年课外最宝贵的一课",
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
  {
    id: "ky-retest-breadth-depth",
    category: "kaoyan1",
    partLabel: "专业抽题 · 文献阅读与聚焦",
    prepSec: 20,
    talkSec: 60,
    title: "如何平衡广读文献与深耕单一研究方向？",
    promptEn: "As a graduate student, how will you balance reading broadly across the field with focusing deeply on one narrow research topic?",
    promptZh: "读研期间面对海量论文，你如何平衡泛读追踪前沿与聚焦精读特定方向？",
    keyPhrases: [
      { en: "pyramid reading strategy", zh: "金字塔式阅读策略" },
      { en: "skim abstracts for trends", zh: "速览摘要追踪趋势" },
      { en: "replicate key baselines deeply", zh: "深入复现关键基准" },
    ],
    sampleEn:
      "I adopt a two-layer strategy: spending roughly seventy percent of my reading time diving deeply into core papers directly tied to my thesis, even re-deriving formulas or replicating code to verify details, while reserving Friday afternoons to skim new abstracts across neighboring areas. Broad scanning prevents tunnel vision and often sparks fresh methods we can borrow.",
    sampleZh:
      "我采用分层阅读策略：把约七成精力花在和课题直接相关的核心精读上，甚至自己重新推导公式或复现实验来抠懂细节；同时每周固定留出一下午速览相邻方向的最新摘要。这样既能扎深根基，又能避免视野受限、启发跨方法借鉴。",
  },
  {
    id: "ky-retest-failure",
    category: "kaoyan1",
    partLabel: "导师追问 · 实验与挫折应对",
    prepSec: 15,
    talkSec: 60,
    title: "如果实验结果与你的假设完全相反，你会怎么办？",
    promptEn: "What would you do if months of experiments turned out to contradict your original hypothesis completely?",
    promptZh: "如果做了几个月的实验结果与你最初的设想完全相反，你会怎么处理？",
    keyPhrases: [
      { en: "check experimental controls first", zh: "先排查实验对照与数据管道" },
      { en: "let data challenge intuition", zh: "让客观数据修正先入之见" },
      { en: "a negative result still holds value", zh: "阴性/反例结果同样具有科学价值" },
    ],
    sampleEn:
      "First, I wouldn't rush to abandon the project or force the numbers to fit. I'd audit the data pipeline and baseline controls step by step to rule out implementation bugs. Once sure the result is genuine, an unexpected outcome is actually exciting because it signals a hidden mechanism we overlooked. Explaining why an intuitive assumption fails often leads to a far stronger contribution than confirming the obvious.",
    sampleZh:
      "首先我不会急着全盘否定或强行美化数据，而是逐环节核查数据管道与对照设置，排除程序失误。如果确认是真实可靠的反例结果，那其实反而令人兴奋——说明我们触及了此前被忽视的底层机制。把“看似合理的直觉为何失效”解释清楚，往往比验证一个平庸设想更有学术价值。",
  },
];
