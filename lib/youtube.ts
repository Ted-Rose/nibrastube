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
}

export interface UploadsPage {
  videoIds: string[];
  nextPageToken?: string;
}

export interface FullVideoDetails extends YouTubeVideo {
  embeddable: boolean;
}

// Minimal shapes of the YouTube Data API responses we consume
interface YTSnippet {
  title: string;
  channelTitle?: string;
  channelId?: string;
  publishedAt?: string;
  thumbnails?: { medium?: { url: string }; default?: { url: string } };
  resourceId?: { videoId?: string };
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
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean };
}

// YouTube returns ISO 8601 durations: PT1H2M3S / PT10M / PT45S
export function parseIsoDuration(iso?: string): number | null {
  const m = iso ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) : null;
  if (!m) return null;
  return +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
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
    thumbnail: item.snippet.thumbnails?.medium?.url,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt
      ? new Date(item.snippet.publishedAt)
      : null,
    durationSeconds: null, // search results don't include contentDetails
  }));
}

export async function getVideoDetails(videoId: string): Promise<YouTubeVideo> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/videos`, {
    params: {
      part: "snippet,contentDetails",
      id: videoId,
      key: API_KEY,
    },
  });

  const item: YTVideoItem = response.data.items[0];
  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url ?? "",
    channelTitle: item.snippet.channelTitle ?? "",
    channelId: item.snippet.channelId,
    publishedAt: item.snippet.publishedAt
      ? new Date(item.snippet.publishedAt)
      : null,
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
  };
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
    thumbnail: item.snippet.thumbnails?.medium?.url,
  }));
}

export async function getChannelDetails(channelId: string): Promise<ChannelDetails | null> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/channels`, {
    params: {
      part: "snippet,contentDetails",
      id: channelId,
      key: API_KEY,
    },
  });

  const item = response.data.items?.[0];
  if (!item) return null;

  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
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
        part: "snippet,status,contentDetails",
        id: ids.slice(i, i + 50).join(","),
        key: API_KEY,
      },
    });

    for (const item of (response.data.items || []) as YTVideoItem[]) {
      // Only embeddable videos can play in the IFrame embed
      if (item.status?.embeddable !== true) continue;
      results.push({
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
        channelTitle: item.snippet.channelTitle ?? "",
        channelId: item.snippet.channelId,
        publishedAt: item.snippet.publishedAt
          ? new Date(item.snippet.publishedAt)
          : null,
        durationSeconds: parseIsoDuration(item.contentDetails?.duration),
        embeddable: true,
      });
    }
  }

  return results;
}
