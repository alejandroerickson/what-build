import {
  Activity, Archive, ArchiveRestore, ArrowLeft, ArrowRight, BookOpen, Bot, Box, Building, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, CircleCheck, CircleDashed, Clock, Copy, CornerDownRight, Download, Ellipsis, ExternalLink, FileText, FileVolume, FolderInput,
  GripVertical, Info, KeyRound, Library, Lightbulb, Link, LoaderCircle, LogOut, Menu, Mic, Monitor, Moon, PanelLeftClose, PanelLeftOpen,
  PanelRight, Pencil, Plug, Plus, Quote, Scale, Search, Settings, Signpost, Sun, Target, Trash, TriangleAlert, Upload, User, UserPlus, Users, X,
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
  copy: Copy,
  "corner-down-right": CornerDownRight,
  download: Download,
  ellipsis: Ellipsis,
  "external-link": ExternalLink,
  "file-text": FileText,
  "file-audio": FileVolume,
  "folder-input": FolderInput,
  grip: GripVertical,
  info: Info,
  key: KeyRound,
  library: Library,
  lightbulb: Lightbulb,
  link: Link,
  loader: LoaderCircle,
  "log-out": LogOut,
  menu: Menu,
  mic: Mic,
  monitor: Monitor,
  moon: Moon,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  "panel-right": PanelRight,
  pencil: Pencil,
  plug: Plug,
  plus: Plus,
  quote: Quote,
  scale: Scale,
  search: Search,
  settings: Settings,
  signpost: Signpost,
  sun: Sun,
  target: Target,
  trash: Trash,
  "triangle-alert": TriangleAlert,
  upload: Upload,
  user: User,
  "user-plus": UserPlus,
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
