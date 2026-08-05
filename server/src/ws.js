import crypto from 'node:crypto';

// Minimal RFC 6455 WebSocket server implementation (text frames + control
// frames). No external dependencies; works with any standard client,
// including React Native's built-in WebSocket.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1024 * 1024; // 1 MiB

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (!key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
  );
  return new WsConnection(socket);
}

export class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = null; // { opcode, chunks: [] }
    this.closed = false;
    this.closeSent = false;
    this.isAlive = true;
    this.onmessage = null; // (text) => void
    this.onclose = null; // () => void

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this._teardown());
    socket.on('close', () => this._teardown());
    socket.on('end', () => this._teardown());
  }

  feed(head) {
    if (head && head.length) this._onData(head);
  }

  send(obj) {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    this._writeFrame(OP.TEXT, Buffer.from(text, 'utf8'));
  }

  ping() {
    this._writeFrame(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed || this.closeSent) return;
    this.closeSent = true;
    const r = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this._writeFrame(OP.CLOSE, payload);
    // Give the peer a moment to echo the close frame, then drop.
    setTimeout(() => this._teardown(), 1500);
  }

  terminate() {
    this._teardown();
  }

  _teardown() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {}
    if (this.onclose) this.onclose();
  }

  _writeFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this._teardown();
    }
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      this._parse();
    } catch {
      this.close(1002, 'protocol error');
    }
  }

  _parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) {
          this.close(1009, 'message too big');
          return;
        }
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) {
        this.close(1009, 'message too big');
        return;
      }
      // Clients must mask frames (RFC 6455 §5.1).
      if (!masked) {
        this.close(1002, 'client frames must be masked');
        return;
      }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + i] ^ mask[i & 3];
      this.buf = this.buf.subarray(off + len);

      switch (opcode) {
        case OP.TEXT:
        case OP.BIN:
          if (fin) {
            this._deliver(opcode, payload);
          } else {
            this.fragments = { opcode, chunks: [payload], size: payload.length };
          }
          break;
        case OP.CONT: {
          if (!this.fragments) {
            this.close(1002, 'unexpected continuation');
            return;
          }
          this.fragments.chunks.push(payload);
          this.fragments.size += payload.length;
          if (this.fragments.size > MAX_PAYLOAD) {
            this.close(1009, 'message too big');
            return;
          }
          if (fin) {
            const full = Buffer.concat(this.fragments.chunks);
            const op = this.fragments.opcode;
            this.fragments = null;
            this._deliver(op, full);
          }
          break;
        }
        case OP.PING:
          this._writeFrame(OP.PONG, payload);
          break;
        case OP.PONG:
          this.isAlive = true;
          break;
        case OP.CLOSE:
          if (!this.closeSent) {
            this.closeSent = true;
            this._writeFrame(OP.CLOSE, payload.subarray(0, 2));
          }
          this._teardown();
          return;
        default:
          this.close(1002, 'unknown opcode');
          return;
      }
    }
  }

  _deliver(opcode, payload) {
    this.isAlive = true;
    if (opcode === OP.TEXT && this.onmessage) {
      this.onmessage(payload.toString('utf8'));
    }
    // Binary messages are not used by the protocol; ignore them.
  }
}
