import { z } from "zod";
import type { JobRunOrigin, ProviderId, WorkflowNode } from "@/components/workspace/types";
import { getSpawnableNodeCatalogSummaries } from "@/lib/node-catalog";
import {
  createGeneratedModelListSettings,
  createGeneratedModelTextNoteSettings,
  createGeneratedModelTextTemplateSettings,
  normalizeTemplateDisplayLabel,
} from "@/lib/list-template";
import type { OpenAiTextOutputTarget } from "@/lib/text-output-targets";

export type GeneratedNodeKind = "text-note" | "list" | "text-template";

type GeneratedNodeDescriptorBase = {
  descriptorId: string;
  kind: GeneratedNodeKind;
  label: string;
  sourceJobId: string;
  sourceModelNodeId: string | null;
  outputIndex: number;
  descriptorIndex: number;
  runOrigin: JobRunOrigin;
};

export type GeneratedTextNoteDescriptor = GeneratedNodeDescriptorBase & {
  kind: "text-note";
  text: string;
};

export type GeneratedListNodeDescriptor = GeneratedNodeDescriptorBase & {
  kind: "list";
  columns: string[];
  rows: string[][];
};

export type GeneratedTextTemplateDescriptor = GeneratedNodeDescriptorBase & {
  kind: "text-template";
  templateText: string;
};

export type GeneratedNodeDescriptor =
  | GeneratedTextNoteDescriptor
  | GeneratedListNodeDescriptor
  | GeneratedTextTemplateDescriptor;

export type GeneratedConnectionDescriptor = {
  kind: "input" | "prompt";
  sourceDescriptorId: string;
  targetDescriptorId: string;
};

export function shouldConnectGeneratedDescriptorToSourceModel(input: {
  descriptorId: string;
  generatedConnections?: GeneratedConnectionDescriptor[] | null;
  runOrigin: JobRunOrigin;
}) {
  if (input.runOrigin === "copilot") {
    return false;
  }

  return !(input.generatedConnections || []).some(
    (connection) => connection.targetDescriptorId === input.descriptorId
  );
}

type StructuredParseInput = {
  textOutputTarget: OpenAiTextOutputTarget;
  content: string;
  sourceJobId: string;
  sourceModelNodeId?: string | null;
  outputIndex?: number;
  runOrigin?: JobRunOrigin;
};

export type StructuredParseResult = {
  generatedNodeDescriptors: GeneratedNodeDescriptor[];
  generatedConnections: GeneratedConnectionDescriptor[];
  warning: string | null;
};

type DescriptorSeed =
  | {
      id: string;
      kind: "text-note";
      label: string;
      text: string;
    }
  | {
      id: string;
      kind: "list";
      label: string;
      columns: string[];
      rows: string[][];
    }
  | {
      id: string;
      kind: "text-template";
      label: string;
      templateText: string;
    };

const textNoteDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.literal("text-note"),
  label: z.string().trim().min(1).max(120),
  text: z.string(),
});

const listDescriptorSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("list"),
    label: z.string().trim().min(1).max(120),
    columns: z.array(z.string().trim().min(1).max(120)).min(1),
    rows: z.array(z.array(z.string())),
  })
  .superRefine((value, ctx) => {
    value.rows.forEach((row, rowIndex) => {
      if (row.length !== value.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${rowIndex + 1} must contain exactly ${value.columns.length} value(s).`,
        });
      }
    });
  });

const textTemplateDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.literal("text-template"),
  label: z.string().trim().min(1).max(120),
  templateText: z.string().min(1),
});

const generatedConnectionDescriptorSchema = z.object({
  kind: z.enum(["input", "prompt"]),
  sourceDescriptorId: z.string().trim().min(1).max(80),
  targetDescriptorId: z.string().trim().min(1).max(80),
});

const smartOutputSchema = z
  .object({
    nodes: z.array(z.union([textNoteDescriptorSchema, listDescriptorSchema, textTemplateDescriptorSchema])).min(1),
    connections: z.array(generatedConnectionDescriptorSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const seenIds = new Set<string>();
    value.nodes.forEach((node, index) => {
      if (seenIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node id "${node.id}" must be unique.`,
          path: ["nodes", index, "id"],
        });
        return;
      }
      seenIds.add(node.id);
    });
  });

