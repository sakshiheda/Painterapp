# PainterApp Measurement API

A small, hardened REST service that:

1. **Stores geo-tagged photos** uploaded from any client (mobile, browser, server).
2. **Calibrates** each photo to a real-world scale via a 2-point reference.
3. Lets clients **draw a polygon** over any region of the photo and returns:
   - Each side length (cm, ft, m)
   - Total perimeter
   - Total area (cm², ft², m²)
   - The lat/long where the photo was taken

Designed to be re-used by multiple downstream apps (painters, surveyors, real-estate, signage, etc.)

---

## Run locally

```powershell
cd api
npm install
copy .env.example .env
# (edit .env if you like — at minimum change API_KEYS)
npm run dev      # http://localhost:4000
npm test         # geometry unit tests
```

Health check: `GET http://localhost:4000/healthz` → `{ "status": "ok" }`

## Auth

Every `/api/*` route requires an API key. Pass it as **either**:

```
x-api-key: <your-key>
Authorization: Bearer <your-key>
```

Configure keys in `.env` via `API_KEYS=key1,key2,key3`. The server refuses to boot if no keys are set.

---

## Endpoints (v1)

Base path: `/api/v1`

### `POST /captures`  — upload a photo

`multipart/form-data`:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `image` | file | yes | jpeg/png/heic/heif/webp, ≤ 15 MB by default |
| `latitude` | number | no | decimal degrees, client GPS preferred over EXIF |
| `longitude` | number | no | |
| `altitude` | number | no | metres |
| `takenAt` | string | no | ISO timestamp |
| `deviceInfo` | string | no | free-form (e.g. `"iPhone 14 Pro"`) |

Response `201`:

```json
{
  "capture": {
    "id": "Kp9X1aB2cD3eFg",
    "width": 4032,
    "height": 3024,
    "location": { "latitude": 19.0760, "longitude": 72.8777, "altitude": 14, "source": "client" },
    "takenAt": "2026-05-08T10:14:33.000Z",
    "createdAt": "2026-05-08 10:14:34",
    "calibration": null,
    "imageUrl": "/api/v1/captures/Kp9X1aB2cD3eFg/image"
  }
}
```

### `POST /captures/:id/calibrate` — set the scale

```json
{
  "p1": { "x": 1450, "y": 2010 },
  "p2": { "x": 2330, "y": 2018 },
  "realLength": 100,
  "unit": "cm"
}
```

Units accepted: `mm`, `cm`, `m`, `in`, `ft`. Returns the capture with `calibration.pxPerCm` set.

### `POST /captures/:id/measure` — measure a polygon

```json
{
  "polygon": [
    { "x": 200, "y": 300 },
    { "x": 1800, "y": 280 },
    { "x": 1820, "y": 1500 },
    { "x": 220, "y": 1480 }
  ]
}
```

Response `201`:

```json
{
  "measurement": {
    "id": "Q3rT6vY8nP1m",
    "captureId": "Kp9X1aB2cD3eFg",
    "location": { "latitude": 19.0760, "longitude": 72.8777, "altitude": 14, "source": "client" },
    "polygon": [ ... ],
    "pointCount": 4,
    "perimeter": { "cm": 568.42, "ft": 18.65, "m": 5.684 },
    "area":      { "cm2": 19834.5, "ft2": 21.351, "m2": 1.9835 },
    "sides": [
      { "index": 0, "from": {"x":200,"y":300}, "to": {"x":1800,"y":280}, "lengthPx": 1600.12, "lengthCm": 160.01, "lengthFt": 5.249, "lengthM": 1.6 },
      ...
    ]
  }
}
```

### Other endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/captures` | List recent captures (`?limit=` up to 200) |
| `GET` | `/captures/:id` | Get a single capture |
| `GET` | `/captures/:id/image` | Download the original photo |
| `GET` | `/captures/:id/measurements` | List all measurements for a capture |
| `DELETE` | `/captures/:id` | Delete capture + image + measurements |

---

## Security

- API key auth on every `/api/*` route
- `helmet` security headers, CORS allowlist (`CORS_ORIGINS`)
- Rate limit per IP (`RATE_LIMIT_*` env vars)
- Multer file-size limit (`MAX_UPLOAD_MB`) and MIME-type allowlist
- Path-traversal-safe file serving (uploads served by id, not filename)
- Zod schema validation on every JSON body
- All polygon / calibration points are bounds-checked against image dimensions

---

## Cloud deployment

The API is a single stateless container plus two persistent folders (`uploads/`, `data/`).

### Docker

```powershell
cd api
docker build -t painterapp-api .
docker run --rm -p 4000:4000 `
  -e API_KEYS=prod-key-1,prod-key-2 `
  -e CORS_ORIGINS=https://yourapp.com `
  -v ${PWD}/uploads:/app/uploads `
  -v ${PWD}/data:/app/data `
  painterapp-api
```

### Render / Railway / Fly.io / Azure App Service

1. Push this repo to GitHub.
2. Point the platform at `api/Dockerfile` (or `api/` as the root for buildpacks — Node 18+).
3. Set environment variables (at minimum `API_KEYS`, optionally `CORS_ORIGINS`).
4. Mount a persistent disk on `/app/uploads` and `/app/data` (or switch the storage layer to S3/R2 if you expect large volume — see "Scaling" below).
5. Health check path: `/healthz`.

### AWS / GCP

Either run the Docker image on ECS Fargate / Cloud Run, or use a small VM. For Cloud Run, replace the SQLite + local disk storage with Cloud Storage + Firestore if you need horizontal autoscaling.

### Scaling notes

- Default storage is a **single JSON file + local image folder** — zero native dependencies, perfect for single-instance deployments and easy backups (just copy `data/painterapp.json` and `uploads/`).
- For multi-instance / serverless, swap the implementation in [src/db.js](src/db.js) for a managed DB (Postgres, Mongo, Firestore) and the upload folder for object storage (S3/GCS/R2). The route layer doesn't change — only the storage layer.

---

## Project layout

```
api/
├── src/
│   ├── server.js              # Express bootstrap
│   ├── config.js              # env parsing
│   ├── db.js                  # JSON file store (atomic writes)
│   ├── routes/
│   │   └── captures.js        # all v1 endpoints
│   ├── services/
│   │   ├── geometry.js        # pure math (unit-tested)
│   │   └── image.js           # EXIF + sharp metadata
│   └── middleware/
│       ├── auth.js            # API key
│       ├── upload.js          # multer
│       └── errors.js          # 404 + error handler
├── test/
│   └── geometry.test.js       # node --test
├── Dockerfile
└── .env.example
```
