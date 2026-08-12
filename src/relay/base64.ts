const BINARY_STRING_CHUNK_SIZE = 8192;

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BINARY_STRING_CHUNK_SIZE) {
    const slice = bytes.subarray(offset, offset + BINARY_STRING_CHUNK_SIZE);
    binary += String.fromCharCode(...slice);
  }
  return binary;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.toBase64) return bytes.toBase64();
  return btoa(bytesToBinaryString(bytes));
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const standard = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = standard.length % 4;
  return base64ToBytes(remainder === 0 ? standard : standard + "=".repeat(4 - remainder));
}

export { bytesToBase64, base64ToBytes, base64UrlToBytes };
