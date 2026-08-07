from fastapi.testclient import TestClient
from visual_ai_api.main import create_app
from visual_ai_api.store import MemoryRepository


def client() -> TestClient:
    return TestClient(create_app(repository=MemoryRepository()))


def test_live_health_is_public_and_non_sensitive() -> None:
    response = client().get("/health/live")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_browser_routes_require_a_bearer_token() -> None:
    response = client().get("/api/v1/devices")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_internal_publisher_is_disabled_without_its_credential() -> None:
    response = client().post("/api/v1/internal/outbox/publish")

    assert response.status_code == 404


def test_internal_route_has_no_browser_cors_header() -> None:
    response = client().options(
        "/api/v1/internal/outbox/publish",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )

    assert response.headers.get("access-control-allow-origin") is None
