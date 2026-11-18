import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 翻译：左上一个“中”，右下一个 A，一条弯箭头连过去 */
export function IconTranslate(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<path d="M12.75 21L16.75 11L20.75 21Z" />}
      line={
        <>
          <rect x="3" y="5.5" width="8.5" height="6" rx="1" />
          <path d="M7.25 3V14" />
          <path d="M12.75 21L16.75 11L20.75 21M14.25 17.5H19.25" />
          <path d="M14.5 4.5H17.5Q19.5 4.5 19.5 6.5V8.5M18 7.25L19.5 8.75L21 7.25" />
        </>
      }
    />
  );
}
