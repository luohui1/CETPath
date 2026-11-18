// 应用里的品牌图标：自己画的双色文具图标（src/components/icons）。名字沿用以前像素图标的，调用处不用改；
// 其余通用界面图标（箭头、关闭、播放……）直接用 Phosphor 的 duotone。
import { memo, type ComponentType } from "react";
import {
  IconBlankLine,
  IconBookStack,
  IconDesk,
  IconExamPaper,
  IconFlashcards,
  IconGraphPaper,
  IconHeadset,
  IconHighlighter,
  IconMagnifyPage,
  IconNib,
  IconNotebook,
  IconParagraphs,
  IconReorder,
  IconRulerPencil,
  IconStamp,
  IconStopwatch,
  IconTranslate,
  IconWordBank,
  IconWrongStamp,
  type BrandIconProps,
  type IconAccent,
} from "./icons";

const ICONS = {
  // 主导航
  house: IconDesk,
  desk: IconDesk,
  paper: IconExamPaper,
  target: IconHighlighter,
  highlighter: IconHighlighter,
  bolt: IconFlashcards,
  flashcards: IconFlashcards,
  star: IconNotebook,
  notebook: IconNotebook,
  mistakes: IconWrongStamp,
  // 次要导航
  books: IconBookStack,
  chest: IconBookStack,
  graph: IconGraphPaper,
  ruler: IconRulerPencil,
  // 题型
  headphones: IconHeadset,
  puzzle: IconBlankLine,
  blanks: IconWordBank,
  link: IconParagraphs,
  order: IconReorder,
  book: IconMagnifyPage,
  translate: IconTranslate,
  pen: IconNib,
  // 计时、完成
  hourglass: IconStopwatch,
  calendar: IconStopwatch,
  stamp: IconStamp,
  trophy: IconStamp,
  flame: IconStamp,
  heart: IconNotebook,
} satisfies Record<string, ComponentType<BrandIconProps>>;

export type PixelName = keyof typeof ICONS;

/** 各题型的图标 */
export const KIND_PIXELS: Record<"listening" | "cloze" | "banked" | "matching" | "reading" | "order" | "translation" | "writing", PixelName> = {
  listening: "headphones",
  cloze: "puzzle",
  banked: "blanks",
  matching: "link",
  reading: "book",
  order: "order",
  translation: "translate",
  writing: "pen",
};

/** 一个品牌图标；size 是边长（像素），accent 换套色（默认按图标语义），strokeWidth 已不用（统一 1.75） */
export const PixelIcon = memo(function PixelIcon({
  name,
  size = 20,
  className,
  title,
  accent,
}: {
  name: PixelName;
  size?: number;
  className?: string;
  title?: string;
  accent?: IconAccent;
  strokeWidth?: number;
}) {
  const Icon = ICONS[name];
  return <Icon size={size} accent={accent} className={className} title={title} />;
});
