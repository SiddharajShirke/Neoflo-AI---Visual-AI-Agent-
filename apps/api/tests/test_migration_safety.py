from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_lifecycle_migration_aborts_on_ambiguous_expired_history() -> None:
    migration = (ROOT / "supabase" / "migrations" / "0010_session_lifecycle.sql").read_text(
        encoding="utf-8"
    )

    assert "expired_count > 0" in migration
    assert "expired rows require a semantic migration decision" in migration
    assert "when 'expired' then 'cancelled'" not in migration


def test_lifecycle_migration_maps_only_approved_legacy_values() -> None:
    migration = (ROOT / "supabase" / "migrations" / "0010_session_lifecycle.sql").read_text(
        encoding="utf-8"
    )

    assert "when 'active' then 'recording'" in migration
    assert "when 'stopped' then 'completed'" in migration


def test_lifecycle_migration_rejects_unexpected_history_and_drops_default_before_cast() -> None:
    migration = (ROOT / "supabase" / "migrations" / "0010_session_lifecycle.sql").read_text(
        encoding="utf-8"
    )

    assert "unexpected_count > 0" in migration
    assert "unexpected legacy status rows" in migration
    assert migration.index("alter column status drop default") < migration.index(
        "alter column status type"
    )


def test_idempotency_migration_claims_key_per_owner_before_comparing_route() -> None:
    table_migration_path = ROOT / "supabase" / "migrations" / "0011_event_ingestion_idempotency.sql"
    table_migration = table_migration_path.read_text(encoding="utf-8")
    rpc_migration = (ROOT / "supabase" / "migrations" / "0012_event_outbox.sql").read_text(
        encoding="utf-8"
    )

    assert "unique (user_id, idempotency_key)" in table_migration
    assert "'in_progress'" in table_migration
    assert "p_route text" in rpc_migration


def test_control_plane_migration_keeps_idempotency_and_consent_withdrawal_server_only() -> None:
    migration = (
        ROOT
        / "supabase"
        / "migrations"
        / "0016_control_plane_idempotency_and_consent_withdrawal.sql"
    ).read_text(encoding="utf-8")

    assert "consent_records_one_active_grant_idx" in migration
    assert "response_metadata = jsonb_build_object" in migration
    assert "request_body" not in migration
    assert "raw_request_body" not in migration
    assert "security definer" in migration
    assert "to service_role" in migration
    assert "from public, anon, authenticated" in migration
    assert "set revoked_at = timezone('utc', now())" in migration


def _m4_event_gate_migration() -> str:
    return (ROOT / "supabase" / "migrations" / "0017_m4_browser_event_v2_gate.sql").read_text(
        encoding="utf-8"
    )


def test_m4_event_gate_is_forward_only_and_preserves_v1_columns() -> None:
    migration = _m4_event_gate_migration()

    assert "forward-only" in migration.lower()
    assert "add column page_domain text" in migration
    assert "add column transition_type text" in migration
    assert "add column client_event_uuid uuid" in migration
    assert "add column event_contract_version smallint not null default 1" in migration
    for legacy_column in (
        "client_event_id",
        "page_origin",
        "page_path_hash",
        "page_title_redacted",
        "accessibility_context_redacted",
        "context_sha256",
    ):
        assert f"drop column {legacy_column}" not in migration


def test_m4_event_gate_enforces_uuid_positive_sequence_and_top_level_transitions() -> None:
    migration = _m4_event_gate_migration()

    assert "client_event_uuid::text" in migration
    assert "sequence_number > 0" in migration
    assert "browser_events_v2_device_client_uuid_idx" in migration
    for transition in (
        "link",
        "typed",
        "auto_bookmark",
        "generated",
        "start_page",
        "form_submit",
        "reload",
        "keyword",
        "keyword_generated",
    ):
        assert f"'{transition}'" in migration
    assert "auto_subframe" not in migration
    assert "manual_subframe" not in migration


def test_m4_event_gate_keeps_ingestion_privileged_and_request_body_free() -> None:
    migration = _m4_event_gate_migration()

    assert "security definer" in migration
    assert "from public, anon, authenticated" in migration
    assert "to service_role" in migration
    assert "request_body" not in migration
    assert "raw_request_body" not in migration
    assert "event_contract_version = 2" in migration
    assert "contract_version in (1, 2)" in migration
