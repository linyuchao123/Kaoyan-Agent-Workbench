from pathlib import Path
from unittest import TestCase


class MigrationContractTests(TestCase):
    def test_audit_log_policy_is_read_only_for_authenticated_users(self):
        sql = Path("supabase/migrations/202608100001_initial.sql").read_text()
        self.assertIn("create policy audit_logs_owner_select", sql)
        self.assertNotIn("'action_proposals','audit_logs'", sql)

    def test_core_cloud_tables_and_contribution_view_are_user_scoped(self):
        sql = Path("supabase/migrations/202608100001_initial.sql").read_text()
        for table in ("tasks", "study_sessions"):
            self.assertIn(f"alter table public.{table} enable row level security", sql)
        self.assertIn("with (security_invoker = true)", sql)
        self.assertIn("completed_tasks", sql)
        self.assertIn("mistake_count", sql)
        self.assertIn("user_id = auth.uid()", sql)

    def test_security_invoker_contribution_view_can_read_its_source_tables(self):
        sql = Path("supabase/migrations/202608100002_cloud_study_loop.sql").read_text()
        self.assertIn("grant select on public.profiles to authenticated", sql)
        self.assertIn("grant select on public.mistake_cards to authenticated", sql)

    def test_mistake_review_is_atomic_and_user_scoped(self):
        sql = Path("supabase/migrations/202608110002_mistake_review_loop.sql").read_text()
        self.assertIn("create or replace function public.review_mistake_card", sql)
        self.assertIn("user_id = auth.uid()", sql)
        self.assertIn("insert into public.review_events", sql)
        self.assertIn("update public.mistake_cards", sql)
        self.assertIn("grant execute on function public.review_mistake_card", sql)

    def test_authenticated_users_can_access_plans_through_rls(self):
        sql = Path("supabase/migrations/202608110003_grant_plan_access.sql").read_text()
        self.assertIn(
            "grant select, insert, update, delete on public.plans to authenticated",
            sql,
        )

    def test_authenticated_users_can_access_v05_records_through_rls(self):
        school_sql = Path(
            "supabase/migrations/202608120001_grant_school_option_access.sql"
        ).read_text()
        career_sql = Path(
            "supabase/migrations/202608120002_grant_career_item_access.sql"
        ).read_text()
        self.assertIn("on public.school_options", school_sql)
        self.assertIn("to authenticated", school_sql)
        self.assertIn("on public.career_items", career_sql)
        self.assertIn("to authenticated", career_sql)

    def test_private_material_storage_is_user_scoped(self):
        sql = Path(
            "supabase/migrations/202608120003_private_material_storage.sql"
        ).read_text()
        self.assertIn("'study-materials'", sql)
        self.assertIn("public = excluded.public", sql)
        self.assertIn("storage.foldername(name))[1] = auth.uid()::text", sql)
        self.assertIn("flagged_untrusted_instruction boolean", sql)
        self.assertIn("on public.documents to authenticated", sql)
        self.assertIn("on public.document_chunks to authenticated", sql)
