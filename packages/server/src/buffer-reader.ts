/**
 * Utility for reading binary data from a Buffer with a cursor.
 * Used by the pgoutput message parser.
 */
export class BufferReader {
  private pos: number;

  constructor(
    private readonly buf: Buffer,
    start = 0,
  ) {
    this.pos = start;
  }

  readUInt8(): number {
    const val = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return val;
  }

  readInt16(): number {
    const val = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return val;
  }

  readUInt32(): number {
    const val = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return val;
  }

  readBigUInt64(): bigint {
    const val = this.buf.readBigUInt64BE(this.pos);
    this.pos += 8;
    return val;
  }

  /** Read a null-terminated UTF-8 string */
  readCString(): string {
    let end = this.pos;
    while (end < this.buf.length && this.buf[end] !== 0) end++;
    const str = this.buf.subarray(this.pos, end).toString("utf8");
    this.pos = end + 1; // skip null terminator
    return str;
  }

  readBytes(n: number): Buffer {
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  get position(): number {
    return this.pos;
  }

  hasMore(): boolean {
    return this.pos < this.buf.length;
  }
}