const singleBracketPlaceholderPattern = /\[(?!\[)\s*([^[\]]+?)\s*\](?!\])/g;

function getDefaultGeneratedDescriptorId(outputIndex: number, descriptorIndex: number) {
  return `generated-${outputIndex}-${descriptorIndex}`;
}

function descriptorSeedToDescriptor(
  seed: DescriptorSeed,
  provenance: {
    sourceJobId: string;
    sourceModelNodeId: string | null;
    outputIndex: number;
    descriptorIndex: number;
    runOrigin: JobRunOrigin;
  }
): GeneratedNodeDescriptor {
  const descriptorBase = {
    descriptorId: seed.id,
    kind: seed.kind,
    label: seed.label,
    ...provenance,
  } as const;

  if (seed.kind === "text-template") {
    return {
      ...descriptorBase,
      templateText: normalizeGeneratedTemplateText(seed.templateText),
    };
  }

  if (seed.kind === "list") {
    return {
      ...descriptorBase,
      columns: seed.columns,
      rows: seed.rows,
    };
  }

  return {
    ...descriptorBase,
    text: seed.text,
  };
}

function normalizeGeneratedTemplateText(templateText: string) {
  return templateText.replace(singleBracketPlaceholderPattern, (_match, rawLabel: string) => {
    const label = normalizeTemplateDisplayLabel(String(rawLabel ?? ""));
    return label ? `[[${label}]]` : _match;
  });
}

function buildSmartOutputInstructions() {
  const summaries = getSpawnableNodeCatalogSummaries();
  const allowedKinds = summaries.map((summary) => summary.kind).join(", ");
  const generalRules = summaries.map((summary) => `${summary.kind}: ${summary.promptSummary}`).join(" ");
  const payloadRules = summaries.map((summary) => summary.payloadSummary).join(" ");

  return `Respond with JSON only. Generate the set of nodes that best fulfills the user's request. If the user gives specific instructions about what nodes to create, follow those instructions first. Apply the general rules below only when the user has not already made the desired node types clear. Allowed kinds are ${allowedKinds}. You may return one node or many. Create only the node types that are actually useful for the request. Do not force a list or template unless the user's request clearly calls for one. ${generalRules} You may return multiple nodes when the request naturally implies multiple useful outputs. Each node must include a unique id that is stable within the response so connections can reference it. Template rules: placeholder variables must use only [[variable]] syntax. Placeholders may appear in any order and may repeat any number of times. Do not use single-bracket placeholders like [variable]. Do not use mustache placeholders like {{variable}}. Do not use any other delimiter style for placeholder variables. Curly braces, single brackets, parentheses, quotes, and other punctuation may appear as literal text when they are not placeholder variables, so preserve them when they are meant literally. Before returning a text-template node, rewrite placeholder-like variable references into [[variable]] syntax while leaving literal punctuation unchanged. If you return both a list and a text-template that are meant to work together, every template placeholder must correspond to a list column, do not invent template placeholders that are not backed by the list, make them compatible enough that the template can be filled from the list without missing variables, and add an input connection from the list node to the template node when that pairing should already be wired. Every node must include id, kind, label, text, columns, rows, and templateText. For unused fields, set the value to null. Always include a connections array. Use [] when there are no useful links to add. Each connection must include kind, sourceDescriptorId, and targetDescriptorId. Only connect nodes that you also returned in the nodes array. ${payloadRules} Do not include explanations, markdown, or commentary. Return only valid JSON that matches the schema.`;
}

export function getGeneratedDescriptorDefaultLabel(kind: GeneratedNodeKind, visualIndex = 0) {
  if (kind === "list") {
    return `Generated List ${visualIndex + 1}`;
  }
  if (kind === "text-template") {
    return `Generated Template ${visualIndex + 1}`;
  }
  return `Generated Text ${visualIndex + 1}`;
}

