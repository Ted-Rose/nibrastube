import axios from "axios";

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

export interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  channelId?: string;
  publishedAt: Date | null;
  durationSeconds: number | null;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  thumbnail: string;
}

export interface ChannelDetails extends YouTubeChannel {
  uploadsPlaylistId: string | null;
  description: string | null;
  country: string | null;
  publishedAt: Date | null;
  subscriberCount: number | null;
  videoCount: number | null;
  raw: unknown;
}

export interface UploadsPage {
  videoIds: string[];
  nextPageToken?: string;
}

// Everything we persist into the `videos` table from one videos.list item.
// Fields are null when the API didn't return them.
export interface FullVideoDetails extends YouTubeVideo {
  embeddable: boolean;
  description: string | null;
  tags: string[] | null;
  categoryId: number | null;
  defaultLanguage: string | null;
  defaultAudioLanguage: string | null;
  liveBroadcastContent: string | null;
  madeForKids: boolean | null;
  ageRestricted: boolean | null;
  privacyStatus: string | null;
  hasCaptions: boolean | null;
  definition: string | null;
  viewCount: number | null;
  likeCount: number | null;
  raw: unknown;
}

// Minimal shapes of the YouTube Data API responses we consume
interface YTThumbnails {
  maxres?: { url: string };
  standard?: { url: string };
  high?: { url: string };
  medium?: { url: string };
  default?: { url: string };
}

interface YTSnippet {
  title: string;
  description?: string;
  channelTitle?: string;
  channelId?: string;
  publishedAt?: string;
  thumbnails?: YTThumbnails;
  resourceId?: { videoId?: string };
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  liveBroadcastContent?: string;
  country?: string;
}

interface YTSearchItem {
  id: { videoId?: string; channelId?: string };
  snippet: YTSnippet;
}

interface YTPlaylistItem {
  contentDetails?: { videoId?: string };
  snippet?: YTSnippet;
}

interface YTVideoItem {
  id: string;
  snippet: YTSnippet;
  contentDetails?: {
    duration?: string;
    definition?: string;
    caption?: string; // "true" | "false"
    licensedContent?: boolean;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
    projection?: string;
  };
  status?: {
    uploadStatus?: string;
    privacyStatus?: string;
    embeddable?: boolean;
    madeForKids?: boolean;
    license?: string;
    publicStatsViewable?: boolean;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YTChannelItem {
  id: string;
  snippet: YTSnippet;
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
  statistics?: { subscriberCount?: string; videoCount?: string };
}

// YouTube returns ISO 8601 durations: PT1H2M3S / PT10M / PT45S
export function parseIsoDuration(iso?: string): number | null {
  const m = iso ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) : null;
  if (!m) return null;
  return +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
}

// Prefer the largest thumbnail the API actually returned
function pickThumbnail(t?: YTThumbnails): string {
  return (
    t?.maxres?.url ??
    t?.standard?.url ??
    t?.high?.url ??
    t?.medium?.url ??
    t?.default?.url ??
    ""
  );
}

function mapVideoItem(item: YTVideoItem): FullVideoDetails {
  const s = item.snippet;
  const cd = item.contentDetails;
  const st = item.status;
  const stats = item.statistics;
  return {
    id: item.id,
    title: s.title,
    thumbnail: pickThumbnail(s.thumbnails),
    channelTitle: s.channelTitle ?? "",
    channelId: s.channelId,
    publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
    durationSeconds: parseIsoDuration(cd?.duration),
    description: s.description ?? null,
    tags: s.tags ?? null,
    categoryId: s.categoryId ? Number(s.categoryId) : null,
    defaultLanguage: s.defaultLanguage ?? null,
    defaultAudioLanguage: s.defaultAudioLanguage ?? null,
    liveBroadcastContent: s.liveBroadcastContent ?? null,
    madeForKids: st?.madeForKids ?? null,
    ageRestricted:
      cd?.contentRating == null
        ? null
        : cd.contentRating.ytRating === "ytAgeRestricted",
    embeddable: st?.embeddable ?? false,
    privacyStatus: st?.privacyStatus ?? null,
    hasCaptions:
      cd?.caption == null ? null : cd.caption === "true",
    definition: cd?.definition ?? null,
    viewCount: stats?.viewCount != null ? Number(stats.viewCount) : null,
    likeCount: stats?.likeCount != null ? Number(stats.likeCount) : null,
    raw: item,
  };
}

/** Values for inserting/updating a `videos` row from API details. */
export function videoRowValues(v: FullVideoDetails) {
  return {
    id: v.id,
    title: v.title,
    thumbnail: v.thumbnail,
    channelTitle: v.channelTitle,
    channelId: v.channelId,
    publishedAt: v.publishedAt,
    durationSeconds: v.durationSeconds,
    description: v.description,
    tags: v.tags,
    categoryId: v.categoryId,
    defaultLanguage: v.defaultLanguage,
    defaultAudioLanguage: v.defaultAudioLanguage,
    liveBroadcastContent: v.liveBroadcastContent,
    madeForKids: v.madeForKids,
    ageRestricted: v.ageRestricted,
    embeddable: v.embeddable,
    privacyStatus: v.privacyStatus,
    hasCaptions: v.hasCaptions,
    definition: v.definition,
    viewCount: v.viewCount,
    likeCount: v.likeCount,
    fetchedAt: new Date(),
    raw: v.raw,
  };
}

/** Values for inserting/updating a `channels` row from API details. */
export function channelRowValues(c: ChannelDetails) {
  return {
    id: c.id,
    title: c.title,
    thumbnail: c.thumbnail,
    uploadsPlaylistId: c.uploadsPlaylistId,
    description: c.description,
    country: c.country,
    publishedAt: c.publishedAt,
    subscriberCount: c.subscriberCount,
    videoCount: c.videoCount,
    fetchedAt: new Date(),
    raw: c.raw,
  };
}

export async function searchYouTube(query: string): Promise<YouTubeVideo[]> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/search`, {
    params: {
      part: "snippet",
      maxResults: 12,
      q: query,
      type: "video",
      key: API_KEY,
    },
  });

  return response.data.items.map((item: YTSearchItem) => ({
    id: item.id.videoId,
    title: item.snippet.title,
    thumbnail: pickThumbnail(item.snippet.thumbnails),
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt
      ? new Date(item.snippet.publishedAt)
      : null,
    durationSeconds: null, // search results don't include contentDetails
  }));
}

export async function getVideoDetails(
  videoId: string
): Promise<FullVideoDetails> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/videos`, {
    params: {
      part: "snippet,contentDetails,status,statistics",
      id: videoId,
      key: API_KEY,
    },
  });

  const item: YTVideoItem = response.data.items[0];
  return mapVideoItem(item);
}

