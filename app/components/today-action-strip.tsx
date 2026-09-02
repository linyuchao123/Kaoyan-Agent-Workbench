"use client";

type TodayActionStripProps = {
  mistakeCount: number;
  loading: boolean;
  onOpenAgentPlan: () => void;
  onOpenMistakeReview: () => void;
};

export function TodayActionStrip({ mistakeCount, loading, onOpenAgentPlan, onOpenMistakeReview }: TodayActionStripProps) {
  const mistakeCopy = loading
    ? "正在读取今日复习队列"
    : mistakeCount > 0
      ? `${mistakeCount} 道到期错题等待复习`
      : "今日到期错题已经清空";

  return (
    <section className="today-action-strip" aria-label="今日学习行动">
      <article className="today-action-card agent">
        <span className="today-action-icon" aria-hidden="true">✦</span>
        <div>
          <span>AI 今日计划提案</span>
          <strong>让计划教练找出今天最该先做的一项</strong>
          <small>只生成待确认提案；批准后才会写入任务，并保留审计记录。</small>
        </div>
        <button type="button" onClick={onOpenAgentPlan}>生成提案</button>
      </article>
      <article className="today-action-card mistake">
        <span className="today-action-icon" aria-hidden="true">↻</span>
        <div>
          <span>今日错题复习</span>
          <strong>{mistakeCopy}</strong>
          <small>{mistakeCount > 0 ? "直接进入复习队列，完成后自动安排下次复习。" : "仍可快速记录一道新错题。"}</small>
        </div>
        <button type="button" onClick={onOpenMistakeReview}>{mistakeCount > 0 ? "开始复习" : "查看错题"}</button>
      </article>
    </section>
  );
}
