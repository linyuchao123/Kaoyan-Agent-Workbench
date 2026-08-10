from datetime import UTC, datetime, timedelta
from unittest import TestCase

from app.domain.contributions import StudyInterval, aggregate_daily_minutes, intensity_level


class ContributionTests(TestCase):
    def test_overall_thresholds(self):
        self.assertEqual(
            [intensity_level(value) for value in [0, 1, 60, 180, 300]], [0, 1, 2, 3, 4]
        )

    def test_subject_thresholds(self):
        self.assertEqual(
            [intensity_level(value, "math") for value in [0, 1, 30, 60, 120]], [0, 1, 2, 3, 4]
        )

    def test_overlap_is_not_double_counted(self):
        start = datetime(2026, 8, 10, 8, tzinfo=UTC)
        intervals = [
            StudyInterval(start, start + timedelta(hours=2), 0, "math"),
            StudyInterval(start + timedelta(hours=1), start + timedelta(hours=3), 0, "math"),
        ]
        self.assertEqual(aggregate_daily_minutes(intervals)[start.date()], 180)

    def test_pause_is_removed(self):
        start = datetime(2026, 8, 10, 8, tzinfo=UTC)
        interval = StudyInterval(start, start + timedelta(hours=1), 600, "english")
        self.assertEqual(aggregate_daily_minutes([interval])[start.date()], 50)

    def test_session_is_split_at_midnight(self):
        start = datetime(2026, 8, 10, 23, 30, tzinfo=UTC)
        interval = StudyInterval(start, start + timedelta(hours=2), 0, "math")
        self.assertEqual(
            aggregate_daily_minutes([interval]),
            {start.date(): 30, (start + timedelta(days=1)).date(): 90},
        )

    def test_pause_cannot_make_negative_time(self):
        start = datetime(2026, 8, 10, 8, tzinfo=UTC)
        interval = StudyInterval(start, start + timedelta(minutes=20), 3600, "math")
        self.assertEqual(aggregate_daily_minutes([interval]), {})