export function getStructuredTextOutputContract(target: Exclude<OpenAiTextOutputTarget, "note">) {
  if (target === "list") {
    return {
      schemaName: "generated_list_node",
      instructions:
        "Respond with JSON only. Generate exactly one list node. Provide a concise label, one or more column names, and rows whose value count exactly matches the number of columns.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "list" },
          label: { type: "string" },
          columns: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        required: ["kind", "label", "columns", "rows"],
      },
    } as const;
  }

  if (target === "template") {
    return {
      schemaName: "generated_template_node",
      instructions:
        "Respond with JSON only. Generate exactly one text template node. Provide a concise label and templateText that can be edited directly in the app.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "text-template" },
          label: { type: "string" },
          templateText: { type: "string" },
        },
        required: ["kind", "label", "templateText"],
      },
    } as const;
  }

  return {
    schemaName: "generated_smart_nodes",
    instructions: buildSmartOutputInstructions(),
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["text-note", "list", "text-template"],
              },
              id: { type: "string" },
              label: { type: "string" },
              text: { type: ["string", "null"] },
              columns: {
                type: ["array", "null"],
                items: { type: "string" },
              },
              rows: {
                type: ["array", "null"],
                items: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              templateText: { type: ["string", "null"] },
            },
            required: ["id", "kind", "label", "text", "columns", "rows", "templateText"],
          },
        },
        connections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["input", "prompt"],
              },
              sourceDescriptorId: { type: "string" },
              targetDescriptorId: { type: "string" },
            },
            required: ["kind", "sourceDescriptorId", "targetDescriptorId"],
          },
        },
      },
      required: ["nodes", "connections"],
    },
  } as const;
}

export function createFallbackGeneratedTextNoteDescriptor(input: {
  content: string;
  sourceJobId: string;
  sourceModelNodeId?: string | null;
  outputIndex?: number;
  descriptorIndex?: number;
  label?: string;
  runOrigin?: JobRunOrigin;
  descriptorId?: string;
}): GeneratedTextNoteDescriptor {
  return {
    descriptorId:
      input.descriptorId || getDefaultGeneratedDescriptorId(input.outputIndex ?? 0, input.descriptorIndex ?? 0),
    kind: "text-note",
    label: input.label || getGeneratedDescriptorDefaultLabel("text-note", input.descriptorIndex || 0),
    text: input.content,
    sourceJobId: input.sourceJobId,
    sourceModelNodeId: input.sourceModelNodeId ?? null,
    outputIndex: input.outputIndex ?? 0,
    descriptorIndex: input.descriptorIndex ?? 0,
    runOrigin: input.runOrigin || (input.sourceModelNodeId ? "canvas-node" : "copilot"),
  };
}

