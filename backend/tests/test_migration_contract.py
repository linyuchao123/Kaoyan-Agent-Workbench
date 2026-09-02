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

    def test_daily_target_completion_is_scoped_and_keeps_rls_boundary(self):
        sql = Path(
            "supabase/migrations/202609020001_daily_target_completion.sql"
        ).read_text()
        self.assertIn("with (security_invoker = true)", sql)
        self.assertIn("subject_target_tasks", sql)
        self.assertIn("subject_completed_target_tasks", sql)
        self.assertIn("case when plan.level = 'day' then plan.starts_on end", sql)
        self.assertIn("grant select on public.daily_study_contributions to authenticated", sql)

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

    def test_private_keyword_search_uses_auth_owner_and_excludes_flagged_chunks(self):
        sql = Path(
            "supabase/migrations/202608120004_private_keyword_search.sql"
        ).read_text()
        self.assertIn("search_private_document_chunks", sql)
        self.assertIn("dc.user_id = auth.uid()", sql)
        self.assertIn("not dc.flagged_untrusted_instruction", sql)
        self.assertIn("filter_document_ids", sql)
        self.assertIn("to authenticated", sql)

    def test_private_hybrid_search_fuses_ranks_and_preserves_security_boundaries(self):
        sql = Path(
            "supabase/migrations/202608140001_private_hybrid_search.sql"
        ).read_text()
        self.assertIn("hybrid_search_private_document_chunks", sql)
        self.assertIn("dc.user_id = auth.uid()", sql)
        self.assertIn("not dc.flagged_untrusted_instruction", sql)
        self.assertIn("filter_document_ids", sql)
        self.assertIn("keyword_rank", sql)
        self.assertIn("semantic_rank", sql)
        self.assertIn("to authenticated", sql)

    def test_ocr_queue_has_owner_reads_and_atomic_service_role_claim(self):
        sql = Path("supabase/migrations/202608140002_ocr_job_queue.sql").read_text()
        self.assertIn("create table if not exists public.ocr_jobs", sql)
        self.assertIn("using (user_id = auth.uid())", sql)
        self.assertIn("enqueue_document_ocr", sql)
        self.assertIn("claim_document_ocr", sql)
        self.assertIn("complete_document_ocr", sql)
        self.assertIn("fail_document_ocr", sql)
        self.assertIn("for update skip locked", sql)
        self.assertIn("ocr_jobs.status in ('failed', 'completed')", sql)
        self.assertIn("OCR worker lease expired", sql)
        self.assertIn("locked_at < now() - interval '2 hours'", sql)
        self.assertIn("attempts < max_attempts", sql)
        self.assertIn("delete from public.document_chunks", sql)
        self.assertIn("ingestion_status = 'ready'", sql)
        self.assertIn("should_retry", sql)
        self.assertIn("service role required", sql)
        self.assertIn("to service_role", sql)

    def test_document_embedding_metadata_is_dimension_safe_and_ocr_aware(self):
        sql = Path(
            "supabase/migrations/202608150002_document_embedding_metadata.sql"
        ).read_text()
        self.assertIn("embedding_provider", sql)
        self.assertIn("embedding_model", sql)
        self.assertIn("embedding_dimensions = 1536", sql)
        self.assertIn("embedding_version", sql)
        self.assertIn("complete_document_ocr", sql)
        self.assertIn("service role required", sql)

    def test_ocr_page_recovery_records_failures_and_allows_retry(self):
        sql = Path(
            "supabase/migrations/202608150003_ocr_page_recovery.sql"
        ).read_text()
        self.assertIn("ocr_failed_pages", sql)
        self.assertIn("ocr_fallback_pages", sql)
        self.assertIn("ocr_metadata jsonb", sql)
        self.assertIn("document does not require OCR", sql)
        self.assertIn("cardinality", sql)

    def test_ocr_worker_can_read_claimed_jobs_and_documents(self):
        sql = Path(
            "supabase/migrations/202608160001_grant_ocr_worker_read_access.sql"
        ).read_text()
        self.assertIn("grant select on public.ocr_jobs to service_role", sql)
        self.assertIn("grant select on public.documents to service_role", sql)

    def test_document_reindex_is_atomic_owned_and_versioned(self):
        sql = Path(
            "supabase/migrations/202608190001_document_reindex.sql"
        ).read_text()
        self.assertIn("chunking_version", sql)
        self.assertIn("indexed_at", sql)
        self.assertIn("replace_document_chunks", sql)
        self.assertIn("where id = requested_document_id and user_id = owner_id", sql)
        self.assertIn("for update", sql)
        self.assertIn("delete from public.document_chunks", sql)
        self.assertIn("jsonb_array_elements(replacement_chunks)", sql)
        self.assertIn("enqueue_document_reindex_ocr", sql)
        self.assertIn("to authenticated", sql)
        self.assertNotIn("grant insert", sql)
        self.assertNotIn("grant update", sql)
        self.assertNotIn("grant delete", sql)

    def test_agent_model_usage_is_owner_readable_and_rpc_written(self):
        sql = Path(
            "supabase/migrations/202608150004_agent_model_usage.sql"
        ).read_text()
        self.assertIn("create table public.agent_model_usage", sql)
        self.assertIn("agent_model_usage_owner_select", sql)
        self.assertIn("record_agent_model_usage", sql)
        self.assertIn("auth.uid()", sql)
        self.assertIn("requested_input_tokens", sql)
        self.assertNotIn("api_key", sql)

    def test_agent_proposal_rpc_uses_auth_owner_audit_and_idempotent_approval(self):
        sql = Path(
            "supabase/migrations/202608130001_agent_proposal_persistence.sql"
        ).read_text()
        self.assertIn("create_agent_proposal", sql)
        self.assertIn("decide_agent_proposal", sql)
        self.assertIn("owner_id uuid := auth.uid()", sql)
        self.assertIn("for update", sql)
        self.assertIn("current_proposal.status = 'applied'", sql)
        self.assertIn("insert into public.audit_logs", sql)
        self.assertIn("insert into public.tasks", sql)
        self.assertIn("security definer", sql)
        self.assertIn("to authenticated", sql)

    def test_import_proposals_are_granted_with_existing_owner_rls(self):
        sql = Path(
            "supabase/migrations/202608130002_import_proposal_permissions.sql"
        ).read_text()
        self.assertIn("on public.import_proposals to authenticated", sql)

    def test_read_only_agent_thread_rpc_uses_authenticated_owner(self):
        sql = Path(
            "supabase/migrations/202608130003_agent_thread_persistence.sql"
        ).read_text()
        self.assertIn("create or replace function public.ensure_agent_thread", sql)
        self.assertIn("owner_id uuid := auth.uid()", sql)
        self.assertIn("user_id = owner_id", sql)
        self.assertIn("to authenticated", sql)

    def test_agent_message_history_is_owner_scoped_and_written_by_rpc(self):
        sql = Path(
            "supabase/migrations/202608130005_agent_message_history.sql"
        ).read_text()
        self.assertIn("create table if not exists public.agent_messages", sql)
        self.assertIn("alter table public.agent_messages enable row level security", sql)
        self.assertIn("using (user_id = auth.uid())", sql)
        self.assertIn("create or replace function public.append_agent_exchange", sql)
        self.assertIn("owner_id uuid := auth.uid()", sql)
        self.assertIn("grant execute on function public.append_agent_exchange", sql)

    def test_agent_model_profile_is_owner_scoped_and_persisted(self):
        sql = Path(
            "supabase/migrations/202608150001_agent_model_profiles.sql"
        ).read_text()
        self.assertIn("add column if not exists model_profile", sql)
        self.assertIn("model_profile in ('flash', 'pro')", sql)
        self.assertIn("create or replace function public.set_agent_thread_model_profile", sql)
        self.assertIn("owner_id uuid := auth.uid()", sql)
        self.assertIn("last_provider = nullif(agent_metadata ->> 'provider', '')", sql)
        self.assertIn("to authenticated", sql)
