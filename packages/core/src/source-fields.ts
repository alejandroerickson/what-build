/**
 * The closed vocabularies a source's fields use. What the material is, and whom it concerns, are
 * tags: there is no list of kinds.
 */

export const PROVENANCE_DEPTHS = ["primary", "derived", "analysis_of_analysis", "unknown"] as const;
export const FILE_ROLES = ["primary", "origin", "supplement"] as const;

/** The sentence repeated wherever files are added or listed. */
export const SEARCH_RULE =
  "Only the primary file is searched. Origin and supplement files are kept in full for download and never affect search.";
