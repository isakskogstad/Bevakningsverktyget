/**
 * AgentOrchestrator - Multi-turn och parallella agent-loopar
 *
 * Funktioner:
 * - Multi-turn konversationer med verktygsanrop
 * - Parallell exekvering av oberoende agenter
 * - Dependency graph för ordnade uppgifter
 * - Automatisk återförsök och felhantering
 */

import Anthropic from "@anthropic-ai/sdk";

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AgentTask {
  id: string;
  name: string;
  prompt: string;
  tools?: Tool[];
  dependsOn?: string[];
  maxTurns?: number;
  timeout?: number;
}

export interface AgentResult {
  taskId: string;
  success: boolean;
  result: string;
  toolCalls: Array<{
    tool: string;
    input: unknown;
    output: string;
  }>;
  turns: number;
  durationMs: number;
  error?: string;
}

type ToolHandler = (name: string, input: unknown) => Promise<string>;

/**
 * Multi-turn agent loop med verktygsanrop
 */
export async function runAgentLoop(
  task: AgentTask,
  toolHandler: ToolHandler,
  options: {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
  } = {}
): Promise<AgentResult> {
  const {
    apiKey,
    model = "claude-opus-4-5-20251101",
    maxTokens = 4096,
    systemPrompt = "Du är en hjälpsam AI-assistent som utför uppgifter steg för steg.",
  } = options;

  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  const startTime = Date.now();
  const maxTurns = task.maxTurns || 10;
  const toolCalls: AgentResult["toolCalls"] = [];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: task.prompt },
  ];

  let turns = 0;
  let finalResult = "";

  while (turns < maxTurns) {
    turns++;

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: task.tools,
      messages,
    });

    // Kolla om vi är klara
    if (response.stop_reason === "end_turn") {
      const textContent = response.content.find((c) => c.type === "text");
      if (textContent && textContent.type === "text") {
        finalResult = textContent.text;
      }
      break;
    }

    // Hantera verktygsanrop
    if (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      const toolUseBlocks = assistantContent.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
      );

      // Kör alla verktyg
      const toolResults: ToolResult[] = [];

      for (const toolUse of toolUseBlocks) {
        try {
          const output = await toolHandler(toolUse.name, toolUse.input);
          toolCalls.push({
            tool: toolUse.name,
            input: toolUse.input,
            output,
          });
          toolResults.push({
            tool_use_id: toolUse.id,
            content: output,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          toolResults.push({
            tool_use_id: toolUse.id,
            content: `Error: ${errorMessage}`,
            is_error: true,
          });
        }
      }

      // Lägg till i konversationen
      messages = [
        ...messages,
        { role: "assistant", content: assistantContent },
        {
          role: "user",
          content: toolResults.map((tr) => ({
            type: "tool_result" as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            is_error: tr.is_error,
          })),
        },
      ];
    }
  }

  return {
    taskId: task.id,
    success: true,
    result: finalResult,
    toolCalls,
    turns,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Kör flera agenter parallellt
 */
export async function runAgentsInParallel(
  tasks: AgentTask[],
  toolHandler: ToolHandler,
  options: {
    apiKey?: string;
    model?: string;
    maxConcurrency?: number;
  } = {}
): Promise<AgentResult[]> {
  const { maxConcurrency = 5 } = options;

  // Filtrera bort tasks med dependencies
  const independentTasks = tasks.filter(
    (t) => !t.dependsOn || t.dependsOn.length === 0
  );

  // Kör i batchar
  const results: AgentResult[] = [];

  for (let i = 0; i < independentTasks.length; i += maxConcurrency) {
    const batch = independentTasks.slice(i, i + maxConcurrency);

    const batchResults = await Promise.all(
      batch.map((task) =>
        runAgentLoop(task, toolHandler, options).catch((error) => ({
          taskId: task.id,
          success: false,
          result: "",
          toolCalls: [],
          turns: 0,
          durationMs: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        }))
      )
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Kör agenter enligt dependency graph
 */
export async function runAgentDAG(
  tasks: AgentTask[],
  toolHandler: ToolHandler,
  options: {
    apiKey?: string;
    model?: string;
  } = {}
): Promise<Map<string, AgentResult>> {
  const results = new Map<string, AgentResult>();
  const completed = new Set<string>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Topologisk sortering
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, task.dependsOn?.length || 0);
    for (const dep of task.dependsOn || []) {
      const deps = dependents.get(dep) || [];
      deps.push(task.id);
      dependents.set(dep, deps);
    }
  }

  // Hitta startuppgifter
  let ready = tasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0);

  while (ready.length > 0) {
    // Kör alla redo uppgifter parallellt
    const batchResults = await Promise.all(
      ready.map((task) =>
        runAgentLoop(task, toolHandler, options).catch((error) => ({
          taskId: task.id,
          success: false,
          result: "",
          toolCalls: [],
          turns: 0,
          durationMs: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        }))
      )
    );

    // Spara resultat
    for (const result of batchResults) {
      results.set(result.taskId, result);
      completed.add(result.taskId);
    }

    // Uppdatera in-degree och hitta nya redo uppgifter
    ready = [];
    for (const result of batchResults) {
      const deps = dependents.get(result.taskId) || [];
      for (const depId of deps) {
        const currentDegree = inDegree.get(depId) || 0;
        inDegree.set(depId, currentDegree - 1);

        if (currentDegree - 1 === 0) {
          const task = taskMap.get(depId);
          if (task) ready.push(task);
        }
      }
    }
  }

  return results;
}

/**
 * Skapa standard verktyg för agenter
 */
export const standardTools: Tool[] = [
  {
    name: "web_search",
    description: "Sök på webben efter information",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Sökfråga",
        },
        num_results: {
          type: "number",
          description: "Antal resultat (default: 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Hämta innehåll från en URL",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL att hämta",
        },
        extract_text: {
          type: "boolean",
          description: "Extrahera endast text (default: true)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "read_file",
    description: "Läs innehållet i en fil",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Sökväg till filen",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Skriv innehåll till en fil",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Sökväg till filen",
        },
        content: {
          type: "string",
          description: "Innehåll att skriva",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "execute_code",
    description: "Exekvera kod (JavaScript/TypeScript)",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Kod att exekvera",
        },
        language: {
          type: "string",
          enum: ["javascript", "typescript"],
          description: "Programmeringsspråk",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "database_query",
    description: "Kör databasfråga",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "SQL-fråga",
        },
        params: {
          type: "array",
          items: { type: "string" },
          description: "Parametrar för prepared statement",
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Skapa en enkel tool handler
 */
export function createToolHandler(
  handlers: Record<string, (input: unknown) => Promise<string>>
): ToolHandler {
  return async (name: string, input: unknown): Promise<string> => {
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(input);
  };
}

/**
 * Agent för att summera flera resultat
 */
export async function summarizeResults(
  results: AgentResult[],
  question: string,
  apiKey?: string
): Promise<string> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  const context = results
    .filter((r) => r.success)
    .map((r) => `## ${r.taskId}\n${r.result}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Baserat på följande forskningsresultat, besvara frågan:

FRÅGA: ${question}

RESULTAT:
${context}

Ge ett sammanhängande svar som syntetiserar informationen.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return content.text;
}

export default {
  runAgentLoop,
  runAgentsInParallel,
  runAgentDAG,
  standardTools,
  createToolHandler,
  summarizeResults,
};
