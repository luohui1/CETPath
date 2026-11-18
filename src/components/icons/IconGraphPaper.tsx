import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 学习统计：方格纸上三根高低不一的柱 */
export function IconGraphPaper(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="10.75" y="7" width="2.5" height="11" rx="0.5" />}
      line={
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 3V21M3 12H21" strokeWidth={0.75} opacity={0.22} />
          <rect x="6.25" y="13" width="2.5" height="5" rx="0.5" />
          <rect x="10.75" y="7" width="2.5" height="11" rx="0.5" />
          <rect x="15.25" y="10.5" width="2.5" height="7.5" rx="0.5" />
        </>
      }
    />
  );
}