export async function searchChannels(query: string): Promise<YouTubeChannel[]> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/search`, {
    params: {
      part: "snippet",
      maxResults: 12,
      q: query,
      type: "channel",
      key: API_KEY,
    },
  });

  return response.data.items.map((item: YTSearchItem) => ({
    id: item.id.channelId,
    title: item.snippet.title,
    thumbnail: pickThumbnail(item.snippet.thumbnails),
  }));
}

export async function getChannelDetails(channelId: string): Promise<ChannelDetails | null> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/channels`, {
    params: {
      part: "snippet,contentDetails,statistics",
      id: channelId,
      key: API_KEY,
    },
  });

  const item: YTChannelItem | undefined = response.data.items?.[0];
  if (!item) return null;

  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: pickThumbnail(item.snippet.thumbnails),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    description: item.snippet.description ?? null,
    country: item.snippet.country ?? null,
    publishedAt: item.snippet.publishedAt
      ? new Date(item.snippet.publishedAt)
      : null,
    subscriberCount:
      item.statistics?.subscriberCount != null
        ? Number(item.statistics.subscriberCount)
        : null,
    videoCount:
      item.statistics?.videoCount != null
        ? Number(item.statistics.videoCount)
        : null,
    raw: item,
  };
}

export async function getUploadsPage(
  playlistId: string,
  pageToken?: string
): Promise<UploadsPage> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/playlistItems`, {
    params: {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: 50,
      pageToken,
      key: API_KEY,
    },
  });

  return {
    videoIds: (response.data.items || [])
      .map(
        (item: YTPlaylistItem) =>
          item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      )
      .filter(Boolean),
    nextPageToken: response.data.nextPageToken,
  };
}

export async function getVideosBatch(ids: string[]): Promise<FullVideoDetails[]> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");
  if (ids.length === 0) return [];

  const results: FullVideoDetails[] = [];
  // /videos accepts up to 50 ids per call
  for (let i = 0; i < ids.length; i += 50) {
    const response = await axios.get(`${BASE_URL}/videos`, {
      params: {
        part: "snippet,contentDetails,status,statistics",
        id: ids.slice(i, i + 50).join(","),
        key: API_KEY,
      },
    });

    for (const item of (response.data.items || []) as YTVideoItem[]) {
      // Only embeddable videos can play in the IFrame embed
      if (item.status?.embeddable !== true) continue;
      results.push(mapVideoItem(item));
    }
  }

  return results;
}
