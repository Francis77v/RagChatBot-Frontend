import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RAGService } from './rag.service';

@Component({
  selector: 'app-document-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './document-upload.component.html',
  styleUrl: './document-upload.component.scss'
})
export class DocumentUploadComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  isDragging = signal<boolean>(false);
  availableRoles = signal<string[]>(['Admin', 'User', 'Manager', 'Employee']);

  constructor(public ragService: RAGService) {}

  triggerFilePicker() {
    this.fileInput.nativeElement.click();
  }

  toggleRole(role: string) {
    this.ragService.selectedRoles.update(current => {
      if (current.includes(role)) {
        return current.filter(r => r !== role);
      } else {
        return [...current, role];
      }
    });
  }

  isRoleSelected(role: string): boolean {
    return this.ragService.selectedRoles().includes(role);
  }

  async onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];
      await this.ragService.uploadDocuments([file], this.ragService.selectedRoles());
      target.value = '';
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const files: File[] = [];
      for (let i = 0; i < event.dataTransfer.files.length; i++) {
        const file = event.dataTransfer.files[i];
        if (file.name.endsWith('.pdf')) {
          files.push(file);
        }
      }

      if (files.length > 0) {
        await this.ragService.uploadDocuments(files, this.ragService.selectedRoles());
      } else {
        this.ragService.uploadError.set('Only PDF files are supported.');
      }
    }
  }

  async handleSync() {
    await this.ragService.syncDatabase();
  }
}
