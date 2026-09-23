import { getAppConfig } from "../../core/config";
import { theme } from "../theme/theme";

describe("App foundation smoke test", () => {
  it("exposes the expected config and theme defaults", () => {
    const config = getAppConfig();

    expect(config.appName).toBe("Rider App");
    expect(theme.colors.primary).toBe("#1F6FEB");
    expect(theme.spacing.md).toBe(12);
  });
});
