import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 选词填空：词库方框，外面一个小标签指向下面的空线 */
export function IconWordBank(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<path d="M15 10.5H20.5V14.5L17.75 17L15 14.5Z" />}
      line={
        <>
          <rect x="3" y="3" width="11.5" height="9" rx="1.5" />
          <path d="M6 6.5H11.5M6 9H9.5" />
          <path d="M15 10.5H20.5V14.5L17.75 17L15 14.5Z" />
          <path d="M10.5 21H21" />
        </>
      }
    />
  );
}
