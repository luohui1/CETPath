import type * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** glass: default frosted capsule. primary: blue glass, one per view. ghost: low-emphasis, blue text. danger: destructive. */
  variant?: 'glass' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** Helper text under the field. */
  hint?: React.ReactNode;
  /** Error text; replaces hint and marks the field invalid. */
  error?: React.ReactNode;
  /** Leading Lucide icon, e.g. "search". */
  icon?: IconName;
  /** Trailing slot inside the field, e.g. a <Kbd>⌘K</Kbd> or an icon button. */
  trailing?: React.ReactNode;
}
export declare function Input(props: InputProps): React.ReactElement;

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** A short muted line above the title (category or date), e.g. "收藏 · 10 月 31 日". */
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  /** Actions or meta under a hairline. */
  footer?: React.ReactNode;
  /** Adds hover lift; give it an onClick and tabIndex. */
  interactive?: boolean;
}
export declare function Card(props: CardProps): React.ReactElement;

export interface BadgeProps {
  tone?: 'neutral' | 'brand' | 'star' | 'success' | 'danger';
  className?: string;
  children?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface TabItem { value: string; label: React.ReactNode; disabled?: boolean }
export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Accessible name for the tab list. */
  label?: string;
  className?: string;
}
export declare function Tabs(props: TabsProps): React.ReactElement;

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  className?: string;
}
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}
export declare function Alert(props: AlertProps): React.ReactElement;

export interface ChartSeries {
  /** Field name in each data row. */
  key: string;
  /** Shown in legend and tooltip. */
  label?: string;
  /** Override; defaults to var(--chart-N) in fixed order. */
  color?: string;
}
interface CartesianProps {
  /** Rows, e.g. [{ month: '1月', desktop: 186, mobile: 80 }]. */
  data: Record<string, any>[];
  /** Field used for the x-axis labels. Default 'label'. */
  xKey?: string;
  series: ChartSeries[];
  /** Plot height in px. Default 240. */
  height?: number;
  /** Show the y-axis tick labels. Default true. */
  yAxis?: boolean;
  /** Formats values in tooltip and the hidden data table. */
  valueFormat?: (v: number) => string;
  ariaLabel?: string;
  /** Header of the first column in the screen-reader table. */
  xLabel?: string;
  className?: string;
}
export interface AreaChartProps extends CartesianProps { stacked?: boolean }
export declare function AreaChart(props: AreaChartProps): React.ReactElement;
export interface LineChartProps extends CartesianProps {}
export declare function LineChart(props: LineChartProps): React.ReactElement;
export interface BarChartProps extends CartesianProps {
  stacked?: boolean;
  /** Max bar thickness in px. Default 24. */
  barSize?: number;
}
export declare function BarChart(props: BarChartProps): React.ReactElement;
export interface DonutDatum { label: string; value: number; color?: string }
export interface DonutChartProps {
  data: DonutDatum[];
  /** Diameter in px. Default 200. */
  size?: number;
  /** Centre text; defaults to the formatted total. */
  centerValue?: React.ReactNode;
  centerLabel?: string;
  valueFormat?: (v: number) => string;
  ariaLabel?: string;
  className?: string;
}
export declare function DonutChart(props: DonutChartProps): React.ReactElement;
export interface RadialDatum { label: string; value: number; max?: number; color?: string }
export interface RadialChartProps {
  /** Up to 3 concentric rings, outermost first; max defaults to 100. */
  data: RadialDatum[];
  size?: number;
  /** Ring thickness in px. Default 12. */
  thickness?: number;
  centerValue?: React.ReactNode;
  centerLabel?: string;
  valueFormat?: (v: number, max: number) => string;
  ariaLabel?: string;
  className?: string;
}
export declare function RadialChart(props: RadialChartProps): React.ReactElement;
export interface ChartCardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Top-right slot, e.g. a <Tabs> for the time range. */
  action?: React.ReactNode;
  /** One-line takeaway with an arrow; good colours the arrow success/danger. */
  trend?: { text: React.ReactNode; direction?: 'up' | 'down'; good?: boolean };
  /** Muted second line, e.g. the period covered. */
  footer?: React.ReactNode;
}
export declare function ChartCard(props: ChartCardProps): React.ReactElement;

