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
 * Avatar type is selected by HEYGEN_CHARACTER_TYPE env (or per-call opt):
 *   - "avatar"        → Studio Avatar (default; uses character.avatar_id)
 *   - "talking_photo" → Photo Avatar / Avatar IV (uses character.talking_photo_id)
 * If a Photo Avatar request returns "avatar not found", we automatically
 * retry with the other type so the operator doesn't have to remember to
 * flip an env var.
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
const DEFAULT_CHARACTER_TYPE: CharacterType =
  ((process.env.HEYGEN_CHARACTER_TYPE || "").trim().toLowerCase() === "talking_photo")
    ? "talking_photo"
    : "avatar";

export type CharacterType = "avatar" | "talking_photo";

export interface HeyGenCreateOpts {
  avatar_id?: string;
  voice_id?: string;
  /** Which HeyGen avatar type to use. Defaults to HEYGEN_CHARACTER_TYPE env. */
  character_type?: CharacterType;
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

/** Build the HeyGen v2 video_inputs body. Two character shapes are supported:
 *  Studio Avatar — character.type "avatar"        + character.avatar_id
 *  Photo Avatar  — character.type "talking_photo" + character.talking_photo_id
 *  voice + dimension are identical across both. */
function buildBody(
  speechText: string,
  characterType: CharacterType,
  avatarId: string,
  voiceId: string,
  width: number,
  height: number
): Record<string, unknown> {
  const character: Record<string, unknown> =
    characterType === "talking_photo"
      ? { type: "talking_photo", talking_photo_id: avatarId }
      : { type: "avatar", avatar_id: avatarId, avatar_style: "normal" };

  return {
    video_inputs: [
      {
        character,
        voice: { type: "text", input_text: speechText, voice_id: voiceId },
      },
    ],
    dimension: { width, height },
  };
}

/** Submit a new video render. Returns the HeyGen video_id (job id).
 *
 *  Retry logic: if the chosen character type is rejected with a "not found"
 *  / "wrong type" style error, we automatically try the OTHER type once. This
 *  saves an env-var dance when an operator pastes a Photo Avatar ID into a
 *  config that defaults to Studio Avatars (or vice versa). */
export async function createVideo(speechText: string, opts: HeyGenCreateOpts = {}): Promise<string> {
  const apiKey = getApiKey();
  const avatarId = opts.avatar_id ?? DEFAULT_AVATAR_ID;
  const voiceId = opts.voice_id ?? DEFAULT_VOICE_ID;
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const primaryType: CharacterType = opts.character_type ?? DEFAULT_CHARACTER_TYPE;

  const submit = async (type: CharacterType): Promise<{ video_id?: string; error_text: string; status: number }> => {
    const body = buildBody(speechText, type, avatarId, voiceId, width, height);
    const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return { error_text: text, status: res.status };
    try {
      const json = JSON.parse(text) as { data?: { video_id?: string } };
      return { video_id: json?.data?.video_id, error_text: text, status: res.status };
    } catch {
      return { error_text: text, status: res.status };
    }
  };

  const first = await submit(primaryType);
  if (first.video_id) return first.video_id;

  // Decide whether to retry with the other character type. HeyGen returns
  // varied error strings — match conservatively on "not found" / "invalid"
  // / "wrong" / "talking_photo" / "avatar_id" so we don't burn quota on
  // unrelated failures (rate limits, billing, etc.).
  const other: CharacterType = primaryType === "avatar" ? "talking_photo" : "avatar";
  const looksLikeWrongType =
    /not\s*found|invalid\s*(avatar|talking|character)|wrong\s*(type|character)|talking_photo_id|avatar_id|character\.type/i
      .test(first.error_text);

  if (looksLikeWrongType) {
    const second = await submit(other);
    if (second.video_id) return second.video_id;
    throw new Error(
      `HeyGen createVideo: tried both character types. ` +
      `first(${primaryType})=HTTP ${first.status} ${first.error_text.slice(0, 200)} ; ` +
      `second(${other})=HTTP ${second.status} ${second.error_text.slice(0, 200)}`
    );
  }

  throw new Error(`HeyGen createVideo HTTP ${first.status}: ${first.error_text.slice(0, 500)}`);
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
