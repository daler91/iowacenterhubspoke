import api, {
  authAPI,
  locationsAPI,
  employeesAPI,
  schedulesAPI,
  dashboardAPI,
  activityAPI,
  notificationsAPI,
  workloadAPI
} from './api';

jest.mock('axios', () => {
  return {
    create: jest.fn(() => ({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    })),
  };
});

describe('API config', () => {
  let originalWindowLocation;
  let requestInterceptor;
  let responseErrorInterceptor;

  beforeAll(() => {
    // Save the interceptors before jest.clearAllMocks() clears the mock calls
    requestInterceptor = api.interceptors.request.use.mock.calls[0][0];
    responseErrorInterceptor = api.interceptors.response.use.mock.calls[0][1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // mock window.location
    originalWindowLocation = window.location;
    delete window.location;
    window.location = { href: '' };
  });

  afterEach(() => {
    window.location = originalWindowLocation;
  });

  describe('interceptors', () => {
    it('request interceptor adds auth_token to Authorization header', () => {
      const config = { headers: {} };
      localStorage.setItem('auth_token', 'test_token');

      const updatedConfig = requestInterceptor(config);

      expect(updatedConfig.headers.Authorization).toBe('Bearer test_token');
    });

    it('request interceptor does not add Authorization header if no token', () => {
      const config = { headers: {} };

      const updatedConfig = requestInterceptor(config);

      expect(updatedConfig.headers.Authorization).toBeUndefined();
    });

    it('response interceptor handles 401 correctly', async () => {
      localStorage.setItem('auth_token', 'token');
      localStorage.setItem('auth_user', 'user');

      const error = { response: { status: 401 } };

      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(window.location.href).toBe('/login');
    });

    it('response interceptor passes through non-401 errors', async () => {
      localStorage.setItem('auth_token', 'token');

      const error = { response: { status: 500 } };

      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(localStorage.getItem('auth_token')).toBe('token');
      expect(window.location.href).toBe('');
    });
  });

  describe('API endpoints', () => {
    // authAPI
    it('authAPI.register calls post with correct url and data', () => {
      const data = { name: 'Test' };
      authAPI.register(data);
      expect(api.post).toHaveBeenCalledWith('/auth/register', data);
    });

    it('authAPI.login calls post with correct url and data', () => {
      const data = { email: 'test@example.com' };
      authAPI.login(data);
      expect(api.post).toHaveBeenCalledWith('/auth/login', data);
    });

    it('authAPI.me calls get with correct url', () => {
      authAPI.me();
      expect(api.get).toHaveBeenCalledWith('/auth/me');
    });

    // locationsAPI
    it('locationsAPI.getAll calls get with correct url', () => {
      locationsAPI.getAll();
      expect(api.get).toHaveBeenCalledWith('/locations');
    });

    it('locationsAPI.create calls post with correct url and data', () => {
      const data = { name: 'Loc' };
      locationsAPI.create(data);
      expect(api.post).toHaveBeenCalledWith('/locations', data);
    });

    it('locationsAPI.update calls put with correct url and data', () => {
      const data = { name: 'Loc Updated' };
      locationsAPI.update(1, data);
      expect(api.put).toHaveBeenCalledWith('/locations/1', data);
    });

    it('locationsAPI.delete calls delete with correct url', () => {
      locationsAPI.delete(1);
      expect(api.delete).toHaveBeenCalledWith('/locations/1');
    });

    // employeesAPI
    it('employeesAPI.getAll calls get with correct url', () => {
      employeesAPI.getAll();
      expect(api.get).toHaveBeenCalledWith('/employees');
    });

    it('employeesAPI.create calls post with correct url and data', () => {
      const data = { name: 'Emp' };
      employeesAPI.create(data);
      expect(api.post).toHaveBeenCalledWith('/employees', data);
    });

    it('employeesAPI.update calls put with correct url and data', () => {
      const data = { name: 'Emp Updated' };
      employeesAPI.update(1, data);
      expect(api.put).toHaveBeenCalledWith('/employees/1', data);
    });

    it('employeesAPI.delete calls delete with correct url', () => {
      employeesAPI.delete(1);
      expect(api.delete).toHaveBeenCalledWith('/employees/1');
    });

    // schedulesAPI
    it('schedulesAPI.getAll calls get with correct url and params', () => {
      const params = { location: 1 };
      schedulesAPI.getAll(params);
      expect(api.get).toHaveBeenCalledWith('/schedules', { params });
    });

    it('schedulesAPI.create calls post with correct url and data', () => {
      const data = { date: '2023-01-01' };
      schedulesAPI.create(data);
      expect(api.post).toHaveBeenCalledWith('/schedules', data);
    });

    it('schedulesAPI.update calls put with correct url and data', () => {
      const data = { date: '2023-01-02' };
      schedulesAPI.update(1, data);
      expect(api.put).toHaveBeenCalledWith('/schedules/1', data);
    });

    it('schedulesAPI.delete calls delete with correct url', () => {
      schedulesAPI.delete(1);
      expect(api.delete).toHaveBeenCalledWith('/schedules/1');
    });

    it('schedulesAPI.updateStatus calls put with correct url and status', () => {
      schedulesAPI.updateStatus(1, 'published');
      expect(api.put).toHaveBeenCalledWith('/schedules/1/status', { status: 'published' });
    });

    // dashboardAPI
    it('dashboardAPI.getStats calls get with correct url', () => {
      dashboardAPI.getStats();
      expect(api.get).toHaveBeenCalledWith('/dashboard/stats');
    });

    // activityAPI
    it('activityAPI.getAll calls get with default limit params', () => {
      activityAPI.getAll();
      expect(api.get).toHaveBeenCalledWith('/activity-logs', { params: { limit: 30 } });
    });

    it('activityAPI.getAll calls get with custom limit params', () => {
      activityAPI.getAll(50);
      expect(api.get).toHaveBeenCalledWith('/activity-logs', { params: { limit: 50 } });
    });

    // notificationsAPI
    it('notificationsAPI.getAll calls get with correct url', () => {
      notificationsAPI.getAll();
      expect(api.get).toHaveBeenCalledWith('/notifications');
    });

    // workloadAPI
    it('workloadAPI.getAll calls get with correct url', () => {
      workloadAPI.getAll();
      expect(api.get).toHaveBeenCalledWith('/workload');
    });
  });
});
