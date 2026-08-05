# Milestone 1: Supabase foundation

The Supabase schema is API-first. Future extension and dashboard product behavior calls FastAPI; neither client accesses queues nor uploads screenshots directly. Row Level Security is defense in depth: authenticated users can read only their own explicitly permitted data, while FastAPI uses the server-only `SUPABASE_SECRET_KEY` for trusted mutations.

The `redacted-screenshots` bucket is private. It accepts only redacted PNG, JPEG, or WebP objects up to 10 MiB, and has no client upload/update/delete policy. Future FastAPI endpoints may issue short-lived signed URLs after authorization; no route exists in this milestone.

Supabase Queues use durable `event_processing` and `deletion_processing` queues. They carry JSON references only. During the unpaid MVP, FastAPI will later perform bounded on-demand processing. A continuous worker remains a future option.

Retention defaults are proposals, not an enabled schedule: screenshots 7 days; browser events 30; observations/activities 90; summaries 180; completed deletion audit metadata 30. `list_retention_candidates` identifies records only. The database does not claim to delete underlying Storage objects; a later trusted API/worker orchestration milestone must use the Storage API and verify each object deletion.

The pgTAP extension is initialized only by `supabase/tests/000_setup.sql` for local SQL tests. It is deliberately absent from production migrations.
