import { z } from 'zod';
import * as yaml from 'yaml';
import { DocassembleIndex, SearchResult, Citation, SearchScope } from './indexer.js';

export const SearchSourcesInputSchema = z.object({
  query: z.string().describe('Search query string'),
  maxResults: z.number().int().min(1).max(25).default(8).describe('Maximum number of results to return'),
  scope: z.enum(['docs', 'examples', 'docs_and_examples', 'all']).default('docs_and_examples').describe('Scope of search'),
  fileGlobs: z.array(z.string()).optional().describe('Optional file glob patterns to filter results'),
});

export const GetAuthoritativeSnippetsInputSchema = z.object({
  topic: z.string().describe('Topic or term to find authoritative snippets for'),
  desiredCount: z.number().int().min(1).max(12).default(5).describe('Desired number of snippets'),
});

export const PlanInterviewYamlInputSchema = z.object({
  requirements: z.string().describe('User\'s natural-language requirements for the interview'),
  assumptions: z.array(z.string()).optional().describe('Assumptions to make'),
  constraints: z.array(z.string()).optional().describe('Constraints to apply'),
  strictness: z.enum(['strict', 'strict_plus_search']).default('strict_plus_search').describe('Strictness mode'),
});

export const GenerateInterviewYamlInputSchema = z.object({
  inputMode: z.enum(['requirements', 'plan', 'spec']).describe('Input mode'),
  requirements: z.string().optional().describe('Requirements string (if inputMode=requirements)'),
  plan: z.any().optional().describe('Plan object (if inputMode=plan)'),
  spec: z.any().optional().describe('Spec object (if inputMode=spec)'),
  style: z.object({
    commentsInYaml: z.boolean().default(true),
    includeDocCitationsInComments: z.boolean().default(true),
    readability: z.enum(['compact', 'readable']).default('readable'),
  }).optional(),
  groundingMode: z.enum(['strict', 'strict_plus_search']).default('strict_plus_search'),
});

export const ValidateInterviewYamlInputSchema = z.object({
  yaml: z.string().describe('YAML content to validate'),
  mode: z.enum(['parse_only', 'lint']).default('lint').describe('Validation mode'),
});

export const ExplainTermInputSchema = z.object({
  term: z.string().describe('Term to explain'),
});

export interface SearchSourcesOutput {
  results: Array<{
    path: string;
    lineStart: number;
    lineEnd: number;
    excerpt: string;
    score: number;
  }>;
  suggestedNextQueries: string[];
  notes: string[];
}

export interface GetAuthoritativeSnippetsOutput {
  snippets: Array<{
    path: string;
    lineStart: number;
    lineEnd: number;
    excerpt: string;
    whyThisMatters: string;
  }>;
  coverageGaps: string[];
}

export interface PlanSection {
  name: string;
  intent: string;
  proposedYamlBlocks: string[];
  neededVariables: string[];
  citations: Citation[];
}

export interface PlanInterviewYamlOutput {
  plan: {
    interviewTitle?: string;
    sections: PlanSection[];
    openQuestions: string[];
  };
  warnings: string[];
  citations: Citation[];
}

export interface GenerateInterviewYamlOutput {
  yaml: string;
  files: Array<{ suggestedPath: string; content: string }>;
  citations: Citation[];
  warnings: string[];
  nextSteps: string[];
}

export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
  ruleId?: string;
  citations?: Citation[];
}

export interface ValidationWarning {
  message: string;
  line?: number;
  ruleId?: string;
  citations?: Citation[];
}

export interface SuggestedFix {
  description: string;
  patchLikeHint: string;
  citations: Citation[];
}

export interface ValidateInterviewYamlOutput {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestedFixes: SuggestedFix[];
}

export interface ExplainTermOutput {
  explanation: string;
  citations: Citation[];
  examples: Array<{ snippet: string; citations: Citation[] }>;
}

export class ToolsManager {
  private index: DocassembleIndex;

  constructor(index: DocassembleIndex) {
    this.index = index;
  }

