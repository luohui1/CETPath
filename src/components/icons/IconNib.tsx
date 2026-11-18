import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 写作：钢笔笔尖，下面一滴墨 */
export function IconNib(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="ink"
      fill={<circle cx="11" cy="19.25" r="1.75" />}
      line={
        <>
          <path d="M8 3.25H16V8.5L12 16.5L8 8.5Z" />
          <path d="M12 16.5V11.75" />
          <circle cx="12" cy="10" r="1.1" />
        </>
      }
    />
  );
}
