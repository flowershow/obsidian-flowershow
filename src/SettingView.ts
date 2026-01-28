import Publisher from "./Publisher";
import { IFlowershowSettings } from "./settings";
import { Notice, Setting, debounce, MetadataCache, getIcon } from "obsidian";
// import SiteManager from './SiteManager';

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
    this.settingsRootElement.createEl("h1", { text: "Flowershow Settings" });
    const linkDiv = this.settingsRootElement.createEl("div");
    linkDiv.addClass("pr-link");
    linkDiv.createEl("a", {
      text: "Sign up for Flowershow →",
      href: "https://cloud.flowershow.app/login?utm_source=obsidian&utm_medium=referral",
    });

    const githubHeader = this.settingsRootElement.createEl("h3", {
      text: "GitHub Authentication",
    });
    const githubIcon = getIcon("github");
    if (githubIcon) githubHeader.prepend(githubIcon);

    this.initializeGitHubUserNameSetting();
    this.initializeGitHubRepoSetting();
    this.initializeGitHubTokenSetting();
    this.initializeBranchSetting();
    this.initializeTestConnection();

    const publishHeader = this.settingsRootElement.createEl("h3", {
      text: "Publishing Settings",
    });
    this.initializeAutoMergeSetting();
    this.initializeMergeMessageSetting();
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

  private initializeGitHubRepoSetting() {
    new Setting(this.settingsRootElement)
      .setName("Repository name")
      .setDesc("Name of the GitHub repository linked to your Flowershow site")
      .addText((text) =>
        text
          .setPlaceholder("mygithubrepo")
          .setValue(this.settings.githubRepo)
          .onChange(async (value) => {
            this.settings.githubRepo = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeGitHubUserNameSetting() {
    new Setting(this.settingsRootElement)
      .setName("Username")
      .setDesc("Your GitHub username")
      .addText((text) =>
        text
          .setPlaceholder("myusername")
          .setValue(this.settings.githubUserName)
          .onChange(async (value) => {
            this.settings.githubUserName = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeBranchSetting() {
    new Setting(this.settingsRootElement)
      .setName("Branch")
      .setDesc("The branch to publish to (defaults to main)")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.settings.branch)
          .onChange(async (value) => {
            this.settings.branch = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeGitHubTokenSetting() {
    const desc = document.createDocumentFragment();
    desc.createEl("span", undefined, (span) => {
      span.appendText(
        "GitHub personal access token with repository permissions. You can generate one ",
      );
      span.createEl("a", undefined, (link) => {
        link.href = "https://github.com/settings/tokens/new?scopes=repo";
        link.innerText = "here!";
      });
      span.createEl("br");
      span.createEl("br");
      span.createEl("strong", { text: "Required scopes:" });
      span.createEl("br");
      span.appendText("• Classic PAT: repo scope");
      span.createEl("br");
      span.appendText(
        "• Fine-grained PAT: Contents and Pull Requests (both with read and write)",
      );
    });

    new Setting(this.settingsRootElement)
      .setName("Personal Access Token")
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder("Secret Token")
          .setValue(this.settings.githubToken)
          .onChange(async (value) => {
            this.settings.githubToken = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeTestConnection() {
    new Setting(this.settingsRootElement)
      .setName("Test Connection")
      .setDesc(
        "Test GitHub repository access, permissions, and branch existence",
      )
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

  private initializeAutoMergeSetting() {
    new Setting(this.settingsRootElement)
      .setName("Auto-merge Pull Requests")
      .setDesc("Automatically merge pull requests after creation")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.autoMergePullRequests)
          .onChange(async (value) => {
            this.settings.autoMergePullRequests = value;
            await this.saveSettings();
          }),
      );
  }

  private initializeMergeMessageSetting() {
    new Setting(this.settingsRootElement)
      .setName("Merge Commit Message")
      .setDesc("Default message for merge commits")
      .addText((text) =>
        text
          .setPlaceholder("Merge content updates")
          .setValue(this.settings.mergeCommitMessage)
          .onChange(async (value) => {
            this.settings.mergeCommitMessage = value;
            await this.saveSettings();
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
          .setPlaceholder("^\\.git/\n^node_modules/\n\\.DS_Store$")
          .setValue(this.settings.excludePatterns.join("\n"))
          .onChange(async (value) => {
            // Split by newlines and filter out empty lines
            const patterns = value
              .split("\n")
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
      Note: This excludes files from being pushed to your GitHub repo, e.g. for some private content that you don't want to leave your personal computer. If you still want them to be pushed and version controled, but you don't want them to be published by Flowershow, exclude them in your config.json.
      Examples:<br>
      • <code>^private/</code> - Exlude private directory
    `;
  }
}
