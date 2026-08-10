from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal

Scope = Literal["all", "math", "english", "politics", "cs408", "career"]


@dataclass(frozen=True)
class StudyInterval:
    started_at: datetime
    ended_at: datetime
    paused_seconds: int
    subject: str

    @property
    def effective_seconds(self) -> int:
        return max(0, int((self.ended_at - self.started_at).total_seconds()) - self.paused_seconds)


def intensity_level(minutes: int, scope: Scope = "all") -> int:
    """Return GitHub-style intensity, with 0 for an empty day and 1-4 for activity."""
    thresholds = (1, 60, 180, 300) if scope == "all" else (1, 30, 60, 120)
    for index, threshold in enumerate(thresholds):
        if minutes < threshold:
            return index
    return 4


def _union_seconds(intervals: Iterable[tuple[datetime, datetime]]) -> int:
    ordered = sorted(intervals, key=lambda item: item[0])
    if not ordered:
        return 0
    total = 0
    current_start, current_end = ordered[0]
    for start, end in ordered[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            total += int((current_end - current_start).total_seconds())
            current_start, current_end = start, end
    return total + int((current_end - current_start).total_seconds())


def aggregate_daily_minutes(intervals: Iterable[StudyInterval]) -> dict[date, int]:
    """Aggregate effective study time by local date.

    Pause duration is removed from the tail of a session because the API stores
    only a duration, not individual pause intervals.  The remaining effective
    interval is split at midnight and overlapping intervals are merged before
    minutes are calculated.
    """
    by_day: dict[date, list[tuple[datetime, datetime]]] = defaultdict(list)
    for interval in intervals:
        if interval.ended_at <= interval.started_at:
            continue
        effective_end = interval.ended_at - timedelta(seconds=max(0, interval.paused_seconds))
        if effective_end <= interval.started_at:
            continue

        cursor = interval.started_at
        while cursor.date() < effective_end.date():
            next_midnight = datetime.combine(
                cursor.date() + timedelta(days=1),
                time.min,
                tzinfo=cursor.tzinfo,
            )
            by_day[cursor.date()].append((cursor, next_midnight))
            cursor = next_midnight
        by_day[cursor.date()].append((cursor, effective_end))

    return {day: max(0, _union_seconds(values) // 60) for day, values in by_day.items()}
