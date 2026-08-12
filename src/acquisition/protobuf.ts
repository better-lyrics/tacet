// -- Wire format ---------------------------------------------------------------

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const MAX_VARINT_BYTES = 10;

// -- Writing -------------------------------------------------------------------

type ProtoInput =
  | { number: number; varint: number | bigint }
  | { number: number; bytes: Uint8Array }
  | { number: number; text: string }
  | { number: number; message: readonly ProtoInput[] };

function asBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isInteger(value)) throw new Error(`a varint must be a whole number, got ${value}`);
  return BigInt(value);
}

function pushVarint(out: number[], value: bigint): void {
  if (value < 0n) throw new Error(`a varint cannot be negative, got ${value}`);
  let rest = value;
  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    out.push(rest > 0n ? byte | 0x80 : byte);
  } while (rest > 0n);
}

function pushTag(out: number[], number: number, wire: number): void {
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`a field number must be a positive whole number, got ${number}`);
  }
  pushVarint(out, (BigInt(number) << 3n) | BigInt(wire));
}

function pushLengthDelimited(out: number[], number: number, payload: Uint8Array): void {
  pushTag(out, number, WIRE_LENGTH_DELIMITED);
  pushVarint(out, BigInt(payload.length));
  for (const byte of payload) out.push(byte);
}

function pushField(out: number[], field: ProtoInput): void {
  if ("varint" in field) {
    pushTag(out, field.number, WIRE_VARINT);
    pushVarint(out, asBigInt(field.varint));
    return;
  }
  if ("bytes" in field) {
    pushLengthDelimited(out, field.number, field.bytes);
    return;
  }
  if ("text" in field) {
    pushLengthDelimited(out, field.number, new TextEncoder().encode(field.text));
    return;
  }
  pushLengthDelimited(out, field.number, encodeMessage(field.message));
}

function encodeMessage(fields: readonly ProtoInput[]): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const field of fields) pushField(out, field);
  return new Uint8Array(out);
}

// -- Reading -------------------------------------------------------------------

interface ProtoField {
  number: number;
  wire: number;
  varint: bigint | null;
  bytes: Uint8Array | null;
}

function readVarint(input: Uint8Array, at: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let index = at;
  for (let count = 0; count < MAX_VARINT_BYTES; count += 1) {
    if (index >= input.length) throw new Error(`a varint at ${at} runs past the end of ${input.length} bytes`);
    const byte = input[index];
    index += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: index };
    shift += 7n;
  }
  throw new Error(`a varint at ${at} is longer than ${MAX_VARINT_BYTES} bytes`);
}

function readMessage(input: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let at = 0;
  while (at < input.length) {
    const tag = readVarint(input, at);
    at = tag.next;
    const number = Number(tag.value >> 3n);
    const wire = Number(tag.value & 0x7n);
    if (number < 1) throw new Error(`field number ${number} at ${at} is not valid`);

    if (wire === WIRE_VARINT) {
      const read = readVarint(input, at);
      at = read.next;
      fields.push({ number, wire, varint: read.value, bytes: null });
      continue;
    }

    if (wire === WIRE_LENGTH_DELIMITED) {
      const size = readVarint(input, at);
      at = size.next;
      const end = at + Number(size.value);
      if (end > input.length) {
        throw new Error(`field ${number} claims ${size.value} bytes but only ${input.length - at} remain`);
      }
      fields.push({ number, wire, varint: null, bytes: input.subarray(at, end) });
      at = end;
      continue;
    }

    if (wire === WIRE_FIXED64 || wire === WIRE_FIXED32) {
      const width = wire === WIRE_FIXED64 ? 8 : 4;
      if (at + width > input.length) {
        throw new Error(`field ${number} needs ${width} fixed bytes but only ${input.length - at} remain`);
      }
      fields.push({ number, wire, varint: null, bytes: input.subarray(at, at + width) });
      at += width;
      continue;
    }

    throw new Error(`wire type ${wire} on field ${number} is not supported`);
  }
  return fields;
}

function allAt(fields: readonly ProtoField[], number: number): ProtoField[] {
  return fields.filter(field => field.number === number);
}

function fieldAt(fields: readonly ProtoField[], number: number): ProtoField | null {
  const matches = allAt(fields, number);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function varintAt(fields: readonly ProtoField[], number: number): bigint | null {
  return fieldAt(fields, number)?.varint ?? null;
}

function numberAt(fields: readonly ProtoField[], number: number): number | null {
  const value = varintAt(fields, number);
  return value === null ? null : Number(value);
}

function bytesAt(fields: readonly ProtoField[], number: number): Uint8Array | null {
  return fieldAt(fields, number)?.bytes ?? null;
}

function messageAt(fields: readonly ProtoField[], number: number): ProtoField[] | null {
  const payload = bytesAt(fields, number);
  return payload === null ? null : readMessage(payload);
}

function textAt(fields: readonly ProtoField[], number: number): string | null {
  const payload = bytesAt(fields, number);
  return payload === null ? null : new TextDecoder().decode(payload);
}

export {
  allAt,
  bytesAt,
  encodeMessage,
  fieldAt,
  messageAt,
  numberAt,
  readMessage,
  readVarint,
  textAt,
  varintAt,
  WIRE_FIXED32,
  WIRE_FIXED64,
  WIRE_LENGTH_DELIMITED,
  WIRE_VARINT,
};
export type { ProtoField, ProtoInput };