export function parseStructuredTextOutput(input: StructuredParseInput): StructuredParseResult {
  const outputIndex = input.outputIndex ?? 0;
  const runOrigin = input.runOrigin || (input.sourceModelNodeId ? "canvas-node" : "copilot");

  try {
    const parsed = JSON.parse(input.content) as unknown;
    const warnings: string[] = [];
    const smartOutput =
      input.textOutputTarget === "smart" ? smartOutputSchema.parse(parsed) : null;
    const seeds =
      input.textOutputTarget === "list"
        ? [{ ...listDescriptorSchema.parse({ id: getDefaultGeneratedDescriptorId(outputIndex, 0), ...((parsed as Record<string, unknown>) || {}) }) }]
        : input.textOutputTarget === "template"
          ? [{ ...textTemplateDescriptorSchema.parse({ id: getDefaultGeneratedDescriptorId(outputIndex, 0), ...((parsed as Record<string, unknown>) || {}) }) }]
          : smartOutput?.nodes || [];
    const nodeIds = new Set(seeds.map((seed) => seed.id));
    const seenConnections = new Set<string>();
    const generatedConnections =
      smartOutput?.connections?.filter((connection) => {
        if (
          !nodeIds.has(connection.sourceDescriptorId) ||
          !nodeIds.has(connection.targetDescriptorId) ||
          connection.sourceDescriptorId === connection.targetDescriptorId
        ) {
          warnings.push("Ignored 1 invalid generated connection.");
          return false;
        }

        const key = `${connection.kind}:${connection.sourceDescriptorId}:${connection.targetDescriptorId}`;
        if (seenConnections.has(key)) {
          warnings.push("Ignored 1 duplicate generated connection.");
          return false;
        }
        seenConnections.add(key);
        return true;
      }) || [];

    return {
      generatedNodeDescriptors: seeds.map((seed, descriptorIndex) =>
        descriptorSeedToDescriptor(seed, {
          sourceJobId: input.sourceJobId,
          sourceModelNodeId: input.sourceModelNodeId ?? null,
          outputIndex,
          descriptorIndex,
          runOrigin,
        })
      ),
      generatedConnections,
      warning: warnings.length > 0 ? [...new Set(warnings)].join(" ") : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown structured output parse failure.";
    return {
      generatedNodeDescriptors: [
        createFallbackGeneratedTextNoteDescriptor({
          content: input.content,
          sourceJobId: input.sourceJobId,
          sourceModelNodeId: input.sourceModelNodeId ?? null,
          outputIndex,
          runOrigin,
        }),
      ],
      generatedConnections: [],
      warning: `Structured output parsing failed. Fell back to a generated text note. ${message}`,
    };
  }
}

export function createGeneratedTextNoteDescriptorsFromRawText(input: {
  outputs: Array<{ content: string; outputIndex: number }>;
  sourceJobId: string;
  sourceModelNodeId?: string | null;
  runOrigin?: JobRunOrigin;
}): GeneratedNodeDescriptor[] {
  return input.outputs.map((output, descriptorIndex) =>
    createFallbackGeneratedTextNoteDescriptor({
      content: output.content,
      sourceJobId: input.sourceJobId,
      sourceModelNodeId: input.sourceModelNodeId ?? null,
      outputIndex: output.outputIndex,
      descriptorIndex,
      runOrigin: input.runOrigin,
    })
  );
}

export function getGeneratedNodeDescriptorKey(input: {
  sourceJobId: string;
  outputIndex: number;
  descriptorIndex: number;
}) {
  return `${input.sourceJobId}:${input.outputIndex}:${input.descriptorIndex}`;
}

function getDeterministicListColumnId(descriptor: GeneratedListNodeDescriptor, columnIndex: number) {
  return `generated-col-${descriptor.outputIndex}-${descriptor.descriptorIndex}-${columnIndex}`;
}

function getDeterministicListRowId(descriptor: GeneratedListNodeDescriptor, rowIndex: number) {
  return `generated-row-${descriptor.outputIndex}-${descriptor.descriptorIndex}-${rowIndex}`;
}

export function buildGeneratedNodePosition(input: {
  modelNode: Pick<WorkflowNode, "x" | "y">;
  visualIndex: number;
  baseOffsetX: number;
  offsetY: number;
  columnOffsetX?: number;
}) {
  return {
    x: Math.round(input.modelNode.x + input.baseOffsetX + Math.floor(input.visualIndex / 4) * (input.columnOffsetX ?? 0)),
    y: Math.round(input.modelNode.y + (input.visualIndex % 4) * input.offsetY),
  };
}

type CreateGeneratedModelNodeInput = {
  id: string;
  providerId: ProviderId;
  modelId: string;
  modelNodeId?: string | null;
  label: string;
  position: { x: number; y: number };
  zIndex: number;
  processingState: WorkflowNode["processingState"];
  descriptor: GeneratedNodeDescriptor;
  connectToSourceModel?: boolean;
};

export function createGeneratedModelNode(input: CreateGeneratedModelNodeInput): WorkflowNode {
  const connectToSourceModel = input.connectToSourceModel !== false && Boolean(input.modelNodeId);
  const shared = {
    id: input.id,
    label: input.label,
    providerId: input.providerId,
    modelId: input.modelId,
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: input.descriptor.sourceJobId,
    sourceOutputIndex: input.descriptor.outputIndex,
    processingState: input.processingState,
    promptSourceNodeId: null,
    upstreamNodeIds: connectToSourceModel && input.modelNodeId ? [input.modelNodeId] : [],
    upstreamAssetIds: connectToSourceModel && input.modelNodeId ? [`node:${input.modelNodeId}`] : [],
    x: input.position.x,
    y: input.position.y,
    zIndex: input.zIndex,
    displayMode: "preview" as const,
    size: null,
  } satisfies Omit<
    WorkflowNode,
    "kind" | "nodeType" | "outputType" | "prompt" | "settings"
  >;

  if (input.descriptor.kind === "list") {
    return {
      ...shared,
      kind: "list",
      nodeType: "list",
      outputType: "text",
      prompt: "",
      settings: createGeneratedModelListSettings({
        sourceJobId: input.descriptor.sourceJobId,
        sourceModelNodeId: input.descriptor.sourceModelNodeId,
        outputIndex: input.descriptor.outputIndex,
        descriptorIndex: input.descriptor.descriptorIndex,
        runOrigin: input.descriptor.runOrigin,
        columns: input.descriptor.columns.map((label, columnIndex) => ({
          id: getDeterministicListColumnId(input.descriptor, columnIndex),
          label,
        })),
        rows: input.descriptor.rows.map((row, rowIndex) => ({
          id: getDeterministicListRowId(input.descriptor, rowIndex),
          values: input.descriptor.columns.reduce<Record<string, string>>((acc, _column, columnIndex) => {
            acc[getDeterministicListColumnId(input.descriptor, columnIndex)] = row[columnIndex] ?? "";
            return acc;
          }, {}),
        })),
      }),
    };
  }

  if (input.descriptor.kind === "text-template") {
    return {
      ...shared,
      kind: "text-template",
      nodeType: "text-template",
      outputType: "text",
      prompt: input.descriptor.templateText,
      settings: createGeneratedModelTextTemplateSettings({
        sourceJobId: input.descriptor.sourceJobId,
        sourceModelNodeId: input.descriptor.sourceModelNodeId,
        outputIndex: input.descriptor.outputIndex,
        descriptorIndex: input.descriptor.descriptorIndex,
        runOrigin: input.descriptor.runOrigin,
      }),
    };
  }

  return {
    ...shared,
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    prompt: input.descriptor.text,
    settings: createGeneratedModelTextNoteSettings({
      sourceJobId: input.descriptor.sourceJobId,
      sourceModelNodeId: input.descriptor.sourceModelNodeId,
      outputIndex: input.descriptor.outputIndex,
      descriptorIndex: input.descriptor.descriptorIndex,
      runOrigin: input.descriptor.runOrigin,
    }),
  };
}

export function applyGeneratedDescriptorToNode(
  node: WorkflowNode,
  input: {
    providerId: ProviderId;
    modelId: string;
    processingState: WorkflowNode["processingState"];
    descriptor: GeneratedNodeDescriptor;
    allowContentHydration: boolean;
    connectToSourceModel?: boolean;
  }
): WorkflowNode {
  const nextNode = createGeneratedModelNode({
    id: node.id,
    providerId: input.providerId,
    modelId: input.modelId,
    modelNodeId: input.descriptor.sourceModelNodeId,
    label: input.descriptor.label || node.label,
    position: {
      x: node.x,
      y: node.y,
    },
    zIndex: node.zIndex,
    processingState: input.processingState,
    descriptor: input.descriptor,
    connectToSourceModel: input.connectToSourceModel,
  });
  const shouldPreserveGraphLinks = nextNode.kind === node.kind;
  const preservedGraphFields = shouldPreserveGraphLinks
    ? {
        promptSourceNodeId: node.promptSourceNodeId,
        upstreamNodeIds: node.upstreamNodeIds,
        upstreamAssetIds: node.upstreamAssetIds,
      }
    : null;

  if (!input.allowContentHydration) {
    return {
      ...nextNode,
      ...(preservedGraphFields || {}),
      label: node.label,
      prompt: node.prompt,
      settings:
        nextNode.kind === "list" && node.kind === "list"
          ? node.settings
          : nextNode.kind === "text-template" && node.kind === "text-template"
            ? node.settings
            : nextNode.kind === "text-note" && node.kind === "text-note"
              ? node.settings
              : nextNode.settings,
      processingState: input.processingState,
    };
  }

  return {
    ...nextNode,
    ...(preservedGraphFields || {}),
  };
}
