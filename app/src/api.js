import { API_URL } from './config';

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
    throw new Error(`Can't reach the server at ${API_URL}. Is it running?`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // non-JSON response
  }
  if (!res.ok) {
    throw new Error((json && json.error) || `Request failed (${res.status})`);
  }
  return json;
}
