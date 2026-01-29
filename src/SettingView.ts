import Publisher from "./Publisher";
import { IFlowershowSettings } from "./settings";
import { Notice, Setting, debounce, MetadataCache } from "obsidian";

export default class SettingView {
  private publisher: Publisher;
  private settings: IFlowershowSettings;
  private saveSettings: () => Promise<void>;
  private settingsRootElement: HTMLElement;
  debouncedSaveAndUpdate = debounce(
    this.saveSiteSettingsAndUpdateEnv,
    500,
    true,
  );

  constructor(
    settingsRootElement: HTMLElement,
    publisher: Publisher,
    settings: IFlowershowSettings,
    saveSettings: () => Promise<void>,
  ) {
    this.publisher = publisher;
    this.settingsRootElement = settingsRootElement;
    this.settingsRootElement.classList.add("dg-settings");
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  initialize() {
    this.settingsRootElement.empty();

    // Link to Flowershow
    const linkDiv = this.settingsRootElement.createEl("div");

    linkDiv.createEl("a", {
      text: "Sign up for Flowershow →",
      href: "https://cloud.flowershow.app/login?utm_source=obsidian&utm_medium=referral",
    });
    linkDiv.setCssProps({ padding: "15px 0" });

    // Authentication section
    const authHeader = this.settingsRootElement.createEl("h2", {
      text: "Authentication",
    });

    this.initializeTokenSetting();
    this.initializeSiteNameSetting();
    this.initializeTestConnection();

    // Publishing settings
    const publishHeader = this.settingsRootElement.createEl("h2", {
      text: "Publishing Settings",
    });
    this.initializeExcludePatternsSetting();
  }

  private async saveSiteSettingsAndUpdateEnv(
    metadataCache: MetadataCache,
    settings: IFlowershowSettings,
    saveSettings: () => Promise<void>,
  ) {
    let updateFailed = false;
    try {
      await saveSettings();
    } catch {
      new Notice(
        "Failed to update settings. Make sure you have an internet connection.",
      );
      updateFailed = true;
    }

    if (!updateFailed) {
      await saveSettings();
    }
  }

  private initializeTokenSetting() {
    const desc = document.createDocumentFragment();
    desc.createEl("span", undefined, (span) => {
      span.appendText(
        "Your Flowershow Personal Access Token (PAT). You can generate one ",
      );
      span.createEl("a", undefined, (link) => {
        link.href =
          "https://cloud.flowershow.app/tokens?utm_source=obsidian&utm_medium=referral";
        link.innerText = "here!";
      });
      span.createEl("br");
      span.createEl("br");
      span.appendText("The token should start with ");
      span.createEl("code", { text: "fs_pat_" });
    });

    new Setting(this.settingsRootElement)
      .setName("Flowershow PAT Token")
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder("fs_pat_...")
          .setValue(this.settings.flowershowToken)
          .onChange(async (value) => {
            this.settings.flowershowToken = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeSiteNameSetting() {
    new Setting(this.settingsRootElement)
      .setName("Site Name")
      .setDesc(
        "Name of your Flowershow site (will be created if it doesn't exist)",
      )
      .addText((text) =>
        text
          .setPlaceholder("my-notes")
          .setValue(this.settings.siteName)
          .onChange(async (value) => {
            this.settings.siteName = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeTestConnection() {
    new Setting(this.settingsRootElement)
      .setName("Test Connection")
      .setDesc("Test Flowershow connection and validate your credentials")
      .addButton((button) =>
        button.setButtonText("Test Connection").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("Testing...");

          try {
            const result = await this.publisher.testConnection();
            if (result.success) {
              new Notice("✅ " + result.message, 4000);
            } else {
              new Notice("❌ " + result.message, 10000);
            }
          } catch (error) {
            new Notice("❌ Failed to test connection", 4000);
          } finally {
            button.setDisabled(false);
            button.setButtonText("Test Connection");
          }
        }),
      );
  }

  private initializeExcludePatternsSetting() {
    const settingContainer = this.settingsRootElement.createDiv(
      "exclude-patterns-container",
    );

    new Setting(settingContainer)
      .setName("Exclude Patterns")
      .setDesc(
        "Regex patterns to exclude files and folders from publishing. One pattern per line.",
      )
      .addTextArea((textarea) => {
        textarea
          .setPlaceholder("^\\.git/\\n^node_modules/\\n\\.DS_Store$")
          .setValue(this.settings.excludePatterns.join("\\n"))
          .onChange(async (value) => {
            // Split by newlines and filter out empty lines
            const patterns = value
              .split("\\n")
              .filter((pattern) => pattern.trim() !== "");
            this.settings.excludePatterns = patterns;
            await this.saveSettings();
          });

        // Adjust textarea height
        textarea.inputEl.rows = 4;
        textarea.inputEl.style.width = "100%";
      });

    // Add a help text with examples
    const helpText = settingContainer.createEl("div", {
      cls: "setting-item-description",
    });
    helpText.innerHTML = `
      Examples:<br>
      • <code>^private/</code> - Exclude private directory<br>
      • <code>\\.excalidraw\\.md$</code> - Exclude Excalidraw files
    `;
  }
}
