/**
 * Claude Opus 4.5 API Client
 *
 * Komplett implementation av Claude API med alla Opus 4.5-funktioner:
 * - Effort parameter (low/medium/high)
 * - Extended thinking med summarization
 * - Interleaved thinking
 * - Programmatic tool calling
 * - Tool search
 * - Vision och PDF-support
 * - Strict tool use
 * - Context management
 */

// =============================================================================
// TYPES
// =============================================================================

export type EffortLevel = "low" | "medium" | "high";

export type ThinkingConfig = {
  type: "enabled";
  budget_tokens: number; // Minimum 1024
};

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
  allowed_callers?: ("direct" | "code_execution_20250825")[];
  defer_loading?: boolean; // For tool search
  input_examples?: Record<string, unknown>[]; // Beta: Tool use examples
}

export interface ServerTool {
  type: string;
  name: string;
}

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockImage {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data?: string;
    url?: string;
  };
}

export interface ContentBlockDocument {
  type: "document";
  source: {
    type: "base64";
    media_type: "application/pdf";
    data: string;
  };
}

export interface ContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: {
    type: "direct" | "code_execution_20250825";
    tool_id?: string;
  };
}

export interface ContentBlockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ContentBlockThinking {
  type: "thinking";
  thinking: string;
}

export interface ContentBlockThinkingSummary {
  type: "thinking_summary";
  summary: string;
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockImage
  | ContentBlockDocument
  | ContentBlockToolUse
  | ContentBlockToolResult
  | ContentBlockThinking
  | ContentBlockThinkingSummary;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ClaudeRequestOptions {
  // Core
  model?: ClaudeModel;
  max_tokens?: number;
  messages: Message[];
  system?: string;

  // Tools
  tools?: (ToolDefinition | ServerTool)[];
  tool_choice?: {
    type: "auto" | "any" | "tool" | "none";
    name?: string;
    disable_parallel_tool_use?: boolean;
  };

  // Extended Thinking
  thinking?: ThinkingConfig;

  // Opus 4.5 Effort Parameter
  output_config?: {
    effort?: EffortLevel;
  };

  // Context Management
  context_management?: {
    edits?: Array<{
      type: "clear_tool_uses_20250919";
      trigger: { type: "input_tokens"; value: number };
      keep: { type: "tool_uses"; value: number };
      clear_at_least?: { type: "input_tokens"; value: number };
    }>;
  };

  // Container for code execution
  container?: string;

  // Beta features
  betas?: BetaHeader[];

  // Streaming
  stream?: boolean;

  // Temperature (0-1)
  temperature?: number;
}

export interface ClaudeResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "model_context_window_exceeded";
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  container?: {
    id: string;
    expires_at: string;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

export type ClaudeModel =
  | "claude-opus-4-5-20251101"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5-20251001"
  | "claude-opus-4-1-20250414"
  | "claude-sonnet-4-20250514"
  | "claude-haiku-3-5-20241022";

export type BetaHeader =
  | "advanced-tool-use-2025-11-20"      // Programmatic tool calling, Tool search
  | "effort-2025-11-24"                  // Effort parameter (Opus 4.5 only)
  | "interleaved-thinking-2025-05-14"   // Interleaved thinking
  | "context-management-2025-06-27"     // Memory tool, Context editing
  | "context-1m-2025-08-07";            // 1M context window

export const MODELS = {
  OPUS_4_5: "claude-opus-4-5-20251101" as ClaudeModel,
  SONNET_4_5: "claude-sonnet-4-5-20250929" as ClaudeModel,
  HAIKU_4_5: "claude-haiku-4-5-20251001" as ClaudeModel,
  OPUS_4_1: "claude-opus-4-1-20250414" as ClaudeModel,
  SONNET_4: "claude-sonnet-4-20250514" as ClaudeModel,
  HAIKU_3_5: "claude-haiku-3-5-20241022" as ClaudeModel,
};

export const BETA_HEADERS = {
  ADVANCED_TOOL_USE: "advanced-tool-use-2025-11-20" as BetaHeader,
  EFFORT: "effort-2025-11-24" as BetaHeader,
  INTERLEAVED_THINKING: "interleaved-thinking-2025-05-14" as BetaHeader,
  CONTEXT_MANAGEMENT: "context-management-2025-06-27" as BetaHeader,
  CONTEXT_1M: "context-1m-2025-08-07" as BetaHeader,
};

// Tool type versions
export const TOOL_TYPES = {
  CODE_EXECUTION: "code_execution_20250825",
  TEXT_EDITOR: "text_editor_20250728",
  WEB_SEARCH: "web_search_20250305",
  WEB_FETCH: "web_fetch_20250305",
  COMPUTER_USE: "computer_20250124",
  MEMORY: "memory_20250818",
  TOOL_SEARCH_REGEX: "tool_search_tool_regex_20251119",
  TOOL_SEARCH_BM25: "tool_search_tool_bm25_20251119",
};

// =============================================================================
// CLAUDE CLIENT CLASS
// =============================================================================

export class ClaudeClient {
  private apiKey: string;
  private baseUrl = "https://api.anthropic.com/v1";
  private defaultModel: ClaudeModel = MODELS.OPUS_4_5;

  constructor(apiKey: string, options?: { defaultModel?: ClaudeModel }) {
    this.apiKey = apiKey;
    if (options?.defaultModel) {
      this.defaultModel = options.defaultModel;
    }
  }

  /**
   * Core messages API call
   */
  async messages(options: ClaudeRequestOptions): Promise<ClaudeResponse> {
    const model = options.model || this.defaultModel;
    const betas = options.betas || [];

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };

    // Add beta headers if specified
    if (betas.length > 0) {
      headers["anthropic-beta"] = betas.join(",");
    }

    // Build request body
    const body: Record<string, unknown> = {
      model,
      max_tokens: options.max_tokens || 4096,
      messages: options.messages,
    };

    if (options.system) body.system = options.system;
    if (options.tools) body.tools = options.tools;
    if (options.tool_choice) body.tool_choice = options.tool_choice;
    if (options.thinking) body.thinking = options.thinking;
    if (options.output_config) body.output_config = options.output_config;
    if (options.context_management) body.context_management = options.context_management;
    if (options.container) body.container = options.container;
    if (options.stream) body.stream = options.stream;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    // Determine endpoint
    const endpoint = betas.length > 0
      ? `${this.baseUrl}/messages?beta=true`
      : `${this.baseUrl}/messages`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ClaudeAPIError(response.status, error);
    }

    return await response.json() as ClaudeResponse;
  }

