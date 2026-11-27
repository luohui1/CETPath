import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 口语：桌立麦克风 */
export function IconMic(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="9" y="3" width="6" height="10" rx="3" />}
      line={
        <>
          <rect x="9" y="3" width="6" height="10" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
          <path d="M12 18v3.5" />
          <path d="M8.5 21.5h7" />
        </>
      }
    />
  );
}
