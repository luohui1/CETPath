import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 生词本：线圈本，右上角垂下一条红书签带 */
export function IconNotebook(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="red"
      fill={<path d="M13.5 2.75V9.5L15.25 8L17 9.5V2.75Z" />}
      line={
        <>
          <rect x="6" y="2.75" width="13.5" height="18.5" rx="2" />
          <path d="M13.5 2.75V9.5L15.25 8L17 9.5V2.75" />
          <path d="M9.5 13.5H16M9.5 16.5H14" />
          <g style={{ fill: "var(--sheet, #fff)" }}>
            <circle cx="6" cy="7" r="1.4" />
            <circle cx="6" cy="12" r="1.4" />
            <circle cx="6" cy="17" r="1.4" />
          </g>
        </>
      }
    />
  );
}
