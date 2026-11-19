import { Glyph } from "../ui/index.tsx";

/**
 * The foot of an opened archived list, for an admin: delete everything in it at once. It is as
 * quiet as the list's toggle and takes the danger colour only under the pointer or the keyboard,
 * since it opens the delete dialog, which says what goes and asks why, rather than deleting.
 */
export function EmptyArchive({ count, what, whats, onSelect }: {
  count: number;
  /** "archived mockup canvas" */
  what: string;
  /** "archived mockup canvases" */
  whats: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="archived-empty" onClick={onSelect} aria-label={count === 1 ? `Delete the ${what} permanently…` : `Delete all ${count} ${whats} permanently…`}>
      <Glyph name="trash" />
      <span>Delete all archived…</span>
    </button>
  );
}
