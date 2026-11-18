import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 已完成：一枚印章，底座红色 */
export function IconStamp(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="red"
      fill={<rect x="4" y="11.5" width="16" height="4.5" rx="1.25" />}
      line={
        <>
          <circle cx="12" cy="5.25" r="2.5" />
          <path d="M10.5 7.5L9.5 11.5H14.5L13.5 7.5" />
          <rect x="4" y="11.5" width="16" height="4.5" rx="1.25" />
          <path d="M5.5 19.75H18.5" />
        </>
      }
    />
  );
}
