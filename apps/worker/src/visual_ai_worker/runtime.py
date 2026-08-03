def worker_metadata() -> dict[str, str]:
    """Return static metadata without polling queues or calling providers."""
    return {"service": "worker", "mode": "foundation"}
