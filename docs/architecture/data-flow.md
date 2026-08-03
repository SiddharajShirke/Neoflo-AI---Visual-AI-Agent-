# Intended future data flow and current boundary

Future approved behavior will flow from an explicitly consented extension event to FastAPI, durable storage, bounded processing, and dashboard display. Every resulting AI observation must retain its source-event identifier and capture-policy provenance. The API remains the operational boundary; browser code and dashboard code do not use Supabase service credentials.

Milestone 0 intentionally implements none of this flow: no event endpoint, database table, queue, storage object, authentication, AI call, or dashboard query exists.
