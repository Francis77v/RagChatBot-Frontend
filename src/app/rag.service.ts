import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export interface Message {
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
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
        console.log('User changed, loading data for:', userKey);
        
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
          console.log('Saving conversations to:', key);
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

    // 1. Immediately append user message
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

    this.isAILoading.set(true);

    // Create placeholder AI message
    const aiMsgPlaceholder: Message = {
      sender: 'assistant',
      text: '',
      timestamp: new Date()
    };
    
    this.updateMessagesInConversation(convId, aiMsgPlaceholder);

    const questionEncoded = encodeURIComponent(questionText);
    const askUrl = `${this.baseUrl}/api/chat/ask?question=${questionEncoded}`;
    console.log('askUrl:', askUrl, 'origin:', window.location.origin);

    try {
      // Try to read direct response
      // For standard Angular REST GET:
      const response = await firstValueFrom(
        this.http.get(askUrl, { responseType: 'text' })
      );
      
      this.isAILoading.set(false);

      // Parse JSON if backend returned a JSON object instead of raw text
      let cleanedResponse = response;
      try {
        const json = JSON.parse(response);
        cleanedResponse = json.response || json.answer || json.reply || json.text || response;
      } catch (e) {
        // Response is raw text, leave as is
      }

      await this.animateResponseText(convId, cleanedResponse);
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
            updatedMsgs[updatedMsgs.length - 1] = {
              ...updatedMsgs[updatedMsgs.length - 1],
              text: newMessage.text
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

  // --- Beautiful typing animation for high fidelity Gemini UX ---
  private animateResponseText(convId: string, text: string): Promise<void> {
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
            timestamp: new Date()
          });
        } else {
          clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });
  }
}
