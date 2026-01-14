import express, { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';

import { DocassembleIndex } from './indexer.js';
import { ResourceManager } from './resources.js';
import {
  ToolsManager,
  SearchSourcesInputSchema,
  GetAuthoritativeSnippetsInputSchema,
  PlanInterviewYamlInputSchema,
  GenerateInterviewYamlInputSchema,
  ValidateInterviewYamlInputSchema,
  ExplainTermInputSchema,
} from './tools.js';
import { listPrompts, getPrompt, getPromptMessages } from './prompts.js';

const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const MCP_ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const PORT = parseInt(process.env.PORT || '3000', 10);
const DOCASSEMBLE_REF_PATH = process.env.DOCASSEMBLE_REF_PATH || path.join(process.cwd(), '..', 'docassemble-ref');

let index: DocassembleIndex;
let resourceManager: ResourceManager;
let toolsManager: ToolsManager;

async function initializeIndex(): Promise<void> {
  const refPath = path.resolve(DOCASSEMBLE_REF_PATH);
  
  if (!fs.existsSync(refPath)) {
    console.error(`Docassemble reference path not found: ${refPath}`);
    console.error('Please set DOCASSEMBLE_REF_PATH environment variable to point to the docassemble repository.');
    process.exit(1);
  }

  console.log(`Initializing index from: ${refPath}`);
  index = new DocassembleIndex(refPath);
  await index.initialize();
  
  const stats = index.getStats();
  console.log(`Index initialized: ${stats.totalFiles} files, ${stats.examples} examples, ${stats.keywords} keywords`);

  resourceManager = new ResourceManager(index);
  toolsManager = new ToolsManager(index);
}

function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'mcp-docassemble-interviews',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_sources',
          description: 'Find relevant passages in Docassemble docs and examples. Returns citations with file paths and line numbers.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string' },
              maxResults: { type: 'number', description: 'Maximum results (1-25, default 8)' },
              scope: { 
                type: 'string', 
                enum: ['docs', 'examples', 'docs_and_examples', 'all'],
                description: 'Search scope' 
              },
              fileGlobs: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'Optional file glob patterns' 
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_authoritative_snippets',
          description: 'Get authoritative, citation-backed snippets for a topic. Internally runs multiple searches and dedupes.',
          inputSchema: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'Topic or term to find snippets for' },
              desiredCount: { type: 'number', description: 'Desired number of snippets (1-12, default 5)' },
            },
            required: ['topic'],
          },
        },
        {
          name: 'plan_interview_yaml',
          description: 'Convert natural-language requirements into a structured authoring plan with YAML skeleton outline. All constructs are grounded in sources.',
          inputSchema: {
            type: 'object',
            properties: {
              requirements: { type: 'string', description: 'User\'s conversational description of the interview' },
              assumptions: { type: 'array', items: { type: 'string' }, description: 'Assumptions to make' },
              constraints: { type: 'array', items: { type: 'string' }, description: 'Constraints to apply' },
              strictness: { 
                type: 'string', 
                enum: ['strict', 'strict_plus_search'],
                description: 'Strictness mode (default: strict_plus_search)' 
              },
            },
            required: ['requirements'],
          },
        },
        {
          name: 'generate_interview_yaml',
          description: 'Generate a COMPLETE interview YAML file using ONLY confirmed syntax/patterns. Every non-trivial syntax choice has citations.',
          inputSchema: {
            type: 'object',
            properties: {
              inputMode: { 
                type: 'string', 
                enum: ['requirements', 'plan', 'spec'],
                description: 'Input mode' 
              },
              requirements: { type: 'string', description: 'Requirements string (if inputMode=requirements)' },
              plan: { type: 'object', description: 'Plan object (if inputMode=plan)' },
              spec: { type: 'object', description: 'Spec object (if inputMode=spec)' },
              style: {
                type: 'object',
                properties: {
                  commentsInYaml: { type: 'boolean', description: 'Include comments (default true)' },
                  includeDocCitationsInComments: { type: 'boolean', description: 'Include citations in comments (default true)' },
                  readability: { type: 'string', enum: ['compact', 'readable'], description: 'Readability style' },
                },
              },
              groundingMode: { 
                type: 'string', 
                enum: ['strict', 'strict_plus_search'],
                description: 'Grounding mode (default: strict_plus_search)' 
              },
            },
            required: ['inputMode'],
          },
        },
        {
          name: 'validate_interview_yaml',
          description: 'Validate YAML parse and doc-grounded lint rules. Each lint rule cites its source.',
          inputSchema: {
            type: 'object',
            properties: {
              yaml: { type: 'string', description: 'YAML content to validate' },
              mode: { 
                type: 'string', 
                enum: ['parse_only', 'lint'],
                description: 'Validation mode (default: lint)' 
              },
            },
            required: ['yaml'],
          },
        },
        {
          name: 'explain_term',
          description: 'Provide authoritative explanation for a YAML keyword/block/pattern with citations and examples.',
          inputSchema: {
            type: 'object',
            properties: {
              term: { type: 'string', description: 'Term to explain' },
            },
            required: ['term'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'search_sources': {
          const input = SearchSourcesInputSchema.parse(args);
          const result = toolsManager.searchSources(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'get_authoritative_snippets': {
          const input = GetAuthoritativeSnippetsInputSchema.parse(args);
          const result = toolsManager.getAuthoritativeSnippets(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'plan_interview_yaml': {
          const input = PlanInterviewYamlInputSchema.parse(args);
          const result = toolsManager.planInterviewYaml(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'generate_interview_yaml': {
          const input = GenerateInterviewYamlInputSchema.parse(args);
          const result = toolsManager.generateInterviewYaml(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'validate_interview_yaml': {
          const input = ValidateInterviewYamlInputSchema.parse(args);
          const result = toolsManager.validateInterviewYaml(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'explain_term': {
          const input = ExplainTermInputSchema.parse(args);
          const result = toolsManager.explainTerm(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = resourceManager.listResources();
    return {
      resources: resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'docassemble://start-here') {
      const resource = resourceManager.getStartHereResource();
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }

    if (uri === 'docassemble://examples-library') {
      const resource = resourceManager.getExamplesLibraryResource();
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }

    if (uri === 'docassemble://keyword-reference') {
      const resource = resourceManager.getKeywordReferenceResource();
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }

    if (uri === 'docassemble://patterns-cookbook') {
      const resource = resourceManager.getPatternsCookbookResource();
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }

    if (uri.startsWith('docassemble://examples/')) {
      const exampleName = uri.replace('docassemble://examples/', '');
      const resource = resourceManager.getExampleContent(exampleName);
      if (resource) {
        return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
      }
    }

    if (uri.startsWith('docassemble://files/')) {
      const relativePath = uri.replace('docassemble://files/', '');
      const resource = resourceManager.getFileContent(relativePath);
      if (resource) {
        return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts = listPrompts();
    return {
      prompts: prompts.map(p => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = getPrompt(name);

    if (!prompt) {
      throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${name}`);
    }

    const messages = getPromptMessages(name, args || {});

    return {
      description: prompt.description,
      messages: messages.map(m => ({
        role: m.role,
        content: { type: 'text', text: m.content },
      })),
    };
  });

  return server;
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MCP_AUTH_TOKEN) {
    console.warn('WARNING: MCP_AUTH_TOKEN not set. Authentication is disabled.');
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== MCP_AUTH_TOKEN) {
    res.status(401).json({ error: 'Invalid authentication token' });
    return;
  }

  next();
}

function originMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (MCP_ALLOWED_ORIGINS.length === 0) {
    console.warn('WARNING: MCP_ALLOWED_ORIGINS not set. Origin validation is disabled.');
    next();
    return;
  }

  const origin = req.headers.origin;
  
  if (!origin) {
    res.status(403).json({ error: 'Missing Origin header' });
    return;
  }

  if (!MCP_ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  next();
}

interface McpSession {
  server: Server;
  lastActivity: number;
}

const sessions = new Map<string, McpSession>();

function getOrCreateSession(sessionId: string): McpSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      server: createMcpServer(),
      lastActivity: Date.now(),
    };
    sessions.set(sessionId, session);
  }
  session.lastActivity = Date.now();
  return session;
}

setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > timeout) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

async function startHttpServer(): Promise<void> {
  await initializeIndex();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.options('/mcp', (req, res) => {
    const origin = req.headers.origin;
    if (origin && (MCP_ALLOWED_ORIGINS.length === 0 || MCP_ALLOWED_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    res.status(204).end();
  });

  app.get('/mcp', originMiddleware, authMiddleware, async (req: Request, res: Response) => {
    res.json({
      name: 'mcp-docassemble-interviews',
      version: '1.0.0',
      description: 'MCP Server for Docassemble Interview Authoring - Citation-backed reference and YAML generator',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
      },
      stats: index.getStats(),
    });
  });

  app.post('/mcp', originMiddleware, authMiddleware, async (req: Request, res: Response) => {
    try {
      const sessionId = (req.headers['x-mcp-session-id'] as string) || 'default';
      const session = getOrCreateSession(sessionId);
      
      const { method, params, id } = req.body;

      if (!method) {
        res.status(400).json({ 
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid request: missing method' },
          id 
        });
        return;
      }

      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: 'mcp-docassemble-interviews',
              version: '1.0.0',
            },
          };
          break;

        case 'tools/list':
          result = await handleToolsList();
          break;

        case 'tools/call':
          result = await handleToolsCall(params);
          break;

        case 'resources/list':
          result = await handleResourcesList();
          break;

        case 'resources/read':
          result = await handleResourcesRead(params);
          break;

        case 'prompts/list':
          result = await handlePromptsList();
          break;

        case 'prompts/get':
          result = await handlePromptsGet(params);
          break;

        default:
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32601, message: `Method not found: ${method}` },
            id,
          });
          return;
      }

      res.json({
        jsonrpc: '2.0',
        result,
        id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: req.body?.id,
      });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', stats: index.getStats() });
  });

  app.listen(PORT, () => {
    console.log(`MCP Docassemble Interviews server running on port ${PORT}`);
    console.log(`Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

async function handleToolsList() {
  return {
    tools: [
      {
        name: 'search_sources',
        description: 'Find relevant passages in Docassemble docs and examples. Returns citations with file paths and line numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string' },
            maxResults: { type: 'number', description: 'Maximum results (1-25, default 8)' },
            scope: { type: 'string', enum: ['docs', 'examples', 'docs_and_examples', 'all'] },
            fileGlobs: { type: 'array', items: { type: 'string' } },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_authoritative_snippets',
        description: 'Get authoritative, citation-backed snippets for a topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic or term' },
            desiredCount: { type: 'number', description: 'Desired count (1-12, default 5)' },
          },
          required: ['topic'],
        },
      },
      {
        name: 'plan_interview_yaml',
        description: 'Convert requirements into a structured authoring plan.',
        inputSchema: {
          type: 'object',
          properties: {
            requirements: { type: 'string' },
            assumptions: { type: 'array', items: { type: 'string' } },
            constraints: { type: 'array', items: { type: 'string' } },
            strictness: { type: 'string', enum: ['strict', 'strict_plus_search'] },
          },
          required: ['requirements'],
        },
      },
      {
        name: 'generate_interview_yaml',
        description: 'Generate complete interview YAML with citations.',
        inputSchema: {
          type: 'object',
          properties: {
            inputMode: { type: 'string', enum: ['requirements', 'plan', 'spec'] },
            requirements: { type: 'string' },
            plan: { type: 'object' },
            spec: { type: 'object' },
            style: { type: 'object' },
            groundingMode: { type: 'string', enum: ['strict', 'strict_plus_search'] },
          },
          required: ['inputMode'],
        },
      },
      {
        name: 'validate_interview_yaml',
        description: 'Validate YAML syntax and lint rules.',
        inputSchema: {
          type: 'object',
          properties: {
            yaml: { type: 'string' },
            mode: { type: 'string', enum: ['parse_only', 'lint'] },
          },
          required: ['yaml'],
        },
      },
      {
        name: 'explain_term',
        description: 'Explain a Docassemble term with citations.',
        inputSchema: {
          type: 'object',
          properties: {
            term: { type: 'string' },
          },
          required: ['term'],
        },
      },
    ],
  };
}

async function handleToolsCall(params: { name: string; arguments?: Record<string, unknown> }) {
  const { name, arguments: args } = params;

  switch (name) {
    case 'search_sources': {
      const input = SearchSourcesInputSchema.parse(args);
      const result = toolsManager.searchSources(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'get_authoritative_snippets': {
      const input = GetAuthoritativeSnippetsInputSchema.parse(args);
      const result = toolsManager.getAuthoritativeSnippets(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'plan_interview_yaml': {
      const input = PlanInterviewYamlInputSchema.parse(args);
      const result = toolsManager.planInterviewYaml(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'generate_interview_yaml': {
      const input = GenerateInterviewYamlInputSchema.parse(args);
      const result = toolsManager.generateInterviewYaml(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'validate_interview_yaml': {
      const input = ValidateInterviewYamlInputSchema.parse(args);
      const result = toolsManager.validateInterviewYaml(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'explain_term': {
      const input = ExplainTermInputSchema.parse(args);
      const result = toolsManager.explainTerm(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleResourcesList() {
  const resources = resourceManager.listResources();
  return {
    resources: resources.map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  };
}

async function handleResourcesRead(params: { uri: string }) {
  const { uri } = params;

  if (uri === 'docassemble://start-here') {
    const resource = resourceManager.getStartHereResource();
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
  }

  if (uri === 'docassemble://examples-library') {
    const resource = resourceManager.getExamplesLibraryResource();
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
  }

  if (uri === 'docassemble://keyword-reference') {
    const resource = resourceManager.getKeywordReferenceResource();
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
  }

  if (uri === 'docassemble://patterns-cookbook') {
    const resource = resourceManager.getPatternsCookbookResource();
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
  }

  if (uri.startsWith('docassemble://examples/')) {
    const exampleName = uri.replace('docassemble://examples/', '');
    const resource = resourceManager.getExampleContent(exampleName);
    if (resource) {
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }
  }

  if (uri.startsWith('docassemble://files/')) {
    const relativePath = uri.replace('docassemble://files/', '');
    const resource = resourceManager.getFileContent(relativePath);
    if (resource) {
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
    }
  }

  throw new Error(`Resource not found: ${uri}`);
}

async function handlePromptsList() {
  const prompts = listPrompts();
  return {
    prompts: prompts.map(p => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  };
}

async function handlePromptsGet(params: { name: string; arguments?: Record<string, string> }) {
  const { name, arguments: args } = params;
  const prompt = getPrompt(name);

  if (!prompt) {
    throw new Error(`Prompt not found: ${name}`);
  }

  const messages = getPromptMessages(name, args || {});

  return {
    description: prompt.description,
    messages: messages.map(m => ({
      role: m.role,
      content: { type: 'text', text: m.content },
    })),
  };
}

async function startStdioServer(): Promise<void> {
  await initializeIndex();
  
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('MCP Docassemble Interviews server running on stdio');
}

const args = process.argv.slice(2);
if (args.includes('--stdio')) {
  startStdioServer().catch(console.error);
} else {
  startHttpServer().catch(console.error);
}
