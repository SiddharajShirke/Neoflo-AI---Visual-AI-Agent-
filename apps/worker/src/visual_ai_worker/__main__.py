import json

from visual_ai_worker.runtime import worker_metadata


def main() -> None:
    """Future continuous-worker entry point; currently reports shell readiness and exits."""
    print(json.dumps(worker_metadata()))


if __name__ == "__main__":
    main()
