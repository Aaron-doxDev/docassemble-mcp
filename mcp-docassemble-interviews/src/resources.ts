import { DocassembleIndex, IndexedFile, Citation } from './indexer.js';

export interface ResourceContent {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  content: string;
}

export interface KeywordReference {
  name: string;
  purpose: string;
  supportedFields: string[];
  minimalSnippet: string;
  citations: Citation[];
}

export interface PatternEntry {
  name: string;
  description: string;
  minimalExample: string;
  citations: Citation[];
}

const EXAMPLE_CATEGORIES = [
  { category: 'Formatting', examples: ['markdown', 'terms', 'auto-terms'] },
  { category: 'Mako templating', examples: ['mako-01', 'mako-02', 'mako-03', 'mako-04', 'mako-05', 'mako-09'] },
  { category: 'Documents', examples: ['document', 'formatting', 'page-numbers', 'alignment', 'attachment-code', 'valid-formats', 'document-docx'] },
  { category: 'PDF & DOCX templates', examples: ['pdf-fill', 'pdf-fill-signature', 'pdf-fill-code', 'docx-template'] },
  { category: 'Fields', examples: ['text-field', 'text-box-field', 'date-field', 'money-field', 'number-field', 'email-field', 'password-field'] },
  { category: 'Multiple choice', examples: ['yesno', 'noyes', 'yesnomaybe', 'buttons', 'buttons-labels', 'choices', 'fields-checkboxes'] },
  { category: 'Files', examples: ['upload', 'upload-multiple', 'signature'] },
  { category: 'Objects', examples: ['objects', 'object', 'object-radio', 'generic-object'] },
  { category: 'Interview flow', examples: ['need', 'reset', 'actions', 'review', 'prevent-back', 'force-ask', 'force-gather'] },
  { category: 'Groups', examples: ['for_fruit', 'gather-fruit', 'gather-dict', 'nested-loop'] },
  { category: 'Code', examples: ['imports', 'modules', 'code', 'initial', 'mandatory', 'reconsider'] },
  { category: 'Sections', examples: ['sections', 'sections-keywords', 'sections-keywords-review'] },
  { category: 'Review screens', examples: ['review', 'review-1', 'review-2', 'review-3', 'review-tabular'] },
];

const KEYWORD_DEFINITIONS: Record<string, { purpose: string; supportedFields: string[] }> = {
  'question': {
    purpose: 'Defines a question block that displays content and collects user input',
    supportedFields: ['subquestion', 'fields', 'buttons', 'choices', 'signature', 'under', 'help', 'terms', 'audio', 'video', 'decoration', 'css class', 'script', 'html', 'continue button field', 'continue button label', 'back button', 'corner back button', 'prevent going back', 'id', 'comment'],
  },
  'fields': {
    purpose: 'Defines input fields within a question block for collecting user data',
    supportedFields: ['datatype', 'default', 'required', 'hint', 'help', 'label', 'choices', 'code', 'show if', 'hide if', 'js show if', 'js hide if', 'disable others', 'uncheck others', 'none of the above', 'all of the above', 'min', 'max', 'minlength', 'maxlength', 'step', 'scale', 'shuffle', 'input type', 'rows', 'accept', 'address autocomplete', 'geocode'],
  },
  'mandatory': {
    purpose: 'Marks a block as required for interview completion, controlling interview flow',
    supportedFields: [],
  },
  'code': {
    purpose: 'Defines a code block containing Python code that sets variables or performs logic',
    supportedFields: [],
  },
  'attachment': {
    purpose: 'Defines a single document attachment to be generated',
    supportedFields: ['name', 'filename', 'content', 'docx template file', 'pdf template file', 'variable name', 'valid formats', 'description', 'skip undefined', 'pdf/a', 'tagged pdf', 'editable', 'decimal places', 'language', 'raw'],
  },
  'attachments': {
    purpose: 'Defines multiple document attachments to be generated',
    supportedFields: ['name', 'filename', 'content', 'docx template file', 'pdf template file', 'variable name', 'valid formats', 'description', 'code'],
  },
  'objects': {
    purpose: 'Declares object instances to be used in the interview',
    supportedFields: [],
  },
  'include': {
    purpose: 'Includes another YAML file into the current interview',
    supportedFields: [],
  },
  'metadata': {
    purpose: 'Defines interview metadata like title, short title, and documentation links',
    supportedFields: ['title', 'short title', 'description', 'authors', 'revision_date', 'documentation', 'example start', 'example end', 'tags', 'required privileges', 'temporary session', 'exit link', 'exit label', 'exit url', 'unlisted', 'hidden', 'sessions are unique', 'post', 'error help', 'error action', 'title url', 'title url opens in other window', 'logo', 'tab title', 'short logo', 'css', 'javascript', 'inverse navbar', 'bootstrap theme', 'navigation bar html'],
  },
  'review': {
    purpose: 'Defines a review screen that allows users to review and edit their answers',
    supportedFields: ['button', 'note', 'html', 'show if', 'hide if', 'field', 'edit', 'delete buttons', 'help', 'css class'],
  },
  'event': {
    purpose: 'Defines an event block that can be triggered by actions',
    supportedFields: [],
  },
  'sets': {
    purpose: 'Specifies which variables a question or code block sets',
    supportedFields: [],
  },
  'template': {
    purpose: 'Defines a reusable text template',
    supportedFields: ['subject', 'content', 'content file'],
  },
  'table': {
    purpose: 'Defines a table for displaying list or dictionary data',
    supportedFields: ['rows', 'columns', 'edit', 'delete buttons', 'confirm', 'require gathered', 'show if empty', 'not available label', 'css class', 'header row'],
  },
  'initial': {
    purpose: 'Marks a code block to run at the beginning of each screen load',
    supportedFields: [],
  },
  'sections': {
    purpose: 'Defines navigation sections for the interview',
    supportedFields: [],
  },
  'features': {
    purpose: 'Configures interview features like navigation, progress bar, etc.',
    supportedFields: ['navigation', 'progress bar', 'progress bar method', 'progress bar multiplier', 'show progress bar percentage', 'question back button', 'question help button', 'navigation back button', 'centered', 'cache documents', 'go full screen', 'javascript', 'css', 'bootstrap theme', 'inverse navbar', 'hide navbar', 'hide standard menu', 'labels above fields', 'small screen navigation', 'debug', 'pdftk', 'maximum image size', 'image upload type', 'use font awesome', 'default date min', 'default date max'],
  },
  'default role': {
    purpose: 'Sets the default role for the interview',
    supportedFields: [],
  },
  'generic object': {
    purpose: 'Defines a question that applies to any object of a given type',
    supportedFields: [],
  },
  'validation code': {
    purpose: 'Python code that validates field input',
    supportedFields: [],
  },
  'datatype': {
    purpose: 'Specifies the type of data a field collects',
    supportedFields: [],
  },
};

