from pathlib import Path
from unittest import TestCase


class MigrationContractTests(TestCase):
    def test_audit_log_policy_is_read_only_for_authenticated_users(self):
        sql = Path("supabase/migrations/202608100001_initial.sql").read_text()
        self.assertIn("create policy audit_logs_owner_select", sql)
        self.assertNotIn("'action_proposals','audit_logs'", sql)
