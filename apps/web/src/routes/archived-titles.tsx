import { OneLine } from "../ui/index.tsx";

/**
 * Every title a delete of all archived objects would take, so the person sees exactly what goes
 * before they confirm. A long list scrolls inside its own hairline box rather than stretching the
 * dialog, and takes the keyboard's focus so it can be scrolled without a pointer.
 */
export function ArchivedTitles({ titles, label }: { titles: { id: string; title: string }[]; label: string }) {
  const long = titles.length > 6;
  return (
    <ul className={`archived-titles${long ? " archived-titles-long" : ""}`} aria-label={label} tabIndex={long ? 0 : undefined}>
      {titles.map((t) => (
        <li key={t.id}>
          <OneLine text={t.title} />
        </li>
      ))}
    </ul>
  );
}
