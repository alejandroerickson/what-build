/** The house styles, one per file, in the order the catalogue lists them: the quietest first, the loudest last. */
import { BLOCKS } from "./blocks.ts";
import { CLEAR } from "./clear.ts";
import { ISOTYPE } from "./isotype.ts";
import type { HouseStyle } from "./kit.ts";
import { LARGE } from "./large.ts";
import { PASTEL } from "./pastel.ts";
import { REPORT } from "./report.ts";
import { RISO } from "./riso.ts";
import { TONAL } from "./tonal.ts";
import { WAYFINDING } from "./wayfinding.ts";
import { WIDE } from "./wide.ts";

export const HOUSE_STYLES: HouseStyle[] = [CLEAR, LARGE, REPORT, TONAL, WIDE, PASTEL, WAYFINDING, ISOTYPE, BLOCKS, RISO];