  searchSources(input: z.infer<typeof SearchSourcesInputSchema>): SearchSourcesOutput {
    const results = this.index.search(input.query, {
      maxResults: input.maxResults,
      scope: input.scope as SearchScope,
      fileGlobs: input.fileGlobs,
    });

    const suggestedNextQueries: string[] = [];
    const notes: string[] = [];

    const queryTerms = input.query.toLowerCase().split(/\s+/);
    const relatedTerms: Record<string, string[]> = {
      'question': ['fields', 'buttons', 'choices', 'subquestion'],
      'fields': ['datatype', 'required', 'default', 'show if'],
      'mandatory': ['code', 'question', 'initial'],
      'attachment': ['document', 'pdf', 'docx', 'template'],
      'review': ['edit', 'button', 'continue button field'],
      'list': ['DAList', 'gather', 'collect', 'for'],
      'object': ['DAObject', 'objects', 'generic object'],
    };

    for (const term of queryTerms) {
      if (relatedTerms[term]) {
        for (const related of relatedTerms[term]) {
          if (!queryTerms.includes(related)) {
            suggestedNextQueries.push(`${input.query} ${related}`);
          }
        }
      }
    }

    if (results.length === 0) {
      notes.push('No results found. Try broader search terms or different scope.');
      suggestedNextQueries.push(queryTerms[0] || 'question');
    }

    if (results.length > 0 && results[0].score < 20) {
      notes.push('Results have low relevance scores. Consider refining your query.');
    }

    return {
      results: results.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        score: r.score,
      })),
      suggestedNextQueries: suggestedNextQueries.slice(0, 5),
      notes,
    };
  }

  getAuthoritativeSnippets(input: z.infer<typeof GetAuthoritativeSnippetsInputSchema>): GetAuthoritativeSnippetsOutput {
    const snippets: GetAuthoritativeSnippetsOutput['snippets'] = [];
    const coverageGaps: string[] = [];

    const searchTerms = [
      input.topic,
      `${input.topic} example`,
      `${input.topic} usage`,
    ];

    const seenPaths = new Set<string>();

    for (const term of searchTerms) {
      const results = this.index.search(term, {
        maxResults: input.desiredCount * 2,
        scope: 'docs_and_examples',
      });

      for (const result of results) {
        if (seenPaths.has(result.relativePath)) continue;
        seenPaths.add(result.relativePath);

        const file = this.index.getFile(result.relativePath);
        let whyThisMatters = `Contains usage of "${input.topic}"`;

        if (file?.metadata?.title) {
          whyThisMatters = `Example: ${file.metadata.title}`;
        }

        snippets.push({
          path: result.relativePath,
          lineStart: result.lineStart,
          lineEnd: result.lineEnd,
          excerpt: result.excerpt,
          whyThisMatters,
        });

        if (snippets.length >= input.desiredCount) break;
      }

      if (snippets.length >= input.desiredCount) break;
    }

    if (snippets.length < input.desiredCount) {
      coverageGaps.push(`Only found ${snippets.length} snippets for "${input.topic}" (requested ${input.desiredCount})`);
    }

    const topicLower = input.topic.toLowerCase();
    const advancedTopics = ['machine learning', 'api', 'webhook', 'oauth', 'redis', 'database'];
    for (const advanced of advancedTopics) {
      if (topicLower.includes(advanced)) {
        coverageGaps.push(`"${advanced}" may require additional configuration not covered in basic examples`);
      }
    }

    return { snippets, coverageGaps };
  }

  planInterviewYaml(input: z.infer<typeof PlanInterviewYamlInputSchema>): PlanInterviewYamlOutput {
    const sections: PlanSection[] = [];
    const warnings: string[] = [];
    const allCitations: Citation[] = [];
    const openQuestions: string[] = [];

    const requirements = input.requirements.toLowerCase();

    const detectedNeeds = {
      collectName: /\b(name|person|user|client|applicant)\b/.test(requirements),
      collectAddress: /\b(address|location|city|state|zip)\b/.test(requirements),
      collectEmail: /\b(email|e-mail|contact)\b/.test(requirements),
      collectPhone: /\b(phone|telephone|mobile)\b/.test(requirements),
      collectDate: /\b(date|birthday|dob|birth)\b/.test(requirements),
      collectSignature: /\b(sign|signature)\b/.test(requirements),
      generateDocument: /\b(document|pdf|letter|form|generate|create|produce)\b/.test(requirements),
      reviewScreen: /\b(review|summary|confirm)\b/.test(requirements),
      conditionalLogic: /\b(if|condition|eligib|qualify|depend)\b/.test(requirements),
      multipleItems: /\b(list|multiple|several|many|each|all)\b/.test(requirements),
      yesNoQuestion: /\b(yes|no|agree|consent|confirm)\b/.test(requirements),
    };

    let interviewTitle = 'Interview';
    const titleMatch = requirements.match(/(?:interview|form|questionnaire)\s+(?:for|about|to)\s+([^,.]+)/i);
    if (titleMatch) {
      interviewTitle = titleMatch[1].trim();
    }

    sections.push({
      name: 'Metadata',
      intent: 'Define interview metadata including title',
      proposedYamlBlocks: ['metadata'],
      neededVariables: [],
      citations: [],
    });

    if (detectedNeeds.collectName || detectedNeeds.collectAddress || detectedNeeds.collectEmail) {
      const variables: string[] = [];
      if (detectedNeeds.collectName) variables.push('user_name', 'user_first_name', 'user_last_name');
      if (detectedNeeds.collectAddress) variables.push('user_address');
      if (detectedNeeds.collectEmail) variables.push('user_email');
      if (detectedNeeds.collectPhone) variables.push('user_phone');

      const searchResults = this.index.search('fields name address', { maxResults: 3 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of collecting personal information',
      }));

      sections.push({
        name: 'Personal Information',
        intent: 'Collect user personal information',
        proposedYamlBlocks: ['question with fields'],
        neededVariables: variables,
        citations,
      });

      allCitations.push(...citations);
    }

    if (detectedNeeds.yesNoQuestion) {
      const searchResults = this.index.search('yesno', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of yes/no question',
      }));

      sections.push({
        name: 'Yes/No Questions',
        intent: 'Ask yes/no questions for consent or confirmation',
        proposedYamlBlocks: ['yesno question'],
        neededVariables: ['agrees_to_terms'],
        citations,
      });

      allCitations.push(...citations);
    }

    if (detectedNeeds.conditionalLogic) {
      const searchResults = this.index.search('show if code', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of conditional logic',
      }));

      sections.push({
        name: 'Conditional Logic',
        intent: 'Implement conditional branching based on user responses',
        proposedYamlBlocks: ['code block', 'question with show if'],
        neededVariables: ['eligibility_status'],
        citations,
      });

      allCitations.push(...citations);
      openQuestions.push('What specific conditions should determine eligibility or branching?');
    }

    if (detectedNeeds.multipleItems) {
      const searchResults = this.index.search('DAList gather', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of list collection',
      }));

      sections.push({
        name: 'List Collection',
        intent: 'Collect multiple items from the user',
        proposedYamlBlocks: ['objects declaration', 'list collect question'],
        neededVariables: ['items'],
        citations,
      });

      allCitations.push(...citations);
      openQuestions.push('What type of items should be collected in the list?');
    }

    if (detectedNeeds.collectSignature) {
      const searchResults = this.index.search('signature', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of signature collection',
      }));

      sections.push({
        name: 'Signature',
        intent: 'Collect user signature',
        proposedYamlBlocks: ['signature question'],
        neededVariables: ['user_signature'],
        citations,
      });

      allCitations.push(...citations);
    }

    if (detectedNeeds.reviewScreen) {
      const searchResults = this.index.search('review button edit', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of review screen',
      }));

      sections.push({
        name: 'Review Screen',
        intent: 'Allow user to review and edit their answers',
        proposedYamlBlocks: ['review question'],
        neededVariables: ['review_complete'],
        citations,
      });

      allCitations.push(...citations);
    }

    if (detectedNeeds.generateDocument) {
      const searchResults = this.index.search('attachment document', { maxResults: 2 });
      const citations = searchResults.map(r => ({
        path: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        excerpt: r.excerpt,
        reason: 'Example of document generation',
      }));

      sections.push({
        name: 'Document Generation',
        intent: 'Generate output document with collected data',
        proposedYamlBlocks: ['attachment block'],
        neededVariables: [],
        citations,
      });

      allCitations.push(...citations);
      openQuestions.push('What format should the output document be (PDF, DOCX)?');
      openQuestions.push('What content should be included in the document?');
    }

    sections.push({
      name: 'Final Screen',
      intent: 'Display completion message',
      proposedYamlBlocks: ['mandatory question'],
      neededVariables: [],
      citations: [],
    });

    if (sections.length <= 2) {
      warnings.push('Could not detect many specific requirements. Please provide more details about what the interview should collect.');
      openQuestions.push('What specific information should this interview collect?');
    }

    if (input.strictness === 'strict' && allCitations.length === 0) {
      warnings.push('STRICT MODE: No citations found to support the proposed plan. Some constructs may be UNKNOWN.');
    }

    return {
      plan: {
        interviewTitle,
        sections,
        openQuestions,
      },
      warnings,
      citations: allCitations,
    };
  }

  generateInterviewYaml(input: z.infer<typeof GenerateInterviewYamlInputSchema>): GenerateInterviewYamlOutput {
    const warnings: string[] = [];
    const allCitations: Citation[] = [];
    const nextSteps: string[] = [];

    const style = input.style || {
      commentsInYaml: true,
      includeDocCitationsInComments: true,
      readability: 'readable',
    };

    let plan: PlanInterviewYamlOutput['plan'];

    if (input.inputMode === 'requirements' && input.requirements) {
      const planResult = this.planInterviewYaml({
        requirements: input.requirements,
        strictness: input.groundingMode,
      });
      plan = planResult.plan;
      warnings.push(...planResult.warnings);
      allCitations.push(...planResult.citations);
    } else if (input.inputMode === 'plan' && input.plan) {
      plan = input.plan;
    } else if (input.inputMode === 'spec' && input.spec) {
      plan = {
        interviewTitle: input.spec.title || 'Interview',
        sections: input.spec.sections || [],
        openQuestions: [],
      };
    } else {
      return {
        yaml: '',
        files: [],
        citations: [],
        warnings: ['Invalid input: must provide requirements, plan, or spec'],
        nextSteps: [],
      };
    }

    let yamlContent = '';

    const addComment = (comment: string, citation?: Citation) => {
      if (!style.commentsInYaml) return '';
      let result = `# ${comment}`;
      if (style.includeDocCitationsInComments && citation) {
        result += ` (Source: ${citation.path} L${citation.lineStart}-${citation.lineEnd})`;
      }
      return result + '\n';
    };

    yamlContent += addComment('Interview metadata');
    yamlContent += `metadata:
  title: ${plan.interviewTitle || 'Interview'}
  short title: ${(plan.interviewTitle || 'Interview').substring(0, 20)}
---
`;

    for (const section of plan.sections) {
      if (section.name === 'Metadata') continue;

      yamlContent += addComment(`Section: ${section.name} - ${section.intent}`, section.citations[0]);

      if (section.proposedYamlBlocks.includes('question with fields')) {
        yamlContent += `question: |
  Please provide your information.
fields:
`;
        for (const variable of section.neededVariables) {
          const label = variable.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          yamlContent += `  - "${label}": ${variable}\n`;
        }
        yamlContent += '---\n';
      }

      if (section.proposedYamlBlocks.includes('yesno question')) {
        yamlContent += `question: |
  Do you agree to the terms and conditions?
yesno: agrees_to_terms
---
`;
      }

      if (section.proposedYamlBlocks.includes('code block')) {
        yamlContent += `code: |
  # Add your conditional logic here
  # Example:
  # if some_condition:
  #   eligibility_status = "eligible"
  # else:
  #   eligibility_status = "not eligible"
  pass
---
`;
        nextSteps.push('Implement the conditional logic in the code block');
      }

      if (section.proposedYamlBlocks.includes('objects declaration')) {
        yamlContent += `objects:
  - items: DAList
---
`;
      }

      if (section.proposedYamlBlocks.includes('list collect question')) {
        yamlContent += `question: |
  Tell me about item ${ '${' }i + 1${ '}' }.
fields:
  - "Item name": items[i]
list collect: True
---
`;
      }

      if (section.proposedYamlBlocks.includes('signature question')) {
        yamlContent += `question: |
  Please sign below.
signature: user_signature
---
`;
      }

      if (section.proposedYamlBlocks.includes('review question')) {
        yamlContent += `question: |
  Please review your answers.
review:
`;
        const allVariables = plan.sections.flatMap(s => s.neededVariables);
        for (const variable of allVariables.slice(0, 10)) {
          const label = variable.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          yamlContent += `  - Edit ${label}: ${variable}
    button: |
      **${label}**: ${ '${' }${variable}${ '}' }
`;
        }
        yamlContent += `continue button field: review_complete
---
`;
      }

      if (section.proposedYamlBlocks.includes('attachment block')) {
        yamlContent += `question: |
  Here is your document.
attachments:
  - name: Summary Document
    filename: summary
    content: |
      [BOLDCENTER] ${plan.interviewTitle || 'Summary'}
      
      Generated on: ${ '${' }today()${ '}' }
      
`;
        const allVariables = plan.sections.flatMap(s => s.neededVariables);
        for (const variable of allVariables.slice(0, 10)) {
          const label = variable.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          yamlContent += `      ${label}: ${ '${' }${variable}${ '}' }
`;
        }
        yamlContent += `mandatory: True
---
`;
      }

      if (section.proposedYamlBlocks.includes('mandatory question') && section.name === 'Final Screen') {
        yamlContent += `question: |
  Thank you for completing this interview.
subquestion: |
  Your responses have been recorded.
mandatory: True
---
`;
      }
    }

    if (plan.openQuestions.length > 0) {
      nextSteps.push(...plan.openQuestions.map(q => `Clarify: ${q}`));
    }

    nextSteps.push('Review the generated YAML and customize as needed');
    nextSteps.push('Test the interview in Docassemble');

    const slug = (plan.interviewTitle || 'interview').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    return {
      yaml: yamlContent,
      files: [{ suggestedPath: `interviews/${slug}.yml`, content: yamlContent }],
      citations: allCitations,
      warnings,
      nextSteps,
    };
  }

  validateInterviewYaml(input: z.infer<typeof ValidateInterviewYamlInputSchema>): ValidateInterviewYamlOutput {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestedFixes: SuggestedFix[] = [];

    try {
      yaml.parse(input.yaml);
    } catch (e) {
      const error = e as Error & { linePos?: Array<{ line: number; col: number }> };
      errors.push({
        message: `YAML parse error: ${error.message}`,
        line: error.linePos?.[0]?.line,
        column: error.linePos?.[0]?.col,
        ruleId: 'yaml-parse',
      });

      return {
        isValid: false,
        errors,
        warnings,
        suggestedFixes,
      };
    }

    if (input.mode === 'lint') {
      const lines = input.yaml.split('\n');

      const hasMetadata = input.yaml.includes('metadata:');
      if (!hasMetadata) {
        warnings.push({
          message: 'Interview does not have a metadata block. Consider adding one for title and description.',
          ruleId: 'missing-metadata',
        });
        suggestedFixes.push({
          description: 'Add metadata block at the beginning',
          patchLikeHint: `+metadata:
+  title: Your Interview Title
+---`,
          citations: [],
        });
      }

      const hasMandatory = input.yaml.includes('mandatory:');
      if (!hasMandatory) {
        warnings.push({
          message: 'Interview does not have any mandatory blocks. The interview may not have a defined flow.',
          ruleId: 'missing-mandatory',
        });
      }

      const hasQuestion = input.yaml.includes('question:');
      if (!hasQuestion) {
        warnings.push({
          message: 'Interview does not have any question blocks.',
          ruleId: 'missing-question',
        });
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('\t')) {
          errors.push({
            message: 'Tab character found. YAML should use spaces for indentation.',
            line: i + 1,
            ruleId: 'no-tabs',
          });
          suggestedFixes.push({
            description: 'Replace tabs with spaces',
            patchLikeHint: `Line ${i + 1}: Replace tab with 2 spaces`,
            citations: [],
          });
        }

        if (/^\s*-\s*$/.test(line) && i + 1 < lines.length && !/^\s+/.test(lines[i + 1])) {
          warnings.push({
            message: 'Empty list item detected',
            line: i + 1,
            ruleId: 'empty-list-item',
          });
        }

        if (/\$\{[^}]*\}/.test(line)) {
          const matches = line.match(/\$\{([^}]*)\}/g);
          if (matches) {
            for (const match of matches) {
              const varName = match.slice(2, -1).trim();
              if (varName.includes('(') && !varName.includes(')')) {
                warnings.push({
                  message: `Possible unclosed parenthesis in Mako expression: ${match}`,
                  line: i + 1,
                  ruleId: 'unclosed-paren',
                });
              }
            }
          }
        }

        if (/^[a-z_]+:\s*\|/.test(line.trim())) {
          const nextLine = lines[i + 1];
          if (nextLine && !/^\s+/.test(nextLine) && nextLine.trim() !== '' && nextLine.trim() !== '---') {
            warnings.push({
              message: 'Literal block indicator (|) should be followed by indented content',
              line: i + 1,
              ruleId: 'literal-block-indent',
            });
          }
        }
      }

      const knownKeywords = [
        'question', 'subquestion', 'fields', 'buttons', 'choices', 'mandatory', 'code',
        'attachment', 'attachments', 'template', 'content', 'under', 'help', 'terms',
        'metadata', 'include', 'objects', 'sets', 'event', 'review', 'signature',
        'yesno', 'noyes', 'yesnomaybe', 'datatype', 'default', 'required', 'note',
        'html', 'css', 'script', 'features', 'sections', 'table', 'need', 'initial',
        'generic object', 'id', 'continue button field', 'continue button label',
        'back button', 'corner back button', 'prevent going back', 'decoration',
        'audio', 'video', 'progress', 'action buttons', 'reload', 'refresh',
        'comment', 'usedefs', 'scan for variables', 'only sets', 'reconsider',
        'undefine', 'reset', 'allow cron', 'cron', 'if', 'validation code',
        'validation messages', 'show if', 'hide if', 'js show if', 'js hide if',
        'disable others', 'uncheck others', 'none of the above', 'all of the above',
        'object labeler', 'list collect', 'add another label', 'there is another',
        'there are any', 'complete attribute', 'object type', 'minimum number',
        'target number', 'exactly', 'allow reordering', 'delete buttons', 'edit',
        'confirm', 'rows', 'columns', 'header row', 'require gathered', 'show if empty',
        'not available label', 'name', 'filename', 'description', 'valid formats',
        'docx template file', 'pdf template file', 'variable name', 'skip undefined',
        'pdf/a', 'tagged pdf', 'editable', 'decimal places', 'language', 'raw',
        'subject', 'content file', 'short title', 'title', 'authors', 'revision_date',
        'documentation', 'example start', 'example end', 'tags', 'required privileges',
        'temporary session', 'exit link', 'exit label', 'exit url', 'unlisted', 'hidden',
      ];

      const topLevelKeywordRegex = /^([a-z][a-z_ ]*[a-z]):/;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(topLevelKeywordRegex);
        if (match) {
          const keyword = match[1].toLowerCase();
          if (!knownKeywords.includes(keyword) && !keyword.startsWith('$')) {
            warnings.push({
              message: `Unknown top-level keyword: "${keyword}". This may be intentional or a typo.`,
              line: i + 1,
              ruleId: 'unknown-keyword',
            });
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestedFixes,
    };
  }

  explainTerm(input: z.infer<typeof ExplainTermInputSchema>): ExplainTermOutput {
    const term = input.term.toLowerCase();
    const citations: Citation[] = [];
    const examples: ExplainTermOutput['examples'] = [];

    const termDefinitions: Record<string, string> = {
      'question': 'A question block displays content to the user and optionally collects input. It can contain subquestion text, fields for data entry, buttons for choices, and various display options.',
      'fields': 'The fields specifier within a question block defines input fields for collecting user data. Each field can have a label, variable name, datatype, validation rules, and conditional display logic.',
      'mandatory': 'The mandatory specifier marks a block as required for interview completion. When set to True, the block must be satisfied before the interview can end. Can also be a Python expression.',
      'code': 'A code block contains Python code that executes to set variables or perform logic. Code blocks run when their variables are needed by the interview logic.',
      'attachment': 'An attachment block defines a document to be generated. It can create documents from content, DOCX templates, or PDF templates, with various formatting options.',
      'attachments': 'The attachments specifier (plural) defines multiple documents to be generated, either as a list or using code to dynamically generate the list.',
      'objects': 'The objects block declares object instances to be used in the interview. Objects are typically DAObject subclasses like Individual, Person, or DAList.',
      'include': 'The include specifier imports another YAML file into the current interview, allowing modular interview design and code reuse.',
      'metadata': 'The metadata block defines interview-level settings like title, description, authors, and various configuration options.',
      'review': 'A review block creates a screen where users can review and edit their previous answers. It displays a summary of collected data with edit buttons.',
      'event': 'An event block defines a screen that can be triggered by actions. Events are used for navigation, displaying information, or handling special cases.',
      'sets': 'The sets specifier declares which variables a question or code block will set. This helps Docassemble understand the interview logic.',
      'template': 'A template block defines reusable text content that can be referenced elsewhere in the interview using Mako syntax.',
      'table': 'A table block defines how to display list or dictionary data in a tabular format, with options for editing and deleting items.',
      'initial': 'An initial code block runs at the beginning of each screen load, useful for setting up variables or performing checks.',
      'sections': 'The sections block defines navigation sections for the interview, creating a sidebar or progress indicator.',
      'features': 'The features block configures interview-wide settings like navigation style, progress bar, and various UI options.',
      'datatype': 'The datatype specifier within a field defines what type of data the field collects (text, number, date, email, etc.).',
      'show if': 'The show if specifier conditionally displays a field or element based on a Python expression or variable value.',
      'hide if': 'The hide if specifier conditionally hides a field or element based on a Python expression or variable value.',
      'yesno': 'The yesno specifier creates a yes/no question that sets a boolean variable.',
      'noyes': 'The noyes specifier creates a yes/no question where "No" is the first option, setting a boolean variable.',
      'signature': 'The signature specifier creates a signature pad for collecting user signatures.',
      'subquestion': 'The subquestion specifier adds explanatory text below the main question text.',
      'buttons': 'The buttons specifier defines clickable buttons for user choices, each setting a variable value.',
      'choices': 'The choices specifier defines a list of options for multiple choice questions.',
      'continue button field': 'The continue button field specifier creates a continue button that sets a variable when clicked.',
      'list collect': 'The list collect specifier enables automatic list collection, repeatedly asking a question for each list item.',
      'generic object': 'The generic object specifier creates a question that applies to any object of a specified type.',
      'validation code': 'The validation code specifier contains Python code that validates field input before accepting it.',
      'DAList': 'DAList is a Docassemble class for managing lists of items with built-in gathering and display functionality.',
      'DADict': 'DADict is a Docassemble class for managing dictionaries with built-in gathering and display functionality.',
      'DAObject': 'DAObject is the base class for all Docassemble objects, providing attribute access and instance naming.',
      'Individual': 'Individual is a DAObject subclass representing a person with name, address, and other personal attributes.',
      'Person': 'Person is a DAObject subclass representing a person or organization with name and address attributes.',
    };

    let explanation = termDefinitions[term];

    if (!explanation) {
      const searchResults = this.index.search(term, { maxResults: 5 });

      if (searchResults.length > 0) {
        explanation = `The term "${input.term}" appears in ${searchResults.length} example files. Based on usage, it appears to be related to Docassemble interview authoring.`;

        for (const result of searchResults) {
          const citation = this.index.createCitation(
            result.relativePath,
            result.lineStart,
            result.lineEnd,
            `Usage of "${input.term}"`
          );
          if (citation) {
            citations.push(citation);
            examples.push({
              snippet: result.excerpt,
              citations: [citation],
            });
          }
        }
      } else {
        explanation = `UNKNOWN / NOT CONFIRMED IN SOURCES: The term "${input.term}" was not found in the indexed documentation and examples. This may be a typo, an advanced feature, or a term not covered in the available sources.`;

        return {
          explanation,
          citations: [],
          examples: [],
        };
      }
    } else {
      const searchResults = this.index.search(term, { maxResults: 3 });

      for (const result of searchResults) {
        const citation = this.index.createCitation(
          result.relativePath,
          result.lineStart,
          result.lineEnd,
          `Example of "${input.term}"`
        );
        if (citation) {
          citations.push(citation);
          examples.push({
            snippet: result.excerpt,
            citations: [citation],
          });
        }
      }
    }

    return {
      explanation,
      citations,
      examples,
    };
  }
}
