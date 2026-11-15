import { isVideo, VIDEO_EXTENSIONS } from "@whatbuild/parsers/statuses";
import { AppError } from "./errors.ts";
import { mediaTypeFor } from "./media.ts";

/**
 * WhatBuild takes no video: a file is refused wherever it comes in when its extension is a video's,
 * or when the media type WhatBuild gives it (by its extension, then the type declared) is `video/*`.
 * A video stored before is kept and downloads as a file. This module imports nothing heavy, so the
 * web app turns a video away with the same test before it creates anything.
 */
export { VIDEO_EXTENSIONS };

/** Whether a file coming in is a video. `declared` is the media type its sender gave, if any. */
export function isVideoFile(path: string, declared?: string | null): boolean {
  return isVideo(path, mediaTypeFor(path, declared));
}

/** What to send instead of a video. */
export const INSTEAD_OF_VIDEO =
  "Add the video's transcript instead, as an attachment (a .vtt, .srt or text file), or a link to where the video lives, in the source's summary or its text";

/** The refusal of a video added to a source as an attachment. */
export function videoNotAccepted(path: string): AppError {
  return new AppError(415, "video_not_accepted", `${path} is a video, and WhatBuild does not keep video, so nothing was added. ${INSTEAD_OF_VIDEO}.`, { path });
}
