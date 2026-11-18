import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 新题型：三段文字块，左边一条箭头调换顺序 */
export function IconReorder(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="9.5" y="10" width="11.5" height="4" rx="1" />}
      line={
        <>
          <rect x="9.5" y="3" width="11.5" height="4" rx="1" />
          <rect x="9.5" y="10" width="11.5" height="4" rx="1" />
          <rect x="9.5" y="17" width="11.5" height="4" rx="1" />
          <path d="M5.5 5Q2.5 12 5.5 19M3.5 17.75L5.5 19.25L6.75 17" />
        </>
      }
    />
  );
}
