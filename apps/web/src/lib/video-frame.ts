import { api } from "./api.ts";

/** How wide a frame is sent. The server makes its own small copies from it. */
const FRAME_WIDTH = 640;
/** How far into a video to look when none is playing: a first frame is often black. */
const FRAME_AT_SECONDS = 1;
/** How long a video may take to give up a frame before it goes without. */
const FRAME_WAIT_MS = 15_000;

/** The frame a video element is showing, as a JPEG in base64; null if there is none to take. */
export async function frameOf(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(FRAME_WIDTH, video.videoWidth);
  canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvasAsBase64(canvas);
}

/** What a canvas holds, as a JPEG in base64. */
export async function canvasAsBase64(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** A frame of a video someone is uploading, read from the file on their own machine: this reads nothing from the server. */
export function frameOfFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (frame: string | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(frame);
    };
    const timer = setTimeout(() => done(null), FRAME_WAIT_MS);
    video.muted = true;
    video.preload = "auto";
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(FRAME_AT_SECONDS, (video.duration || 0) / 2);
    };
    video.onseeked = () => void frameOf(video).then(done, () => done(null));
    video.src = url;
  });
}

/**
 * Gives a video or an HTML page its picture. Nothing depends on it: one with none shows the next
 * thing it has, so a failure here says nothing to anyone.
 */
export async function sendFrame(base: string, recordId: string, path: string, frame: string): Promise<void> {
  await api("POST", `${base}/sources/${recordId}/frame`, { path, image_base64: frame }).catch(() => undefined);
}
