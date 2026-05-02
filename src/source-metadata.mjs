function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const SOURCE_TYPES = Object.freeze({
  AD: "ad",
  ARTICLE: "article",
  SEARCH_RESULT: "search_result",
  VIDEO_TRANSCRIPT: "youtube_video_transcript",
  SONG_LYRICS: "song_lyrics",
  SOCIAL_MEDIA_POST: "social_media_post",
  CHAT_MESSAGE: "chat_message",
  PRODUCT_PAGE: "product_page",
  PERSONAL_NOTE: "personal_note",
  SURVEY_SELF_REPORT: "survey_self_report",
  WEB_PAGE: "web_page",
});

const SOCIAL_DOMAINS = ["twitter.com", "x.com", "bsky.app", "facebook.com", "instagram.com", "reddit.com", "linkedin.com"];
const CHAT_DOMAINS = ["chat.openai.com", "claude.ai", "gemini.google.com", "discord.com", "slack.com", "teams.microsoft.com"];
const LYRICS_DOMAINS = ["genius.com", "azlyrics.com", "musixmatch.com"];
const SHOPPING_DOMAINS = ["amazon.", "flipkart.", "ebay.", "shopify.", "etsy.com"];
const SEARCH_DOMAINS = ["google.", "bing.com", "duckduckgo.com", "search.yahoo.com"];

export function inferSourceType(source = {}) {
  const explicit = normalize(source.source_type || source.type || source.media_type);
  const url = String(source.url || source.source_url || "");
  const host = hostnameOf(url);
  const title = normalize(source.title || source.label || "");
  const text = `${explicit} ${host} ${title} ${normalize(url)}`;

  if (explicit.includes("self") || explicit.includes("survey")) return SOURCE_TYPES.SURVEY_SELF_REPORT;
  if (text.includes("ad") || text.includes("utm_medium=cpc") || text.includes("utm_source=ad")) return SOURCE_TYPES.AD;
  if (SEARCH_DOMAINS.some((domain) => host.includes(domain)) || explicit.includes("search")) return SOURCE_TYPES.SEARCH_RESULT;
  if (host.includes("youtube.com") || host.includes("youtu.be") || explicit.includes("video") || explicit.includes("transcript")) {
    return SOURCE_TYPES.VIDEO_TRANSCRIPT;
  }
  if (LYRICS_DOMAINS.some((domain) => host.includes(domain)) || text.includes("lyrics")) return SOURCE_TYPES.SONG_LYRICS;
  if (SOCIAL_DOMAINS.some((domain) => host.includes(domain)) || explicit.includes("social")) return SOURCE_TYPES.SOCIAL_MEDIA_POST;
  if (CHAT_DOMAINS.some((domain) => host.includes(domain)) || explicit.includes("chat")) return SOURCE_TYPES.CHAT_MESSAGE;
  if (SHOPPING_DOMAINS.some((domain) => host.includes(domain)) || explicit.includes("product")) return SOURCE_TYPES.PRODUCT_PAGE;
  if (explicit.includes("note") || text.includes("notion") || text.includes("obsidian")) return SOURCE_TYPES.PERSONAL_NOTE;
  if (explicit.includes("article") || title.length > 20) return SOURCE_TYPES.ARTICLE;
  return SOURCE_TYPES.WEB_PAGE;
}

export function sourceReliabilityScore(source = {}) {
  const type = inferSourceType(source);
  const baseScores = {
    [SOURCE_TYPES.AD]: 0.42,
    [SOURCE_TYPES.ARTICLE]: 0.72,
    [SOURCE_TYPES.SEARCH_RESULT]: 0.58,
    [SOURCE_TYPES.VIDEO_TRANSCRIPT]: 0.66,
    [SOURCE_TYPES.SONG_LYRICS]: 0.48,
    [SOURCE_TYPES.SOCIAL_MEDIA_POST]: 0.54,
    [SOURCE_TYPES.CHAT_MESSAGE]: 0.62,
    [SOURCE_TYPES.PRODUCT_PAGE]: 0.46,
    [SOURCE_TYPES.PERSONAL_NOTE]: 0.78,
    [SOURCE_TYPES.SURVEY_SELF_REPORT]: 0.82,
    [SOURCE_TYPES.WEB_PAGE]: 0.55,
  };
  const snippetLength = String(source.snippet || source.text || source.text_excerpt || "").trim().length;
  const hasTimestamp = Boolean(source.timestamp || source.captured_at || source.occurred_at);
  const hasUrl = Boolean(source.url || source.source_url);
  const evidenceBonus = Math.min(0.12, (snippetLength / 800) * 0.08) + (hasTimestamp ? 0.03 : 0) + (hasUrl ? 0.02 : 0);
  const score = Math.max(0, Math.min(1, (baseScores[type] ?? 0.5) + evidenceBonus));
  return Number(score.toFixed(4));
}

export function enrichSourceMetadata(source = {}) {
  const source_type = inferSourceType(source);
  return {
    ...source,
    source_type,
    source_strength_score: sourceReliabilityScore({ ...source, source_type }),
  };
}
