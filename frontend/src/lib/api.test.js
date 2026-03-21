import axios from 'axios';
import api, { authAPI, locationsAPI, schedulesAPI } from './api';

// Mock window.location
const originalLocation = window.location;
beforeAll(() => {
  delete window.location;
  window.location = { href: '' };
});

afterAll(() => {
  window.location = originalLocation;
});

// We need to spy on the instance methods of the axios instance
jest.mock('axios', () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  };
  return {
    create: jest.fn(() => mockInstance),
    ...mockInstance,
  };
});

describe('api.js', () => {
  let requestInterceptor;
  let responseInterceptorSuccess;
  let responseInterceptorError;

  beforeAll(() => {
    // Extract interceptors from the axios instance we use in test file
    // axios.create creates a mock object, we need to inspect the original mock configuration
    // Since api.js exports the axios instance it created, we can inspect its interceptors
    requestInterceptor = api.interceptors.request.use.mock.calls[0][0];
    responseInterceptorSuccess = api.interceptors.response.use.mock.calls[0][0];
    responseInterceptorError = api.interceptors.response.use.mock.calls[0][1];
  });

  beforeEach(() => {
    // Clear mocks and localStorage before each test
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('Interceptors', () => {
    describe('Request Interceptor', () => {
      it('should add Authorization header if auth_token is in localStorage', () => {
        localStorage.setItem('auth_token', 'test-token');
        const config = { headers: {} };
        const result = requestInterceptor(config);

        expect(result.headers.Authorization).toBe('Bearer test-token');
      });

      it('should not add Authorization header if auth_token is missing', () => {
        const config = { headers: {} };
        const result = requestInterceptor(config);

        expect(result.headers.Authorization).toBeUndefined();
      });
    });

    describe('Response Interceptor', () => {
      it('should pass through successful responses', () => {
        const response = { data: 'test' };
        expect(responseInterceptorSuccess(response)).toBe(response);
      });

      it('should handle 401 error by clearing localStorage and redirecting to login', async () => {
        localStorage.setItem('auth_token', 'test-token');
        localStorage.setItem('auth_user', 'user-data');
        window.location.href = '/dashboard';

        const error = { response: { status: 401 } };

        await expect(responseInterceptorError(error)).rejects.toBe(error);

        expect(localStorage.getItem('auth_token')).toBeNull();
        expect(localStorage.getItem('auth_user')).toBeNull();
        expect(window.location.href).toBe('/login');
      });

      it('should pass through non-401 errors without redirecting', async () => {
        localStorage.setItem('auth_token', 'test-token');
        window.location.href = '/dashboard';

        const error = { response: { status: 500 } };

        await expect(responseInterceptorError(error)).rejects.toBe(error);

        expect(localStorage.getItem('auth_token')).toBe('test-token');
        expect(window.location.href).toBe('/dashboard');
      });
    });
  });

  describe('API Endpoints', () => {
    describe('authAPI', () => {
      it('should call api.post for login', () => {
        const data = { email: 'test@test.com', password: 'password' };
        authAPI.login(data);
        expect(api.post).toHaveBeenCalledWith('/auth/login', data);
      });

      it('should call api.post for register', () => {
        const data = { email: 'test@test.com', password: 'password', name: 'Test' };
        authAPI.register(data);
        expect(api.post).toHaveBeenCalledWith('/auth/register', data);
      });
    });

    describe('locationsAPI', () => {
      it('should call api.get for getAll', () => {
        locationsAPI.getAll();
        expect(api.get).toHaveBeenCalledWith('/locations');
      });
    });

    describe('schedulesAPI', () => {
      it('should call api.put for updateStatus', () => {
        schedulesAPI.updateStatus('123', 'approved');
        expect(api.put).toHaveBeenCalledWith('/schedules/123/status', { status: 'approved' });
      });
    });
  });
});
