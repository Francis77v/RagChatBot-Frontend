import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';

const passwordMatchValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');
  
  if (password && confirmPassword && password.value !== confirmPassword.value) {
    return { passwordMismatch: true };
  }
  return null;
};

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);

  // Form Definitions
  registerForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
    role: ['', [Validators.required]]
  }, { validators: passwordMatchValidator });

  roleForm: FormGroup = this.fb.group({
    roleName: ['', [Validators.required, Validators.minLength(2)]]
  });

  // State Signals
  rolesList = signal<string[]>([]);
  isLoadingRoles = signal<boolean>(false);
  
  isRegistering = signal<boolean>(false);
  registerSuccess = signal<string | null>(null);
  registerError = signal<string | null>(null);

  isAddingRole = signal<boolean>(false);
  roleSuccess = signal<string | null>(null);
  roleError = signal<string | null>(null);

  ngOnInit() {
    this.loadRoles();
  }

  loadRoles() {
    this.isLoadingRoles.set(true);
    this.http.get<any[]>('/api/auth/roles').subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          const mapped = data.map(item => {
            if (typeof item === 'string') {
              return item;
            }
            if (item && typeof item === 'object') {
              return item.name || item.Name || '';
            }
            return '';
          }).filter(name => !!name);
          this.rolesList.set(mapped);
        } else {
          console.error('Roles response is not an array:', data);
        }
        this.isLoadingRoles.set(false);
      },
      error: (err) => {
        console.error('Failed to load roles:', err);
        let msg = 'Failed to load roles from backend server.';
        if (err.status === 0) {
          msg = 'Cannot reach backend server. Please verify it is running on port 5052.';
        } else if (err.status === 500) {
          msg = 'Internal Server Error (500). If this is a proxy error (ECONNREFUSED), please verify that the backend API server is running on port 5052.';
        } else if (err.status === 401) {
          msg = 'Unauthorized (401). Please verify your session/login token.';
        } else if (err.status === 403) {
          msg = 'Forbidden (403). Only administrators are allowed to access roles.';
        } else if (err.error) {
          msg = err.error.message || err.error.error || (typeof err.error === 'string' ? err.error : err.message || msg);
        }
        this.roleError.set(msg);
        this.isLoadingRoles.set(false);
      }
    });
  }

  onRegister() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isRegistering.set(true);
    this.registerSuccess.set(null);
    this.registerError.set(null);

    const { email, password, confirmPassword, role } = this.registerForm.value;

    const payload = {
      Email: email,
      Password: password,
      confirmPassword: confirmPassword,
      Role: role
    };

    this.http.post('/api/auth/register', payload, { responseType: 'text' }).subscribe({
      next: (response) => {
        this.registerSuccess.set(response || 'User registered successfully!');
        this.registerForm.reset({
          email: '',
          password: '',
          confirmPassword: '',
          role: ''
        });
        this.isRegistering.set(false);
      },
      error: (err) => {
        console.error('Registration failed:', err);
        let errorMsg = 'Failed to register user.';
        if (err.status === 0) {
          errorMsg = 'Cannot reach backend server. Please verify it is running on port 5052.';
        } else if (err.status === 500) {
          errorMsg = 'Internal Server Error (500). If this is a proxy error (ECONNREFUSED), please verify that the backend API server is running on port 5052.';
        } else if (err.status === 401) {
          errorMsg = 'Unauthorized (401). Please verify your session/login token.';
        } else if (err.status === 403) {
          errorMsg = 'Forbidden (403). Only administrators are allowed to register users.';
        } else if (err.error) {
          try {
            const parsed = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
            if (parsed.startsWith('{') || parsed.startsWith('[')) {
              const parsedJson = JSON.parse(parsed);
              errorMsg = parsedJson.message || parsedJson.error || parsed;
            } else {
              errorMsg = parsed;
            }
          } catch {
            errorMsg = err.error.message || err.error || err.message;
          }
        }
        this.registerError.set(errorMsg);
        this.isRegistering.set(false);
      }
    });
  }

  onAddRole() {
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      return;
    }

    this.isAddingRole.set(true);
    this.roleSuccess.set(null);
    this.roleError.set(null);

    const { roleName } = this.roleForm.value;

    const payload = {
      RoleName: roleName
    };

    this.http.post<any>('/api/auth/roles', payload).subscribe({
      next: (response) => {
        this.roleSuccess.set(response?.message || `Role '${roleName}' created successfully!`);
        this.roleForm.reset({ roleName: '' });
        this.isAddingRole.set(false);
        this.loadRoles(); // Reload the roles list to update the dropdown options
      },
      error: (err) => {
        console.error('Role creation failed:', err);
        let errorMsg = 'Failed to create role.';
        if (err.status === 0) {
          errorMsg = 'Cannot reach backend server. Please verify it is running on port 5052.';
        } else if (err.status === 500) {
          errorMsg = 'Internal Server Error (500). If this is a proxy error (ECONNREFUSED), please verify that the backend API server is running on port 5052.';
        } else if (err.status === 401) {
          errorMsg = 'Unauthorized (401). Please verify your session/login token.';
        } else if (err.status === 403) {
          errorMsg = 'Forbidden (403). Only administrators are allowed to create roles.';
        } else if (err.error) {
          if (err.error.message) {
            errorMsg = err.error.message;
          } else if (err.error.errors) {
            errorMsg = Object.values(err.error.errors).flat().join(', ');
          } else if (typeof err.error === 'string') {
            errorMsg = err.error;
          }
        }
        this.roleError.set(errorMsg);
        this.isAddingRole.set(false);
      }
    });
  }

  // Field status helpers for UI
  isRegisterFieldInvalid(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  isRoleFieldInvalid(fieldName: string): boolean {
    const field = this.roleForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }
}
