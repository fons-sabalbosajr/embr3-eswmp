import axios from "axios";
import secureStorage from "./utils/secureStorage";

const api = axios.create({
  baseURL: "/api",
});

// Attach token to every request if available
api.interceptors.request.use((config) => {
  const token = secureStorage.get("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
