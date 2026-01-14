export interface PromptDefinition {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    name: 'conversational-interview-builder',
    description: 'Helps build a Docassemble interview through natural conversation. Guides the user through requirements gathering, creates a plan, generates YAML, and validates the result.',
    arguments: [
      {
        name: 'initial_requirements',
        description: 'Initial description of what the interview should do (optional - will ask if not provided)',
        required: false,
      },
    ],
  },
  {
    name: 'iterate-modify-interview',
    description: 'Helps modify an existing Docassemble interview YAML. Validates the current YAML, identifies requested changes, and produces an updated version with citations.',
    arguments: [
      {
        name: 'current_yaml',
        description: 'The current interview YAML content to modify',
        required: true,
      },
      {
        name: 'requested_changes',
        description: 'Description of the changes to make',
        required: true,
      },
    ],
  },
  {
    name: 'debug-interview-yaml',
    description: 'Helps debug issues in a Docassemble interview YAML. Runs validation, explains errors in plain language, and provides fix suggestions with citations.',
    arguments: [
      {
        name: 'yaml_content',
        description: 'The interview YAML content to debug',
        required: true,
      },
      {
        name: 'error_description',
        description: 'Optional description of the error or issue being experienced',
        required: false,
      },
    ],
  },
];

export function getPromptMessages(
  promptName: string,
  args: Record<string, string>
): PromptMessage[] {
  switch (promptName) {
    case 'conversational-interview-builder':
      return getConversationalInterviewBuilderMessages(args);
    case 'iterate-modify-interview':
      return getIterateModifyInterviewMessages(args);
    case 'debug-interview-yaml':
      return getDebugInterviewYamlMessages(args);
    default:
      return [
        {
          role: 'user',
          content: `Unknown prompt: ${promptName}`,
        },
      ];
  }
}

function getConversationalInterviewBuilderMessages(
  args: Record<string, string>
): PromptMessage[] {
  const initialRequirements = args.initial_requirements || '';

  const systemInstructions = `You are a Docassemble Interview Authoring Assistant. Your role is to help users create complete, correct Docassemble interview YAML files through natural conversation.

## Your Workflow

1. **Gather Requirements** (if not provided or incomplete)
   - Ask 3-8 targeted clarification questions about:
     - What information the interview should collect
     - What documents (if any) should be generated
     - Any conditional logic or branching needed
     - Whether a review screen is needed
     - Target audience and use case

2. **Create a Plan**
   - Use the \`plan_interview_yaml\` tool to create a structured plan
   - Review the plan's open questions and ask the user about them
   - Confirm the plan with the user before proceeding

3. **Generate YAML**
   - Use the \`generate_interview_yaml\` tool to create the interview
   - Include citations in comments for transparency

4. **Validate**
   - Use the \`validate_interview_yaml\` tool to check for errors
   - Fix any issues found

5. **Present Results**
   - Show the final YAML to the user
   - Provide a summary of what's included
   - List any warnings or next steps

## Important Rules

- NEVER invent Docassemble syntax. Only use constructs confirmed in the sources.
- Always cite sources for non-trivial syntax choices.
- If something cannot be confirmed in sources, say "UNKNOWN / NOT CONFIRMED IN SOURCES".
- Use the \`search_sources\` and \`get_authoritative_snippets\` tools to find examples.
- Use the \`explain_term\` tool to understand specific keywords.

## Available Tools

- \`search_sources\`: Find relevant passages in docs/examples
- \`get_authoritative_snippets\`: Get authoritative snippets for a topic
- \`plan_interview_yaml\`: Create a structured authoring plan
- \`generate_interview_yaml\`: Generate complete interview YAML
- \`validate_interview_yaml\`: Validate YAML syntax and lint rules
- \`explain_term\`: Get authoritative explanation for a term`;

  if (initialRequirements) {
    return [
      {
        role: 'user',
        content: `${systemInstructions}

---

The user wants to create a Docassemble interview with these initial requirements:

${initialRequirements}

Please analyze these requirements and either:
1. Ask clarifying questions if the requirements are incomplete
2. Create a plan using plan_interview_yaml if requirements are clear enough

Remember to use the tools to ground your responses in the actual Docassemble documentation and examples.`,
      },
    ];
  }

  return [
    {
      role: 'user',
      content: `${systemInstructions}

---

The user wants to create a Docassemble interview but hasn't provided specific requirements yet.

Please start by asking them what kind of interview they want to create. Ask about:
1. What is the purpose of the interview?
2. What information should it collect?
3. Should it generate any documents?
4. Are there any special requirements (conditional logic, review screens, etc.)?`,
    },
  ];
}

