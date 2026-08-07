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
