"""Nachgebauter Cloudflare-Access-Rand vor dem ECHTEN KIRA-Endpunkt
``/api/auth/app/access`` – für scripts/e2e/access-login.mjs.

Ohne Cookie ``CF_Authorization`` leitet der Rand wie Cloudflare auf
``https://e2e-team.cloudflareaccess.com/…`` um (``/api/health``: 401, damit die
Erreichbarkeitsprobe nicht ins Leere folgt). ``/__e2e/login`` steht für die
Anmeldung beim Anbieter: setzt das Cookie und springt zurück. Mit Cookie lässt
er durch und hängt ``Cf-Access-Jwt-Assertion`` an – wie Access. Die
Signaturprüfung des Tokens ist ersetzt (Cloudflares Schlüssel gibt es lokal
nicht); alles andere ist der Code aus dem KIRA-Checkout ``--kira``.

``--binding`` spielt das „Binding Cookie“ nach: Dann gilt die Sitzung nur
zusammen mit ``CF_Binding``, das ausschließlich der Browser bekommt.

    <kira>/.venv/bin/python scripts/e2e/access-edge.py --kira <kira> --port 8497
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

parser = argparse.ArgumentParser()
parser.add_argument("--kira", required=True)
parser.add_argument("--port", type=int, default=8497)
parser.add_argument("--binding", action="store_true")
args = parser.parse_args()
sys.path.insert(0, str(Path(args.kira).resolve()))

import jwt  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse  # noqa: E402

from core.config import Settings  # noqa: E402
from core.interfaces.routes import oidc as oidc_routes  # noqa: E402
from core.memory.database import init_db  # noqa: E402
from core.utils.cf_access import CFAccessIdentity  # noqa: E402

TEAM = "e2e-team"
AUD = "e2e-aud"
EMAIL = "e2e-access@kira.test"


def _part(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


TOKEN = f"{_part({'alg': 'RS256', 'kid': 'e2e'})}.{_part({'email': EMAIL, 'aud': [AUD], 'exp': int(time.time()) + 3600})}.c2lnbmF0dXJl"


async def _verify(token: str, team_domain: str, audience: str) -> CFAccessIdentity:
    if token == TOKEN and team_domain == TEAM and audience == AUD:
        return CFAccessIdentity(email=EMAIL, sub="cf-e2e", name="E2E Access")
    raise jwt.InvalidTokenError("unbekanntes Token")


oidc_routes.verify_cf_access_token = _verify  # type: ignore[assignment]

app = FastAPI()
app.include_router(oidc_routes.router, prefix="/api")


@app.middleware("http")
async def edge(request: Request, call_next):
    if request.url.path == "/__e2e/login":
        resp = RedirectResponse(request.query_params.get("redirect_url", "/"), status_code=302)
        resp.set_cookie("CF_Authorization", TOKEN, httponly=True, samesite="none", secure=False)
        if args.binding:
            resp.set_cookie("CF_Binding", "nur-im-browser", httponly=True)
        return resp
    signed_in = request.cookies.get("CF_Authorization") == TOKEN
    if args.binding:
        signed_in = signed_in and request.cookies.get("CF_Binding") == "nur-im-browser"
    if not signed_in:
        if request.url.path == "/api/health":
            return JSONResponse({"detail": "Cloudflare Access"}, status_code=401)
        login = f"https://{TEAM}.cloudflareaccess.com/cdn-cgi/access/login/127.0.0.1?kid=e2e&redirect_url={quote(str(request.url), safe='')}"
        return RedirectResponse(login, status_code=302)
    request.scope["headers"] = [*request.scope["headers"], (b"cf-access-jwt-assertion", TOKEN.encode())]
    return await call_next(request)


@app.get("/api/health")
async def health():
    return {"status": "healthy", "version": "3.300.0"}


@app.get("/")
async def dashboard():
    return HTMLResponse("<!doctype html><title>KIRA Test-Dashboard</title><h1>Angemeldet über Cloudflare Access</h1>")


async def main() -> None:
    data = Path(tempfile.mkdtemp(prefix="kira-access-edge-"))
    settings = Settings(
        kira_env="testing",
        kira_log_level="WARNING",
        kira_data_dir=data,
        cf_access_enabled=True,
        cf_access_team_domain=TEAM,
        cf_access_aud=AUD,
    )
    app.state.settings = settings
    app.state.session_factory = await init_db(settings)
    print(f"access-edge bereit auf http://127.0.0.1:{args.port} (binding={args.binding})", flush=True)
    await uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning")).serve()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
