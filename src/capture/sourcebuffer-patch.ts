import { logError } from "@/capture/log";
import { isAudioMimeType } from "@/capture/mime-filter";
import { capturesFrom } from "@/pageworld/select-media-element";

interface SourceBufferCaptureDeps {
  isAdPlaying(): boolean;
  onAudioChunk(mimeType: string, bytes: Uint8Array): void;
}

interface SourceBufferCaptureHandle {
  restore(): void;
}

function copyBufferSource(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

// -- Which media element a source buffer is feeding ---------------------------

function mediaElementFor(mediaSource: MediaSource, objectUrl: string | undefined): HTMLMediaElement | null {
  for (const element of document.querySelectorAll("video, audio")) {
    const media = element as HTMLMediaElement;
    if (media.srcObject !== null && media.srcObject === (mediaSource as unknown as MediaProvider)) return media;
    if (objectUrl !== undefined && media.src === objectUrl) return media;
  }
  return null;
}

function installSourceBufferCapture(deps: SourceBufferCaptureDeps): SourceBufferCaptureHandle {
  const mimeTypeBySourceBuffer = new WeakMap<SourceBuffer, string>();
  const mediaSourceBySourceBuffer = new WeakMap<SourceBuffer, MediaSource>();
  const objectUrlByMediaSource = new WeakMap<MediaSource, string>();
  const capturedBySourceBuffer = new WeakMap<SourceBuffer, boolean>();

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
  const originalCreateObjectURL = URL.createObjectURL;

  URL.createObjectURL = function patchedCreateObjectURL(object: Blob | MediaSource): string {
    const url = originalCreateObjectURL.call(URL, object);
    try {
      if (object instanceof MediaSource) objectUrlByMediaSource.set(object, url);
    } catch (error) {
      logError("failed to record a media source's url, its appends cannot be attributed", error);
    }
    return url;
  };

  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mimeType: string): SourceBuffer {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    try {
      mimeTypeBySourceBuffer.set(sourceBuffer, mimeType);
      mediaSourceBySourceBuffer.set(sourceBuffer, this);
    } catch (error) {
      logError("failed to record a source buffer's mime type, it will not be captured", error);
    }
    return sourceBuffer;
  };

  // Resolved once per source buffer and remembered, because a source buffer
  // never changes the media source it belongs to. An unresolved element is not
  // remembered, so the next append tries again.
  function capturesThis(sourceBuffer: SourceBuffer): boolean {
    const remembered = capturedBySourceBuffer.get(sourceBuffer);
    if (remembered !== undefined) return remembered;

    const mediaSource = mediaSourceBySourceBuffer.get(sourceBuffer);
    if (mediaSource === undefined) return true;

    const element = mediaElementFor(mediaSource, objectUrlByMediaSource.get(mediaSource));
    if (element === null) return true;

    const captures = capturesFrom(element);
    capturedBySourceBuffer.set(sourceBuffer, captures);
    return captures;
  }

  SourceBuffer.prototype.appendBuffer = function (this: SourceBuffer, data: BufferSource): void {
    try {
      const mimeType = mimeTypeBySourceBuffer.get(this);
      if (mimeType && isAudioMimeType(mimeType) && !deps.isAdPlaying() && capturesThis(this)) {
        deps.onAudioChunk(mimeType, copyBufferSource(data));
      }
    } catch (error) {
      logError("capture failed for an appendBuffer call, playback continues uncaptured", error);
    }
    originalAppendBuffer.call(this, data);
  };

  function restore(): void {
    MediaSource.prototype.addSourceBuffer = originalAddSourceBuffer;
    SourceBuffer.prototype.appendBuffer = originalAppendBuffer;
    URL.createObjectURL = originalCreateObjectURL;
  }

  return { restore };
}

export { installSourceBufferCapture };
export type { SourceBufferCaptureDeps, SourceBufferCaptureHandle };
