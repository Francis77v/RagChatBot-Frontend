import { Component, ElementRef, ViewChild, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RAGService, Message } from './rag.service';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-window.component.html',
  styleUrl: './chat-window.component.scss'
})
export class ChatWindowComponent {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  
  questionText = '';

  constructor(public ragService: RAGService) {
    // Reactively trigger scrolling to bottom when messages update
    effect(() => {
      // Accessing activeMessages tells Angular to re-run this effect when it changes
      const msgs = this.ragService.activeMessages();
      if (msgs.length > 0) {
        setTimeout(() => this.scrollToBottom(), 50);
      }
    });
  }

  // --- Send Message ---
  async handleSend() {
    const text = this.questionText.trim();
    if (!text || this.ragService.isAILoading()) return;

    this.questionText = '';
    await this.ragService.askQuestion(text);
  }

  // --- Handle Key Press ---
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  // --- Scroll to Bottom helper ---
  private scrollToBottom(): void {
    try {
      if (this.scrollContainer) {
        const element = this.scrollContainer.nativeElement;
        element.scrollTo({
          top: element.scrollHeight,
          behavior: 'smooth'
        });
      }
    } catch (err) {
      console.warn('Scroll failed:', err);
    }
  }

  // --- Clean Inline Markdown Formatting ---
  formatMessage(text: string): string {
    if (!text) return '';
    
    let formatted = text;

    // Escape raw HTML characters to prevent XSS
    formatted = formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 1. Triple-backtick Code Blocks: ```code```
    formatted = formatted.replace(
      /```([\s\S]*?)```/g,
      '<pre class="bg-[#1e1f29] border border-white/5 p-3 rounded-xl my-2 text-xs font-mono overflow-x-auto text-blue-300">$1</pre>'
    );

    // 2. Single-backtick Inline Code: `code`
    formatted = formatted.replace(
      /`([^`]+)`/g,
      '<code class="bg-[#2a2c3a] px-1.5 py-0.5 rounded text-blue-300 font-mono text-[13px]">$1</code>'
    );

    // 3. Bold Text: **text**
    formatted = formatted.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong class="font-bold text-white">$1</strong>'
    );

    // 4. Bullet Points starting with * or -
    formatted = formatted.replace(
      /^\s*[-*]\s+(.+)$/gm,
      '<li class="ml-4 list-disc text-gray-300 my-1">$1</li>'
    );

    // 5. Convert Double-Newlines to paragraph dividers
    formatted = formatted.replace(/\n\n/g, '</p><p class="mt-2.5">');

    // 6. Convert Single-Newlines to linebreaks
    formatted = formatted.replace(/\n/g, '<br/>');

    return `<p>${formatted}</p>`;
  }

  // --- Quick Prompt Suggestion click ---
  applySuggestedPrompt(prompt: string) {
    this.questionText = prompt;
  }
}
