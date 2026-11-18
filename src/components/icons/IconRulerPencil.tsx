import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 设置：直尺和铅笔交叉 */
export function IconRulerPencil(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<path d="M3.5 10.5H15.5L19.5 12L15.5 13.5H3.5Z" transform="rotate(45 12 12)" />}
      line={
        <>
          <g transform="rotate(-45 12 12)">
            <rect x="3" y="10" width="18" height="4" rx="1" />
            <path d="M8 10V12M12 10V11.5M16 10V12" />
          </g>
          <g transform="rotate(45 12 12)">
            <path d="M3.5 10.5H15.5L19.5 12L15.5 13.5H3.5Z" />
            <path d="M15.5 10.5V13.5" />
          </g>
        </>
      }
    />
  );
}
