import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_TEXT_MAX_OUTPUT_TOKENS,
  buildOpenAiTextDebugRequest,
  getOpenAiTextDefaultSettings,
  getOpenAiTextParameterDefinitions,
  isRunnableOpenAiTextModel,
  resolveOpenAiTextSettings,
} from "./openai-text-settings";

test("recognizes runnable OpenAI text models", () => {
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5.4"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5-mini"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5-nano"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-image-1.5"), false);
  assert.equal(isRunnableOpenAiTextModel("topaz", "gpt-5.4"), false);
});

test("exposes model-specific reasoning controls", () => {
  const gpt54ReasoningOptions = getOpenAiTextParameterDefinitions("gpt-5.4")
    .find((definition) => definition.key === "reasoningEffort")
    ?.options?.map((option) => option.value);
  const gpt5MiniReasoningOptions = getOpenAiTextParameterDefinitions("gpt-5-mini")
    .find((definition) => definition.key === "reasoningEffort")
    ?.options?.map((option) => option.value);

  assert.deepEqual(gpt54ReasoningOptions, ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(gpt5MiniReasoningOptions, ["minimal", "low", "medium", "high"]);
});

test("resolves defaults and prunes unsupported reasoning values on model switch", () => {
  assert.deepEqual(getOpenAiTextDefaultSettings("gpt-5.4"), {
    maxOutputTokens: null,
    verbosity: "medium",
    outputFormat: "text",
    reasoningEffort: "none",
    jsonSchemaName: "",
    jsonSchemaDefinition: "",
  });

  const switched = resolveOpenAiTextSettings(
    {
      maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS + 500,
      verbosity: "high",
      outputFormat: "text",
      reasoningEffort: "xhigh",
      jsonSchemaName: "stale_schema",
      jsonSchemaDefinition: '{"type":"object"}',
    },
    "gpt-5-mini"
  );

  assert.equal(switched.maxOutputTokens, OPENAI_TEXT_MAX_OUTPUT_TOKENS);
  assert.equal(switched.reasoningEffort, "minimal");
  assert.deepEqual(switched.effectiveSettings, {
    maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS,
    verbosity: "high",
    outputFormat: "text",
    reasoningEffort: "minimal",
  });
});

test("validates JSON schema output settings", () => {
  const missingSchemaName = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaDefinition: '{"type":"object"}',
    },
    "gpt-5.4"
  );
  assert.equal(missingSchemaName.validationError, "Schema name is required for JSON Schema output.");

  const invalidSchemaJson = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaName: "prompt_output",
      jsonSchemaDefinition: "{bad json}",
    },
    "gpt-5.4"
  );
  assert.equal(invalidSchemaJson.validationError, "Schema JSON must be valid JSON.");

  const validSchema = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaName: "prompt_output",
      jsonSchemaDefinition: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
    },
    "gpt-5.4"
  );
  assert.equal(validSchema.validationError, null);
  assert.deepEqual(validSchema.parsedJsonSchema, {
    type: "object",
    properties: {
      prompt: {
        type: "string",
      },
    },
    required: ["prompt"],
  });
});

test("builds a Responses API preview request from resolved text settings", () => {
  const debugRequest = buildOpenAiTextDebugRequest({
    modelId: "gpt-5.4",
    prompt: "Return a JSON object with one image prompt.",
    rawSettings: {
      maxOutputTokens: 2048,
      verbosity: "low",
      outputFormat: "json_object",
      reasoningEffort: "high",
    },
  });

  assert.equal(debugRequest.endpoint, "client.responses.create");
  assert.equal(debugRequest.validationError, null);
  assert.deepEqual(debugRequest.request, {
    model: "gpt-5.4",
    input: "Return a JSON object with one image prompt.",
    reasoning: {
      effort: "high",
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_object",
      },
    },
    max_output_tokens: 2048,
  });
});
