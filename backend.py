#!/usr/bin/env python3
"""
Dashboard Backend API
Provides system data for the dashboard widgets
"""
import subprocess, json, os, time, re, sqlite3, shlex, threading
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from typing import Optional
import asyncio
import datetime
import logging
import uvicorn
import httpx

logger = logging.getLogger("dashboard")

# Load .env if present
load_dotenv()

HOST = os.environ.get('BACKEND_HOST', '0.0.0.0')
PORT = int(os.environ.get('BACKEND_PORT', '9090'))

app = FastAPI(title="Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- API Key Auth ---
DASHBOARD_API_KEY = os.environ.get("DASHBOARD_API_KEY", "").strip()
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def require_api_key(api_key: str = Security(api_key_header)):
    """Dependency: reject requests without a valid API key when DASHBOARD_API_KEY is set."""
    if DASHBOARD_API_KEY and api_key != DASHBOARD_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")
    return api_key

# --- Config DB ---
DB_PATH = os.environ.get('CONFIG_DB', '/data/dashboard.db')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS widget_config (widget_id TEXT PRIMARY KEY, config TEXT NOT NULL)")
    db.execute("""
        CREATE TABLE IF NOT EXISTS alert_cooldowns (
            alert_key TEXT PRIMARY KEY,
            triggered_at REAL NOT NULL,
            value REAL DEFAULT 0,
            consecutive_hits INTEGER DEFAULT 0
        )
    """)
    # Migration: add consecutive_hits column if it doesn't exist (pre-v2 DBs)
    try:
        db.execute("ALTER TABLE alert_cooldowns ADD COLUMN consecutive_hits INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # Column already exists
    # Migration: fix NULL consecutive_hits from pre-migration rows
    db.execute("UPDATE alert_cooldowns SET consecutive_hits = 0 WHERE consecutive_hits IS NULL")
    # Migration: reset stale counters that were incremented before cooldown check was added
    # Only run once — use a sentinel key
    sentinel = db.execute("SELECT 1 FROM alert_cooldowns WHERE alert_key = '__migrated_v2'").fetchone()
    if not sentinel:
        db.execute("UPDATE alert_cooldowns SET consecutive_hits = 0 WHERE triggered_at = 0 AND consecutive_hits > 0")
        db.execute("INSERT INTO alert_cooldowns (alert_key, triggered_at, value, consecutive_hits) VALUES ('__migrated_v2', 0, 0, 0)")
    # Seed sites from env if DB empty
    seed = os.environ.get("SITES_SEED", "").strip()
    if seed:
        row = db.execute("SELECT config FROM widget_config WHERE widget_id = ?", ("sites",)).fetchone()
        if not row or not json.loads(row["config"]).get("sites"):
            sites = [s.strip() for s in seed.split(",") if s.strip()]
            if sites:
                existing = json.loads(row["config"]) if row else {}
                existing["sites"] = sites
                db.execute("INSERT OR REPLACE INTO widget_config (widget_id, config) VALUES (?, ?)",
                           ("sites", json.dumps(existing)))
    db.commit()
    return db

def get_widget_config_dict(widget_id: str) -> dict:
    """Read a widget's config from DB, return empty dict if not found."""
    try:
        db = get_db()
        row = db.execute("SELECT config FROM widget_config WHERE widget_id = ?", (widget_id,)).fetchone()
        db.close()
        if row:
            return json.loads(row["config"])
    except Exception:
        pass
    return {}


# --- Alert Service (server-side threshold checking) ---
ALERT_CHECK_INTERVAL = int(os.environ.get("ALERT_CHECK_INTERVAL", "60"))
ALERT_COOLDOWN_SECS = int(os.environ.get("ALERT_COOLDOWN_MINUTES", "10")) * 60
ALERT_CONSECUTIVE_THRESHOLD = int(os.environ.get("ALERT_CONSECUTIVE_THRESHOLD", "3"))
ALERT_CONSECUTIVE_TIMEOUT_SECS = int(os.environ.get("ALERT_CONSECUTIVE_TIMEOUT_SECS", "300"))

class AlertService:
    def __init__(self):
        self._lock = threading.Lock()

    def _get_row(self, alert_key: str):
        db = get_db()
        row = db.execute(
            "SELECT triggered_at, value, consecutive_hits FROM alert_cooldowns WHERE alert_key = ?",
            (alert_key,)
        ).fetchone()
        db.close()
        return row

    def _upsert(self, alert_key: str, triggered_at: float, value: float, consecutive_hits: int):
        db = get_db()
        db.execute(
            "INSERT OR REPLACE INTO alert_cooldowns (alert_key, triggered_at, value, consecutive_hits) VALUES (?, ?, ?, ?)",
            (alert_key, triggered_at, value, consecutive_hits)
        )
        db.commit()
        db.close()

    def _delete(self, alert_key: str):
        db = get_db()
        db.execute("DELETE FROM alert_cooldowns WHERE alert_key = ?", (alert_key,))
        db.commit()
        db.close()

    def should_trigger(self, alert_key: str) -> bool:
        now = time.time()
        row = self._get_row(alert_key)
        if row:
            if now - row["triggered_at"] < ALERT_COOLDOWN_SECS:
                return False
        return True

    def mark_triggered(self, alert_key: str):
        self._upsert(alert_key, time.time(), 0, 0)

    def reset_cooldown(self, alert_key: str):
        self._delete(alert_key)

    def _increment_consecutive(self, alert_key: str) -> tuple[bool, int]:
        """Increment consecutive counter atomically. Returns (should_alert, current_count)."""
        with self._lock:
            now = time.time()
            db = get_db()

            # Check cooldown first
            row = db.execute(
                "SELECT triggered_at, value, consecutive_hits FROM alert_cooldowns WHERE alert_key = ?",
                (alert_key,)
            ).fetchone()

            in_cooldown = False
            if row:
                triggered_at = row["triggered_at"]
                if triggered_at and triggered_at > 0 and (now - triggered_at) < ALERT_COOLDOWN_SECS:
                    in_cooldown = True

            if in_cooldown:
                hits = row["consecutive_hits"] or 0
                db.close()
                return False, hits

            if row:
                # Check timeout — reset if too much time passed
                last_hit = row["value"]
                if last_hit and last_hit > 0 and (now - last_hit) > ALERT_CONSECUTIVE_TIMEOUT_SECS:
                    db.execute(
                        "UPDATE alert_cooldowns SET consecutive_hits = 1, value = ?, triggered_at = 0 WHERE alert_key = ?",
                        (now, alert_key)
                    )
                    hits = 1
                else:
                    # Atomic increment
                    db.execute(
                        "UPDATE alert_cooldowns SET consecutive_hits = consecutive_hits + 1, value = ? WHERE alert_key = ?",
                        (now, alert_key)
                    )
                    row2 = db.execute(
                        "SELECT consecutive_hits FROM alert_cooldowns WHERE alert_key = ?",
                        (alert_key,)
                    ).fetchone()
                    hits = row2["consecutive_hits"] or 0
            else:
                # First hit
                db.execute(
                    "INSERT INTO alert_cooldowns (alert_key, triggered_at, value, consecutive_hits) VALUES (?, 0, ?, 1)",
                    (alert_key, now)
                )
                hits = 1

            should_alert = hits >= ALERT_CONSECUTIVE_THRESHOLD
            if should_alert:
                db.execute(
                    "UPDATE alert_cooldowns SET triggered_at = ? WHERE alert_key = ?",
                    (now, alert_key)
                )

            db.commit()
            db.close()
            logger.info(f"_increment_consecutive: {alert_key} hits={hits} should_alert={should_alert}")
            return should_alert, hits

    def check_metric(self, source: str, widget_id: str, hostname: str,
                     metric_name: str, value: float, threshold: float,
                     enabled: bool, unit: str = "%") -> dict | None:
        if not enabled:
            return None
        alert_key = f"{widget_id}|{metric_name}"
        if value > threshold:
            logger.info(f"check_metric: {alert_key} value={value} > threshold={threshold}")
            should_alert, hits = self._increment_consecutive(alert_key)
            if not should_alert:
                # Return a "pending" marker so the frontend can show progress
                return {
                    "widget_id": widget_id,
                    "widget_title": f"{source} ({hostname})",
                    "metric": metric_name,
                    "value": value,
                    "threshold": threshold,
                    "unit": unit,
                    "consecutive_hits": hits,
                    "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                    "description": None
                }
            desc = (f"{source} ({hostname}): {metric_name} достиг {value:.0f}{unit} "
                    f"(порог: {threshold:.0f}{unit}).\n"
                    f"Превышение на {value - threshold:.0f}{unit}.\n"
                    f"Алерт сработал после {hits} последовательных превышений.")
            return {
                "widget_id": widget_id,
                "widget_title": f"{source} ({hostname})",
                "metric": metric_name,
                "value": value,
                "threshold": threshold,
                "unit": unit,
                "consecutive_hits": hits,
                "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                "description": desc
            }
        else:
            self._delete(alert_key)
            return None

    def check_metrics(self, source: str, widget_id: str, hostname: str,
                      metrics: dict, config: dict) -> list[dict]:
        alerts = []
        checks = [
            ("CPU", metrics.get("cpu", 0), "alertCpuEnabled", "alertCpuThreshold"),
            ("RAM", metrics.get("ram", 0), "alertRamEnabled", "alertRamThreshold"),
            ("Disk", metrics.get("disk", 0), "alertDiskEnabled", "alertDiskThreshold"),
        ]
        for name, val, enabled_key, threshold_key in checks:
            enabled = config.get(enabled_key, True)
            threshold = config.get(threshold_key, 90)
            alert = self.check_metric(source, widget_id, hostname, name, val, threshold, enabled)
            if alert:
                alerts.append(alert)
        return alerts

    def pending_alerts(self, widget_id: str, hostname: str, source: str,
                       metrics: dict, config: dict) -> list[dict]:
        """Return currently-active (in cooldown) alerts for API response."""
        alerts = []
        checks = [
            ("CPU", metrics.get("cpu", 0), "alertCpuEnabled", "alertCpuThreshold"),
            ("RAM", metrics.get("ram", 0), "alertRamEnabled", "alertRamThreshold"),
            ("Disk", metrics.get("disk", 0), "alertDiskEnabled", "alertDiskThreshold"),
        ]
        for name, val, enabled_key, threshold_key in checks:
            enabled = config.get(enabled_key, True)
            threshold = config.get(threshold_key, 90)
            if not enabled or val <= threshold:
                continue
            alert_key = f"{widget_id}|{name}"
            row = self._get_row(alert_key)
            if row:
                try:
                    hits = row["consecutive_hits"] or 0
                except (KeyError, IndexError):
                    hits = 0
                try:
                    triggered_at = row["triggered_at"] or 0
                except (KeyError, IndexError):
                    triggered_at = 0
                now = time.time()
                in_cooldown = triggered_at > 0 and (now - triggered_at) < ALERT_COOLDOWN_SECS
                if in_cooldown or hits > 0:
                    alerts.append({
                        "widget_id": widget_id,
                        "widget_title": f"{source} ({hostname})",
                        "metric": name,
                        "value": val,
                        "threshold": threshold,
                        "unit": "%",
                        "consecutive_hits": hits,
                        "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                        "description": None if not in_cooldown else
                            f"{source} ({hostname}): {name} достиг {val:.0f}% (порог: {threshold:.0f}%)."
                    })
        return alerts

    async def send_webhook(self, alerts: list[dict]):
        if not alerts:
            return
        webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
        if not webhook_url:
            return
        auth_token = os.environ.get("ALERT_WEBHOOK_AUTH_TOKEN", "").strip()
        headers = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"
        messages = []
        for a in alerts:
            messages.append({
                "type": "alert",
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "widget_id": a["widget_id"],
                "widget_title": a["widget_title"],
                "metric": a["metric"],
                "value": a["value"],
                "threshold": a["threshold"],
                "unit": a["unit"],
                "description": a["description"]
            })
        payload = {"messages": messages}
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(webhook_url, json=payload, headers=headers, timeout=10)
            logger.info(f"Alert webhook sent: {resp.status_code} ({len(alerts)} alerts)")
        except Exception as e:
            logger.error(f"Alert webhook send failed: {e}")


# Singleton
alert_service = AlertService()

# --- Safe fire-and-forget helper for sync endpoints ---
def _fire_webhook(alerts: list[dict]):
    """Schedule webhook delivery in a background thread — safe from sync endpoints."""
    if not alerts:
        return
    def _run():
        try:
            asyncio.run(alert_service.send_webhook(alerts))
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()

# --- System Info ---
@app.get("/api/sysinfo")
def sysinfo():
    proc = os.environ.get('HOST_PROC','/proc')
    sysf = os.environ.get('HOST_SYS','/sys')
    try:
        with open(f'{proc}/stat') as f:
            for line in f:
                if line.startswith('cpu '):
                    fields = line.split()
                    idle = float(fields[4]); total = sum(float(x) for x in fields[1:])
                    cpu = round(100 * (1 - idle/total)) if total else 0; break
    except: cpu = 0
    try:
        with open(f'{proc}/meminfo') as f:
            memdata = f.read()
            total = int([l for l in memdata.split('\n') if 'MemTotal' in l][0].split()[1])
            avail = int([l for l in memdata.split('\n') if 'MemAvailable' in l][0].split()[1])
            mem = round(100 * (total-avail)/total)
    except: mem = 0
    try:
        disk = subprocess.check_output(["bash","-c","df / | tail -1 | awk '{print $5}' | tr -d '%'"]).decode().strip()
        disk = int(disk) if disk else 0
    except: disk = 0
    try:
        with open(f'{proc}/uptime') as f:
            secs = float(f.read().split()[0])
            days = int(secs//86400); hrs = int((secs%86400)//3600); mins = int((secs%3600)//60)
            uptime = f"{days}d {hrs}h {mins}m"
    except: uptime = "unknown"
    try:
        with open(f'{proc}/loadavg') as f:
            load = f.read().split()[:3]
    except: load = [0,0,0]
    try:
        hostname = os.environ.get('BACKEND_HOSTNAME') or subprocess.check_output(["hostname"]).decode().strip()
    except: hostname = "unknown"
    # CPU model & cores
    try:
        with open(f'{proc}/../proc/cpuinfo' if os.path.exists(f'{proc}/../proc/cpuinfo') else '/proc/cpuinfo') as f:
            lines = f.read().split('\n')
            model_lines = [l for l in lines if l.startswith('model name')]
            cpu_model = model_lines[0].split(':',1)[1].strip() if model_lines else ''
            cpu_cores = len([l for l in lines if l.startswith('processor')])
    except: cpu_model, cpu_cores = '', 0
    # Total RAM
    try:
        total_mem_kb = int([l for l in open('/proc/meminfo').read().split('\n') if 'MemTotal' in l][0].split()[1])
        total_ram_gb = round(total_mem_kb / 1024 / 1024, 1)
    except: total_ram_gb = 0
    # Total disk
    try:
        df_out = subprocess.check_output(["df","-h","/"]).decode().strip().split('\n')
        total_disk_str = df_out[1].split()[1] if len(df_out) > 1 else ''
    except: total_disk_str = ''
    # Server-side alert check
    metrics = {"cpu": cpu, "ram": mem, "disk": disk}
    config = get_widget_config_dict("sysload")
    new_alerts = alert_service.check_metrics("System Load", "sysload", hostname, metrics, config)
    pending = alert_service.pending_alerts("sysload", hostname, "System Load", metrics, config)
    # Fire-and-forget webhook for new alerts (sync version — won't block)
    if new_alerts:
        _fire_webhook(new_alerts)
    return {"cpu": cpu, "ram": mem, "disk": disk, "uptime": uptime,
            "load1": float(load[0]), "load5": float(load[1]), "load15": float(load[2]),
            "hostname": hostname,
            "cpu_model": cpu_model, "cpu_cores": cpu_cores,
            "total_ram": f"{total_ram_gb}GB", "total_disk": total_disk_str,
            "alerts": pending}

# --- Docker ---
@app.get("/api/docker")
def docker():
    try:
        out = subprocess.check_output(["docker","ps","-a","--format","{{json .}}"], env={**os.environ, "DOCKER_HOST": "unix:///var/run/docker.sock"}, timeout=10).decode()
        containers = []
        for line in out.strip().split("\n"):
            if not line: continue
            c = json.loads(line)
            state = c.get("State", "").lower()
            running = state == "running"
            containers.append({
                "id": c.get("ID","")[:12],
                "name": c.get("Names",""),
                "image": c.get("Image",""),
                "status": c.get("Status",""),
                "running": running,
                "ports": c.get("Ports","")
            })
        # Docker: check stopped containers alert
        stopped = [c for c in containers if not c["running"]]
        config = get_widget_config_dict("docker")
        docker_alerts = []
        if config.get("alertStoppedEnabled", True) and len(stopped) > config.get("alertStoppedThreshold", 0):
            stopped_names = ", ".join(c["name"] for c in stopped)
            alert_key = "docker|stopped"
            should_alert, hits = alert_service._increment_consecutive(alert_key)
            if should_alert:
                desc = (f"Docker: {len(stopped)} остановленных контейнеров (порог: {config.get('alertStoppedThreshold', 0)}).\n{stopped_names}\n"
                        f"Алерт сработал после {hits} последовательных проверок.")
                alert_data = {
                    "widget_id": "docker",
                    "widget_title": "Docker Containers",
                    "metric": "Stopped",
                    "value": len(stopped),
                    "threshold": config.get("alertStoppedThreshold", 0),
                    "unit": " шт.",
                    "consecutive_hits": hits,
                    "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                    "description": desc
                }
                docker_alerts.append(alert_data)
                _fire_webhook([alert_data])
            else:
                # Still report as pending with consecutive count
                docker_alerts.append({
                    "widget_id": "docker",
                    "widget_title": "Docker Containers",
                    "metric": "Stopped",
                    "value": len(stopped),
                    "threshold": config.get("alertStoppedThreshold", 0),
                    "unit": " шт.",
                    "consecutive_hits": hits,
                    "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                    "description": None
                })
        else:
            # Clear cooldown if condition resolved
            alert_service._delete("docker|stopped")
        # Attach alerts to each container (as a convenience field)
        return {"containers": containers, "alerts": docker_alerts}
    except Exception as e:
        logger.warning(f"Docker API error: {e}")
        # Return empty structure with error flag instead of fake demo data
        return {"containers": [], "alerts": [], "error": str(e)}

# --- Tailscale ---
@app.get("/api/tailscale")
def tailscale():
    try:
        ts_sock = os.environ.get("TS_SOCKET","/var/run/tailscale/tailscaled.sock")
        env = {**os.environ, "TS_SOCKET": ts_sock}
        out = subprocess.check_output(["tailscale","status"], env=env, timeout=5).decode()
        lines = out.strip().split("\n")
        peers = []
        self_info = {"name": os.environ.get("BACKEND_HOSTNAME","node"), "ip": os.environ.get("TAILSCALE_SELF_IP","")}
        for line in lines:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            ip = parts[0] if parts[0].startswith("100.") else ""
            hostname = parts[1] if len(parts) > 1 else ""
            dns = parts[2] if len(parts) > 2 else ""
            os_name = parts[3] if len(parts) > 3 else ""
            status_info = " ".join(parts[4:]) if len(parts) > 4 else ""

            # Determine online/offline and details
            online = True
            relay = ""
            tx = 0
            rx = 0
            last_seen = ""

            if "offline" in status_info:
                online = False
                import re
                m = re.search(r'last seen (.+) ago', status_info)
                if m:
                    last_seen = m.group(1) + " ago"
            else:
                if "relay" in status_info:
                    relay = "relay"
                # Parse direct connection
                m = __import__('re').search(r'tx (\d+) rx (\d+)', status_info)
                if m:
                    tx = int(m.group(1))
                    rx = int(m.group(2))

            peers.append({
                "name": hostname,
                "ip": ip,
                "dns": dns,
                "os": os_name,
                "online": online,
                "relay": relay,
                "tx": tx,
                "rx": rx,
                "lastseen": last_seen,
                "tags": []
            })

        # Sort: online first, then by name
        peers.sort(key=lambda p: (not p["online"], p["name"]))

        return {"self": self_info, "peers": peers}
    except Exception as e:
        logger.error(f"Tailscale API error: {e}")
        ts_sock = os.environ.get("TS_SOCKET","/var/run/tailscale/tailscaled.sock")
        if not os.path.exists(ts_sock):
            logger.warning(f"Tailscale socket not found at {ts_sock}")
        return {"self": {"name":"dashboard-node","ip":""},
                "peers": []}

# --- Logs ---
@app.get("/api/logs")
def logs(lines: int = 30, services: str = "system"):
    svcs = [s.strip() for s in services.split(",") if s.strip()]
    if not svcs:
        svcs = ["system"]
    entries = {}
    for svc in svcs:
        try:
            if svc == "system":
                cmd = ["journalctl", "-n", str(lines), "--no-page", "--directory=/host/log/journal"]
            else:
                m = re.match(r'^\[(\w+)\](.+)$', svc)
                if m:
                    uname, u_svc = m.group(1), m.group(2).strip()
                    cmd = ["journalctl", f"_SYSTEMD_USER_UNIT={u_svc}.service", "-n", str(lines), "--no-page", "--directory=/host/log/journal"]
                else:
                    cmd = ["journalctl", "-u", svc, "-n", str(lines), "--no-page", "--directory=/host/log/journal"]
            out = subprocess.check_output(cmd, timeout=5).decode()
            entry_lines = []
            for line in out.strip().split("\n"):
                if not line: continue
                entry_lines.append(line.strip())
            entries[svc] = entry_lines[-lines:]
        except:
            entries[svc] = [f"⚠ Не удалось получить логи для {svc}"]
    return {"entries": entries}

# --- TODO ---
@app.get("/api/todo")
def get_todo():
    todo_path = os.environ.get("TODO_PATH", os.path.expanduser("~/.hermes/todo/tasks.json"))
    try:
        with open(todo_path) as f:
            data = json.load(f)
            tasks = []
            for t in data:
                status = t.get("status","pending")
                priority = t.get("priority","medium")
                tasks.append({
                    "id": t.get("id",""),
                    "text": t.get("text",""),
                    "status": status,
                    "priority": priority,
                    "due": t.get("due","")
                })
            return {"count": len(tasks), "pending": sum(1 for t in tasks if t["status"] in ("pending","in_progress","active")), "tasks": tasks}
    except Exception as e:
        logger.warning(f"TODO API error: {e}")
        # Return empty structure with error flag instead of fake demo data
        return {"count": 0, "pending": 0, "tasks": [], "error": str(e)}

# --- Promotions ---
PROMO_DB_PATH = os.environ.get("PROMO_DB_PATH", os.path.expanduser("~/.hermes/data/promotions.db"))

@app.get("/api/promotions")
def get_promotions():
    """Возвращает активные акции из БД promotions."""
    try:
        conn = sqlite3.connect(PROMO_DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT * FROM promotions
            WHERE status = 'active' AND end_date >= date('now')
            ORDER BY end_date ASC, brand ASC
        """).fetchall()
        conn.close()
        promos = []
        for r in rows:
            promos.append({
                "id": r["id"],
                "brand": r["brand"],
                "description": r["description"],
                "terms": r["terms"],
                "benefit": r["benefit"],
                "end_date": r["end_date"],
                "source": r["source"],
                "category": r["category"],
                "url": r["url"],
                "priority": r["priority"],
            })
        return {"promotions": promos, "count": len(promos)}
    except Exception as e:
        return {"promotions": [], "count": 0, "error": str(e)}

# --- Weather ---
@app.get("/api/weather")
def weather():
    import urllib.request
    lat = os.environ.get("WEATHER_LAT", "55.7558").strip()
    lon = os.environ.get("WEATHER_LON", "37.6173").strip()
    city = os.environ.get("WEATHER_CITY", "Moscow").strip()
    api = os.environ.get("WEATHER_API", "https://api.open-meteo.com/v1/forecast").strip().rstrip("/")
    try:
        url = (f"{api}?latitude={lat}&longitude={lon}"
               f"&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
               f"&daily=temperature_2m_max,temperature_2m_min&timezone=Europe/Moscow")
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        current = data.get("current",{})
        daily = data.get("daily",{})
        code = int(current.get("weather_code",0))
        icons = {0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌧️",55:"🌧️",
                 61:"🌧️",63:"🌧️",65:"🌧️",71:"🌨️",73:"🌨️",75:"🌨️",95:"⛈️",96:"⛈️",99:"⛈️"}
        return {
            "temp": current.get("temperature_2m",0),
            "humidity": current.get("relative_humidity_2m",0),
            "wind": current.get("wind_speed_10m",0),
            "icon": icons.get(code,"🌡️"),
            "code": code,
            "city": city,
            "forecast": {"max": daily.get("temperature_2m_max",[0])[0], "min": daily.get("temperature_2m_min",[0])[0]}
        }
    except Exception as e:
        logger.warning(f"Weather fetch failed: {e}")
        # Return empty structure with error flag instead of fake demo data
        return {"temp":None,"humidity":None,"wind":None,"icon":"🌡️","code":0,"city":city,
                "forecast":{"max":None,"min":None},"error":str(e)}

# --- Crypto ---
@app.get("/api/crypto")
def crypto(ids: str = "bitcoin,ethereum,monero"):
    import urllib.request
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd&include_24hr_change=true"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        result = {}
        for coin_id in ids.split(","):
            coin_id = coin_id.strip()
            if coin_id in data:
                result[coin_id] = {
                    "price": data[coin_id]["usd"],
                    "change24": data[coin_id].get("usd_24h_change", 0)
                }
        return result if result else {"bitcoin": {"price": 0, "change24": 0}}
    except:
        return {"bitcoin": {"price": 0, "change24": 0}}

# --- Server Status (SSH Agent) ---
SERVER_CACHE = {"data": None, "ts": 0}

def ssh_collect(host, port=22, user="root"):
    """Collect server metrics via SSH. Returns dict or None on failure."""
    try:
        cmd = [
            "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            "-o", "BatchMode=yes",
            f"-p{port}" if port != 22 else None,
            f"{user}@{host}",
            "cat /proc/loadavg 2>/dev/null; echo '---'; "
            "cat /proc/uptime 2>/dev/null; echo '---'; "
            "head -1 /proc/stat 2>/dev/null; echo '---'; "
            "free -m 2>/dev/null | grep '^Mem:'; echo '---'; "
            "df -h / 2>/dev/null | tail -1; echo '---'; "
            "cat /proc/cpuinfo 2>/dev/null | grep 'model name' | head -1 | sed 's/.*: //'; echo '---'; "
            "nproc 2>/dev/null"
        ]
        cmd = [c for c in cmd if c is not None]
        out = subprocess.check_output(cmd, timeout=10).decode()
        sections = out.strip().split("\n---\n")
        if len(sections) < 7:
            return None

        loadavg = sections[0].strip()
        uptime_raw = sections[1].strip()
        stat_line = sections[2].strip()
        mem_line = sections[3].strip()
        disk_line = sections[4].strip()
        cpu_model = sections[5].strip()
        nproc_raw = sections[6].strip()

        # loadavg
        load_parts = loadavg.split()
        load1 = float(load_parts[0]) if load_parts else 0
        load5 = float(load_parts[1]) if len(load_parts) > 1 else 0
        load15 = float(load_parts[2]) if len(load_parts) > 2 else 0

        # uptime (seconds)
        uptime_secs = float(uptime_raw.split()[0]) if uptime_raw else 0
        days = int(uptime_secs // 86400)
        hrs = int((uptime_secs % 86400) // 3600)

        # CPU (first line of /proc/stat)
        cpu_fields = [float(x) for x in stat_line.split()[1:]]
        cpu = 0
        if cpu_fields:
            idle = cpu_fields[3]
            total = sum(cpu_fields)
            cpu = round(100 * (1 - idle / total)) if total > 0 else 0

        # RAM (free -m output: "Mem:        123456     34250     14562...")
        total_mem = avail_mem = 0
        parts = mem_line.split()
        if len(parts) >= 7:
            total_mem = float(parts[1])
            avail_mem = float(parts[6])
        ram = round(100 * (total_mem - avail_mem) / total_mem) if total_mem > 0 else 0

        # Disk (df output: "/dev/md44       1.8T  662G  1.1T  39% /")
        disk_parts = disk_line.split()
        disk = 0
        total_disk_str = ''
        if len(disk_parts) >= 5:
            disk_str = disk_parts[4].replace("%", "")
            disk = int(disk_str) if disk_str.isdigit() else 0
            total_disk_str = disk_parts[1] if len(disk_parts) > 1 else ''

        # CPU model / cores
        cpu_cores = 0
        try:
            cpu_cores = int(nproc_raw.strip())
        except:
            cpu_cores = 0

        # Total RAM in human readable
        total_ram_gb = round(total_mem / 1024, 1) if total_mem > 0 else 0

        return {
            "online": True,
            "cpu": cpu,
            "ram": ram,
            "disk": disk,
            "cpu_model": cpu_model,
            "cpu_cores": cpu_cores,
            "total_ram": f"{total_ram_gb}GB",
            "total_disk": total_disk_str,
            "uptime": f"{days}d {hrs}h",
            "load1": load1,
            "load5": load5,
            "load15": load15
        }
    except Exception as e:
        return {"online": False, "cpu": 0, "ram": 0, "disk": 0, "uptime": "OFFLINE", "load1": 0, "load5": 0, "load15": 0, "cpu_model": "", "cpu_cores": 0, "total_ram": "0GB", "total_disk": ""}

# Servers config from env JSON (default empty): {"id": {"name": "Name", "host": "ip", "port": 22, "user": "root"}}
SERVERS_CONFIG_JSON = os.environ.get("SERVERS_CONFIG", "{}")
try:
    SERVERS_CONFIG = json.loads(SERVERS_CONFIG_JSON)
except Exception:
    SERVERS_CONFIG = {}

@app.get("/api/server-status")
def get_server_status():
    now = time.time()
    if SERVER_CACHE["data"] and (now - SERVER_CACHE["ts"]) < 15:
        return SERVER_CACHE["data"]
    results = {}
    for sid, cfg in SERVERS_CONFIG.items():
        results[sid] = ssh_collect(cfg["host"], cfg["port"], cfg["user"])
        results[sid]["id"] = sid
        results[sid]["name"] = cfg["name"]
        # Server-side alert check for each server
        if results[sid].get("online"):
            metrics = {"cpu": results[sid].get("cpu", 0),
                       "ram": results[sid].get("ram", 0),
                       "disk": results[sid].get("disk", 0)}
            config = get_widget_config_dict(sid)
            new_alerts = alert_service.check_metrics(results[sid].get("name", sid),
                                                     sid, results[sid].get("name", sid),
                                                     metrics, config)
            pending = alert_service.pending_alerts(sid, results[sid].get("name", sid),
                                                   "Server Status", metrics, config)
            results[sid]["alerts"] = pending
            if new_alerts:
                _fire_webhook(new_alerts)
        else:
            # Server offline alert check
            config = get_widget_config_dict(sid)
            if config.get("alertOfflineEnabled", True):
                alert_key = f"{sid}|Offline"
                should_alert, hits = alert_service._increment_consecutive(alert_key)
                if should_alert:
                    alert_data = {
                        "widget_id": sid,
                        "widget_title": f"Server Status ({cfg['name']})",
                        "metric": "Доступность",
                        "value": 0,
                        "threshold": 0,
                        "unit": "",
                        "consecutive_hits": hits,
                        "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                        "description": f"Server Status ({cfg['name']}): сервер НЕДОСТУПЕН (Offline).\nНет ответа по SSH — проверьте соединение.\nАлерт сработал после {hits} последовательных проверок."
                    }
                    _fire_webhook([alert_data])
                    results[sid]["alerts"] = [alert_data]
                else:
                    # Show pending with consecutive count
                    results[sid]["alerts"] = [{
                        "widget_id": sid,
                        "widget_title": f"Server Status ({cfg['name']})",
                        "metric": "Доступность",
                        "value": 0,
                        "threshold": 0,
                        "unit": "",
                        "consecutive_hits": hits,
                        "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                        "description": None
                    }]
            else:
                results[sid]["alerts"] = []
    
    SERVER_CACHE["data"] = results
    SERVER_CACHE["ts"] = now
    return results

# --- Site Status Check ---
SITE_CACHE = {"data": None, "ts": 0}

DEFAULT_SITES = []  # Previously hardcoded — moved to DB for privacy

def get_sites_list():
    """Get monitored sites from DB config, fallback to empty list."""
    config = get_widget_config_dict("sites")
    sites = config.get("sites", [])
    if not sites:
        # First run: leave empty, user adds via widget settings
        return []
    return sites

def save_sites_list(sites):
    """Save monitored sites list to DB config."""
    config = get_widget_config_dict("sites")
    config["sites"] = sites
    db = get_db()
    db.execute("INSERT OR REPLACE INTO widget_config (widget_id, config) VALUES (?, ?)",
               ("sites", json.dumps(config)))
    db.commit()
    db.close()

def check_site(url):
    """Check if a URL returns HTTP 200."""
    import urllib.request
    try:
        req = urllib.request.Request(url, method="HEAD")
        resp = urllib.request.urlopen(req, timeout=10)
        code = resp.status
        return {"url": url, "status": code, "online": code == 200}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "online": False}
    except Exception as e:
        return {"url": url, "status": 0, "online": False}

@app.get("/api/site-status")
def get_site_status():
    now = time.time()
    cache_hit = SITE_CACHE["data"] and (now - SITE_CACHE["ts"]) < 60
    if cache_hit:
        results = SITE_CACHE["data"]
    else:
        urls = get_sites_list()
        if not urls:
            return {"sites": [], "alerts": []}
        results = [check_site(url) for url in urls]
        # Red (offline) first
        results.sort(key=lambda x: x["online"], reverse=False)
        SITE_CACHE["data"] = results
        SITE_CACHE["ts"] = now

    # Sites: check offline
    config = get_widget_config_dict("sites")
    site_alerts = []
    offline = [s for s in results if not s["online"]]
    if config.get("alertOfflineEnabled", True) and offline:
        names = ", ".join(s["url"] for s in offline)
        statuses = ", ".join(f"{s['url']} ({s['status']})" for s in offline)
        alert_key = "sites|offline"
        should_alert, hits = alert_service._increment_consecutive(alert_key)
        if should_alert:
            alert_data = {
                "widget_id": "sites",
                "widget_title": "Sites",
                "metric": "Offline",
                "value": len(offline),
                "threshold": 0,
                "unit": " сайт.",
                "consecutive_hits": hits,
                "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                "description": f"Обнаружены недоступные сайты ({len(offline)}):\n{statuses}\n"
                               f"Алерт сработал после {hits} последовательных проверок."
            }
            site_alerts.append(alert_data)
            _fire_webhook([alert_data])
        else:
            site_alerts.append({
                "widget_id": "sites",
                "widget_title": "Sites",
                "metric": "Offline",
                "value": len(offline),
                "threshold": 0,
                "unit": " сайт.",
                "consecutive_hits": hits,
                "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                "description": None
            })
    else:
        # Clear cooldown if resolved
        alert_service._delete("sites|offline")

    if site_alerts:
        return {"sites": results, "alerts": site_alerts}
    return {"sites": results, "alerts": []}


# --- Ollama Cloud Usage ---
OLLAMA_USAGE_FILE = os.environ.get("OLLAMA_USAGE_FILE", "/ollama-data/ollama-usage.json")

@app.get("/api/ollama-usage")
def ollama_usage():
    """Возвращает данные об использовании Ollama Cloud из JSON-файла."""
    try:
        with open(OLLAMA_USAGE_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"error": "no_data", "plan": "unknown",
                "session": {"percent": 0, "resets_at": None, "models": []},
                "weekly": {"percent": 0, "resets_at": None, "models": []},
                "fetched_at": None}

    return data


# --- Alert Webhook Config ---
@app.get("/api/alert-config")
def get_alert_config():
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    auth_token = os.environ.get("ALERT_WEBHOOK_AUTH_TOKEN", "").strip()
    return {"webhook_url": webhook_url, "auth_token": auth_token}


# --- Alert Webhook Trigger ---
from pydantic import BaseModel
from typing import List

class AlertMessage(BaseModel):
    type: str = 'alert'
    timestamp: str = None
    widget_id: str = ''
    widget_title: str = ''
    metric: str = ''
    value: float = 0
    threshold: float = 0
    unit: str = ''
    description: str = ''

class AlertPayload(BaseModel):
    messages: List[AlertMessage]

@app.post("/api/alert")
async def trigger_alert(payload: AlertPayload, api_key: str = Depends(require_api_key)):
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    auth_token = os.environ.get("ALERT_WEBHOOK_AUTH_TOKEN", "").strip()
    if not webhook_url:
        return {"status": "no_webhook_configured"}

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                webhook_url,
                json=payload.model_dump(),
                headers=headers,
                timeout=10
            )
        return {"status": "sent", "webhook_status": resp.status_code}
    except Exception as e:
        return {"status": "error", "error": str(e)}

# --- Widget Config ---
class ConfigInput(BaseModel):
    config: dict

@app.get("/api/config/{widget_id}")
def get_widget_config(widget_id: str):
    db = get_db()
    row = db.execute("SELECT config FROM widget_config WHERE widget_id = ?", (widget_id,)).fetchone()
    db.close()
    if row:
        return json.loads(row["config"])
    return {}

@app.get("/api/config")
def get_all_configs():
    db = get_db()
    rows = db.execute("SELECT widget_id, config FROM widget_config").fetchall()
    db.close()
    return {row["widget_id"]: json.loads(row["config"]) for row in rows}

@app.put("/api/config/{widget_id}")
def set_widget_config(widget_id: str, body: ConfigInput, api_key: str = Depends(require_api_key)):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO widget_config (widget_id, config) VALUES (?, ?)",
               (widget_id, json.dumps(body.config)))
    db.commit()
    db.close()
    return {"status": "ok", "widget_id": widget_id}

@app.delete("/api/config/{widget_id}")
def delete_widget_config(widget_id: str, api_key: str = Depends(require_api_key)):
    db = get_db()
    db.execute("DELETE FROM widget_config WHERE widget_id = ?", (widget_id,))
    db.commit()
    db.close()
    return {"status": "deleted"}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

    # Background alert loop — runs independently of frontend
    async def background_alert_loop():
        loop_interval = max(ALERT_CHECK_INTERVAL, 30)
        logger.info(f"Background alert loop started (interval={loop_interval}s)")
        while True:
            try:
                await asyncio.sleep(loop_interval)
                alerts = []
                base_url = f"http://127.0.0.1:{PORT}"

                # Check sysload (local host)
                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(f"{base_url}/api/sysinfo", timeout=10)
                        if resp.status_code == 200:
                            data = resp.json()
                            metrics = {"cpu": data.get("cpu", 0), "ram": data.get("ram", 0), "disk": data.get("disk", 0)}
                            config = get_widget_config_dict("sysload")
                            hostname = data.get("hostname", "localhost")
                            new = alert_service.check_metrics("System Load", "sysload", hostname, metrics, config)
                            alerts.extend(new)
                except Exception as e:
                    logger.warning(f"Background sysload check failed: {e}")

                # Check remote servers
                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(f"{base_url}/api/server-status", timeout=30)
                        if resp.status_code == 200:
                            servers = resp.json()
                            for sid, srv in servers.items():
                                if srv.get("online"):
                                    metrics = {"cpu": srv.get("cpu", 0), "ram": srv.get("ram", 0), "disk": srv.get("disk", 0)}
                                    config = get_widget_config_dict(sid)
                                    hostname = srv.get("name", sid)
                                    new = alert_service.check_metrics(hostname, sid, hostname, metrics, config)
                                    alerts.extend(new)
                                else:
                                    # Offline check
                                    config = get_widget_config_dict(sid)
                                    if config.get("alertOfflineEnabled", True):
                                        alert_key = f"{sid}|Offline"
                                        should_alert, hits = alert_service._increment_consecutive(alert_key)
                                        if should_alert:
                                            alerts.append({
                                                "widget_id": sid,
                                                "widget_title": f"Server Status ({srv.get('name', sid)})",
                                                "metric": "Доступность",
                                                "value": 0,
                                                "threshold": 0,
                                                "unit": "",
                                                "consecutive_hits": hits,
                                                "consecutive_threshold": ALERT_CONSECUTIVE_THRESHOLD,
                                                "description": f"Server Status ({srv.get('name', sid)}): сервер НЕДОСТУПЕН (Offline).\nАлерт сработал после {hits} последовательных проверок."
                                            })
                except Exception as e:
                    logger.warning(f"Background server-status check failed: {e}")

                # Check Docker (stopped containers)
                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(f"{base_url}/api/docker", timeout=10)
                        if resp.status_code == 200:
                            raw = resp.json()
                            if isinstance(raw, dict):
                                docker_alerts = raw.get("alerts", [])
                                alerts.extend(docker_alerts)
                except Exception as e:
                    logger.warning(f"Background docker check failed: {e}")

                # Check Sites (offline sites)
                try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(f"{base_url}/api/site-status", timeout=10)
                        if resp.status_code == 200:
                            raw = resp.json()
                            if isinstance(raw, dict):
                                site_alerts = raw.get("alerts", [])
                                alerts.extend(site_alerts)
                except Exception as e:
                    logger.warning(f"Background sites check failed: {e}")

                if alerts:
                    await alert_service.send_webhook(alerts)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Background alert loop error: {e}")

    async def main():
        loop = asyncio.get_running_loop()
        loop.create_task(background_alert_loop())
        config = uvicorn.Config(app, host=HOST, port=PORT, log_level="info" if PORT != 9090 else "warning")
        server = uvicorn.Server(config)
        await server.serve()

    asyncio.run(main())
