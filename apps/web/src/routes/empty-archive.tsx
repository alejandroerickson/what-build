import { Glyph } from "../ui/index.tsx";

/**
 * The foot of an opened archived list, for an admin: delete everything in it at once. It is as
 * quiet as the list's toggle and takes the danger colour only under the pointer or the keyboard,
 * since it opens the delete dialog, which says what goes and asks why, rather than deleting.
 *
 * Its name holds the words it shows and claims no count: the dialog says how many go, which can be
 * fewer than the list holds (an archived mockup canvas a Story page shows stays).
 */
export function EmptyArchive({ whats, onSelect }: {
  /** "archived mockup canvases" */
  whats: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="archived-empty" onClick={onSelect} aria-label={`Delete all ${whats} permanently…`}>
      <Glyph name="trash" />
      <span>Delete all archived…</span>
    </button>
  );
}
