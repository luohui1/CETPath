import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 首页：桌面上斜放着一张折了角的纸 */
export function IconDesk(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<path d="M7.25 4H13.75L16.75 7V15.5H7.25Z" transform="rotate(-6 12 10)" />}
      line={
        <>
          <path d="M2.75 17.25H21.25M5.5 17.25V21M18.5 17.25V21" />
          <g transform="rotate(-6 12 10)">
            <path d="M7.25 4H13.75L16.75 7V15.5H7.25Z" />
            <path d="M13.75 4V7H16.75M9.5 9.5H14.5M9.5 12.25H12.75" />
          </g>
        </>
      }
    />
  );
}
