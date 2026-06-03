import { Injectable, signal, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly AUTH_KEY = 'rag_chat_auth_token';
  private http = inject(HttpClient);
  private router = inject(Router);

  // Signal to hold auth status
  public isLoggedIn = signal<boolean>(this.checkAuthStatus());

  public userStorageKey = computed(() => {
    this.isLoggedIn();
    return this.getCurrentUserStorageKey();
  });

  public userRole = computed(() => {
    this.isLoggedIn(); // Add dependency to recalculate on login
    const payload = this.decodeTokenPayload();
    if (!payload) {
      return null;
    }
    return (
      payload.role ||
      payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ||
      payload.roles ||
      payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role'] ||
      null
    );
  });

  public isAdmin = computed(() => {
    const role = this.userRole();
    console.log('Checking isAdmin - role:', role);
    if (!role) {
      return false;
    }
    if (Array.isArray(role)) {
      return role.includes('Admin');
    }
    return role === 'Admin';
  });

  public userEmail = computed(() => {
    this.isLoggedIn();
    const payload = this.decodeTokenPayload();
    if (!payload) {
      return null;
    }
    return (
      payload.email ||
      payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
      payload.mail ||
      payload.unique_name ||
      null
    );
  });

  public userName = computed(() => {
    this.isLoggedIn();
    const payload = this.decodeTokenPayload();
    if (!payload) {
      return null;
    }
    return (
      payload.name ||
      payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
      payload.given_name ||
      payload.family_name ||
      payload.email ||
      'User'
    );
  });

  public userInitials = computed(() => {
    const name = this.userName();
    if (!name) {
      return 'U';
    }
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  });

  private checkAuthStatus(): boolean {
    if (typeof window !== 'undefined' && window.localStorage) {
      return !!localStorage.getItem(this.AUTH_KEY);
    }
    return false;
  }

  private getCurrentToken(): string | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(this.AUTH_KEY);
    }
    return null;
  }

  private decodeTokenPayload(): any | null {
    const token = this.getCurrentToken();
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(json);
      console.log('Decoded JWT payload:', payload);
      return payload;
    } catch {
      return null;
    }
  }

  private getCurrentUserStorageKey(): string {
    const payload = this.decodeTokenPayload();
    if (!payload) {
      console.log('No payload, using anonymous user');
      return 'rag_user_anonymous';
    }

    const userId =
      payload.sub ||
      payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ||
      payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
      payload.name ||
      payload.email ||
      payload.unique_name ||
      null;

    const key = userId ? `rag_user_${userId}` : 'rag_user_anonymous';
    console.log('User storage key:', key, 'userId:', userId);
    return key;
  }

  async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await firstValueFrom(
        this.http.post<any>('/api/auth/login', { email, password })
      );

      // Extract token from response. Common patterns: response.token, response.Token, response.access_token
      let token = '';
      if (response) {
        if (typeof response === 'string') {
          token = response;
        } else {
          // Properly support C# PascalCase "Token" as well as standard camelCase "token"
          token = response.token || response.Token || response.access_token || response.data?.token || '';
        }
      }

      if (!token) {
        throw new Error('Authentication response did not contain a valid token.');
      }


      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(this.AUTH_KEY, token);
      }
      this.isLoggedIn.set(true);
      return { success: true };
    } catch (err: any) {
      console.error('Login failed:', err);
      let errorMsg = 'Invalid email or password.';
      if (err.status === 0) {
        errorMsg = 'Cannot reach backend server. Please verify it is running on port 5052.';
      } else if (err.error?.message) {
        errorMsg = err.error.message;
      } else if (err.error?.error) {
        errorMsg = err.error.error;
      }
      return { success: false, error: errorMsg };
    }
  }

  logout() {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.AUTH_KEY);
    }
    this.isLoggedIn.set(false);
    this.router.navigate(['/login']);
  }
}
