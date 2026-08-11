export type StudyInterval = {
  startedAt: Date;
  endedAt: Date;
  effectiveMinutes: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function createShanghaiStudyInterval(
  date: string,
  startedTime: string,
  endedTime: string,
): StudyInterval {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(startedTime) || !TIME_PATTERN.test(endedTime)) {
    throw new Error("请填写完整的补录日期和时间");
  }

  const startedAt = new Date(`${date}T${startedTime}:00+08:00`);
  const endedAt = new Date(`${date}T${endedTime}:00+08:00`);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new Error("补录日期或时间格式无效");
  }
  if (endedAt <= startedAt) {
    throw new Error("结束时间必须晚于开始时间，跨日学习请拆成两条记录");
  }

  const effectiveMinutes = Math.floor((endedAt.getTime() - startedAt.getTime()) / 60_000);
  if (effectiveMinutes > 24 * 60) {
    throw new Error("单条学习记录不能超过 24 小时");
  }
  return { startedAt, endedAt, effectiveMinutes };
}
