# Deploy PainterApp API

The API runs as a single Docker container with two persistent folders (`/app/uploads`, `/app/data`). Pick one platform below — all of them give you a public HTTPS URL in a few minutes.

---

## Option 1 — Render (easiest, free tier, push-to-deploy) ⭐ recommended

**One-time setup**

1. Push this repo to GitHub:
   ```powershell
   cd d:\PainterApp
   git init
   git add .
   git commit -m "Initial commit"
   # create an empty repo on github.com first, then:
   git remote add origin https://github.com/<your-username>/PainterApp.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New ▸ Blueprint**.
3. Connect the GitHub repo. Render reads [render.yaml](render.yaml), provisions the service + 1 GB disk, and generates a fresh `API_KEYS` secret.
4. Wait ~3 min for the first deploy. Your URL will be `https://painterapp-api-XXXX.onrender.com`.

**Get your API key**

In the Render dashboard → your service → **Environment** → reveal `API_KEYS`. Copy it.

**Test it**
```powershell
$base = "https://painterapp-api-XXXX.onrender.com"
$key  = "<paste-from-render>"
Invoke-RestMethod -Uri "$base/healthz"
Invoke-RestMethod -Uri "$base/api/v1/captures" -Headers @{ "x-api-key" = $key }
```

> Free tier note: Render free services sleep after 15 min of inactivity. First request after sleep takes ~30 s. Upgrade to **Starter ($7/mo)** for always-on.

---

## Option 2 — Fly.io (always-on free allowance, single command)

```powershell
# 1. Install flyctl (one time)
iwr https://fly.io/install.ps1 -useb | iex

# 2. Sign up / log in
fly auth signup        # or: fly auth login

# 3. Deploy
cd d:\PainterApp\api
fly launch --copy-config --no-deploy        # press Enter to all prompts
fly volumes create painterapp_data --region iad --size 1
fly secrets set API_KEYS="$(-join ((48..57)+(97..122) | Get-Random -Count 32 | %{[char]$_}))"
fly deploy
```

Your URL will be `https://painterapp-api.fly.dev`. The `API_KEYS` secret is set above — store the value somewhere safe.

---

## Option 3 — Railway

1. Push to GitHub (same as Render step 1).
2. Go to [railway.app](https://railway.app) → **New Project ▸ Deploy from GitHub repo**.
3. Railway picks up [railway.json](railway.json) and [api/Dockerfile](api/Dockerfile) automatically.
4. In **Variables**, add `API_KEYS=<a-secret-string>`.
5. **Settings ▸ Volumes**: add a volume mounted at `/app` (1 GB).
6. Click **Deploy**.

---

## Option 4 — Run anywhere with Docker

```powershell
cd d:\PainterApp\api
docker build -t painterapp-api .
docker run -d --restart=always -p 4000:4000 `
  -e API_KEYS=your-prod-key-1,your-prod-key-2 `
  -e CORS_ORIGINS=https://yourapp.com `
  -v painterapp_uploads:/app/uploads `
  -v painterapp_data:/app/data `
  --name painterapp-api `
  painterapp-api
```

Works on any VPS (DigitalOcean, Linode, Hetzner, AWS Lightsail, your own home server, etc.). Put it behind nginx/Caddy for HTTPS.

A pre-built image is published by [.github/workflows/api-image.yml](.github/workflows/api-image.yml) once you push to GitHub:
```
ghcr.io/<your-username>/painterapp-api:latest
```

---

## Once deployed — point the mobile app at it

In the Expo app on your phone, open **API Settings**:

| Field | Value |
| --- | --- |
| API base URL | `https://painterapp-api-XXXX.onrender.com` (or your fly.dev / railway.app URL) |
| API key | the value of `API_KEYS` from your platform dashboard |

Tap **Test connection** → expect *"Connected"*.

That same URL + key now works in **all your other projects** — drop a few `fetch()` calls in any web/mobile/server app and you have measurement-as-a-service.

---

## Production checklist

- [ ] `API_KEYS` is **not** the example value — generate a long random string per consumer.
- [ ] `CORS_ORIGINS` is set to the exact origin(s) of your downstream apps (no `*`).
- [ ] Persistent volume is mounted on `/app` (or separate volumes on `/app/uploads` and `/app/data`).
- [ ] Health-check path is `/healthz` (already configured in all sample files).
- [ ] If you expect heavy traffic, swap the local JSON store for Postgres + S3-compatible object storage. Only [api/src/db.js](api/src/db.js) and [api/src/services/image.js](api/src/services/image.js) need to change — the route layer stays the same.
