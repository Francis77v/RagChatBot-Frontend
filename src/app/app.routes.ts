import { Routes } from '@angular/router';
import { ChatWindowComponent } from './chat-window.component';
import { DocumentUploadComponent } from './document-upload.component';
import { LoginComponent } from './login.component';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin.guard';
import { loginGuard } from './login.guard';

import { UserManagementComponent } from './user-management.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [loginGuard]
  },
  {
    path: '',
    component: ChatWindowComponent,
    canActivate: [authGuard]
  },
  {
    path: 'documents',
    component: DocumentUploadComponent,
    canActivate: [authGuard, adminGuard]
  },
  {
    path: 'users',
    component: UserManagementComponent,
    canActivate: [authGuard, adminGuard]
  },
  {
    path: '**',
    redirectTo: ''
  }
];

