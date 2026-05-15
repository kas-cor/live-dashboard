#!/usr/bin/env python3
"""
Dashboard Backend API
Provides system data for the dashboard widgets
"""
import subprocess, json, os, time, re, sqlite3
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn
import httpx

# Load .env if present
load_dotenv()

HOST = os.environ.get('BACKEND_HOST', '0.0.0.0')
PORT = int(os.environ.get('BACKEND_PORT', '9090'))

app = FastAPI(title="Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Config DB ---
DB_PATH = os.environ.get('CONFIG_DB', '/data/dashboard.db')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS widget_config (widget_id TEXT PRIMARY KEY, config TEXT NOT NULL)")
    db.commit()
    return db

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
    return {"cpu": cpu, "ram": mem, "disk": disk, "uptime": uptime,
            "load1": float(load[0]), "load5": float(load[1]), "load15": float(load[2]),
            "hostname": hostname,
            "cpu_model": cpu_model, "cpu_cores": cpu_cores,
            "total_ram": f"{total_ram_gb}GB", "total_disk": total_disk_str}

# --- Docker ---
@app.get("/api/docker")
def docker():
    try:
        out = subprocess.check_output(["docker","ps","-a","--format","{{json .}}"], env={**os.environ, "DOCKER_HOST": "unix:///var/run/docker.sock"}).decode()
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
        return containers
    except Exception as e:
        return [{"id":"demo1","name":"nginx","image":"nginx:latest","status":"Up 2 days","running":True,"ports":"80:80"},
                {"id":"demo2","name":"postgres","image":"postgres:15","status":"Up 5 hours","running":True,"ports":"5432:5432"},
                {"id":"demo3","name":"redis","image":"redis:alpine","status":"Exited (1) 3 days ago","running":False,"ports":""}]

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
        return {"self": {"name":"dashboard-node","ip":""},
                "peers": []}

# --- Logs ---
@app.get("/api/logs")
def logs(lines: int = 30, service: str = "system"):
    try:
        if service == "system":
            # Read from multiple host log files via volume mount
            cmd = ["bash","-c",f"""
                {{ tail -n {lines} /host/log/syslog 2>/dev/null;
                   tail -n {lines} /host/log/messages 2>/dev/null;
                   tail -n {lines} /host/log/kern.log 2>/dev/null;
                   tail -n {lines} /host/log/auth.log 2>/dev/null;
                   dmesg -T 2>/dev/null | tail -n {lines};
                   journalctl --directory=/host/log/journal -n {lines} --no-pager -o short-iso 2>/dev/null;
                }} | tac | awk '!seen[$0]++' | head -n {lines} | tac
            """]
        else:
            cmd = ["bash","-c",f"docker logs --tail {lines} {service} 2>/dev/null"]
        out = subprocess.check_output(cmd, timeout=5).decode()
        entries = []
        for line in out.strip().split("\n"):
            if not line: continue
            entries.append(line.strip())
        return {"service": service, "lines": entries[-lines:]}
    except:
        return {"service": service, "lines": ["⚠ Не удалось получить логи"]}

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
    except:
        return {"count": 5, "pending": 3,
                "tasks": [
                    {"id":"1","text":"Обновить сервер до 24.04","status":"pending","priority":"high","due":"2025-05-15"},
                    {"id":"2","text":"Настроить бэкапы на S3","status":"in_progress","priority":"high","due":"2025-05-20"},
                    {"id":"3","text":"Почистить Docker volumes","status":"pending","priority":"low","due":""},
                    {"id":"4","text":"Проверить TLS сертификаты","status":"completed","priority":"medium","due":""},
                    {"id":"5","text":"Обновить документацию","status":"pending","priority":"low","due":""}
                ]}

# --- Weather ---
@app.get("/api/weather")
def weather():
    import urllib.request
    try:
        url = "https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=Europe/Moscow"
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
            "city": "Moscow",
            "forecast": {"max": daily.get("temperature_2m_max",[0])[0], "min": daily.get("temperature_2m_min",[0])[0]}
        }
    except Exception as e:
        return {"temp":22,"humidity":45,"wind":3.5,"icon":"☀️","code":0,"city":"Moscow","forecast":{"max":25,"min":14}}

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
    SERVER_CACHE["data"] = results
    SERVER_CACHE["ts"] = now
    return results

# --- Site Status Check ---
SITE_CACHE = {"data": None, "ts": 0}

SITES_CHECK = [
    "https://oboi-store.ru",
    "https://parketov-store.ru"
]

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
    if SITE_CACHE["data"] and (now - SITE_CACHE["ts"]) < 60:
        return SITE_CACHE["data"]
    results = [check_site(url) for url in SITES_CHECK]
    # Red (offline) first
    results.sort(key=lambda x: x["online"], reverse=False)
    SITE_CACHE["data"] = results
    SITE_CACHE["ts"] = now
    return results

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
async def trigger_alert(payload: AlertPayload):
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    auth_token = os.environ.get("ALERT_WEBHOOK_AUTH_TOKEN", "").strip()
    if not webhook_url:
        return {"status": "no_webhook_configured"}

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = "Bearer " + auth_token

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
def set_widget_config(widget_id: str, body: ConfigInput):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO widget_config (widget_id, config) VALUES (?, ?)",
               (widget_id, json.dumps(body.config)))
    db.commit()
    db.close()
    return {"status": "ok", "widget_id": widget_id}

@app.delete("/api/config/{widget_id}")
def delete_widget_config(widget_id: str):
    db = get_db()
    db.execute("DELETE FROM widget_config WHERE widget_id = ?", (widget_id,))
    db.commit()
    db.close()
    return {"status": "deleted"}

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
