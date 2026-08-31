export const workbenchViews = [
  "today",
  "plan",
  "subjects",
  "schools",
  "career",
  "materials",
  "backup",
  "agents",
] as const;

export type WorkbenchView = (typeof workbenchViews)[number];

const defaultWorkbenchView: WorkbenchView = "today";

export function isWorkbenchView(value: string | null): value is WorkbenchView {
  return value !== null && workbenchViews.some((view) => view === value);
}

export function workbenchViewStorageKey(accountKey: string) {
  return `yantu:last-view:${accountKey}`;
}

export function readStoredWorkbenchView(
  storage: Pick<Storage, "getItem"> | null,
  accountKey: string,
): WorkbenchView {
  if (!storage) return defaultWorkbenchView;
  try {
    const storedView = storage.getItem(workbenchViewStorageKey(accountKey));
    return isWorkbenchView(storedView) ? storedView : defaultWorkbenchView;
  } catch {
    return defaultWorkbenchView;
  }
}

export function storeWorkbenchView(
  storage: Pick<Storage, "setItem"> | null,
  accountKey: string,
  view: WorkbenchView,
) {
  if (!storage) return;
  try {
    storage.setItem(workbenchViewStorageKey(accountKey), view);
  } catch {
    // Storage may be unavailable in private browsing; navigation must still work.
  }
}
