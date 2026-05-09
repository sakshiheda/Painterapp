import { Platform } from 'react-native';

/**
 * Tiny wrapper around fetch that prepends the base URL and the API key.
 */
export function createApiClient({ apiBaseUrl, apiKey }) {
  if (!apiBaseUrl) throw new Error('API base URL not configured');

  const base = apiBaseUrl.replace(/\/+$/, '');

  async function request(path, options = {}) {
    const headers = {
      Accept: 'application/json',
      'x-api-key': apiKey || '',
      ...(options.headers || {}),
    };
    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options = { ...options, body: JSON.stringify(options.body) };
    }
    const url = `${base}${path}`;
    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (e) {
      throw new Error(`Network error contacting ${url}: ${e.message}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) {
      const msg = (body && body.message) || (typeof body === 'string' && body) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function uploadCapture({
    photoUri,
    latitude,
    longitude,
    altitude,
    accuracyM,
    altitudeAccuracyM,
    mocked,
    gpsTimestamp,
    gpsProvider,
    gpsFixCount,
    takenAt,
    deviceInfo,
  }) {
    const form = new FormData();
    // React Native FormData file shape
    const filename = photoUri.split('/').pop() || `photo-${Date.now()}.jpg`;
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    form.append('image', {
      uri: Platform.OS === 'ios' ? photoUri.replace('file://', '') : photoUri,
      name: filename,
      type: mime,
    });
    if (latitude != null) form.append('latitude', String(latitude));
    if (longitude != null) form.append('longitude', String(longitude));
    if (altitude != null) form.append('altitude', String(altitude));
    if (accuracyM != null) form.append('accuracyM', String(accuracyM));
    if (altitudeAccuracyM != null) form.append('altitudeAccuracyM', String(altitudeAccuracyM));
    if (mocked != null) form.append('mocked', mocked ? 'true' : 'false');
    if (gpsTimestamp) form.append('gpsTimestamp', String(gpsTimestamp));
    if (gpsProvider) form.append('gpsProvider', String(gpsProvider));
    if (gpsFixCount != null) form.append('gpsFixCount', String(gpsFixCount));
    if (takenAt) form.append('takenAt', takenAt);
    if (deviceInfo) form.append('deviceInfo', deviceInfo);

    return request('/api/v1/captures', { method: 'POST', body: form });
  }

  function calibrate(captureId, payload) {
    return request(`/api/v1/captures/${captureId}/calibrate`, {
      method: 'POST',
      body: payload,
    });
  }

  // Perspective-correct calibration. Payload:
  //   { tl, tr, br, bl, widthCm, heightCm }
  // where each corner is { x, y } in image-pixel coords.
  function calibrateRect(captureId, payload) {
    return request(`/api/v1/captures/${captureId}/calibrate-rect`, {
      method: 'POST',
      body: payload,
    });
  }

  // Re-run server-side QR auto-detection for a previously uploaded capture.
  // Useful when the photo was taken before the user printed the marker, or
  // when retrying with a clearer image.
  function detectMarker(captureId) {
    return request(`/api/v1/captures/${captureId}/detect-marker`, {
      method: 'POST',
      body: {},
    });
  }

  function measure(captureId, polygon) {
    return request(`/api/v1/captures/${captureId}/measure`, {
      method: 'POST',
      body: { polygon },
    });
  }

  function ping() {
    return request('/healthz', { method: 'GET' });
  }

  return { request, uploadCapture, calibrate, calibrateRect, detectMarker, measure, ping, baseUrl: base };
}
