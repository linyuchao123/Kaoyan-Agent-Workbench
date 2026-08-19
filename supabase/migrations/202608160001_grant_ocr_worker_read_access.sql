-- v0.8: allow the service-role OCR worker to read claimed jobs and documents.
-- Mutations remain restricted to the existing security-definer RPC functions.
grant select on public.ocr_jobs to service_role;
grant select on public.documents to service_role;
