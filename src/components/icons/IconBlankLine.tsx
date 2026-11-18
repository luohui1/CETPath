import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 完形填空：一行字中间空出一段，空里填一个小方块 */
export function IconBlankLine(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="10" y="6.5" width="4" height="4" rx="0.75" />}
      line={
        <>
          <path d="M3 10.5H7.25M16.75 10.5H21" />
          <path d="M9 12.25H15" />
          <path d="M3 17.5H21" />
        </>
      }
    />
  );
}
