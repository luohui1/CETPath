import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 专项训练：一支斜放的荧光笔，笔尖下划出一道荧光 */
export function IconHighlighter(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="mark"
      fill={<rect x="2" y="17.25" width="11" height="3.25" rx="1" />}
      line={
        <>
          <g transform="rotate(45 12 12)">
            <rect x="9" y="2" width="6" height="10" rx="1.5" />
            <path d="M9 5.5H15M9.5 12L10.5 14.5H13.5L14.5 12M10.75 14.5V17.5L13.25 16.25V14.5" />
          </g>
          <path d="M3.5 20.5H11.5" />
        </>
      }
    />
  );
}
