import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_VARIANT,
  MODEL_VARIANTS,
  getModelDescriptor,
  getModelSha256,
  getModelUrl,
  isModelVariant,
} from "@/cache/model-url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEY = "PLASMO_PUBLIC_MODEL_BASE_URL";
let original: string | undefined;

const FP32_FILENAME = getModelDescriptor("fp32").filename;
const FP16_FILENAME = getModelDescriptor("fp16").filename;

beforeEach(() => {
  original = process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("getModelUrl", () => {
  it("appends the model filename to the configured base url", () => {
    process.env[ENV_KEY] = "https://models.example.com";
    expect(getModelUrl()).toBe(`https://models.example.com/${FP32_FILENAME}`);
  });

  it("strips a trailing slash from the base url before appending", () => {
    process.env[ENV_KEY] = "https://models.example.com/";
    expect(getModelUrl()).toBe(`https://models.example.com/${FP32_FILENAME}`);
  });

  it("trims surrounding whitespace", () => {
    process.env[ENV_KEY] = "  https://models.example.com  ";
    expect(getModelUrl()).toBe(`https://models.example.com/${FP32_FILENAME}`);
  });

  it("serves a different file for each variant from one base url", () => {
    process.env[ENV_KEY] = "https://models.example.com";
    expect(getModelUrl("fp32")).toBe(`https://models.example.com/${FP32_FILENAME}`);
    expect(getModelUrl("fp16")).toBe(`https://models.example.com/${FP16_FILENAME}`);
  });

  describe("edge cases", () => {
    it("falls back to the default host when the env var is unset", () => {
      delete process.env[ENV_KEY];
      expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${FP32_FILENAME}`);
    });

    it("falls back to the default host when the env var is empty", () => {
      process.env[ENV_KEY] = "   ";
      expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${FP32_FILENAME}`);
    });
  });

  describe("regressions", () => {
    it("regression: resolves where process does not exist, as in the offscreen document", () => {
      const globals = globalThis as { process?: NodeJS.Process };
      const saved = globals.process;
      globals.process = undefined;
      try {
        expect(getModelUrl()).toBe(`${DEFAULT_MODEL_BASE_URL}/${FP32_FILENAME}`);
        expect(getModelUrl("fp16")).toBe(`${DEFAULT_MODEL_BASE_URL}/${FP16_FILENAME}`);
      } finally {
        globals.process = saved;
      }
    });
  });
});

describe("model registry", () => {
  it("defaults to the full precision model", () => {
    expect(DEFAULT_MODEL_VARIANT).toBe("fp32");
  });

  it("lists every variant it can describe", () => {
    expect([...MODEL_VARIANTS].sort()).toEqual(["fp16", "fp32"]);
    for (const variant of MODEL_VARIANTS) expect(getModelDescriptor(variant).variant).toBe(variant);
  });

  it("pairs every variant with its own file and digest", () => {
    expect(FP16_FILENAME).not.toBe(FP32_FILENAME);
    expect(getModelSha256("fp16")).not.toBe(getModelSha256("fp32"));
  });

  it("carries a full 64 character sha256 for every variant", () => {
    for (const variant of MODEL_VARIANTS) expect(getModelSha256(variant)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports the half precision model as roughly half the size", () => {
    const fp32 = getModelDescriptor("fp32").approxBytes;
    const fp16 = getModelDescriptor("fp16").approxBytes;
    expect(fp16).toBeLessThan(fp32);
    expect(fp16 / fp32).toBeGreaterThan(0.4);
    expect(fp16 / fp32).toBeLessThan(0.6);
  });
});

describe("isModelVariant", () => {
  it("accepts the known variants", () => {
    expect(isModelVariant("fp32")).toBe(true);
    expect(isModelVariant("fp16")).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects anything else", () => {
      for (const value of ["fp8", "", null, undefined, 16, {}, ["fp16"]]) {
        expect(isModelVariant(value)).toBe(false);
      }
    });
  });
});

describe("invariants", () => {
  it("falls back to the default descriptor for an unknown variant", () => {
    const unknown = "fp8" as unknown as Parameters<typeof getModelDescriptor>[0];
    expect(getModelDescriptor(unknown).variant).toBe(DEFAULT_MODEL_VARIANT);
  });

  it("keeps the digest and the url describing the same file", () => {
    process.env[ENV_KEY] = "https://models.example.com";
    for (const variant of MODEL_VARIANTS) {
      expect(getModelUrl(variant).endsWith(getModelDescriptor(variant).filename)).toBe(true);
      expect(getModelSha256(variant)).toBe(getModelDescriptor(variant).sha256);
    }
  });
});
