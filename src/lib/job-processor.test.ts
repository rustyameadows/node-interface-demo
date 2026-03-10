import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneratedTextResultFromOutputs } from "@/lib/server/job-processor";
import type { NormalizedOutput } from "@/lib/types";

test("buildGeneratedTextResultFromOutputs parses smart text from mixed image jobs", () => {
  const outputs: NormalizedOutput[] = [
    {
      type: "image",
      mimeType: "image/png",
      extension: "png",
      encoding: "binary",
      metadata: {
        outputIndex: 0,
      },
      content: Buffer.from("png"),
    },
    {
      type: "text",
      mimeType: "application/json",
      extension: "json",
      encoding: "utf-8",
      metadata: {
        outputIndex: 1,
        textOutputTarget: "smart",
      },
      content: JSON.stringify({
        nodes: [
          {
            id: "tweet",
            kind: "text-note",
            label: "Tweet",
            text: "Mars cave flower discovered.",
            columns: null,
            rows: null,
            templateText: null,
          },
        ],
        connections: [],
      }),
    },
  ];

  const result = buildGeneratedTextResultFromOutputs({
    outputs,
    fallbackTextOutputTarget: "note",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });

  assert.equal(result.textOutputTarget, "smart");
  assert.equal(result.textOutputs.length, 1);
  assert.equal(result.textOutputs[0]?.outputIndex, 1);
  assert.equal(result.generatedNodeDescriptorResult?.generatedNodeDescriptors.length, 1);
  assert.deepEqual(
    result.generatedNodeDescriptorResult?.generatedNodeDescriptors.map((descriptor) => descriptor.kind),
    ["text-note"]
  );
});
