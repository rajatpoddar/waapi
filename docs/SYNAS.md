# Deploying WAPI on a Synology NAS

This guide is for Synology NAS models running **DSM 7.x** with **Container Manager**
(the built-in Docker UI). It also works on DiskStation/RS/DS models with Intel **or**
ARM CPUs — the Docker images are multi-architecture.

## Overview

You run two containers:

| Container | Image | Port | Purpose |
| --- | --- | --- | --- |
| `wapi-baileys` | custom (Node 22) | internal 2729 | WhatsApp engine |
| `wapi-fastapi` | custom (Python 3.12) | **2728** | REST API |

Persistent data lives in host folders, which makes backups trivial.

## 1. Prepare a project folder

On the NAS (via SSH or File Station):

```
/docker/wapi/
├── docker-compose.yml
├── .env
├── baileys/        (source from this repo)
├── fastapi/        (source from this repo)
├── auth/           (created automatically)
├── uploads/        (created automatically)
└── logs/           (created automatically)
```

Easiest way: `git clone` the project to `/docker/wapi`, or upload the project files
via File Station.

## 2. Install Container Manager

- **Package Center → Container Manager → Install** (DSM 7.2+). On older DSM install
  the "Docker" package instead.

## 3. Configure `.env`

```bash
cd /docker/wapi
cp .env.example .env
# edit .env (SSH with vim/nano, or edit in File Station with a text editor)
```

At minimum set a strong `API_KEY`.

## 4. Create the project in Container Manager

1. Open **Container Manager → Project**.
2. Click **Create** → name it `wapi`.
3. Set **Path** to `/docker/wapi` (the folder containing `docker-compose.yml`).
4. Container Manager auto-detects the compose file; leave the defaults and click
   **Next** → **Done**.

It now builds both images and starts the stack. Building the Baileys image takes a few
minutes on a NAS (it compiles the `libsignal` native module — normal).

> Alternative (advanced users): run `sudo docker compose up -d --build` over SSH.

## 5. Open the firewall port

**Control Panel → Security → Firewall → Edit rules**, and allow inbound TCP **2728**
(from your LAN, or from the internet if you intend to expose it).

Test: `http://<nas-ip>:2728/health` from your browser.

## 6. Scan the QR code

```
http://<nas-ip>:2728/qr.png
```

On your phone: **WhatsApp → Settings → Linked devices → Link a device** and scan.
Sessions survive reboots automatically (`auth/` persists on the NAS disk).

## 7. (Recommended) Add a reverse proxy with HTTPS

DSM has a built-in reverse proxy so you can reach the API at
`https://wa.yourdomain.com` with a valid certificate:

1. **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**.
2. Source: protocol **HTTPS**, port **443**, hostname `wa.yourdomain.com`.
3. Destination: protocol **HTTP**, port **2728**, hostname `localhost`.
4. Enable the Let's Encrypt certificate for the hostname.

Then open **Control Panel → Security → Firewall** and **close inbound 2728** so the
API is only reachable through the proxy. WAPI already honours `X-Forwarded-For` for
rate limiting and CORS can be restricted via `CORS_ORIGINS`.

## 8. Ensure auto-start after reboot

Container Manager starts containers with **restart policy** automatically when the
NAS boots (`restart: unless-stopped` is already in `docker-compose.yml`). Nothing else
to configure.

## 9. Backups

The only state that matters is `auth/` (your WhatsApp logins) and `.env`. Add them to
a Hyper Backup task, or:

```bash
sudo tar czf /volume1/backups/wapi-$(date +%F).tar.gz /docker/wapi/auth /docker/wapi/.env
```

Restore = put the folder back and `docker compose up -d` (or restart the project in
Container Manager).

## 10. Updates

In Container Manager: **Project → wapi → Action → Build** (rebuilds with the new
source), or over SSH:

```bash
cd /docker/wapi && git pull && sudo docker compose up -d --build
```

## Troubleshooting on Synology

| Symptom | Fix |
| --- | --- |
| Port 2728 not reachable | Enable the firewall rule (step 5); on some models also check **Control Panel → Security → Firewall → Enable** |
| Build fails with `g++`/`python` errors | The Baileys image needs build tools — this repo's Dockerfile installs them automatically; make sure you're using the supplied `baileys/Dockerfile` and have internet access during the first build |
| Slow builds / timeouts | First build downloads Node/apt packages; give it 10+ minutes; ensure the NAS has enough free RAM (4 GB+ recommended) |
| Containers restart in a loop | Check `docker compose logs baileys`; the health check has a 30 s start period — this is normal during the first seconds |
| ARM NAS | Images are multi-arch; the native `libsignal` module is compiled inside the container, so no manual steps |
| Can't write to `auth/` | File permissions: `sudo chown -R 0:0 /docker/wapi` (containers run as root) or use PUID/PGID of a NAS user |
