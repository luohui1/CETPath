import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 听力：头戴耳机 */
export function IconHeadset(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={
        <>
          <rect x="3" y="13.5" width="4.5" height="7" rx="1.75" />
          <rect x="16.5" y="13.5" width="4.5" height="7" rx="1.75" />
        </>
      }
      line={
        <>
          <path d="M4.5 14V12A7.5 7.5 0 0 1 19.5 12V14" />
          <rect x="3" y="13.5" width="4.5" height="7" rx="1.75" />
          <rect x="16.5" y="13.5" width="4.5" height="7" rx="1.75" />
        </>
      }
    />
  );
}
