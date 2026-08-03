from visual_ai_shared.metadata import foundation_metadata


def test_foundation_metadata_identifies_shared_package() -> None:
    assert foundation_metadata()["package"] == "visual-ai-shared"
