import { BrandIcon, type BrandIconProps } from "./BrandIcon";

/** 词书：两本平放叠起的书，上面那本略歪 */
export function IconBookStack(props: BrandIconProps) {
  return (
    <BrandIcon
      {...props}
      defaultAccent="blue"
      fill={<rect x="6" y="6" width="14.5" height="6" rx="1.5" transform="rotate(-5 13 9)" />}
      line={
        <>
          <g transform="rotate(-5 13 9)">
            <rect x="6" y="6" width="14.5" height="6" rx="1.5" />
            <path d="M9.5 9H15" />
          </g>
          <rect x="3" y="13" width="16.5" height="6.5" rx="1.5" />
          <path d="M6.5 16.25H13" />
        </>
      }
    />
  );
}
