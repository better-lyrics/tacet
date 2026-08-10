// -- Model variants ------------------------------------------------------------

type ModelVariant = "fp32" | "fp16";

interface ModelDescriptor {
  variant: ModelVariant;
  filename: string;
  sha256: string;
  approxBytes: number;
}

const MODELS: Record<ModelVariant, ModelDescriptor> = {
  fp32: {
    variant: "fp32",
    filename: "htdemucs_fp32.v1.onnx",
    sha256: "47a8c4169cbc08550c7ac1aa6e525b480ccd091efdbd21ffbb88f5f60566d3bd",
    approxBytes: 170_807_563,
  },
  fp16: {
    variant: "fp16",
    filename: "htdemucs_fp16.v2.onnx",
    sha256: "4ee2df213fe36dd2ff36021b8426754322d2ac89ac15253a84c4066b04bb2182",
    approxBytes: 86_675_238,
  },
};

const MODEL_VARIANTS: readonly ModelVariant[] = ["fp32", "fp16"];

const DEFAULT_MODEL_VARIANT: ModelVariant = "fp32";

const DEFAULT_MODEL_BASE_URL = "https://models.betterlyrics.org/tacet";

function isModelVariant(value: unknown): value is ModelVariant {
  return value === "fp32" || value === "fp16";
}

function getModelBaseUrl(): string {
  const raw = typeof process === "undefined" ? undefined : process.env.PLASMO_PUBLIC_MODEL_BASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_MODEL_BASE_URL;
}

function getModelDescriptor(variant: ModelVariant = DEFAULT_MODEL_VARIANT): ModelDescriptor {
  return MODELS[variant] ?? MODELS[DEFAULT_MODEL_VARIANT];
}

function getModelUrl(variant: ModelVariant = DEFAULT_MODEL_VARIANT): string {
  return `${getModelBaseUrl()}/${getModelDescriptor(variant).filename}`;
}

function getModelSha256(variant: ModelVariant = DEFAULT_MODEL_VARIANT): string {
  return getModelDescriptor(variant).sha256;
}

export {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_VARIANT,
  MODEL_VARIANTS,
  getModelDescriptor,
  getModelSha256,
  getModelUrl,
  isModelVariant,
};
export type { ModelDescriptor, ModelVariant };