const PATTERN_DEFINITIONS: PatternEntry[] = [
  {
    name: 'Basic Question with Fields',
    description: 'Collect user input using a question block with fields',
    minimalExample: `question: |
  What is your name?
fields:
  - First name: user_first_name
  - Last name: user_last_name`,
    citations: [],
  },
  {
    name: 'Yes/No Question',
    description: 'Ask a yes/no question using yesno datatype',
    minimalExample: `question: |
  Do you agree to the terms?
yesno: agrees_to_terms`,
    citations: [],
  },
  {
    name: 'Multiple Choice with Buttons',
    description: 'Present choices as buttons for user selection',
    minimalExample: `question: |
  What is your favorite color?
buttons:
  - Red: red
  - Blue: blue
  - Green: green
field: favorite_color`,
    citations: [],
  },
  {
    name: 'Conditional Logic',
    description: 'Show different questions based on previous answers',
    minimalExample: `question: |
  What is your age?
fields:
  - Age: user_age
    datatype: integer
---
question: |
  % if user_age >= 18:
  You are an adult.
  % else:
  You are a minor.
  % endif
mandatory: True`,
    citations: [],
  },
  {
    name: 'Review Screen',
    description: 'Allow users to review and edit their answers',
    minimalExample: `question: |
  Review your answers
review:
  - Edit name: user_name
    button: |
      Name: \${ user_name }
  - Edit address: user_address
    button: |
      Address: \${ user_address }
continue button field: review_complete`,
    citations: [],
  },
  {
    name: 'Document Generation',
    description: 'Generate a document from collected data',
    minimalExample: `question: |
  Here is your document.
attachments:
  - name: Summary Document
    filename: summary
    content: |
      [BOLDCENTER] Summary
      
      Name: \${ user_name }
      Date: \${ today() }
mandatory: True`,
    citations: [],
  },
  {
    name: 'List Collection',
    description: 'Collect a list of items from the user',
    minimalExample: `objects:
  - fruits: DAList
---
question: |
  What fruits do you like?
fields:
  - Fruit: fruits[i]
list collect: True`,
    citations: [],
  },
  {
    name: 'Signature Collection',
    description: 'Collect a signature from the user',
    minimalExample: `question: |
  Please sign below.
signature: user_signature`,
    citations: [],
  },
  {
    name: 'Sections Navigation',
    description: 'Add navigation sections to the interview',
    minimalExample: `sections:
  - Introduction
  - Personal Information
  - Review
  - Download
---
features:
  navigation: True
  progress bar: True`,
    citations: [],
  },
  {
    name: 'Code Block for Logic',
    description: 'Use code blocks to set variables based on logic',
    minimalExample: `code: |
  if income < 30000:
    eligibility = "eligible"
  else:
    eligibility = "not eligible"`,
    citations: [],
  },
];

