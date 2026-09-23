import * as SecureStore from "expo-secure-store";

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
