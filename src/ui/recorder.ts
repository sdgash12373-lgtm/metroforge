/**
 * 巡查錄影: records the 3D view (not the buttons over it) with the browser's MediaRecorder, and hands the
 * clip over when it stops: the share sheet on phones (so it can go to Photos), a download elsewhere.
 */
export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0;
  private type = '';

  constructor(private canvas: HTMLCanvasElement) {}

  /** Whether this browser can record the canvas at all. */
  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get recording(): boolean {
    return this.rec !== null;
  }

  /** Seconds since recording began. */
  get seconds(): number {
    return this.rec ? (performance.now() - this.started) / 1000 : 0;
  }

  start(): boolean {
    if (this.rec || !ClipRecorder.supported()) return false;
    // MP4 where the browser can (Safari, newer Chrome) so phones can keep it in Photos; WebM otherwise
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    this.type = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    try {
      const stream = this.canvas.captureStream(30);
      this.rec = new MediaRecorder(stream, { ...(this.type ? { mimeType: this.type } : {}), videoBitsPerSecond: 8_000_000 });
    } catch {
      this.rec = null;
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
    this.started = performance.now();
    return true;
  }

  /** Stops and resolves with the clip, or null if nothing was recorded. */
  stop(): Promise<{ blob: Blob; name: string } | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    return new Promise((resolve) => {
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || this.type || 'video/webm';
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        this.chunks = [];
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
        resolve(blob.size ? { blob, name: `Metroforge-巡查-${stamp}.${type.includes('mp4') ? 'mp4' : 'webm'}` } : null);
      };
      rec.stop();
    });
  }
}

/** Offers the clip to the share sheet where there is one for files (phones), else downloads it. */
export async function saveClip(clip: { blob: Blob; name: string }): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([clip.blob], clip.name, { type: clip.blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: clip.name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Share refused (no user gesture left, say): fall back to a download
    }
  }
  const url = URL.createObjectURL(clip.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = clip.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
