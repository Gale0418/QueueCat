import { normalizeSource } from "../shared/urls";

export interface SourceTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
}

export interface TabsPermissionApi {
  permissions: {
    request(options: { permissions: string[] }): Promise<boolean>;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<
      Array<{
        id?: number;
        windowId?: number;
        title?: string;
        url?: string;
      }>
    >;
  };
}

export type SourceTabsResult =
  | { status: "ok"; tabs: SourceTab[] }
  | { status: "denied" }
  | { status: "unavailable" };

/** Read only supported source pages, after the user grants the tabs permission. */
export async function requestSupportedTabs(
  api: TabsPermissionApi | undefined,
): Promise<SourceTabsResult> {
  if (!api?.permissions?.request || !api.tabs?.query)
    return { status: "unavailable" };

  // Keep this as the first privileged operation in the click handler path.
  if (!(await api.permissions.request({ permissions: ["tabs"] })))
    return { status: "denied" };

  const queried = await api.tabs.query({});
  const supported: SourceTab[] = [];
  for (const tab of queried) {
    if (!tab.url) continue;
    const normalized = normalizeSource(tab.url);
    if (!normalized || tab.id === undefined || tab.windowId === undefined) continue;
    supported.push({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || normalized,
      url: tab.url,
    });
  }
  return { status: "ok", tabs: supported };
}

export function appendSelectedTabUrls(
  currentText: string,
  tabs: SourceTab[],
  selectedIds: number[],
): string {
  const urls = tabs
    .filter((tab) => selectedIds.includes(tab.id))
    .map((tab) => tab.url);
  if (!urls.length) return currentText;
  const separator = currentText && !/\r?\n$/.test(currentText) ? "\n" : "";
  return `${currentText}${separator}${urls.join("\n")}`;
}
