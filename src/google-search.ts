import axios from 'axios';

export interface GoogleResult {
  title: string;
  link: string;
  snippet?: string;
}

export async function googleSearch(query: string, apiKey?: string, cx?: string): Promise<GoogleResult[]> {
  if (!apiKey || !cx) return [];
  const url = 'https://www.googleapis.com/customsearch/v1';
  try {
    const res = await axios.get(url, { params: { key: apiKey, cx, q: query } });
    if (!res.data || !res.data.items) return [];
    return res.data.items.map((it: any) => ({ title: it.title, link: it.link, snippet: it.snippet }));
  } catch (e) {
    // swallow and return empty for resiliency
    return [];
  }
}
