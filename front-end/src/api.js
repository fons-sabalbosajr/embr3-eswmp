import axios from "axios";
import secureStorage from "./utils/secureStorage";

const api = axios.create({
  baseURL: "/eswm-pipeline/api",
});

// Attach token to every request if available (skip if already set explicitly)
api.interceptors.request.use((config) => {
  if (!config.headers.Authorization) {
    const token = secureStorage.get("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;
