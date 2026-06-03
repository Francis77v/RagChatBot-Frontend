import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { RAGService } from './rag.service';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  constructor(
    public ragService: RAGService,
    public authService: AuthService,
    private router: Router
  ) {}

  toggleSidebar() {
    this.ragService.sidebarCollapsed.update(state => !state);
  }

  selectChat(id: string) {
    this.ragService.selectConversation(id);
    this.router.navigate(['/']);
  }

  startNewChat() {
    this.ragService.createNewConversation();
    this.router.navigate(['/']);
  }

  deleteChat(id: string, event: Event) {
    event.stopPropagation();
    this.ragService.deleteConversation(id);
  }

  logout() {
    this.authService.logout();
  }
}

