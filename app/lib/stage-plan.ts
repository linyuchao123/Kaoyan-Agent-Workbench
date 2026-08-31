import type { ApiPlan } from "./api";

const dayMilliseconds = 24 * 60 * 60 * 1000;

function dateValue(date: string) {
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) ? value : null;
}

export function selectSidebarStage(plans: ApiPlan[], today: string) {
  const stages = plans.filter((plan) => plan.level === "stage" && plan.status !== "archived");
  if (!stages.length) return null;

  const active = stages
    .filter((plan) => plan.status === "active")
    .sort((left, right) => left.starts_on.localeCompare(right.starts_on));
  if (active.length) return active[0];

  const current = stages
    .filter((plan) => plan.starts_on <= today && today <= plan.ends_on)
    .sort((left, right) => right.starts_on.localeCompare(left.starts_on));
  if (current.length) return current[0];

  const upcoming = stages
    .filter((plan) => plan.starts_on > today)
    .sort((left, right) => left.starts_on.localeCompare(right.starts_on));
  if (upcoming.length) return upcoming[0];

  return stages.sort((left, right) => right.ends_on.localeCompare(left.ends_on))[0];
}

export function stageDateProgress(plan: ApiPlan, today: string) {
  const start = dateValue(plan.starts_on);
  const end = dateValue(plan.ends_on);
  const current = dateValue(today);
  if (start === null || end === null || current === null || end < start) return 0;
  if (plan.status === "completed") return 100;
  if (current < start) return 0;
  if (current > end) return 100;

  const totalDays = Math.floor((end - start) / dayMilliseconds) + 1;
  const elapsedDays = Math.floor((current - start) / dayMilliseconds) + 1;
  return Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
}
