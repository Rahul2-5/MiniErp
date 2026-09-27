import axios from 'axios';

// One axios instance for the whole app; the base URL comes from VITE_API_URL in .env.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

// Every request carries the JWT. (Spring: a RestTemplate/WebClient interceptor adding the header.)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired or invalid token (401) means: forget the login and go to the login page.
// A wrong password on the login form is also a 401, but that must just show its message.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config.url === '/auth/login';
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

// The backend always answers errors as { "error": "message" }; show that message as it is.
export function errorMessage(error) {
  return error.response?.data?.error || error.message;
}

export default api;
