from visual_ai_worker.runtime import worker_metadata


def test_worker_metadata_declares_foundation_mode() -> None:
    assert worker_metadata()["mode"] == "foundation"