export interface CheckboxProps {
  label?: React.ReactNode;
  /** Muted line under the label. */
  description?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  /** Shows a dash; for a parent of partly-checked children. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

export interface RadioItem { value: string; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean }
export interface RadioGroupProps {
  items: RadioItem[];
  /** Group label, read as the radiogroup's name. */
  label?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  className?: string;
}
export declare function RadioGroup(props: RadioGroupProps): React.ReactElement;

export interface SelectOption { value: string; label: React.ReactNode; disabled?: boolean }
export interface SelectProps {
  options: SelectOption[];
  label?: React.ReactNode;
  placeholder?: string;
  hint?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Open on mount (documentation only). */
  defaultOpen?: boolean;
  id?: string;
  className?: string;
}
export declare function Select(props: SelectProps): React.ReactElement;

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Receives the new text. With maxLength a live count shows bottom-right. */
  onChange?: (value: string) => void;
}
export declare function Textarea(props: TextareaProps): React.ReactElement;

export interface SliderProps {
  label?: React.ReactNode;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  /** Show the current value top-right. Default true. */
  showValue?: boolean;
  format?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
}
export declare function Slider(props: SliderProps): React.ReactElement;

export interface ProgressProps {
  value: number;
  max?: number;
  label?: React.ReactNode;
  showValue?: boolean;
  format?: (value: number, max: number) => string;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}
export declare function Progress(props: ProgressProps): React.ReactElement;

export interface AvatarProps {
  /** Used for initials (Chinese: last two characters) and the accessible name. */
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'away' | 'offline';
  className?: string;
}
export declare function Avatar(props: AvatarProps): React.ReactElement;
export interface AvatarGroupProps {
  people: { name: string; src?: string }[];
  /** Show at most this many, then "+N". Default 4. */
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
export declare function AvatarGroup(props: AvatarGroupProps): React.ReactElement;

export interface TableColumn<R = any> {
  key: string;
  header: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  /** Tabular figures for number columns. */
  numeric?: boolean;
  render?: (row: R) => React.ReactNode;
}
export interface TableProps<R = any> {
  columns: TableColumn<R>[];
  rows: R[];
  /** Read by screen readers. */
  caption?: string;
  /** Shown when rows is empty. */
  empty?: React.ReactNode;
  className?: string;
}
export declare function Table(props: TableProps): React.ReactElement;

export interface StatCardProps extends React.HTMLAttributes<HTMLElement> {
  label: React.ReactNode;
  /** Pre-formatted headline value, e.g. "12.8万". */
  value: React.ReactNode;
  delta?: { text: React.ReactNode; direction?: 'up' | 'down'; good?: boolean };
  /** 8–30 points for the dithered sparkline. */
  trend?: number[];
  /** Muted comparison, e.g. "较上周". */
  note?: React.ReactNode;
}
export declare function StatCard(props: StatCardProps): React.ReactElement;

export interface TooltipProps {
  content: React.ReactNode;
  side?: 'top' | 'bottom';
  /** Exactly one focusable element. */
  children: React.ReactElement;
  defaultOpen?: boolean;
  className?: string;
}
export declare function Tooltip(props: TooltipProps): React.ReactElement;

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons, right-aligned; primary last. */
  footer?: React.ReactNode;
  width?: number;
  noAutoFocus?: boolean;
  className?: string;
  children?: React.ReactNode;
}
export declare function Dialog(props: DialogProps): React.ReactElement | null;

