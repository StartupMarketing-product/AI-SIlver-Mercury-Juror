/**
 * HeyGen video generation adapter.
 *
 * Two operations:
 *   - createVideo(speechText, opts) → POSTs to HeyGen, returns video_id
 *   - getVideoStatus(video_id) → GETs status, returns { status, video_url? }
 *
 * Defaults for avatar_id and voice_id come from env (HEYGEN_AVATAR_ID,
 * HEYGEN_VOICE_ID). Override per call by passing them in opts.
 *
 * Designed to be fire-and-forget: createVideo returns the job id immediately,
 * a background poller in index.ts checks status every 30s and writes the
 * final video_url back to the verdict row when ready.
 */

const HEYGEN_API_BASE = "https://api.heygen.com";

// Use || (not ??) so empty-string env vars also fall back to the default.
// This is important because dotenv parses `HEYGEN_VOICE_ID=` as "" not undefined,
// and HeyGen rejects empty voice_id with "Voice not found".
const DEFAULT_AVATAR_ID = (process.env.HEYGEN_AVATAR_ID || "").trim() || "ae1759f2b3d046e38baf250403b53aef";
const DEFAULT_VOICE_ID = (process.env.HEYGEN_VOICE_ID || "").trim() || "c458964dc4264b70a867b2ebcf36b51e";

export interface HeyGenCreateOpts {
  avatar_id?: string;
  voice_id?: string;
  /** Width in pixels. HeyGen default 1280. */
  width?: number;
  /** Height in pixels. HeyGen default 720. */
  height?: number;
}

export interface HeyGenStatus {
  status: "pending" | "processing" | "waiting" | "completed" | "failed";
  video_url?: string;
  thumbnail_url?: string;
  error?: string;
}

function getApiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY not set in environment");
  return key;
}

/** Submit a new video render. Returns the HeyGen video_id (job id). */
export async function createVideo(speechText: string, opts: HeyGenCreateOpts = {}): Promise<string> {
  const apiKey = getApiKey();
  const body = {
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: opts.avatar_id ?? DEFAULT_AVATAR_ID,
          avatar_style: "normal",
        },
        voice: {
          type: "text",
          input_text: speechText,
          voice_id: opts.voice_id ?? DEFAULT_VOICE_ID,
        },
      },
    ],
    dimension: {
      width: opts.width ?? 1280,
      height: opts.height ?? 720,
    },
  };

  const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HeyGen createVideo HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data?: { video_id?: string }; error?: unknown };
  const videoId = json?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen createVideo: no video_id in response: ${JSON.stringify(json).slice(0, 500)}`);
  return videoId;
}

/** Check the render status of a video. Returns the current state + URL when ready. */
export async function getVideoStatus(videoId: string): Promise<HeyGenStatus> {
  const apiKey = getApiKey();
  const url = `${HEYGEN_API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HeyGen getVideoStatus HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    data?: { status?: string; video_url?: string; thumbnail_url?: string; error?: { message?: string } };
  };
  const data = json?.data ?? {};
  const status = (data.status ?? "pending") as HeyGenStatus["status"];
  return {
    status,
    video_url: data.video_url,
    thumbnail_url: data.thumbnail_url,
    error: data.error?.message,
  };
}