export class ResourceManager {
  private index: DocassembleIndex;

  constructor(index: DocassembleIndex) {
    this.index = index;
  }

  getStartHereResource(): ResourceContent {
    const content = this.buildStartHereContent();
    return {
      uri: 'docassemble://start-here',
      name: 'Docassemble Interview Authoring Start Here',
      description: 'A curated map of the most relevant docs, example YAML interviews, and notes on what each covers',
      mimeType: 'text/markdown',
      content,
    };
  }

  private buildStartHereContent(): string {
    const stats = this.index.getStats();
    let content = `# Docassemble Interview Authoring - Start Here

## Overview

This MCP server provides citation-backed reference material for authoring Docassemble interviews.
All syntax and patterns are grounded in the official Docassemble repository.

**Index Statistics:**
- Total indexed files: ${stats.totalFiles}
- Example YAML files: ${stats.examples}
- Template files: ${stats.templates}
- Indexed keywords: ${stats.keywords}

## Key Concepts

### Interview Structure
A Docassemble interview is a YAML file containing blocks separated by \`---\`.
Common block types include:
- **question blocks**: Display content and collect user input
- **code blocks**: Execute Python logic
- **mandatory blocks**: Control interview flow
- **attachment blocks**: Generate documents

### Example Categories

`;

    for (const cat of EXAMPLE_CATEGORIES) {
      content += `#### ${cat.category}\n`;
      for (const example of cat.examples) {
        const file = this.index.getExampleByName(example);
        if (file) {
          const title = file.metadata?.title || example;
          const doc = file.metadata?.documentation || '';
          content += `- **${example}**: ${title}${doc ? ` ([docs](${doc}))` : ''}\n`;
        } else {
          content += `- **${example}**\n`;
        }
      }
      content += '\n';
    }

    content += `## Quick Reference

### Essential Keywords
- \`question\`: Define a question screen
- \`fields\`: Collect user input
- \`mandatory\`: Mark required blocks
- \`code\`: Execute Python logic
- \`attachments\`: Generate documents
- \`review\`: Create review screens
- \`sections\`: Add navigation

### Getting Started
1. Use \`search_sources\` to find relevant examples
2. Use \`explain_term\` to understand specific keywords
3. Use \`plan_interview_yaml\` to create an authoring plan
4. Use \`generate_interview_yaml\` to produce the final YAML
5. Use \`validate_interview_yaml\` to check for errors
`;

    return content;
  }

  getExamplesLibraryResource(): ResourceContent {
    const examples = this.index.getAllExamples();
    let content = `# Interview YAML Examples Library

Total examples: ${examples.length}

## Examples by Category

`;

    for (const cat of EXAMPLE_CATEGORIES) {
      content += `### ${cat.category}\n\n`;
      for (const exampleName of cat.examples) {
        const file = this.index.getExampleByName(exampleName);
        if (file) {
          const title = file.metadata?.title || exampleName;
          content += `#### ${exampleName}\n`;
          content += `- **Title**: ${title}\n`;
          content += `- **Path**: ${file.relativePath}\n`;
          if (file.metadata?.documentation) {
            content += `- **Documentation**: ${file.metadata.documentation}\n`;
          }
          content += `- **Lines**: ${file.lines.length}\n`;
          content += `- **URI**: docassemble://examples/${exampleName}\n\n`;
        }
      }
    }

    content += `## All Examples (alphabetical)\n\n`;
    const sortedExamples = [...examples].sort((a, b) => 
      a.relativePath.localeCompare(b.relativePath)
    );

    for (const file of sortedExamples.slice(0, 100)) {
      const name = file.relativePath.split('/').pop()?.replace('.yml', '') || '';
      content += `- ${name}: ${file.relativePath}\n`;
    }

    if (sortedExamples.length > 100) {
      content += `\n... and ${sortedExamples.length - 100} more examples\n`;
    }

    return {
      uri: 'docassemble://examples-library',
      name: 'Interview YAML Examples Library',
      description: 'Directory listing of example YAML interviews with metadata',
      mimeType: 'text/markdown',
      content,
    };
  }

