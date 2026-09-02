export const DEFAULT_EXAM_TARGET_DATE = "2028-12-23";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type StorageReaderWriter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function isValidExamTargetDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function examTargetStorageKey(accountKey: string) {
  return `kaoyan:exam-target:${accountKey}`;
}

export function readExamTargetDate(storage: Pick<StorageReaderWriter, "getItem"> | null, accountKey: string) {
  if (!storage) return DEFAULT_EXAM_TARGET_DATE;
  try {
    const stored = storage.getItem(examTargetStorageKey(accountKey));
    return isValidExamTargetDate(stored) ? stored : DEFAULT_EXAM_TARGET_DATE;
  } catch {
    return DEFAULT_EXAM_TARGET_DATE;
  }
}

export function storeExamTargetDate(storage: Pick<StorageReaderWriter, "setItem"> | null, accountKey: string, targetDate: string) {
  if (!storage || !isValidExamTargetDate(targetDate)) return false;
  try {
    storage.setItem(examTargetStorageKey(accountKey), targetDate);
    return true;
  } catch {
    return false;
  }
}

export function clearExamTargetDate(storage: Pick<StorageReaderWriter, "removeItem"> | null, accountKey: string) {
  if (!storage) return;
  try {
    storage.removeItem(examTargetStorageKey(accountKey));
  } catch {
    // Storage can be unavailable in privacy mode; the in-memory default still works.
  }
}

export function daysUntilExam(today: string, targetDate: string) {
  if (!isValidExamTargetDate(today) || !isValidExamTargetDate(targetDate)) return 0;
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const todayTime = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const targetTime = Date.UTC(targetYear, targetMonth - 1, targetDay);
  return Math.max(0, Math.round((targetTime - todayTime) / 86_400_000));
}

export function formatExamTargetDate(targetDate: string) {
  if (!isValidExamTargetDate(targetDate)) return targetDate;
  const [year, month, day] = targetDate.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}
