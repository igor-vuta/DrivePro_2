import { WS_URL } from './config';

// Small websocket client with auto-reconnect and a type-based listener bus.
// Server messages are JSON objects with a `type` field.

class WsClient {
  constructor() {
    this.ws = null;
    this.token = null;
    this.listeners = new Map(); // type -> Set<fn>; '*' receives everything
    this.connected = false;
    this.retry = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.manuallyClosed = false;
  }

  connect(token) {
    this.token = token;
    this.manuallyClosed = false;
    this._open();
  }

  disconnect() {
    this.manuallyClosed = true;
    this.token = null;
    this._cleanup();
    this._emit('connection', { connected: false });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => {
      const set = this.listeners.get(type);
      if (set) set.delete(fn);
    };
  }

  _open() {
    if (!this.token || this.manuallyClosed) return;
    this._cleanup(true);
    let ws;
    try {
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.token)}`);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this._emit('connection', { connected: true });
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type) this._emit(msg.type, msg);
      this._emit('*', msg);
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (wasConnected) this._emit('connection', { connected: false });
      if (!this.manuallyClosed) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.manuallyClosed || !this.token) return;
    const delay = Math.min(1000 * 2 ** this.retry, 10000);
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, delay);
  }

  _cleanup(keepToken) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch (e) {}
    }
    this.connected = false;
    if (!keepToken) this.retry = 0;
  }

  _emit(type, payload) {
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (e) {}
      }
    }
  }
}

export const wsClient = new WsClient();
