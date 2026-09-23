import AsyncStorage from "@react-native-async-storage/async-storage";

export type StorageValue =
  string | Record<string, unknown> | number | boolean | null;

export const storage = {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: StorageValue): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await AsyncStorage.setItem(key, serialized);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
  async clear(): Promise<void> {
    await AsyncStorage.clear();
  },
};
