import {
  Activity, Archive, ArchiveRestore, ArrowLeft, ArrowRight, Blend, BookOpen, Bot, Box, Building, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, CircleCheck, CircleDashed, Clock, Cookie, Copy, CornerDownRight, Download, Ellipsis, ExternalLink, FileText, FileVolume, FolderInput,
  FlaskConical, GitCommitHorizontal, GripVertical, Image, Info, Keyboard, LayoutGrid, Library, Lightbulb, Link, LoaderCircle, LogOut, Maximize2, Menu, Mic, Minimize2, Minus, Monitor, Moon, MoveHorizontal, Palette, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Pencil, Plus, Quote, RotateCcw, Scale, Search, Settings, Signpost, Sun, Tag, Target, Trash, Triangle, TriangleAlert, Upload, UserPlus, Users, X, ZoomIn, ZoomOut, Scan, Hand, MousePointer2,
  type LucideIcon,
} from "lucide-react";

/**
 * The app's one icon source: lucide, drawn at 12 or 14px with a 1.75 stroke. Screens name a glyph
 * rather than importing lucide themselves, so size, stroke and accessibility stay consistent. To use
 * a new icon, add it to this map.
 */
const GLYPHS = {
  activity: Activity,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  blend: Blend,
  "book-open": BookOpen,
  box: Box,
  bot: Bot,
  building: Building,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "circle-dashed": CircleDashed,
  clock: Clock,
  cookie: Cookie,
  copy: Copy,
  "corner-down-right": CornerDownRight,
  download: Download,
  ellipsis: Ellipsis,
  "external-link": ExternalLink,
  "file-text": FileText,
  "file-audio": FileVolume,
  flask: FlaskConical,
  "folder-input": FolderInput,
  "git-commit": GitCommitHorizontal,
  hand: Hand,
  grip: GripVertical,
  image: Image,
  info: Info,
  keyboard: Keyboard,
  "layout-grid": LayoutGrid,
  library: Library,
  lightbulb: Lightbulb,
  link: Link,
  loader: LoaderCircle,
  "log-out": LogOut,
  pointer: MousePointer2,
  maximize: Maximize2,
  menu: Menu,
  mic: Mic,
  minimize: Minimize2,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  "move-horizontal": MoveHorizontal,
  palette: Palette,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  "panel-right-close": PanelRightClose,
  "panel-right-open": PanelRightOpen,
  pencil: Pencil,
  plus: Plus,
  quote: Quote,
  "rotate-ccw": RotateCcw,
  scan: Scan,
  scale: Scale,
  search: Search,
  settings: Settings,
  signpost: Signpost,
  sun: Sun,
  tag: Tag,
  target: Target,
  trash: Trash,
  triangle: Triangle,
  "triangle-alert": TriangleAlert,
  upload: Upload,
  "user-plus": UserPlus,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  users: Users,
  x: X,
} satisfies Record<string, LucideIcon>;

export type GlyphName = keyof typeof GLYPHS;

const SIZE = { sm: 12, md: 14 } as const;

/**
 * An icon. Decorative by default (hidden from assistive tech); pass `label` only when the icon is the
 * sole carrier of meaning and has no visible text next to it.
 */
export function Glyph({ name, size = "md", label, className }: { name: GlyphName; size?: "sm" | "md"; label?: string; className?: string }) {
  const Icon = GLYPHS[name];
  const px = SIZE[size];
  return (
    <Icon
      size={px}
      strokeWidth={1.75}
      className={`glyph glyph-${size}${className ? ` ${className}` : ""}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
}