export interface MenuItem { label?: React.ReactNode; onSelect?: () => void; shortcut?: string; danger?: boolean; disabled?: boolean; separator?: boolean }
export interface MenuProps {
  /** Trigger button text. */
  label: React.ReactNode;
  items: MenuItem[];
  variant?: 'glass' | 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'end';
  defaultOpen?: boolean;
  className?: string;
}
export declare function Menu(props: MenuProps): React.ReactElement;

export interface SpinnerProps {
  /** Accessible name, e.g. "加载中". */
  label?: string;
  /** Show the label as shimmering text beside the grid. */
  showLabel?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}
/** A 3×3 pixel grid whose outer cells light in turn. */
export declare function Spinner(props: SpinnerProps): React.ReactElement;

export interface TaskStep { title: React.ReactNode; description?: React.ReactNode; status?: 'pending' | 'running' | 'done' | 'error'; children?: React.ReactNode }
export interface TaskStepsProps { steps: TaskStep[]; className?: string }
export declare function TaskSteps(props: TaskStepsProps): React.ReactElement;

export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  /** Built-in light highlighter; false for plain text. */
  highlight?: boolean;
  className?: string;
}
export declare function CodeBlock(props: CodeBlockProps): React.ReactElement;

export interface AttachmentItem { id?: string | number; name: string; size?: number; type?: string; /** Image thumbnail. */ src?: string; /** Custom file icon image for this item. */ icon?: string; status?: 'uploading' | 'error' | 'done' }
export interface AttachmentsProps { items: AttachmentItem[]; onRemove?: (item: AttachmentItem, index: number) => void; className?: string }
export declare function Attachments(props: AttachmentsProps): React.ReactElement;

export type IconName = 'check' | 'x' | 'plus' | 'minus' | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'arrow-up' | 'arrow-down' | 'arrow-right' | 'copy' | 'rotate-cw' | 'thumbs-up' | 'thumbs-down' | 'pencil' | 'search' | 'globe' | 'info' | 'circle-check' | 'triangle-alert' | 'circle-x' | 'trending-up' | 'trending-down' | 'paperclip' | 'square' | 'mic' | 'settings' | 'user' | 'users' | 'bell' | 'calendar' | 'star' | 'heart' | 'share-2' | 'download' | 'upload' | 'trash-2' | 'ellipsis' | 'external-link' | 'menu' | 'log-out' | 'filter' | 'eye' | 'lock' | 'house' | 'image' | 'link' | 'message-square' | 'sun' | 'moon' | 'clock' | 'map-pin' | 'folder' | 'file' | 'file-text' | 'file-spreadsheet' | 'file-image' | 'file-code' | 'file-archive' | 'file-audio' | 'file-video' | 'file-json' | 'presentation' | 'lightbulb' | 'book-open' | 'chart-column' | 'pen-line' | 'sparkles' | 'scroll-text' | 'align-left' | 'table' | 'chart-pie' | 'play' | 'music' | 'package' | 'code' | 'braces' | 'layout-dashboard' | 'inbox' | 'panel-left' | 'command' | 'circle-help' | 'mail' | 'compass' | 'bookmark' | 'history' | 'refresh-cw' | 'circle-plus' | 'file-plus' | 'folder-open' | 'save' | 'undo-2' | 'redo-2' | 'mouse-pointer-2' | 'move' | 'circle' | 'type' | 'hand' | 'zoom-in' | 'zoom-out' | 'grid-3x3' | 'layers' | 'eye-off' | 'lock-open' | 'box' | 'git-branch' | 'scissors' | 'clipboard' | 'pen-tool' | 'ruler' | 'maximize-2' | 'pipette' | 'palette' | 'sliders-horizontal' | 'frame' | 'cpu' | 'monitor' | 'magnet';
export interface IconProps {
  /** A Lucide icon name (https://lucide.dev). The bundle inlines the set above. */
  name: IconName;
  /** px; default 16. Use 16 in controls, 18 in alerts and file tiles, 20 in navigation. */
  size?: number;
  /** Default 2 on Lucide's 24-unit grid. */
  strokeWidth?: number;
  /** Gives a meaningful icon an accessible name; omit for decorative icons. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): React.ReactElement;

export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'data' | 'other';
export interface FileIconProps {
  /** File name; the extension picks the kind (xlsx → sheet, pptx → slide …). */
  name?: string;
  /** MIME type, used when the extension is missing. */
  type?: string;
  /** Force a kind. */
  kind?: FileKind;
  /** Height in px (width is 0.8×). Default 32. */
  size?: number;
  /** A licensed icon image to use instead (also see setFileIcons). */
  src?: string;
  /** Read the kind aloud ("表格"); omit when the file name is next to it. */
  label?: boolean;
  className?: string;
}
export declare function FileIcon(props: FileIconProps): React.ReactElement;
/** Register icon images by extension or kind, e.g. setFileIcons({ docx: '/_blob/…', pdf: '/_blob/…' }). For official product icons your team is licensed to use. */
export declare function setFileIcons(map: Record<string, string>): void;

