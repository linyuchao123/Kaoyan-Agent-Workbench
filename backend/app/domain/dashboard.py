from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.schemas import ContributionDay, DashboardMetrics


def _local_date(value: Any, timezone: ZoneInfo) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.date()
        return value.astimezone(timezone).date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            try:
                return date.fromisoformat(value)
            except ValueError:
                return None
        if parsed.tzinfo is None:
            return parsed.date()
        return parsed.astimezone(timezone).date()
    return None


def select_today_tasks(
    *,
    today: date,
    tasks: list[dict],
    day_plans: list[dict],
    timezone_name: str = "Asia/Shanghai",
) -> list[dict]:
    timezone = ZoneInfo(timezone_name)
    plan_dates = {
        str(plan["id"]): _local_date(plan.get("starts_on"), timezone)
        for plan in day_plans
    }
    selected: list[dict] = []
    for task in tasks:
        completed = bool(task.get("completed") or task.get("completed_at"))
        plan_id = str(task["plan_id"]) if task.get("plan_id") else None
        scheduled_date = plan_dates.get(plan_id) if plan_id else None
        due_date = _local_date(task.get("due_at"), timezone)
        created_date = _local_date(task.get("created_at"), timezone)
        task_date = scheduled_date or due_date or created_date
        if task_date == today or (not completed and (task_date is None or task_date < today)):
            selected.append(task)
    return selected


def active_stage_title(
    *,
    today: date,
    plans: list[dict],
    timezone_name: str = "Asia/Shanghai",
) -> str | None:
    timezone = ZoneInfo(timezone_name)
    candidates = [
        plan
        for plan in plans
        if plan.get("level") == "stage"
        and (_local_date(plan.get("starts_on"), timezone) or date.max) <= today
        and (_local_date(plan.get("ends_on"), timezone) or date.min) >= today
        and plan.get("status") != "archived"
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda plan: plan.get("status") != "active")
    return str(candidates[0].get("title") or "").strip() or None


def build_dashboard_metrics(
    *,
    today: date,
    tasks: list[dict],
    day_plans: list[dict],
    contributions: list[ContributionDay],
    today_tasks: list[dict] | None = None,
    stage_title: str | None = None,
    timezone_name: str = "Asia/Shanghai",
) -> DashboardMetrics:
    timezone = ZoneInfo(timezone_name)
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    weekly_plan_ids = {
        str(plan["id"])
        for plan in day_plans
        if week_start
        <= (_local_date(plan.get("starts_on"), timezone) or date.min)
        <= week_end
    }

    weekly_tasks: list[dict] = []
    for task in tasks:
        plan_id = task.get("plan_id")
        due_date = _local_date(task.get("due_at"), timezone)
        created_date = _local_date(task.get("created_at"), timezone)
        belongs_to_week = bool(plan_id and str(plan_id) in weekly_plan_ids)
        belongs_to_week = belongs_to_week or bool(
            due_date and week_start <= due_date <= week_end
        )
        belongs_to_week = belongs_to_week or bool(
            not plan_id and not due_date and created_date and week_start <= created_date <= week_end
        )
        if belongs_to_week:
            weekly_tasks.append(task)

    weekly_completed = sum(
        bool(task.get("completed") or task.get("completed_at")) for task in weekly_tasks
    )

    active_dates = {
        item.date for item in contributions if item.effective_minutes > 0 and item.date <= today
    }
    streak_cursor = today if today in active_dates else today - timedelta(days=1)
    current_streak = 0
    if streak_cursor in active_dates:
        while streak_cursor in active_dates:
            current_streak += 1
            streak_cursor -= timedelta(days=1)

    longest_streak = 0
    running_streak = 0
    previous: date | None = None
    for active_date in sorted(active_dates):
        running_streak = running_streak + 1 if previous == active_date - timedelta(days=1) else 1
        longest_streak = max(longest_streak, running_streak)
        previous = active_date

    today_minutes = next(
        (item.effective_minutes for item in contributions if item.date == today),
        0,
    )
    current_tasks = today_tasks if today_tasks is not None else tasks
    today_planned_minutes = sum(
        max(0, int(task.get("planned_minutes") or 0)) for task in current_tasks
    )
    weekly_total = len(weekly_tasks)
    return DashboardMetrics(
        week_start=week_start,
        week_end=week_end,
        weekly_task_count=weekly_total,
        weekly_completed_tasks=weekly_completed,
        weekly_completion_rate=round(weekly_completed / weekly_total * 100)
        if weekly_total
        else 0,
        today_effective_minutes=today_minutes,
        today_task_count=len(current_tasks),
        today_planned_minutes=today_planned_minutes,
        active_stage_title=stage_title,
        current_streak_days=current_streak,
        longest_streak_days=longest_streak,
    )