function getIterateModifyInterviewMessages(
  args: Record<string, string>
): PromptMessage[] {
  const currentYaml = args.current_yaml || '';
  const requestedChanges = args.requested_changes || '';

  return [
    {
      role: 'user',
      content: `You are a Docassemble Interview Modification Assistant. Your role is to help users modify existing Docassemble interview YAML files.

## Your Workflow

1. **Validate Current YAML**
   - Use \`validate_interview_yaml\` to check the current YAML for errors
   - Report any existing issues

2. **Understand the Changes**
   - Analyze the requested changes
   - Use \`search_sources\` and \`get_authoritative_snippets\` to find relevant examples for any new constructs needed

3. **Plan the Modifications**
   - Identify which sections need to be modified
   - Determine if any new blocks need to be added
   - Check if any variables need to be renamed or added

4. **Generate Modified YAML**
   - Apply the changes while preserving existing functionality
   - Add citations for any new constructs
   - Maintain consistent style with the original

5. **Validate Again**
   - Use \`validate_interview_yaml\` on the modified YAML
   - Fix any issues introduced by the changes

6. **Present Results**
   - Show the modified YAML
   - Summarize what was changed
   - Highlight any warnings or considerations

## Important Rules

- NEVER invent Docassemble syntax. Only use constructs confirmed in the sources.
- Preserve existing functionality unless explicitly asked to remove it.
- Always validate before and after modifications.
- Cite sources for any new constructs added.

---

## Current YAML to Modify

\`\`\`yaml
${currentYaml}
\`\`\`

## Requested Changes

${requestedChanges}

Please start by validating the current YAML, then analyze the requested changes and determine what modifications are needed.`,
    },
  ];
}

function getDebugInterviewYamlMessages(
  args: Record<string, string>
): PromptMessage[] {
  const yamlContent = args.yaml_content || '';
  const errorDescription = args.error_description || '';

  let userMessage = `You are a Docassemble Interview Debugging Assistant. Your role is to help users fix issues in their Docassemble interview YAML files.

## Your Workflow

1. **Run Validation**
   - Use \`validate_interview_yaml\` with mode "lint" to check for all issues
   - Collect all errors and warnings

2. **Explain Each Issue**
   - For each error/warning, explain in plain language what's wrong
   - Use \`explain_term\` to provide context for relevant keywords
   - Cite sources that show the correct usage

3. **Provide Fix Suggestions**
   - For each issue, provide a specific fix suggestion
   - Show the corrected code snippet
   - Explain why the fix works

4. **Re-validate**
   - After suggesting fixes, show what the corrected YAML would look like
   - Validate the corrected version to confirm fixes work

## Important Rules

- NEVER guess at fixes. Only suggest fixes that are confirmed in sources.
- Explain errors in plain, non-technical language when possible.
- Provide citations for correct syntax.
- If an issue cannot be diagnosed, say so clearly.

---

## YAML to Debug

\`\`\`yaml
${yamlContent}
\`\`\``;

  if (errorDescription) {
    userMessage += `

## User-Reported Error/Issue

${errorDescription}`;
  }

  userMessage += `

Please start by running validation on this YAML and then explain any issues found.`;

  return [
    {
      role: 'user',
      content: userMessage,
    },
  ];
}

export function listPrompts(): PromptDefinition[] {
  return PROMPT_DEFINITIONS;
}

export function getPrompt(name: string): PromptDefinition | undefined {
  return PROMPT_DEFINITIONS.find(p => p.name === name);
}
