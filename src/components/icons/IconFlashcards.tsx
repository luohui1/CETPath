import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 背单词：三张错开叠放的卡片 */
export function IconFlashcards(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="3" y="8" width="12.5" height="12.5" rx="2" />}
      line={
        <>
          <path d="M8 5.5V5Q8 3 10 3H18.5Q20.5 3 20.5 5V13.5Q20.5 15.5 18.5 15.5H18" />
          <path d="M5.5 8V7.5Q5.5 5.5 7.5 5.5H16Q18 5.5 18 7.5V16Q18 18 16 18H15.5" />
          <rect x="3" y="8" width="12.5" height="12.5" rx="2" />
          <path d="M6.25 14.25H12.25" />
        </>
      }
    />
  );
}