  getKeywordReferenceResource(): ResourceContent {
    let content = `# Keyword / Block Reference (Citation-Backed)

This reference documents confirmed Docassemble YAML keywords and blocks.
Each entry includes citations to source files.

`;

    for (const [keyword, def] of Object.entries(KEYWORD_DEFINITIONS)) {
      const files = this.index.getFilesWithKeyword(keyword);
      const citations: Citation[] = [];

      for (const file of files.slice(0, 3)) {
        for (let i = 0; i < file.lines.length; i++) {
          if (file.lines[i].toLowerCase().includes(keyword.toLowerCase())) {
            const citation = this.index.createCitation(
              file.relativePath,
              Math.max(1, i - 1),
              Math.min(file.lines.length, i + 4),
              `Example usage of ${keyword}`
            );
            if (citation) {
              citations.push(citation);
              break;
            }
          }
        }
      }

      content += `## ${keyword}\n\n`;
      content += `**Purpose**: ${def.purpose}\n\n`;

      if (def.supportedFields.length > 0) {
        content += `**Supported fields/options**:\n`;
        for (const field of def.supportedFields) {
          content += `- ${field}\n`;
        }
        content += '\n';
      }

      if (citations.length > 0) {
        content += `**Example** (from ${citations[0].path} L${citations[0].lineStart}-${citations[0].lineEnd}):\n`;
        content += '```yaml\n';
        content += citations[0].excerpt;
        content += '\n```\n\n';
      }

      content += `**Found in ${files.length} example files**\n\n`;
      content += '---\n\n';
    }

    return {
      uri: 'docassemble://keyword-reference',
      name: 'Keyword / Block Reference',
      description: 'Citation-backed reference for Docassemble YAML keywords and blocks',
      mimeType: 'text/markdown',
      content,
    };
  }

  getPatternsCookbookResource(): ResourceContent {
    let content = `# Patterns Cookbook

Common interview patterns with minimal examples and citations.

`;

    for (const pattern of PATTERN_DEFINITIONS) {
      const searchResults = this.index.search(pattern.name.toLowerCase(), { maxResults: 3 });

      content += `## ${pattern.name}\n\n`;
      content += `${pattern.description}\n\n`;
      content += `**Minimal Example**:\n`;
      content += '```yaml\n';
      content += pattern.minimalExample;
      content += '\n```\n\n';

      if (searchResults.length > 0) {
        content += `**Related Examples**:\n`;
        for (const result of searchResults) {
          content += `- ${result.relativePath} (L${result.lineStart}-${result.lineEnd})\n`;
        }
        content += '\n';
      }

      content += '---\n\n';
    }

    return {
      uri: 'docassemble://patterns-cookbook',
      name: 'Patterns Cookbook',
      description: 'Common interview patterns with examples and citations',
      mimeType: 'text/markdown',
      content,
    };
  }

  getExampleContent(exampleName: string): ResourceContent | null {
    const file = this.index.getExampleByName(exampleName);
    if (!file) return null;

    return {
      uri: `docassemble://examples/${exampleName}`,
      name: file.metadata?.title || exampleName,
      description: `Example YAML interview: ${exampleName}`,
      mimeType: 'text/yaml',
      content: file.content,
    };
  }

  getFileContent(relativePath: string): ResourceContent | null {
    const file = this.index.getFile(relativePath);
    if (!file) return null;

    const ext = relativePath.split('.').pop() || '';
    const mimeType = ext === 'yml' || ext === 'yaml' ? 'text/yaml' : 'text/plain';

    return {
      uri: `docassemble://files/${relativePath}`,
      name: relativePath,
      description: `File: ${relativePath}`,
      mimeType,
      content: file.content,
    };
  }

  listResources(): Array<{ uri: string; name: string; description: string; mimeType: string }> {
    const resources = [
      {
        uri: 'docassemble://start-here',
        name: 'Docassemble Interview Authoring Start Here',
        description: 'A curated map of the most relevant docs, example YAML interviews, and notes on what each covers',
        mimeType: 'text/markdown',
      },
      {
        uri: 'docassemble://examples-library',
        name: 'Interview YAML Examples Library',
        description: 'Directory listing of example YAML interviews with metadata',
        mimeType: 'text/markdown',
      },
      {
        uri: 'docassemble://keyword-reference',
        name: 'Keyword / Block Reference',
        description: 'Citation-backed reference for Docassemble YAML keywords and blocks',
        mimeType: 'text/markdown',
      },
      {
        uri: 'docassemble://patterns-cookbook',
        name: 'Patterns Cookbook',
        description: 'Common interview patterns with examples and citations',
        mimeType: 'text/markdown',
      },
    ];

    const examples = this.index.getAllExamples();
    for (const example of examples.slice(0, 50)) {
      const name = example.relativePath.split('/').pop()?.replace('.yml', '') || '';
      resources.push({
        uri: `docassemble://examples/${name}`,
        name: example.metadata?.title || name,
        description: `Example YAML interview: ${name}`,
        mimeType: 'text/yaml',
      });
    }

    return resources;
  }
}
