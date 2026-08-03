from fastapi import FastAPI

app = FastAPI(title="Visual AI Browser Agent API", version="0.0.0")


@app.get("/healthz")
def health() -> dict[str, str]:
    """Return a non-sensitive liveness response for deployment checks."""
    return {"status": "ok", "service": "api"}


@app.get("/readyz")
def readiness() -> dict[str, str]:
    """Foundation readiness has no external dependency checks yet."""
    return {"status": "ok", "service": "api"}
