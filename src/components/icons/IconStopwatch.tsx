import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 计时：秒表 */
export function IconStopwatch(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<circle cx="12" cy="13.5" r="7.5" />}
      line={
        <>
          <circle cx="12" cy="13.5" r="7.5" />
          <path d="M10 2.75H14M12 2.75V6M18.25 6.5L19.75 5" />
          <path d="M12 13.5L14.75 10.75" />
        </>
      }
    />
  );
}
