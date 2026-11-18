import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 真题训练：一张试卷，左上角订书钉，右下角一枚红章 */
export function IconExamPaper(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="red"
      fill={<circle cx="15.25" cy="16.75" r="2.25" />}
      line={
        <>
          <rect x="4.75" y="2.75" width="14.5" height="18.5" rx="2" />
          <path d="M9.25 7H15.75" strokeWidth={2.5} />
          <circle cx="7.6" cy="5.6" r="1" fill="currentColor" stroke="none" />
          <path d="M8 11H16M8 14H12" />
          <circle cx="15.25" cy="16.75" r="2.25" />
        </>
      }
    />
  );
}
