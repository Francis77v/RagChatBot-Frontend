import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = typeof window !== 'undefined' && window.localStorage 
    ? localStorage.getItem('rag_chat_auth_token') 
    : null;

  console.log('Token from localStorage:', token);

  if (token) {
    console.log('Adding auth header:', `Bearer ${token}`);
    const authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    return next(authReq);
  }

  console.log('No token found, sending request without auth header');
  return next(req);
};
