import { describe, it, expect } from "vitest";
import { BufferReader } from "../buffer-reader.js";

describe("BufferReader", () => {
  it("reads UInt8", () => {
    const buf = Buffer.from([0x42, 0xff]);
    const r = new BufferReader(buf);
    expect(r.readUInt8()).toBe(0x42);
    expect(r.readUInt8()).toBe(0xff);
  });

  it("reads Int16 big-endian", () => {
    const buf = Buffer.allocUnsafe(2);
    buf.writeInt16BE(-1000, 0);
    const r = new BufferReader(buf);
    expect(r.readInt16()).toBe(-1000);
  });

  it("reads UInt32 big-endian", () => {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32BE(0xdeadbeef, 0);
    const r = new BufferReader(buf);
    expect(r.readUInt32()).toBe(0xdeadbeef);
  });

  it("reads BigUInt64 big-endian", () => {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64BE(BigInt("0x0102030405060708"), 0);
    const r = new BufferReader(buf);
    expect(r.readBigUInt64()).toBe(BigInt("0x0102030405060708"));
  });

  it("reads null-terminated C string", () => {
    const str = "hello";
    const buf = Buffer.concat([Buffer.from(str + "\0", "utf8"), Buffer.from([0xaa])]);
    const r = new BufferReader(buf);
    expect(r.readCString()).toBe("hello");
    expect(r.readUInt8()).toBe(0xaa); // next byte follows immediately
  });

  it("reads an empty C string", () => {
    const buf = Buffer.from([0x00]);
    const r = new BufferReader(buf);
    expect(r.readCString()).toBe("");
  });

  it("reads raw bytes", () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const r = new BufferReader(buf);
    expect(r.readBytes(2)).toEqual(Buffer.from([0x01, 0x02]));
    expect(r.position).toBe(2);
  });

  it("tracks position correctly through multiple reads", () => {
    const buf = Buffer.from([0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03]);
    const r = new BufferReader(buf);
    r.readUInt8(); // 1 byte
    r.readInt16(); // 2 bytes
    r.readUInt32(); // 4 bytes (reads to end - 0 extra)
    expect(r.position).toBe(7);
    expect(r.hasMore()).toBe(false);
  });

  it("hasMore returns false when exhausted", () => {
    const buf = Buffer.from([0x01]);
    const r = new BufferReader(buf);
    r.readUInt8();
    expect(r.hasMore()).toBe(false);
  });

  it("supports start offset", () => {
    const buf = Buffer.from([0xff, 0x01, 0x02]);
    const r = new BufferReader(buf, 1); // start at byte 1
    expect(r.readUInt8()).toBe(0x01);
    expect(r.readUInt8()).toBe(0x02);
  });
});