  /**
   * Simple text completion with Opus 4.5 effort parameter
   */
  async complete(
    prompt: string,
    options?: {
      effort?: EffortLevel;
      system?: string;
      maxTokens?: number;
    }
  ): Promise<string> {
    const betas: BetaHeader[] = [];
    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: options?.maxTokens || 4096,
      messages: [{ role: "user", content: prompt }],
    };

    if (options?.system) {
      requestOptions.system = options.system;
    }

    // Add effort parameter (Opus 4.5 only)
    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    const response = await this.messages(requestOptions);
    return this.extractText(response);
  }

  /**
   * Generate with extended thinking
   */
  async think(
    prompt: string,
    options?: {
      thinkingBudget?: number;
      interleaved?: boolean;
      effort?: EffortLevel;
      system?: string;
      maxTokens?: number;
    }
  ): Promise<{ thinking: string; response: string }> {
    const betas: BetaHeader[] = [];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: options?.maxTokens || 8192,
      messages: [{ role: "user", content: prompt }],
      thinking: {
        type: "enabled",
        budget_tokens: options?.thinkingBudget || 5000,
      },
    };

    if (options?.system) {
      requestOptions.system = options.system;
    }

    // Add interleaved thinking beta
    if (options?.interleaved) {
      betas.push(BETA_HEADERS.INTERLEAVED_THINKING);
    }

    // Add effort parameter
    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    const response = await this.messages(requestOptions);
    return this.extractThinking(response);
  }

  /**
   * Analyze a PDF document
   */
  async analyzePdf(
    pdfBase64: string,
    prompt: string,
    options?: {
      effort?: EffortLevel;
      thinking?: boolean;
      thinkingBudget?: number;
    }
  ): Promise<{ thinking?: string; response: string }> {
    const betas: BetaHeader[] = [];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: options?.thinking ? 16000 : 8000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      }],
    };

    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    if (options?.thinking) {
      requestOptions.thinking = {
        type: "enabled",
        budget_tokens: options.thinkingBudget || 5000,
      };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    const response = await this.messages(requestOptions);

    if (options?.thinking) {
      return this.extractThinking(response);
    }

    return { response: this.extractText(response) };
  }

  /**
   * Analyze an image
   */
  async analyzeImage(
    imageBase64: string,
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    prompt: string,
    options?: {
      effort?: EffortLevel;
    }
  ): Promise<string> {
    const betas: BetaHeader[] = [];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      }],
    };

    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    const response = await this.messages(requestOptions);
    return this.extractText(response);
  }

  /**
   * Call with tools (client-side tools)
   */
  async callWithTools(
    prompt: string,
    tools: ToolDefinition[],
    options?: {
      system?: string;
      strictMode?: boolean;
      effort?: EffortLevel;
    }
  ): Promise<ClaudeResponse> {
    const betas: BetaHeader[] = [];

    // Apply strict mode if requested
    const processedTools = options?.strictMode
      ? tools.map(t => ({ ...t, strict: true }))
      : tools;

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      tools: processedTools,
    };

    if (options?.system) {
      requestOptions.system = options.system;
    }

    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    return await this.messages(requestOptions);
  }

  /**
   * Call with programmatic tool calling
   */
  async callProgrammatically(
    prompt: string,
    tools: ToolDefinition[],
    options?: {
      system?: string;
      effort?: EffortLevel;
      container?: string;
    }
  ): Promise<ClaudeResponse> {
    const betas: BetaHeader[] = [BETA_HEADERS.ADVANCED_TOOL_USE];

    // Enable code execution and mark tools as programmatically callable
    const processedTools: (ToolDefinition | ServerTool)[] = [
      { type: TOOL_TYPES.CODE_EXECUTION, name: "code_execution" },
      ...tools.map(t => ({
        ...t,
        allowed_callers: ["code_execution_20250825" as const],
      })),
    ];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
      tools: processedTools,
      betas,
    };

    if (options?.system) {
      requestOptions.system = options.system;
    }

    if (options?.container) {
      requestOptions.container = options.container;
    }

    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    return await this.messages(requestOptions);
  }

  /**
   * Use tool search for many tools
   */
  async callWithToolSearch(
    prompt: string,
    tools: ToolDefinition[],
    searchType: "regex" | "bm25" = "regex",
    options?: {
      system?: string;
      effort?: EffortLevel;
    }
  ): Promise<ClaudeResponse> {
    const betas: BetaHeader[] = [BETA_HEADERS.ADVANCED_TOOL_USE];

    const toolSearchType = searchType === "regex"
      ? TOOL_TYPES.TOOL_SEARCH_REGEX
      : TOOL_TYPES.TOOL_SEARCH_BM25;

    // Add tool search tool and defer loading on all other tools
    const processedTools: (ToolDefinition | ServerTool)[] = [
      { type: toolSearchType, name: `tool_search_tool_${searchType}` },
      ...tools.map(t => ({ ...t, defer_loading: true })),
    ];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      tools: processedTools,
      betas,
    };

    if (options?.system) {
      requestOptions.system = options.system;
    }

    if (options?.effort) {
      betas.push(BETA_HEADERS.EFFORT);
      requestOptions.output_config = { effort: options.effort };
    }

    return await this.messages(requestOptions);
  }

  /**
   * Continue a conversation with tool results
   */
  async continueWithToolResult(
    messages: Message[],
    tools: (ToolDefinition | ServerTool)[],
    options?: {
      betas?: BetaHeader[];
      container?: string;
      effort?: EffortLevel;
    }
  ): Promise<ClaudeResponse> {
    const betas = options?.betas || [];

    const requestOptions: ClaudeRequestOptions = {
      model: MODELS.OPUS_4_5,
      max_tokens: 8192,
      messages,
      tools,
    };

    if (options?.container) {
      requestOptions.container = options.container;
    }

    if (options?.effort) {
      if (!betas.includes(BETA_HEADERS.EFFORT)) {
        betas.push(BETA_HEADERS.EFFORT);
      }
      requestOptions.output_config = { effort: options.effort };
    }

    if (betas.length > 0) {
      requestOptions.betas = betas;
    }

    return await this.messages(requestOptions);
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Extract text content from response
   */
  extractText(response: ClaudeResponse): string {
    const textBlocks = response.content.filter(
      (block): block is ContentBlockText => block.type === "text"
    );
    return textBlocks.map(b => b.text).join("\n");
  }

  /**
   * Extract thinking and response from extended thinking response
   */
  extractThinking(response: ClaudeResponse): { thinking: string; response: string } {
    let thinking = "";
    let text = "";

    for (const block of response.content) {
      if (block.type === "thinking") {
        thinking += block.thinking + "\n";
      } else if (block.type === "thinking_summary") {
        thinking += `[Summary] ${block.summary}\n`;
      } else if (block.type === "text") {
        text += block.text;
      }
    }

    return { thinking: thinking.trim(), response: text.trim() };
  }

  /**
   * Extract tool uses from response
   */
  extractToolUses(response: ClaudeResponse): ContentBlockToolUse[] {
    return response.content.filter(
      (block): block is ContentBlockToolUse => block.type === "tool_use"
    );
  }

  /**
   * Check if response requires tool execution
   */
  requiresToolExecution(response: ClaudeResponse): boolean {
    return response.stop_reason === "tool_use";
  }

  /**
   * Create a tool result message
   */
  createToolResultMessage(toolUseId: string, result: string, isError = false): Message {
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId,
        content: result,
        is_error: isError,
      }],
    };
  }

  /**
   * Parse JSON from Claude response (handles markdown code blocks)
   */
  parseJsonResponse<T>(response: ClaudeResponse): T {
    const text = this.extractText(response);
    return this.parseJsonFromText<T>(text);
  }

  /**
   * Parse JSON from text (handles markdown code blocks)
   */
  parseJsonFromText<T>(text: string): T {
    let jsonText = text;

    // Remove markdown code blocks
    if (jsonText.includes("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    } else if (jsonText.includes("```")) {
      jsonText = jsonText.replace(/```\n?/g, "");
    }

    jsonText = jsonText.trim();

    // Try to extract JSON object or array
    const jsonMatch = jsonText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as T;
    }

    return JSON.parse(jsonText) as T;
  }

  /**
   * Calculate approximate token count
   */
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    // Swedish/Nordic languages might be slightly higher
    return Math.ceil(text.length / 3.5);
  }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class ClaudeAPIError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(`Claude API Error (${status}): ${message}`);
    this.name = "ClaudeAPIError";
    this.status = status;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a Claude client from environment variable
 */
