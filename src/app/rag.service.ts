import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

/** Matches the backend ChatMessage DTO exactly */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

/** Matches the backend ChatRequestDto exactly */
export interface ChatRequestDto {
  chatHistory: ChatMessage[];
}

/** Matches the structured JSON the backend POST /api/chat/ask now returns */
export interface AskResponse {
  question: string;
  answer: string;
  confidenceScore: number;
  confidenceLevel: 'High' | 'Medium' | 'Low';
}

export interface Message {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  /** Numerical confidence returned by the RAG backend (0.0 – 1.0) */
  confidenceScore?: number;
  /** Human-readable confidence tier returned by the RAG backend */
  confidenceLevel?: 'High' | 'Medium' | 'Low';
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const dateReviver = (key: string, value: any) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value);
  }
  return value;
};

@Injectable({
  providedIn: 'root'
})
export class RAGService {
  private readonly baseUrl = '';
  private authService = inject(AuthService);

  private getStorageValue<T>(key: string, defaultValue: T): T {
    if (!isBrowser) {
      return defaultValue;
    }
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored, dateReviver) as T;
      }
    } catch (e) {
      console.error(`Error loading state key "${key}" from localStorage`, e);
    }
    return defaultValue;
  }

  private getUserStorageKey(key: string): string {
    return `${this.authService.userStorageKey()}_${key}`;
  }

  // --- Signals State ---
  readonly conversations = signal<Conversation[]>([]);
  readonly activeConversationId = signal<string | null>(null);
  
  readonly isSyncing = signal<boolean>(false);
  readonly syncMessage = signal<string>('');
  readonly syncError = signal<string | null>(null);
  readonly syncSuccess = signal<boolean>(false);

  readonly isUploading = signal<boolean>(false);
  readonly uploadedFiles = signal<string[]>([]);
  readonly uploadError = signal<string | null>(null);
  readonly selectedRoles = signal<string[]>([]); // Track selected roles for document upload

  readonly isAILoading = signal<boolean>(false);
  readonly sidebarCollapsed = signal<boolean>(false);

  // --- Computed Signals ---
  readonly activeConversation = computed(() => {
    const id = this.activeConversationId();
    if (!id) return null;
    return this.conversations().find(c => c.id === id) || null;
  });

  readonly activeMessages = computed(() => {
    return this.activeConversation()?.messages || [];
  });

  constructor(private http: HttpClient) {
    if (isBrowser) {
      // LOAD EFFECT MUST RUN FIRST when userStorageKey changes, before saving effects
      effect(() => {
        const userKey = this.authService.userStorageKey();
        
        // Clear all state first
        this.conversations.set([]);
        this.activeConversationId.set(null);
        this.uploadedFiles.set([]);
        this.sidebarCollapsed.set(false);
        
        // Load user-specific data
        const prefix = `${userKey}_`;
        this.conversations.set(this.getStorageValue(`${prefix}rag_conversations`, []));
        this.activeConversationId.set(this.getStorageValue(`${prefix}rag_active_conversation_id`, null));
        this.uploadedFiles.set(this.getStorageValue(`${prefix}rag_uploaded_files`, []));
        this.sidebarCollapsed.set(this.getStorageValue(`${prefix}rag_sidebar_collapsed`, false));
      });

      effect(() => {
        try {
          const prefix = `${this.authService.userStorageKey()}_`;
          const key = `${prefix}rag_conversations`;
          localStorage.setItem(key, JSON.stringify(this.conversations()));
        } catch (e) {
          console.error('Error saving conversations to localStorage', e);
        }
      });

      effect(() => {
        try {
          const prefix = `${this.authService.userStorageKey()}_`;
          const activeId = this.activeConversationId();
          if (activeId !== null) {
            localStorage.setItem(`${prefix}rag_active_conversation_id`, JSON.stringify(activeId));
          } else {
            localStorage.removeItem(`${prefix}rag_active_conversation_id`);
          }
        } catch (e) {
          console.error('Error saving activeConversationId to localStorage', e);
        }
      });

      effect(() => {
        try {
          const prefix = `${this.authService.userStorageKey()}_`;
          localStorage.setItem(`${prefix}rag_sidebar_collapsed`, JSON.stringify(this.sidebarCollapsed()));
        } catch (e) {
          console.error('Error saving sidebarCollapsed to localStorage', e);
        }
      });

      effect(() => {
        try {
          const prefix = `${this.authService.userStorageKey()}_`;
          localStorage.setItem(`${prefix}rag_uploaded_files`, JSON.stringify(this.uploadedFiles()));
        } catch (e) {
          console.error('Error saving uploadedFiles to localStorage', e);
        }
      });
    }

    // Only set default/mock empty lists if they are empty
    if (this.conversations().length === 0) {
      this.loadMockConversations();
    }
  }

  // --- Initialize with empty conversations ---
  private loadMockConversations() {
    this.conversations.set([]);
    this.activeConversationId.set(null);
  }

  // --- Conversation Actions ---
  createNewConversation(title = 'New Chat'): string {
    const id = 'chat-' + Math.random().toString(36).substring(2, 9);
    const newChat: Conversation = {
      id,
      title,
      messages: [],
      createdAt: new Date()
    };
    
    this.conversations.update(current => [newChat, ...current]);
    this.activeConversationId.set(id);
    return id;
  }

  selectConversation(id: string) {
    this.activeConversationId.set(id);
  }

  deleteConversation(id: string) {
    this.conversations.update(current => current.filter(c => c.id !== id));
    if (this.activeConversationId() === id) {
      const remaining = this.conversations();
      if (remaining.length > 0) {
        this.activeConversationId.set(remaining[0].id);
      } else {
        this.activeConversationId.set(null);
      }
    }
  }

  // --- API 1: Upload PDF File ---
  async uploadDocuments(files: FileList | File[] | File, roles: string[] = []): Promise<boolean> {
    const selectedFiles: File[] =
      files instanceof File
        ? [files]
        : files instanceof FileList
        ? Array.from(files)
        : Array.isArray(files)
        ? files
        : [];

    if (selectedFiles.length === 0) return false;
    if (selectedFiles.length > 1) {
      this.uploadError.set('Please upload only one PDF file at a time.');
      return false;
    }

    const singleFile = selectedFiles[0];
    if (singleFile.type !== 'application/pdf' && !singleFile.name.endsWith('.pdf')) {
      this.uploadError.set('Only PDF files are allowed.');
      return false;
    }

    this.isUploading.set(true);
    this.uploadError.set(null);

    const formData = new FormData();
    const fileNames: string[] = [];

    formData.append('file', singleFile, singleFile.name);
    fileNames.push(singleFile.name);

    // Add selected roles to FormData
    if (roles && roles.length > 0) {
      roles.forEach(role => {
        formData.append('roles', role);
      });
    }

    try {
      // Execute upload API
      await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/document/upload`, formData)
      );
      
      // Update uploaded files tracker with unique filenames
      this.uploadedFiles.update(current => {
        const combined = [...fileNames, ...current];
        return combined.filter((item, index) => combined.indexOf(item) === index);
      });
      
      this.isUploading.set(false);
      return true;
    } catch (err: any) {
      console.error('File upload failed:', err);
      let errorMsg = `Upload failed (Status ${err.status})`;
      if (err.status === 0) {
        errorMsg = 'Upload failed: Server unreachable (Offline or CORS).';
      } else if (err.error?.message) {
        errorMsg = `Upload failed: ${err.error.message}`;
      }
      this.uploadError.set(errorMsg);
      this.isUploading.set(false);
      return false;
    }
  }

  // --- Document List Actions ---
  removeTrackedFile(fileName: string) {
    this.uploadedFiles.update(current => current.filter(name => name !== fileName));
  }

  clearTrackedFiles() {
    this.uploadedFiles.set([]);
  }

  // --- API 2: Trigger Vector Database Sync ---
  async syncDatabase(): Promise<boolean> {
    if (this.isSyncing()) return false;

    this.isSyncing.set(true);
    this.syncMessage.set('Connecting to ingestion processor...');
    this.syncError.set(null);
    this.syncSuccess.set(false);

    try {
      // Simulate/Show elegant progressive steps
      setTimeout(() => {
        if (this.isSyncing()) this.syncMessage.set('Parsing uploaded PDF texts...');
      }, 1000);
      setTimeout(() => {
        if (this.isSyncing()) this.syncMessage.set('Generating neural embeddings (text-embedding-ada)...');
      }, 2500);
      setTimeout(() => {
        if (this.isSyncing()) this.syncMessage.set('Updating high-dimensional vector index...');
      }, 4000);

      // Perform the actual API call
      await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/document/sync`, {})
      );

      this.isSyncing.set(false);
      this.syncSuccess.set(true);
      this.syncMessage.set('Database Synced Successfully!');
      return true;
    } catch (err: any) {
      console.error('Sync failed:', err);
      this.isSyncing.set(false);
      this.syncSuccess.set(false);
      
      let errorMsg = `Sync Ingestion Failed (Status ${err.status})`;
      if (err.status === 0) {
        errorMsg = 'Sync Ingestion Failed: Server at port 5052 is unreachable (Offline or CORS).';
      }
      this.syncError.set(errorMsg);
      this.syncMessage.set(errorMsg);
      return false;
    }
  }

  // --- API 3: Ask Chatbot Questions ---
  async askQuestion(questionText: string): Promise<void> {
    if (!questionText.trim()) return;

    let convId = this.activeConversationId();
    // Auto-create chat if none exists
    if (!convId) {
      convId = this.createNewConversation(questionText.length > 25 ? questionText.substring(0, 25) + '...' : questionText);
    }

    // 1. Immediately append user message to local conversation
    const userMsg: Message = {
      sender: 'user',
      text: questionText,
      timestamp: new Date()
    };

    this.updateMessagesInConversation(convId, userMsg);

    // Auto-rename conversation if it was brand new
    const conversation = this.conversations().find(c => c.id === convId);
    if (conversation && conversation.messages.length === 1) {
      conversation.title = questionText.length > 30 ? questionText.substring(0, 30) + '...' : questionText;
    }

    // 2. Build the full chat history (including the just-appended user message)
    //    mapping our internal Message shape to the backend ChatMessage DTO shape.
    const currentMessages = this.conversations().find(c => c.id === convId)?.messages ?? [];
    const chatHistory: ChatMessage[] = currentMessages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      text: m.text
    }));

    this.isAILoading.set(true);

    // 3. Create placeholder AI message while waiting for the response
    const aiMsgPlaceholder: Message = {
      sender: 'assistant',
      text: '',
      timestamp: new Date()
    };

    this.updateMessagesInConversation(convId, aiMsgPlaceholder);

    // 4. POST full chat history to the backend
    const askUrl = `${this.baseUrl}/api/chat/ask`;
    const requestBody: ChatRequestDto = { chatHistory };

    try {
      const response = await firstValueFrom(
        this.http.post(askUrl, requestBody, { responseType: 'text' })
      );

      this.isAILoading.set(false);

      // Parse the structured AskResponse from the backend
      let cleanedResponse = response;
      let confidenceScore: number | undefined;
      let confidenceLevel: 'High' | 'Medium' | 'Low' | undefined;
      try {
        const json: AskResponse = JSON.parse(response);
        cleanedResponse = json.answer ?? response;
        confidenceScore = json.confidenceScore;
        confidenceLevel = json.confidenceLevel;
      } catch (e) {
        // Response is raw text, use as-is
      }

      await this.animateResponseText(convId, cleanedResponse, confidenceScore, confidenceLevel);
    } catch (err: any) {
      console.error('Ask Chatbot failed:', err);
      this.isAILoading.set(false);

      // Print the authentic connection/API error to the user in the chat feed
      let errorResponse = `⚠️ **Connection Error**: Failed to fetch a response from the CodeBiz RAG API at \`${this.baseUrl}\`.\n\n`;
      if (err.status === 0) {
        errorResponse += `**Details**: The server at \`http://localhost:5052\` is unreachable (Connection Refused).\n\n*Please verify that:*\n1. Your local backend API server is running on port \`5052\`.\n2. **CORS is enabled** in your backend server configurations to allow requests from the frontend origin (\`http://localhost:4200\`).`;
      } else {
        errorResponse += `**Details**: Server returned status \`${err.status}\` (${err.statusText || 'Error'}).\n\`\`\`json\n${JSON.stringify(err.error || err.message, null, 2)}\n\`\`\``;
      }

      await this.animateResponseText(convId, errorResponse);
    }
  }

  // --- Helper to update message history inside a conversation ---
  private updateMessagesInConversation(convId: string, newMessage: Message) {
    this.conversations.update(current => {
      return current.map(c => {
        if (c.id === convId) {
          // If it's a typing update for the last AI response
          if (newMessage.sender === 'assistant' && newMessage.text !== '' && c.messages[c.messages.length - 1]?.sender === 'assistant') {
            const updatedMsgs = [...c.messages];
            // Spread old message first for base fields (e.g. timestamp origin),
            // then spread newMessage on top so ALL incoming properties — including
            // confidenceScore and confidenceLevel — are preserved on every tick.
            updatedMsgs[updatedMsgs.length - 1] = {
              ...c.messages[c.messages.length - 1],
              ...newMessage
            };
            return { ...c, messages: updatedMsgs };
          }
          // Default: append new message
          return { ...c, messages: [...c.messages, newMessage] };
        }
        return c;
      });
    });
  }

  private extractBackendErrorMessage(err: any): string | null {
    if (!err) {
      return null;
    }

    if (err.status === 0) {
      return 'Unable to connect to the backend server.';
    }

    const payload = err.error;
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        return this.stringifyBackendError(parsed);
      } catch {
        return payload;
      }
    }

    if (payload && typeof payload === 'object') {
      return this.stringifyBackendError(payload);
    }

    return err.message || null;
  }

  private stringifyBackendError(payload: any): string {
    if (!payload) {
      return 'An unknown server error occurred.';
    }

    if (typeof payload === 'string') {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
    }

    const candidates = [
      payload.message,
      payload.error,
      payload.detail,
      payload.title,
      payload.description,
      payload?.exceptionMessage
    ];

    for (const candidate of candidates) {
      if (candidate) {
        if (typeof candidate === 'string') {
          return candidate;
        }
        if (Array.isArray(candidate)) {
          return candidate.join('\n');
        }
        if (typeof candidate === 'object') {
          return JSON.stringify(candidate, null, 2);
        }
      }
    }

    if (payload.errors) {
      if (Array.isArray(payload.errors)) {
        return payload.errors.map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
      }
      if (typeof payload.errors === 'object') {
        return Object.entries(payload.errors)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\n');
      }
    }

    return Object.entries(payload)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join('\n');
  }

  // --- Beautiful typing animation for high fidelity Gemini UX ---
  private animateResponseText(
    convId: string,
    text: string,
    confidenceScore?: number,
    confidenceLevel?: 'High' | 'Medium' | 'Low'
  ): Promise<void> {
    return new Promise((resolve) => {
      let currentIdx = 0;
      let animatedText = '';
      const totalLen = text.length;

      // Speed changes depending on response size to keep it fast
      const intervalMs = totalLen > 200 ? 5 : totalLen > 100 ? 10 : 20;

      const timer = setInterval(() => {
        if (currentIdx < totalLen) {
          // Type in small chunks if response is very long for extreme speed, else char by char
          const chunkSize = totalLen > 300 ? 3 : 1;
          animatedText += text.substring(currentIdx, currentIdx + chunkSize);
          currentIdx += chunkSize;

          this.updateMessagesInConversation(convId, {
            sender: 'assistant',
            text: animatedText,
            timestamp: new Date(),
            confidenceScore,
            confidenceLevel
          });
        } else {
          clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });
  }
}
