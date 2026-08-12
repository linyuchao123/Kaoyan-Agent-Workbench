import csv
import json
from io import StringIO
from typing import Any

from fastapi.encoders import jsonable_encoder

DATASET_LABELS = {
    "plans": "三级计划",
    "tasks": "学习任务",
    "study_sessions": "学习会话",
    "mistake_cards": "错题卡",
    "school_options": "院校情报",
    "career_items": "求职副线",
}


def render_json_export(payload: dict[str, Any]) -> str:
    return json.dumps(jsonable_encoder(payload), ensure_ascii=False, indent=2)


def render_csv_export(payload: dict[str, Any]) -> str:
    """Flatten every dataset into a portable key/value CSV without losing nested values."""
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["数据集", "记录序号", "字段", "值"])
    for dataset, rows in payload["data"].items():
        for index, row in enumerate(rows, start=1):
            for field, value in jsonable_encoder(row).items():
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                writer.writerow([DATASET_LABELS[dataset], index, field, "" if value is None else value])
    return "\ufeff" + output.getvalue()


def _markdown_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return f"`{json.dumps(value, ensure_ascii=False, separators=(',', ':'))}`"
    if value is None or value == "":
        return "未填写"
    return str(value).replace("\n", "  \n")


def render_markdown_export(payload: dict[str, Any]) -> str:
    metadata = payload["metadata"]
    lines = [
        "# 研途学习工作台数据导出",
        "",
        f"- 导出时间：{metadata['exported_at']}",
        f"- 时区：{metadata['timezone']}",
        f"- 数据版本：{metadata['schema_version']}",
        "",
    ]
    for dataset, rows in payload["data"].items():
        lines.extend([f"## {DATASET_LABELS[dataset]}", ""])
        if not rows:
            lines.extend(["暂无记录。", ""])
            continue
        for index, row in enumerate(rows, start=1):
            title = row.get("title") or row.get("university") or row.get("id") or f"记录 {index}"
            lines.extend([f"### {index}. {title}", ""])
            for field, value in jsonable_encoder(row).items():
                lines.append(f"- {field}：{_markdown_value(value)}")
            lines.append("")
    return "\n".join(lines)
