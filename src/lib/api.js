import axios from "axios";
import { authGetToken } from "../services/auth.service";
import { beginPageLoading, endPageLoading } from "../state/pageLoadingStore";

export const api = axios.create({});
const LOADER_TOKEN_KEY = "__billjoyLoaderToken";

api.interceptors.request.use((config) => {
  const token = authGetToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  config[LOADER_TOKEN_KEY] = beginPageLoading("api");
  return config;
});

api.interceptors.response.use(
  (response) => {
    endPageLoading(response?.config?.[LOADER_TOKEN_KEY]);
    return response;
  },
  (error) => {
    endPageLoading(error?.config?.[LOADER_TOKEN_KEY]);
    return Promise.reject(error);
  }
);
