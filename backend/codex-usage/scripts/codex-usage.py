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
RESET_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
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


def fetch_url(url, auth, iid):
    request_headers = headers(auth, iid)
    request_headers["ChatGPT-Account-Id"] = auth["tokens"]["account_id"]
    req = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def reset_credit_data(usage, details):
    counts = usage.get("rate_limit_reset_credits") or usage.get("rateLimitResetCredits") or {}
    if not isinstance(counts, dict):
        counts = {}
    detail_payload = details.get("rateLimitResetCredits", {}) if isinstance(details, dict) else {}
    if not isinstance(detail_payload, dict):
        detail_payload = {}
    credits = (details.get("credits") or detail_payload.get("credits")
               if isinstance(details, dict) else None)
    if not isinstance(credits, list):
        credits = []
    aliases = {
        "id": ("id",), "type": ("type",), "status": ("status",),
        "issued_at": ("issued_at", "issuedAt", "granted_at", "grantedAt"),
        "expires_at": ("expires_at", "expiresAt"), "description": ("description",),
    }
    normalized = []
    for credit in credits:
        if not isinstance(credit, dict):
            continue
        item = {}
        for field, keys in aliases.items():
            value = next((credit[key] for key in keys if key in credit), None)
            if isinstance(value, (str, int, float)):
                item[field] = str(value)
        normalized.append(item)
    return {
        "available_count": usage.get("available_count", usage.get("availableCount", counts.get(
            "available_count", counts.get("availableCount")))),
        "applicable_available_count": usage.get("applicable_available_count", usage.get(
            "applicableAvailableCount", counts.get("applicable_available_count",
                                                    counts.get("applicableAvailableCount")))),
        "credits": normalized,
    }


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

    resets = {"available_count": None, "applicable_available_count": None, "credits": []}
    try:
        reset_usage = fetch_url(RESET_USAGE_URL, auth, iid)
        resets = reset_credit_data(reset_usage, {})
        reset_details = fetch_url(RESET_CREDITS_URL, auth, iid)
        resets["credits"] = reset_credit_data({}, reset_details)["credits"]
    except urllib.error.HTTPError as e:
        if e.code not in (401, 403):
            print(f"codex-usage: reset-credit endpoints unavailable (HTTP {e.code})", file=sys.stderr)
        else:
            refresh(auth)
            reset_usage = fetch_url(RESET_USAGE_URL, auth, iid)
            resets = reset_credit_data(reset_usage, {})
            reset_details = fetch_url(RESET_CREDITS_URL, auth, iid)
            resets["credits"] = reset_credit_data({}, reset_details)["credits"]
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"codex-usage: reset-credit endpoints unavailable ({type(e).__name__})", file=sys.stderr)

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
        "reset_credits": resets,
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
