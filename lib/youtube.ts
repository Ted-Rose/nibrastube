import axios from "axios";

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

export interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  channelId?: string;
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
  }));
}

export async function getVideoDetails(videoId: string): Promise<YouTubeVideo> {
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY is not defined");

  const response = await axios.get(`${BASE_URL}/videos`, {
    params: {
      part: "snippet",
      id: videoId,
      key: API_KEY,
    },
  });

  const item = response.data.items[0];
  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.medium.url,
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
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
        part: "snippet,status",
        id: ids.slice(i, i + 50).join(","),
        key: API_KEY,
      },
    });

    for (const item of response.data.items || []) {
      // Only embeddable videos can play in the IFrame embed
      if (item.status?.embeddable !== true) continue;
      results.push({
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        embeddable: true,
      });
    }
  }

  return results;
}
