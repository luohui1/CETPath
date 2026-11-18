import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 阅读理解：一张纸，右下角压着一个放大镜 */
export function IconMagnifyPage(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<circle cx="16" cy="15.5" r="3.75" />}
      line={
        <>
          <path d="M15 10.5V4.75Q15 2.75 13 2.75H5Q3 2.75 3 4.75V17Q3 19 5 19H11" />
          <path d="M6 7H12M6 10H12M6 13H9.5" />
          <circle cx="16" cy="15.5" r="3.75" />
          <path d="M18.75 18.25L21.25 20.75" />
        </>
      }
    />
  );
}
