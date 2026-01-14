import * as fs from 'fs';
import * as path from 'path';

export interface IndexedFile {
  path: string;
  relativePath: string;
  content: string;
  lines: string[];
  lineOffsets: number[];
  type: 'example' | 'doc' | 'template' | 'other';
  metadata?: {
    title?: string;
    shortTitle?: string;
    documentation?: string;
    exampleStart?: number;
    exampleEnd?: number;
  };
}

export interface SearchResult {
  path: string;
  relativePath: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  score: number;
  type: 'example' | 'doc' | 'template' | 'other';
}

export interface Citation {
  path: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  reason?: string;
}

export type SearchScope = 'docs' | 'examples' | 'docs_and_examples' | 'all';

export class DocassembleIndex {
  private files: Map<string, IndexedFile> = new Map();
  private examplesByName: Map<string, IndexedFile> = new Map();
  private keywordIndex: Map<string, Set<string>> = new Map();
  private basePath: string;
  private initialized: boolean = false;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const examplesPath = path.join(
      this.basePath,
      'docassemble_base/docassemble/base/data/questions/examples'
    );
    const demoQuestionsPath = path.join(
      this.basePath,
      'docassemble_demo/docassemble/demo/data/questions'
    );
    const templatesPath = path.join(
      this.basePath,
      'docassemble_base/docassemble/base/data/templates'
    );

    await this.indexDirectory(examplesPath, 'example');
    await this.indexDirectory(demoQuestionsPath, 'example');
    await this.indexDirectory(templatesPath, 'template');

