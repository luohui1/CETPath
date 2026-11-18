import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 长篇阅读：三段文字，其中一段连到右边的字母框 */
export function IconParagraphs(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="15.5" y="9" width="5.5" height="6.5" rx="1.25" />}
      line={
        <>
          <path d="M3 4.5H11M3 7H8.5M3 11H11M3 13.5H8.5M3 17.5H11M3 20H8.5" />
          <path d="M13 10V14.5M13 12.25H15.5" />
          <rect x="15.5" y="9" width="5.5" height="6.5" rx="1.25" />
        </>
      }
    />
  );
}
