import { API_URL } from './config';
import { t } from './i18n';

export async function api(method, path, body, token) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error(t('err.network', { url: API_URL })), { code: 'network' });
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // non-JSON response
  }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Request failed (${res.status})`);
    err.status = res.status;
    if (json && json.code) err.code = json.code;
    err.data = json;
    throw err;
  }
  return json;
}