    this.buildKeywordIndex();
    this.initialized = true;
  }

  private async indexDirectory(dirPath: string, type: IndexedFile['type']): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory not found: ${dirPath}`);
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.indexDirectory(fullPath, type);
      } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml') || entry.name.endsWith('.md'))) {
        await this.indexFile(fullPath, type);
      }
    }
  }

  private async indexFile(filePath: string, type: IndexedFile['type']): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineOffsets: number[] = [];
      let offset = 0;

      for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1;
      }

      const relativePath = path.relative(this.basePath, filePath);
      const metadata = this.extractMetadata(content);

      const indexedFile: IndexedFile = {
        path: filePath,
        relativePath,
        content,
        lines,
        lineOffsets,
        type,
        metadata,
      };

      this.files.set(relativePath, indexedFile);

      if (type === 'example') {
        const name = path.basename(filePath, path.extname(filePath));
        this.examplesByName.set(name, indexedFile);
      }
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
    }
  }

  private extractMetadata(content: string): IndexedFile['metadata'] {
    const metadata: IndexedFile['metadata'] = {};

    const metadataMatch = content.match(/^metadata:\s*\n((?:[ \t]+[^\n]+\n?)*)/m);
    if (metadataMatch) {
      const metadataBlock = metadataMatch[1];

      const titleMatch = metadataBlock.match(/title:\s*["']?([^"'\n]+)["']?/);
      if (titleMatch) metadata.title = titleMatch[1].trim();

      const shortTitleMatch = metadataBlock.match(/short title:\s*["']?([^"'\n]+)["']?/);
      if (shortTitleMatch) metadata.shortTitle = shortTitleMatch[1].trim();

      const docMatch = metadataBlock.match(/documentation:\s*["']?([^"'\n]+)["']?/);
      if (docMatch) metadata.documentation = docMatch[1].trim();

      const exampleStartMatch = metadataBlock.match(/example start:\s*(\d+)/);
      if (exampleStartMatch) metadata.exampleStart = parseInt(exampleStartMatch[1], 10);

      const exampleEndMatch = metadataBlock.match(/example end:\s*(\d+)/);
      if (exampleEndMatch) metadata.exampleEnd = parseInt(exampleEndMatch[1], 10);
    }

    return metadata;
  }

  private buildKeywordIndex(): void {
    const keywords = [
      'question', 'fields', 'buttons', 'choices', 'mandatory', 'code',
      'attachment', 'attachments', 'template', 'content', 'subquestion',
      'under', 'help', 'terms', 'auto terms', 'metadata', 'include',
      'objects', 'object', 'generic object', 'sets', 'event', 'action',
      'review', 'continue button field', 'signature', 'yesno', 'noyes',
      'yesnomaybe', 'datatype', 'default', 'required', 'validation code',
      'validation messages', 'show if', 'hide if', 'js show if', 'js hide if',
      'note', 'html', 'css', 'script', 'features', 'sections', 'progress',
      'table', 'rows', 'columns', 'edit', 'delete buttons', 'confirm',
      'need', 'depends on', 'scan for variables', 'initial', 'default role',
      'role', 'if', 'else', 'elif', 'for', 'while', 'def', 'class',
      'import', 'from', 'modules', 'reset', 'undefine', 'reconsider',
      'force ask', 'force gather', 'interview help', 'decoration',
      'image sets', 'images', 'audio', 'video', 'prevent going back',
      'back button', 'corner back button', 'continue button label',
      'resume button label', 'exit', 'restart', 'leave', 'refresh',
      'reload', 'url args', 'action argument', 'action buttons',
      'background action', 'background response', 'background response action',
      'check in', 'cron', 'allow cron', 'send email', 'email', 'sms',
      'twilio', 'docx template file', 'pdf template file', 'variable name',
      'valid formats', 'filename', 'name', 'description', 'skip undefined',
      'pdf/a', 'tagged pdf', 'editable', 'decimal places', 'language',
      'translations', 'words', 'comment', 'id', 'supersedes', 'order',
      'usedefs', 'mako', 'jinja2', 'markdown', 'raw', 'target', 'ga id',
      'segment id', 'suppress loading', 'suppress autofill', 'autocomplete',
      'address autocomplete', 'geocode', 'object labeler', 'instanceName',
      'DAList', 'DADict', 'DASet', 'DAObject', 'DAFile', 'DAFileList',
      'DAFileCollection', 'DAStaticFile', 'DAEmail', 'Individual', 'Person',
      'Name', 'Address', 'LatitudeLongitude', 'Organization', 'Thing',
      'Event', 'PeriodicValue', 'Value', 'OfficeList', 'RoleChangeTracker',
      'DARedis', 'DAStore', 'DAGlobal', 'DACloudStorage', 'DAOAuth',
      'DAWeb', 'DAContext', 'DAEmpty', 'DALazyTemplate', 'DALazyTableTemplate',
    ];

    for (const [relativePath, file] of this.files) {
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        if (regex.test(file.content)) {
          if (!this.keywordIndex.has(keyword.toLowerCase())) {
            this.keywordIndex.set(keyword.toLowerCase(), new Set());
          }
          this.keywordIndex.get(keyword.toLowerCase())!.add(relativePath);
        }
      }
    }
  }

  search(
    query: string,
    options: {
      maxResults?: number;
      scope?: SearchScope;
      fileGlobs?: string[];
    } = {}
  ): SearchResult[] {
    const { maxResults = 8, scope = 'docs_and_examples', fileGlobs } = options;
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0);

    for (const [relativePath, file] of this.files) {
      if (!this.matchesScope(file.type, scope)) continue;
      if (fileGlobs && !this.matchesGlobs(relativePath, fileGlobs)) continue;

      const matches = this.findMatches(file, queryTerms);
      results.push(...matches);
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  private matchesScope(type: IndexedFile['type'], scope: SearchScope): boolean {
    switch (scope) {
      case 'docs':
        return type === 'doc';
      case 'examples':
        return type === 'example';
      case 'docs_and_examples':
        return type === 'doc' || type === 'example';
      case 'all':
        return true;
      default:
        return true;
    }
  }

  private matchesGlobs(relativePath: string, globs: string[]): boolean {
    for (const glob of globs) {
      const pattern = glob
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      if (new RegExp(pattern).test(relativePath)) {
        return true;
      }
    }
    return false;
  }

  private findMatches(file: IndexedFile, queryTerms: string[]): SearchResult[] {
    const results: SearchResult[] = [];
    const contentLower = file.content.toLowerCase();

    for (let i = 0; i < file.lines.length; i++) {
      const lineLower = file.lines[i].toLowerCase();
      let score = 0;
      let matchedTerms = 0;

      for (const term of queryTerms) {
        if (lineLower.includes(term)) {
          matchedTerms++;
          score += 10;

          if (lineLower.startsWith(term + ':')) {
            score += 20;
          }
          if (new RegExp(`\\b${term}\\b`).test(lineLower)) {
            score += 5;
          }
        }
      }

      if (matchedTerms > 0) {
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(file.lines.length - 1, i + 5);
        const excerpt = file.lines.slice(contextStart, contextEnd + 1).join('\n');

        score += matchedTerms / queryTerms.length * 10;

        if (file.metadata?.title) {
          const titleLower = file.metadata.title.toLowerCase();
          for (const term of queryTerms) {
            if (titleLower.includes(term)) {
              score += 15;
            }
          }
        }

        results.push({
          path: file.path,
          relativePath: file.relativePath,
          lineStart: contextStart + 1,
          lineEnd: contextEnd + 1,
          excerpt,
          score,
          type: file.type,
        });
      }
    }

    const uniqueResults: SearchResult[] = [];
    const seenRanges = new Set<string>();

    for (const result of results.sort((a, b) => b.score - a.score)) {
      const rangeKey = `${result.relativePath}:${Math.floor(result.lineStart / 10)}`;
      if (!seenRanges.has(rangeKey)) {
        seenRanges.add(rangeKey);
        uniqueResults.push(result);
      }
    }

    return uniqueResults;
  }

  getFile(relativePath: string): IndexedFile | undefined {
    return this.files.get(relativePath);
  }

  getFileByAbsolutePath(absolutePath: string): IndexedFile | undefined {
    const relativePath = path.relative(this.basePath, absolutePath);
    return this.files.get(relativePath);
  }

  getExampleByName(name: string): IndexedFile | undefined {
    return this.examplesByName.get(name);
  }

  getFilesWithKeyword(keyword: string): IndexedFile[] {
    const paths = this.keywordIndex.get(keyword.toLowerCase());
    if (!paths) return [];
    return Array.from(paths).map(p => this.files.get(p)!).filter(Boolean);
  }

  getAllExamples(): IndexedFile[] {
    return Array.from(this.files.values()).filter(f => f.type === 'example');
  }

  getAllFiles(): IndexedFile[] {
    return Array.from(this.files.values());
  }

  getSnippet(relativePath: string, lineStart: number, lineEnd: number): string | null {
    const file = this.files.get(relativePath);
    if (!file) return null;

    const start = Math.max(0, lineStart - 1);
    const end = Math.min(file.lines.length, lineEnd);
    return file.lines.slice(start, end).join('\n');
  }

  createCitation(
    relativePath: string,
    lineStart: number,
    lineEnd: number,
    reason?: string
  ): Citation | null {
    const file = this.files.get(relativePath);
    if (!file) return null;

    const excerpt = this.getSnippet(relativePath, lineStart, lineEnd);
    if (!excerpt) return null;

    return {
      path: relativePath,
      lineStart,
      lineEnd,
      excerpt,
      reason,
    };
  }

  getStats(): { totalFiles: number; examples: number; docs: number; templates: number; keywords: number } {
    let examples = 0;
    let docs = 0;
    let templates = 0;

    for (const file of this.files.values()) {
      switch (file.type) {
        case 'example':
          examples++;
          break;
        case 'doc':
          docs++;
          break;
        case 'template':
          templates++;
          break;
      }
    }

    return {
      totalFiles: this.files.size,
      examples,
      docs,
      templates,
      keywords: this.keywordIndex.size,
    };
  }
}
