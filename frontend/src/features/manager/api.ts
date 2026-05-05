import { usersAPI, locationsAPI } from '../../lib/api';

export const managerFeatureApi = {
  users: {
    getAll: usersAPI.getAll,
    getInvitations: usersAPI.getInvitations,
    listLockouts: usersAPI.listLockouts,
    approve: usersAPI.approve,
    reject: usersAPI.reject,
    updateRole: usersAPI.updateRole,
    delete: usersAPI.delete,
  },
  locations: {
    create: locationsAPI.create,
    update: locationsAPI.update,
    delete: locationsAPI.delete,
    getDriveTimeFromHub: locationsAPI.getDriveTimeFromHub,
  },
};
