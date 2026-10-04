#!/usr/bin/env python3
"""Fetch OpenAI Codex (ChatGPT plan) usage limits and write JSON for the dashboard.

Reads the ChatGPT OAuth token from ~/.codex/auth.json (written by `codex login`),
calls the same usage endpoint the CLI uses, and writes a small JSON snapshot to
/projects/dashboard/data/codex-usage.json. The dashboard container only ever sees
that JSON, never the token.

If the access token is rejected (401/403) the script refreshes it once via the
refresh token and persists the rotated tokens back to auth.json (atomic write).
"""
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

AUTH_FILE = os.environ.get("CODEX_AUTH_FILE", os.path.expanduser("~/.codex/auth.json"))
OUT_FILE = os.environ.get("CODEX_USAGE_OUT", "/projects/dashboard/data/codex-usage.json")
API_URL = os.environ.get("CODEX_USAGE_API", "https://chatgpt.com/backend-api/codex/usage")
TOKEN_URL = "https://auth.openai.com/oauth/token"
# OAuth client id of the Codex CLI (used by `codex login`).
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
USER_AGENT = "codex_cli_rs/" + os.environ.get("CODEX_CLI_VERSION", "0.160.0")


def load_auth():
    with open(AUTH_FILE) as f:
        return json.load(f)


def save_auth(auth):
    """Atomic replace so a crash can never corrupt auth.json."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(AUTH_FILE), prefix=".auth-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(auth, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, AUTH_FILE)
    except BaseException:
        os.unlink(tmp)
        raise


def installation_id(auth_file):
    p = os.path.join(os.path.dirname(auth_file), "installation_id")
    try:
        with open(p) as f:
            return f.read().strip()
    except OSError:
        return ""


def headers(auth, iid):
    return {
        "Authorization": "Bearer " + auth["tokens"]["access_token"],
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Origin": "https://chatgpt.com",
        "x-codex-installation-id": iid,
        "x-openai-ct": "ct=v1",
    }


def refresh(auth):
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": auth["tokens"]["refresh_token"],
        "client_id": CLIENT_ID,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read())
    auth["tokens"]["access_token"] = j["access_token"]
    if "id_token" in j:
        auth["tokens"]["id_token"] = j["id_token"]
    # The token endpoint rotates the refresh token — keep the new one.
    if "refresh_token" in j:
        auth["tokens"]["refresh_token"] = j["refresh_token"]
    auth["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save_auth(auth)


def fetch(iid, auth):
    req = urllib.request.Request(API_URL, headers=headers(auth, iid))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def window(w):
    w = w or {}
    return {
        "used_percent": w.get("used_percent", 0) or 0,
        "window_seconds": w.get("limit_window_seconds", 0) or 0,
        "reset_at": w.get("reset_at"),  # epoch seconds or null
        "reset_in_seconds": w.get("reset_after_seconds", 0) or 0,
    }


def main():
    auth = load_auth()
    iid = installation_id(AUTH_FILE)
    try:
        raw = fetch(iid, auth)
    except urllib.error.HTTPError as e:
        if e.code not in (401, 403):
            raise
        refresh(auth)
        raw = fetch(iid, auth)

    rl = raw.get("rate_limit") or {}
    credits = raw.get("credits") or {}
    out = {
        "plan": raw.get("plan_type", "unknown"),
        "email": raw.get("email", ""),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "allowed": rl.get("allowed", False),
        "limit_reached": rl.get("limit_reached", False),
        "windows": {
            "primary": window(rl.get("primary_window")),
            "secondary": window(rl.get("secondary_window")),
        },
        "credits": {
            "has_credits": credits.get("has_credits", False),
            "unlimited": credits.get("unlimited", False),
            "balance": str(credits.get("balance", "0")),
        },
        "model_usage": raw.get("model_usage"),
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, OUT_FILE)

    p = out["windows"]["primary"]
    s = out["windows"]["secondary"]
    print(f"codex-usage: plan={out['plan']} primary={p['used_percent']}% "
          f"secondary={s['used_percent']}% limit_reached={out['limit_reached']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"codex-usage: FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
