// -----------------------------------------------------------------------------
// MP4 writer (animation video export, DESIGN.md › Animation › Capture)
// -----------------------------------------------------------------------------
// WebCodecs encodes, Mediabunny (MPL-2.0) packs the chunks into an MP4 that
// streams into a file as it grows — the video is never held in memory whole.
// The frame count is known up front, so the MP4's index is reserved at the
// start of the file (Fast Start: players and web pages begin at once). H.264
// first — it plays everywhere (PowerPoint, phones); Chrome's software encoder
// on Linux only does the baseline profile, so the profiles step down before
// VP9 / AV1 (still MP4, fine in browsers and VLC).
//
// A hidden tab: the browser stops drawing, so the export waits, and Chrome
// may take an encoder that sat idle there back (a QuotaExceededError).
// `settle()` hands every frame to the file before the tab hides; a taken
// encoder is then replaced and the video carries on from a key frame. If
// frames were still inside it, or the new one's stream setup differs, the
// export stops at once with a message instead of failing at the end.

import {
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import type { Result } from '../result';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type MuxCodec = 'avc' | 'vp9' | 'av1';
type Failure = { err: unknown; msg: string };

export interface Mp4Writer {
  /** the codec string the encoder runs */
  codec: string;
  /** Encode the canvas as video frame `index` (one frame duration long); an
   *  error once the encoder or the file cannot go on (stop rendering then). */
  add(source: HTMLCanvasElement, index: number): Promise<Result<true>>;
  /** Write out every frame given so far (call before the tab is hidden). */
  settle(): Promise<void>;
  /** Flush, write the index and close the file. */
  finish(): Promise<Result<true>>;
  /** Stop and let go of the file as it is (cancel, or after a failure). */
  close(): Promise<void>;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Tried in order; H.264 at level 5.1 covers up to 4K at 30 fps. */
const CANDIDATES: readonly { codec: string; mux: MuxCodec }[] = [
  { codec: 'avc1.640033', mux: 'avc' },
  { codec: 'avc1.4d0033', mux: 'avc' },
  { codec: 'avc1.42e033', mux: 'avc' },
  { codec: 'vp09.00.51.08', mux: 'vp9' },
  { codec: 'av01.0.13M.08', mux: 'av1' },
];
/** Bits per pixel per frame — thin CAD edges need more than film does. */
const BITS_PER_PIXEL = 0.15;
/** Frames waiting in the encoder before add() waits for it. */
const MAX_QUEUE = 6;
/** Encoded frames waiting to go into the file before add() waits for it. */
const MAX_UNWRITTEN = 30;
/** A key frame every this many seconds (seeking in players). */
const KEY_FRAME_S = 2;
/** The error a browser reports when it takes an idle encoder back. */
const RECLAIMED = 'QuotaExceededError';
const MSG_FAILED = 'The video encoder failed.';
const MSG_TAKEN =
  'The browser stopped the video encoder while this tab was hidden. Export again and keep this tab in front until it is done.';
const MSG_WRITE = 'The video could not be written to disk — is it full?';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** A copy of a decoder description's bytes (compared across encoders). */
function bytesOf(d: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(d)
    ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice()
    : new Uint8Array(d).slice();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function pickConfig(
  width: number,
  height: number,
  fps: number,
): Promise<{ mux: MuxCodec; config: VideoEncoderConfig } | null> {
  const bitrate = Math.round(width * height * fps * BITS_PER_PIXEL);
  for (const c of CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) {
        return { mux: c.mux, config };
      }
    } catch {
      // a codec string this browser does not parse: try the next
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/**
 * An MP4 writer for `frames` frames of `width × height` (even numbers) at
 * `fps`, streaming into `file`. It owns the file from here on: finish() and
 * close() close it, and so does an error from this call.
 */
export async function openMp4Writer(
  file: WritableStream<StreamTargetChunk>,
  frames: number,
  width: number,
  height: number,
  fps: number,
): Promise<Result<Mp4Writer>> {
  const refuse = async (msg: string): Promise<Result<Mp4Writer>> => {
    await file.abort().catch(() => undefined);
    return { error: { err: null, msg } };
  };
  if (typeof VideoEncoder === 'undefined') {
    return refuse('This browser cannot encode video (WebCodecs is missing).');
  }
  const picked = await pickConfig(width, height, fps);
  if (!picked) {
    return refuse(`No video encoder takes ${width}×${height} here — try a smaller size.`);
  }
  const source = new EncodedVideoPacketSource(picked.mux);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'reserve' }),
    target: new StreamTarget(file, { chunked: true }),
  });
  // one packet per frame — exactly what is reserved for the index
  output.addVideoTrack(source, { frameRate: fps, maximumPacketCount: frames });
  try {
    await output.start();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    return { error: { err, msg: MSG_WRITE } };
  }
  const frameUs = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * KEY_FRAME_S));
  let failure: Failure | null = null;
  let reclaimed = false;
  /** frames given to an encoder / frames the encoders gave back */
  let sent = 0;
  let encoded = 0;
  let description: Uint8Array | null = null;
  let keyNext = true;
  /** The file takes the encoded frames one after another, in order. */
  let writing: Promise<void> = Promise.resolve();
  let unwritten = 0;

  const onChunk = (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
    const d = meta?.decoderConfig?.description;
    if (d) {
      const bytes = bytesOf(d);
      if (!description) {
        description = bytes;
      } else if (!sameBytes(description, bytes)) {
        // the file has one stream setup; a replacement encoder with another would garble the frames before it
        failure ??= { err: null, msg: MSG_TAKEN };
      }
    }
    if (failure) {
      return;
    }
    const packet = EncodedPacket.fromEncodedChunk(chunk);
    encoded++;
    unwritten++;
    writing = writing
      .then(() => (failure ? undefined : source.add(packet, meta)))
      .catch((err: unknown) => {
        failure ??= { err, msg: MSG_WRITE };
      })
      .finally(() => {
        unwritten--;
      });
  };
  const openEncoder = (): VideoEncoder => {
    const enc = new VideoEncoder({
      output: onChunk,
      error: (e) => {
        if (e.name === RECLAIMED) {
          reclaimed = true;
        } else {
          failure ??= { err: e, msg: MSG_FAILED };
        }
      },
    });
    enc.configure(picked.config);
    return enc;
  };
  let encoder = openEncoder();
  /** A taken encoder is replaced when it had written every frame. */
  const recover = () => {
    if (!reclaimed && (encoder.state !== 'closed' || failure)) {
      return;
    }
    reclaimed = false;
    if (encoded < sent) {
      failure ??= { err: null, msg: MSG_TAKEN };
      return;
    }
    encoder = openEncoder();
    keyNext = true;
  };
  const closeEncoder = () => {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  };
  const close = async () => {
    closeEncoder();
    await output.cancel().catch(() => undefined);
  };

  return {
    data: {
      codec: picked.config.codec,
      async add(canvas, index) {
        for (;;) {
          recover();
          if (failure) {
            await close();
            return { error: failure };
          }
          if (unwritten > MAX_UNWRITTEN) {
            await writing;
            continue;
          }
          if (encoder.encodeQueueSize <= MAX_QUEUE) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 4));
        }
        const frame = new VideoFrame(canvas, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) });
        encoder.encode(frame, { keyFrame: keyNext || index % keyEvery === 0 });
        frame.close();
        keyNext = false;
        sent++;
        return { data: true };
      },
      async settle() {
        if (encoder.state !== 'configured') {
          return;
        }
        try {
          await encoder.flush();
        } catch {
          // taken or failed meanwhile — the error callback said which
        }
        keyNext = true;
      },
      async finish() {
        if (reclaimed || encoder.state === 'closed') {
          // taken after the last frame: fine when it had written them all
          if (encoded < sent) {
            failure ??= { err: null, msg: MSG_TAKEN };
          }
        } else if (!failure) {
          try {
            await encoder.flush();
          } catch (err) {
            failure ??= reclaimed ? { err, msg: MSG_TAKEN } : { err, msg: 'The video encoder stopped.' };
          }
        }
        closeEncoder();
        await writing;
        if (failure) {
          await close();
          return { error: failure };
        }
        try {
          await output.finalize();
        } catch (err) {
          await close();
          return { error: { err, msg: MSG_WRITE } };
        }
        return { data: true };
      },
      close,
    },
  };
}
