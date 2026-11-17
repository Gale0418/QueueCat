export const GELBOORU_SESSION_KEY = "queuecat.gelbooru.session";

export interface GelbooruCredentials {
  userId: string;
  apiKey: string;
}

export function gelbooruCredentials(
  value: unknown,
): GelbooruCredentials | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { userId, apiKey } = value as Partial<GelbooruCredentials>;
  if (
    typeof userId !== "string" ||
    !/^[1-9]\d{0,9}$/.test(userId) ||
    typeof apiKey !== "string" ||
    !/^[a-z0-9_-]{1,160}$/i.test(apiKey)
  )
    return undefined;
  return { userId, apiKey };
}