export function createClaudeClient(options?: { defaultModel?: ClaudeModel }): ClaudeClient {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable not set");
  }
  return new ClaudeClient(apiKey, options);
}

/**
 * Create server tools definitions
 */
export const ServerTools = {
  codeExecution(): ServerTool {
    return { type: TOOL_TYPES.CODE_EXECUTION, name: "code_execution" };
  },

  webSearch(): ServerTool {
    return { type: TOOL_TYPES.WEB_SEARCH, name: "web_search" };
  },

  webFetch(): ServerTool {
    return { type: TOOL_TYPES.WEB_FETCH, name: "web_fetch" };
  },

  textEditor(): ServerTool {
    return { type: TOOL_TYPES.TEXT_EDITOR, name: "str_replace_based_edit_tool" };
  },

  computerUse(): ServerTool {
    return { type: TOOL_TYPES.COMPUTER_USE, name: "computer" };
  },

  memory(): ServerTool {
    return { type: TOOL_TYPES.MEMORY, name: "memory" };
  },

  toolSearchRegex(): ServerTool {
    return { type: TOOL_TYPES.TOOL_SEARCH_REGEX, name: "tool_search_tool_regex" };
  },

  toolSearchBm25(): ServerTool {
    return { type: TOOL_TYPES.TOOL_SEARCH_BM25, name: "tool_search_tool_bm25" };
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert a file to base64
 */
export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
}

/**
 * Validate PDF file
 */
export function validatePdf(file: File): { valid: boolean; error?: string } {
  if (!file.type.includes("pdf")) {
    return { valid: false, error: "File must be a PDF" };
  }

  // Max 32MB
  if (file.size > 32 * 1024 * 1024) {
    return { valid: false, error: "PDF must be under 32MB" };
  }

  return { valid: true };
}

/**
 * Validate image file
 */
export function validateImage(file: File): {
  valid: boolean;
  error?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
} {
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  if (!validTypes.includes(file.type)) {
    return { valid: false, error: "Image must be JPEG, PNG, GIF, or WebP" };
  }

  // Max 20MB for images
  if (file.size > 20 * 1024 * 1024) {
    return { valid: false, error: "Image must be under 20MB" };
  }

  return {
    valid: true,
    mediaType: file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  };
}
