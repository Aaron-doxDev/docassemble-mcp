# MCP Docassemble Interviews Server

A **remote MCP (Model Context Protocol) server** that helps AI clients generate Docassemble "interviews" and YAML files correctly. This server acts as a **citation-backed reference and YAML generator** grounded in the official Docassemble repository.

## Overview

This MCP server is designed to be a "Docassemble Interview Authoring Copilot Knowledge Base + Generator". It enables AI clients (like Claude or Devin) to:

1. Look up authoritative patterns and keywords from the Docassemble documentation and examples
2. Propose grounded YAML sections with citations
3. Iteratively refine interview YAML based on user feedback
4. Validate YAML continuously
5. Deliver complete, correct interview YAML files

**Key Principle**: The server NEVER invents Docassemble YAML syntax. Every tool output that describes syntax, keywords, blocks, or patterns cites exact sources from the repository.

## Features

### Resources (Read-Only Reference Material)

- **Start Here** (`docassemble://start-here`): Curated map of relevant docs, examples, and what each covers
- **Examples Library** (`docassemble://examples-library`): Directory listing of 800+ example YAML interviews
- **Keyword Reference** (`docassemble://keyword-reference`): Citation-backed reference for all YAML keywords
- **Patterns Cookbook** (`docassemble://patterns-cookbook`): Common interview patterns with examples

### Tools (High-Level Authoring Tools)

1. **search_sources**: Find relevant passages in docs/examples with citations
2. **get_authoritative_snippets**: Get authoritative snippets for a topic with deduplication
3. **plan_interview_yaml**: Convert natural-language requirements into a structured authoring plan
4. **generate_interview_yaml**: Generate complete interview YAML with citations
5. **validate_interview_yaml**: Validate YAML syntax and lint rules
6. **explain_term**: Get authoritative explanation for any Docassemble term

### Prompts (Conversational Workflows)

1. **Conversational Interview Builder**: Guides users through requirements gathering, planning, generation, and validation
2. **Iterate/Modify Interview**: Helps modify existing interview YAML with citations
3. **Debug Interview YAML**: Diagnoses and fixes issues with explanations

## Installation

```bash
cd mcp-docassemble-interviews
npm install
npm run build
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `MCP_AUTH_TOKEN` | Bearer token for authenticating MCP clients | Yes |
| `MCP_ALLOWED_ORIGINS` | Comma-separated list of allowed origins for DNS rebinding protection | Yes |
| `PORT` | Port to run the server on (default: 3000) | No |
| `DOCASSEMBLE_REF_PATH` | Path to the docassemble reference repository | No |

## Running the Server

### HTTP Mode (Streamable HTTP Transport)

```bash
npm start
```

The server will start on the configured port (default: 3000) with the MCP endpoint at `/mcp`.

### Stdio Mode (for local MCP clients)

```bash
npm start -- --stdio
```

## API Endpoints

### `GET /mcp`

Returns server information and capabilities.

### `POST /mcp`

Main MCP endpoint for JSON-RPC requests. Supports:

- `initialize`: Initialize the MCP session
- `tools/list`: List available tools
- `tools/call`: Call a tool
- `resources/list`: List available resources
- `resources/read`: Read a resource
- `prompts/list`: List available prompts
- `prompts/get`: Get a prompt

### `GET /health`

Health check endpoint returning server status and index statistics.

## Authentication

All requests to `/mcp` require:

1. **Bearer Token**: `Authorization: Bearer <MCP_AUTH_TOKEN>`
2. **Origin Header**: Must be in the `MCP_ALLOWED_ORIGINS` allowlist

## Using with Claude

### Connecting to the Server

Configure Claude to connect to this MCP server using the Streamable HTTP transport:

```json
{
  "mcpServers": {
    "docassemble": {
      "transport": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### Using the Conversational Interview Builder

The recommended way to create interviews is using the "Conversational Interview Builder" prompt:

1. Start a conversation with Claude
2. Ask Claude to use the `conversational-interview-builder` prompt
3. Describe what kind of interview you want to create
4. Claude will:
   - Ask clarifying questions if needed
   - Create a plan using `plan_interview_yaml`
   - Generate YAML using `generate_interview_yaml`
   - Validate using `validate_interview_yaml`
   - Present the final YAML with citations

**Example conversation:**

```
User: I need an interview that collects name, address, and eligibility information, 
      then generates a summary document.

Claude: [Uses plan_interview_yaml to create a plan]
        [Asks clarifying questions about eligibility criteria]
        [Uses generate_interview_yaml to create the YAML]
        [Uses validate_interview_yaml to check for errors]
        [Presents the final YAML with citations]
```

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Development Mode

```bash
npm run dev
```

## Testing with MCP Inspector

You can test the server using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

## Architecture

```
mcp-docassemble-interviews/
├── src/
│   ├── index.ts      # Main server with HTTP transport
│   ├── indexer.ts    # Document indexing and search
│   ├── resources.ts  # MCP resources implementation
│   ├── tools.ts      # MCP tools implementation
│   └── prompts.ts    # MCP prompts implementation
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Citation Format

All citations follow this format:

```
{
  "path": "relative/path/to/file.yml",
  "lineStart": 1,
  "lineEnd": 10,
  "excerpt": "...",
  "reason": "Why this citation is relevant"
}
```

## Limitations

- **Read-Only**: This server does not write files or modify repositories
- **Offline Operation**: Does not require a running Docassemble instance
- **No Hallucination**: Returns "UNKNOWN / NOT CONFIRMED IN SOURCES" when sources don't support a construct

## License

MIT