export interface SeparatorProps { orientation?: 'horizontal' | 'vertical'; /** Text in the middle, e.g. "或". */ label?: React.ReactNode; className?: string }
export declare function Separator(props: SeparatorProps): React.ReactElement;
export declare function Kbd(props: { children?: React.ReactNode; className?: string }): React.ReactElement;

export interface SkeletonProps { width?: number | string; height?: number | string; radius?: number | string; circle?: boolean; /** Render N text lines instead (last one shorter). */ lines?: number; className?: string }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

export interface EmptyStateProps { icon?: IconName; title: React.ReactNode; description?: React.ReactNode; /** One or two buttons. */ action?: React.ReactNode; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface AccordionItem { value: string; title: React.ReactNode; content: React.ReactNode }
export interface AccordionProps { items: AccordionItem[]; type?: 'single' | 'multiple'; defaultValue?: string | string[]; className?: string }
export declare function Accordion(props: AccordionProps): React.ReactElement;

export interface BreadcrumbItem { label: React.ReactNode; href?: string; onClick?: (e: React.MouseEvent) => void }
export interface BreadcrumbProps { /** The last item is the current page. */ items: BreadcrumbItem[]; className?: string }
export declare function Breadcrumb(props: BreadcrumbProps): React.ReactElement;

export interface PaginationProps { /** Number of pages. */ total: number; page?: number; defaultPage?: number; onChange?: (page: number) => void; className?: string }
export declare function Pagination(props: PaginationProps): React.ReactElement;

export interface ToggleItem { value: string; label?: React.ReactNode; icon?: IconName; /** Accessible name for icon-only items. */ title?: string; disabled?: boolean }
export interface ToggleGroupProps { items: ToggleItem[]; type?: 'single' | 'multiple'; value?: string | string[] | null; defaultValue?: string | string[] | null; onChange?: (v: any) => void; /** single: cannot be switched off. */ required?: boolean; label?: string; className?: string }
export declare function ToggleGroup(props: ToggleGroupProps): React.ReactElement;

export interface PopoverProps {
  /** The element that opens it (gets aria-expanded and the click handler). */
  trigger: React.ReactElement;
  /** Content, or a render function receiving close(). */
  children?: React.ReactNode | ((close: () => void) => React.ReactNode);
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'end'; width?: number | string; label?: string; className?: string;
}
export declare function Popover(props: PopoverProps): React.ReactElement;

export interface SheetProps { open: boolean; onClose?: () => void; side?: 'right' | 'left' | 'bottom'; title: React.ReactNode; description?: React.ReactNode; footer?: React.ReactNode; width?: number; noAutoFocus?: boolean; className?: string; children?: React.ReactNode }
export declare function Sheet(props: SheetProps): React.ReactElement | null;

export interface ToastOptions { title: React.ReactNode; description?: React.ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info'; action?: { label: string; onClick?: () => void }; /** ms; default 4000; Infinity keeps it. */ duration?: number }
/** Show a toast from anywhere; returns its id. Render one <Toaster /> per app. */
export declare const toast: ((opts: ToastOptions | string) => number) & { dismiss: (id: number) => void };
export interface ToasterProps { position?: 'bottom-right' | 'bottom-center' | 'top-center'; /** Render in flow (documentation only). */ inline?: boolean }
export declare function Toaster(props: ToasterProps): React.ReactElement;

export interface DateRange { from?: Date | null; to?: Date | null }
export interface CalendarProps {
  mode?: 'single' | 'range';
  value?: Date | DateRange | null; defaultValue?: Date | DateRange | null; onChange?: (v: any) => void;
  /** Months side by side. Default 1. */ months?: number;
  min?: Date; max?: Date; /** Override "today" (tests, demos). */ today?: Date; className?: string;
}
export declare function Calendar(props: CalendarProps): React.ReactElement;
export interface DatePickerProps { label?: React.ReactNode; placeholder?: string; value?: Date | null; defaultValue?: Date | null; onChange?: (d: Date) => void; min?: Date; max?: Date; today?: Date; defaultOpen?: boolean; className?: string }
export declare function DatePicker(props: DatePickerProps): React.ReactElement;
export interface DateRangePickerProps { label?: React.ReactNode; placeholder?: string; value?: DateRange | null; defaultValue?: DateRange | null; onChange?: (r: DateRange) => void; /** Defaults: 今天, 最近 7 天, 最近 30 天, 本月, 上个月. */ presets?: { label: string; value: DateRange }[]; months?: number; today?: Date; defaultOpen?: boolean; className?: string }
export declare function DateRangePicker(props: DateRangePickerProps): React.ReactElement;

export interface ComboboxOption { value: string; label: React.ReactNode; icon?: IconName; hint?: React.ReactNode; keywords?: string; disabled?: boolean }
export interface ComboboxProps { options: ComboboxOption[]; label?: React.ReactNode; placeholder?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; emptyText?: string; defaultOpen?: boolean; className?: string }
export declare function Combobox(props: ComboboxProps): React.ReactElement;

export interface CommandItem { label: string; icon?: IconName; shortcut?: string | string[]; keywords?: string; onSelect?: () => void }
export interface CommandPaletteProps { open: boolean; onClose?: () => void; groups: { heading?: string; items: CommandItem[] }[]; placeholder?: string; label?: string }
export declare function CommandPalette(props: CommandPaletteProps): React.ReactElement | null;

export interface InputOTPProps { length?: number; /** Visual gap every N boxes. */ groupSize?: number; value?: string; defaultValue?: string; onChange?: (v: string) => void; onComplete?: (v: string) => void; label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; disabled?: boolean; className?: string }
export declare function InputOTP(props: InputOTPProps): React.ReactElement;

export interface TagProps { children?: React.ReactNode; icon?: IconName; tone?: 'neutral' | 'brand'; /** Shows a remove button. */ onRemove?: () => void; className?: string }
export declare function Tag(props: TagProps): React.ReactElement;
export interface TagInputProps { label?: React.ReactNode; placeholder?: string; hint?: React.ReactNode; value?: string[]; defaultValue?: string[]; onChange?: (tags: string[]) => void; max?: number; className?: string }
/** Type and press Enter (or a comma) to add; Backspace on empty removes the last. */
export declare function TagInput(props: TagInputProps): React.ReactElement;

export interface NumberInputProps { label?: React.ReactNode; value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; /** e.g. "件", "%". */ unit?: string; hint?: React.ReactNode; disabled?: boolean; className?: string }
export declare function NumberInput(props: NumberInputProps): React.ReactElement;

export interface FileUploadProps { label?: React.ReactNode; title?: React.ReactNode; /** e.g. "支持 PDF、Excel，单个不超过 20 MB". */ hint?: React.ReactNode; accept?: string; multiple?: boolean; disabled?: boolean; onFiles?: (files: File[]) => void; /** Usually an <Attachments> of the chosen files. */ children?: React.ReactNode; className?: string }
export declare function FileUpload(props: FileUploadProps): React.ReactElement;

export interface DescriptionItem { label: React.ReactNode; value: React.ReactNode; /** Columns to span. */ span?: number }
export interface DescriptionListProps { items: DescriptionItem[]; columns?: number; className?: string }
export declare function DescriptionList(props: DescriptionListProps): React.ReactElement;

export interface StepperProps { steps: (string | { title: React.ReactNode; description?: React.ReactNode })[]; /** Index of the current step. */ current?: number; label?: string; className?: string }
export declare function Stepper(props: StepperProps): React.ReactElement;

export interface MenuBarItem { label?: React.ReactNode; shortcut?: string; checked?: boolean; danger?: boolean; disabled?: boolean; separator?: boolean; onSelect?: () => void }
export interface MenuBarProps { menus: { label: React.ReactNode; items: MenuBarItem[] }[]; /** Index of a menu open on mount (documentation only). */ defaultOpen?: number; label?: string; className?: string }
/** Desktop-style application menu: 文件 编辑 视图 … Arrow keys move across menus and items. */
export declare function MenuBar(props: MenuBarProps): React.ReactElement;

export interface ToolItem { icon: IconName; label: string; shortcut?: string; active?: boolean; disabled?: boolean; text?: React.ReactNode; onClick?: () => void; /** Any element instead of a tool button. */ render?: React.ReactNode }
export interface ToolbarProps { /** Groups of tools, separated by hairlines. */ groups: ToolItem[][]; vertical?: boolean; label?: string; /** Right-aligned slot. */ children?: React.ReactNode; className?: string }
export declare function Toolbar(props: ToolbarProps): React.ReactElement;

export interface DocTab { value: string; label: React.ReactNode; icon?: IconName; /** Unsaved changes: shows a dot instead of ×. */ dirty?: boolean }
export interface DocTabsProps { tabs: DocTab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; onClose?: (v: string) => void; onAdd?: () => void; label?: string; className?: string }
export declare function DocTabs(props: DocTabsProps): React.ReactElement;

export interface TreeNode { id: string; label: React.ReactNode; icon?: IconName; /** Show a FileIcon for this file name instead of a glyph. */ fileName?: string; meta?: React.ReactNode; actions?: React.ReactNode; children?: TreeNode[] }
export interface TreeViewProps { items: TreeNode[]; defaultExpanded?: string[]; selected?: string; defaultSelected?: string; onSelect?: (id: string) => void; label?: string; className?: string }
/** Files, layers, outlines. Arrow keys navigate; Right/Left expand and collapse. */
export declare function TreeView(props: TreeViewProps): React.ReactElement;

export declare function Inspector(props: { children?: React.ReactNode; className?: string }): React.ReactElement;
export interface PropertyGroupProps { title: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode; children?: React.ReactNode; className?: string }
export declare function PropertyGroup(props: PropertyGroupProps): React.ReactElement;
export interface PropertyRowProps { label: React.ReactNode; children?: React.ReactNode; className?: string }
export declare function PropertyRow(props: PropertyRowProps): React.ReactElement;
export interface ScrubInputProps { value?: number; defaultValue?: number; onChange?: (v: number) => void; /** Axis letter ("X") or a Lucide icon name; drag it left/right to scrub. */ prefix?: React.ReactNode; unit?: string; step?: number; min?: number; max?: number; decimals?: number; label?: string; className?: string }
/** Compact numeric field for inspectors. ↑/↓ change by step, Shift ×10. */
export declare function ScrubInput(props: ScrubInputProps): React.ReactElement;

export interface ColorPickerProps { value?: string; defaultValue?: string; onChange?: (hex: string) => void; swatches?: string[]; /** Shown after the hex value, e.g. 100. */ opacity?: number; label?: React.ReactNode; defaultOpen?: boolean; className?: string }
export declare function ColorPicker(props: ColorPickerProps): React.ReactElement;

export interface SplitPaneProps { /** Exactly two children. */ children: React.ReactNode; direction?: 'horizontal' | 'vertical'; /** Size of the first pane in px (the second when reverse). */ defaultSize?: number; min?: number; max?: number; reverse?: boolean; style?: React.CSSProperties; className?: string }
/** Two panels with a draggable divider; arrow keys resize when the divider has focus. */
export declare function SplitPane(props: SplitPaneProps): React.ReactElement;

export interface ContextMenuItem { label?: React.ReactNode; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; separator?: boolean; onSelect?: () => void }
export interface ContextMenuProps { items: ContextMenuItem[]; children: React.ReactNode; /** Open at a point on mount (documentation only). */ defaultPosition?: { x: number; y: number }; className?: string }
export declare function ContextMenu(props: ContextMenuProps): React.ReactElement;

export interface StatusItem { label?: React.ReactNode; icon?: IconName; dot?: boolean; tone?: 'success' | 'warning' | 'danger' | 'brand'; title?: string }
export interface StatusBarProps { left?: StatusItem[]; right?: StatusItem[]; className?: string }
export declare function StatusBar(props: StatusBarProps): React.ReactElement;

declare global {
  interface Window {
    Grasso: { Button: typeof Button; Input: typeof Input; Card: typeof Card; Badge: typeof Badge; Tabs: typeof Tabs; Switch: typeof Switch; Alert: typeof Alert; ChartCard: typeof ChartCard; AreaChart: typeof AreaChart; LineChart: typeof LineChart; BarChart: typeof BarChart; DonutChart: typeof DonutChart; RadialChart: typeof RadialChart; Checkbox: typeof Checkbox; RadioGroup: typeof RadioGroup; Select: typeof Select; Textarea: typeof Textarea; Slider: typeof Slider; Progress: typeof Progress; Avatar: typeof Avatar; AvatarGroup: typeof AvatarGroup; Table: typeof Table; StatCard: typeof StatCard; Tooltip: typeof Tooltip; Dialog: typeof Dialog; Menu: typeof Menu; Spinner: typeof Spinner; TaskSteps: typeof TaskSteps; CodeBlock: typeof CodeBlock; Attachments: typeof Attachments; Icon: typeof Icon; FileIcon: typeof FileIcon; setFileIcons: typeof setFileIcons; Separator: typeof Separator; Kbd: typeof Kbd; Skeleton: typeof Skeleton; EmptyState: typeof EmptyState; Accordion: typeof Accordion; Breadcrumb: typeof Breadcrumb; Pagination: typeof Pagination; ToggleGroup: typeof ToggleGroup; Popover: typeof Popover; Sheet: typeof Sheet; Toaster: typeof Toaster; toast: typeof toast; Calendar: typeof Calendar; DatePicker: typeof DatePicker; DateRangePicker: typeof DateRangePicker; Combobox: typeof Combobox; CommandPalette: typeof CommandPalette; InputOTP: typeof InputOTP; Tag: typeof Tag; TagInput: typeof TagInput; NumberInput: typeof NumberInput; FileUpload: typeof FileUpload; DescriptionList: typeof DescriptionList; Stepper: typeof Stepper; MenuBar: typeof MenuBar; Toolbar: typeof Toolbar; DocTabs: typeof DocTabs; TreeView: typeof TreeView; Inspector: typeof Inspector; PropertyGroup: typeof PropertyGroup; PropertyRow: typeof PropertyRow; ScrubInput: typeof ScrubInput; ColorPicker: typeof ColorPicker; SplitPane: typeof SplitPane; ContextMenu: typeof ContextMenu; StatusBar: typeof StatusBar };
  }
}
