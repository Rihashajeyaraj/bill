import axios from "axios";
import { authGetToken } from "../services/auth.service";

export const api = axios.create({});

api.interceptors.request.use((config) => {
  const token = authGetToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
