import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import {
  DEFAULT_PROVIDER_CONFIGS,
  normalizeLlmBaseUrl,
  parseProviderConfig,
  parseProviderConnection,
  type LlmProviderKind,
  type ModelDefinition,
  type ProviderConfig,
  type ProviderStatus,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/messages.en';

interface EditableModel {
  id: string;
  displayName: string;
  maxOutputTokens?: number | null;
  tokenParameter: 'max_tokens' | 'max_completion_tokens';
  supportsTemperature: boolean;
  supportsSeed: boolean;
}
interface ProviderDraft {
  id: string;
  name: string;
  kind: LlmProviderKind;
  baseUrl: string;
  models: EditableModel[];
}

/** Compact connection editor; the model input is both editable and backed by a searchable picker. */
@Component({
  selector: 'fl-llm-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './llm-settings.component.css',
  template: `
    <section class="llm-dialog" data-testid="llm-settings" aria-labelledby="llm-title">
      <header class="llm-dialog__header">
        <div>
          <h2 id="llm-title">{{ t('llm.title') }}</h2>
          <p class="muted small">{{ t('llm.compactSubtitle') }}</p>
        </div>
      </header>
      <div class="llm-dialog__body">
        <nav class="llm-providers" [attr.aria-label]="t('llm.title')">
          <button
            class="btn btn--small"
            type="button"
            data-testid="llm-local"
            [disabled]="busy() || loading()"
            (click)="useLocal()"
          >
            {{ t('llm.local') }}
          </button>
          @for (provider of settings()?.providers ?? []; track provider.id) {
            <button
              type="button"
              class="llm-provider"
              [class.is-active]="draft?.id === provider.id"
              [attr.aria-pressed]="draft?.id === provider.id"
              [attr.data-testid]="'llm-provider-' + provider.id"
              [disabled]="busy() || loading()"
              (click)="edit(provider)"
            >
              <strong>{{ provider.name }}</strong>
              <span class="muted small">{{
                t(provider.keySource === 'none' ? 'llm.noKey' : 'llm.configured')
              }}</span>
              @if (settings()?.active?.providerConfigId === provider.id) {
                <span class="llm-in-use small">{{ t('llm.inUse') }}</span>
              }
            </button>
          }
          <button
            type="button"
            class="btn btn--small"
            data-testid="llm-add-provider"
            [disabled]="busy() || loading()"
            (click)="add()"
          >
            {{ t('llm.addProvider') }}
          </button>
        </nav>
        <section class="llm-editor">
          @if (loading()) {
            <p role="status">{{ t('llm.loading') }}</p>
          }
          @if (draft; as d) {
            <fieldset [disabled]="busy()">
              @if (!saved()) {
                <div class="llm-presets" role="group" [attr.aria-label]="t('llm.providerType')">
                  @for (kind of kinds; track kind) {
                    <button
                      type="button"
                      class="llm-preset"
                      [class.is-selected]="d.kind === kind"
                      [attr.aria-pressed]="d.kind === kind"
                      (click)="chooseKind(kind)"
                    >
                      {{ kindLabel(kind) }}
                    </button>
                  }
                </div>
              }
              <label class="field"
                ><span>{{ t('llm.name') }}</span
                ><input
                  maxlength="100"
                  data-testid="llm-name"
                  [value]="d.name"
                  (input)="setField('name', $event)"
              /></label>
              <label class="field"
                ><span>API Key</span
                ><input
                  type="password"
                  maxlength="512"
                  autocomplete="off"
                  spellcheck="false"
                  data-testid="llm-key"
                  [value]="keyDraft"
                  (input)="setKey($event)"
                  [placeholder]="
                    t(
                      saved()?.hasStoredKey && !urlChanged()
                        ? 'llm.keepKey'
                        : 'app.model.keyPlaceholder'
                    )
                  "
              /></label>
              @if (saved()?.keySource === 'environment' && !urlChanged()) {
                <p class="llm-hint" data-testid="llm-env-note">{{ t('llm.environment') }}</p>
              }
              @if (settings()?.canStore !== true) {
                <p class="llm-hint">{{ t('app.model.noKeychain') }}</p>
              }
              <label class="field"
                ><span>API Base URL</span
                ><input
                  type="url"
                  maxlength="2048"
                  spellcheck="false"
                  data-testid="llm-base-url"
                  [value]="d.baseUrl"
                  (input)="setField('baseUrl', $event)"
                  placeholder="https://example.com/v1"
              /></label>
              @if (urlChanged()) {
                <p class="llm-hint">{{ t('llm.urlChanged') }}</p>
              }
              <div class="field">
                <label for="llm-model-id">Model ID <span class="muted small">model_id</span></label>
                <div class="llm-model-input" #modelAnchor>
                  <input
                    id="llm-model-id"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="200"
                    data-testid="llm-model-id"
                    [value]="currentModel()?.id ?? ''"
                    (input)="setModelId($event)"
                    [placeholder]="t('llm.modelPlaceholder')"
                  />
                  <button
                    type="button"
                    class="btn btn--small"
                    data-testid="llm-fetch-models"
                    [disabled]="!canDiscover()"
                    [title]="t('llm.fetchHint')"
                    (click)="discover()"
                  >
                    {{ t('llm.fetchModels') }}
                  </button>
                  <button
                    type="button"
                    class="btn btn--small llm-picker-toggle"
                    data-testid="llm-model-picker"
                    [disabled]="modelOptions().length === 0"
                    [attr.aria-label]="t('llm.chooseModel')"
                    aria-haspopup="listbox"
                    aria-controls="llm-model-options"
                    [attr.aria-expanded]="pickerOpen()"
                    popovertarget="llm-model-popover"
                    (click)="search.set('')"
                  >
                    ▾
                  </button>
                </div>
                <span class="muted small">{{ t('llm.editableModelHint') }}</span>
              </div>
              <details class="llm-advanced" data-testid="llm-advanced">
                <summary>{{ t('llm.advanced') }}</summary>
                @if (currentModel(); as model) {
                  <label class="field"
                    ><span>{{ t('llm.modelName') }}</span
                    ><input
                      maxlength="200"
                      [value]="model.displayName"
                      (input)="setModelName($event)"
                  /></label>
                  <div class="llm-fields">
                    <label class="field"
                      ><span>{{ t('llm.outputLimit') }}</span
                      ><input
                        type="number"
                        min="1"
                        max="1000000"
                        [value]="model.maxOutputTokens ?? ''"
                        (input)="setOutputLimit($event)"
                    /></label>
                    <label class="field"
                      ><span>{{ t('llm.tokenParameter') }}</span
                      ><span class="llm-select"
                        ><select
                          data-testid="llm-token-parameter"
                          [value]="model.tokenParameter"
                          (change)="setTokenParameter($event)"
                        >
                          <option value="max_tokens">max_tokens</option>
                          <option value="max_completion_tokens">max_completion_tokens</option>
                        </select></span
                      ></label
                    >
                  </div>
                  <div class="llm-flags">
                    <label
                      ><input
                        type="checkbox"
                        [checked]="model.supportsTemperature"
                        (change)="setModelFlag('supportsTemperature', $event)"
                      />
                      temperature</label
                    ><label
                      ><input
                        type="checkbox"
                        [checked]="model.supportsSeed"
                        (change)="setModelFlag('supportsSeed', $event)"
                      />
                      seed</label
                    >
                  </div>
                }
                <div class="llm-section-title">
                  <span>{{ t('llm.otherModels') }}</span
                  ><button
                    type="button"
                    class="btn btn--small"
                    data-testid="llm-add-model"
                    [disabled]="d.models.length >= 32"
                    (click)="addModel()"
                  >
                    {{ t('llm.addModel') }}
                  </button>
                </div>
                <div class="llm-model-tabs">
                  @for (model of d.models; track $index; let i = $index) {
                    <button
                      type="button"
                      class="llm-model-tab"
                      [class.is-selected]="editingIndex === i"
                      (click)="editModel(i)"
                    >
                      {{ model.id || t('llm.newModel') }}
                    </button>
                  }
                </div>
                @if (d.models.length > 1) {
                  <button type="button" class="btn btn--small" (click)="removeModel()">
                    {{ t('llm.removeModel') }}
                  </button>
                }
                <p class="muted small">{{ t('llm.urlHint') }}</p>
                <p class="muted small">{{ t('llm.privacy') }}</p>
                <div class="llm-danger-actions">
                  @if (saved()?.hasStoredKey) {
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="llm-clear-key"
                      (click)="clearKey()"
                    >
                      {{ t('llm.clearKey') }}
                    </button>
                  }
                  @if (saved()) {
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="llm-delete"
                      (click)="confirmDelete.set(true)"
                    >
                      {{ t('llm.delete') }}
                    </button>
                  }
                </div>
                @if (confirmDelete()) {
                  <div class="llm-confirm">
                    <p>{{ t('llm.confirmDelete') }}</p>
                    <div class="row">
                      <button
                        type="button"
                        class="btn btn--small"
                        (click)="confirmDelete.set(false)"
                      >
                        {{ t('llm.cancel') }}</button
                      ><button
                        type="button"
                        class="btn btn--small"
                        data-testid="llm-confirm-delete"
                        (click)="remove()"
                      >
                        {{ t('llm.delete') }}
                      </button>
                    </div>
                  </div>
                }
              </details>
            </fieldset>
          }
          @if (notice(); as key) {
            <p class="llm-status" role="status" data-testid="llm-notice">{{ t(key) }}</p>
          }
          @if (busy()) {
            <p class="llm-status" role="status">{{ t('llm.working') }}</p>
          }
        </section>
      </div>
      <footer class="llm-dialog__footer">
        <div class="llm-test">
          <button
            type="button"
            class="btn btn--small"
            data-testid="llm-test"
            [disabled]="busy() || dirty() || !hasCredential()"
            [title]="t(dirty() ? 'llm.saveFirst' : 'llm.testHint')"
            (click)="test()"
          >
            {{ t('llm.test') }}</button
          ><span class="muted small" data-testid="llm-verification">{{
            t(verified() ? 'llm.verified' : 'llm.unverified')
          }}</span>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn"
            data-testid="llm-save"
            [disabled]="busy() || !canSave()"
            (click)="save(false)"
          >
            {{ t('llm.saveOnly') }}</button
          ><button
            type="button"
            class="btn btn--primary"
            data-testid="llm-use"
            [disabled]="busy() || !canSave() || !hasCredential()"
            (click)="save(true)"
          >
            {{ t('llm.saveAndUse') }}
          </button>
        </div>
      </footer>
      <div
        #modelPopover
        id="llm-model-popover"
        popover="auto"
        class="llm-picker"
        (toggle)="onPickerToggle($event)"
      >
        <div class="llm-picker__header">
          <input
            #modelSearch
            autofocus
            type="search"
            autocomplete="off"
            data-testid="llm-model-search"
            [attr.aria-label]="t('llm.searchModels')"
            [placeholder]="t('llm.searchModels')"
            [value]="search()"
            (input)="setSearch($event)"
            (keydown)="onSearchKey($event)"
          /><button
            type="button"
            class="btn btn--small"
            data-testid="llm-refresh-models"
            [disabled]="busy() || !canDiscover()"
            (click)="discover()"
          >
            {{ t('llm.refresh') }}
          </button>
        </div>
        <div
          class="llm-picker__list"
          id="llm-model-options"
          role="listbox"
          [attr.aria-label]="t('llm.chooseModel')"
        >
          @for (model of filteredModels(); track model.id) {
            <button
              type="button"
              role="option"
              class="llm-option"
              [attr.aria-selected]="currentModel()?.id === model.id"
              [disabled]="busy()"
              (click)="pickModel(model)"
            >
              <span>{{ model.id }}</span>
              @if (model.displayName !== model.id) {
                <span class="muted small">{{ model.displayName }}</span>
              }
            </button>
          } @empty {
            <p class="muted small llm-empty">{{ t('llm.noMatchingModels') }}</p>
          }
        </div>
      </div>
    </section>
  `,
})
export class LlmSettingsComponent implements OnDestroy {
  private readonly state = inject(AppStateService);
  protected readonly t = inject(I18nService).t;
  protected readonly settings = this.state.llmSettings;
  protected readonly busy = signal(false);
  protected readonly loading = signal(true);
  protected readonly notice = signal<MessageKey | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly discovered = signal<readonly ModelDefinition[]>([]);
  protected readonly search = signal('');
  protected readonly pickerOpen = signal(false);
  protected readonly kinds: readonly LlmProviderKind[] = [
    'deepseek',
    'openai',
    'openai-compatible',
  ];
  private readonly modelAnchor = viewChild<ElementRef<HTMLElement>>('modelAnchor');
  private readonly modelPopover = viewChild<ElementRef<HTMLElement>>('modelPopover');
  private readonly modelSearch = viewChild<ElementRef<HTMLInputElement>>('modelSearch');
  protected draft: ProviderDraft | null = null;
  protected keyDraft = '';
  protected editingIndex = 0;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.load();
    });
  }
  private async load(): Promise<void> {
    try {
      await this.state.loadLlmSettings();
      if (this.destroyed) return;
      const settings = this.settings();
      const provider =
        settings?.providers.find((p) => p.id === settings.active?.providerConfigId) ??
        settings?.providers[0];
      if (provider) this.edit(provider);
      else this.add();
    } catch {
      this.notice.set('llm.failed');
    } finally {
      this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.keyDraft = '';
    this.hidePicker();
  }
  protected saved(): ProviderStatus | undefined {
    return this.settings()?.providers.find((p) => p.id === this.draft?.id);
  }
  protected kindLabel(kind: LlmProviderKind): string {
    if (kind === 'openai-compatible') return this.t('llm.custom');
    return kind === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  }
  private editable(model: ModelDefinition): EditableModel {
    return {
      ...model,
      tokenParameter: model.tokenParameter ?? 'max_tokens',
      supportsTemperature: model.supportsTemperature ?? true,
      supportsSeed: model.supportsSeed ?? true,
    };
  }
  protected edit(provider: ProviderConfig, preferred?: string): void {
    this.keyDraft = '';
    this.notice.set(null);
    this.confirmDelete.set(false);
    this.discovered.set([]);
    this.hidePicker();
    this.draft = { ...provider, models: provider.models.map((m) => this.editable(m)) };
    const active = this.settings()?.active;
    const id =
      preferred ??
      (active?.providerConfigId === provider.id ? active.modelId : provider.models[0]?.id);
    this.editingIndex = Math.max(
      0,
      provider.models.findIndex((m) => m.id === id),
    );
  }
  protected add(): void {
    this.edit({
      id: `custom-${crypto.randomUUID()}`,
      name: '',
      kind: 'openai-compatible',
      baseUrl: '',
      models: [{ id: '', displayName: '' }],
    });
  }
  protected chooseKind(kind: LlmProviderKind): void {
    if (this.draft?.kind === kind) return;
    const preset = DEFAULT_PROVIDER_CONFIGS.find((p) => p.kind === kind);
    if (preset) this.edit(this.settings()?.providers.find((p) => p.id === preset.id) ?? preset);
    else this.add();
  }
  protected currentModel(): EditableModel | undefined {
    return this.draft?.models[this.editingIndex];
  }
  protected setField(field: 'name' | 'baseUrl', event: Event): void {
    if (this.draft) this.draft[field] = (event.target as HTMLInputElement).value;
    if (field === 'baseUrl') {
      this.discovered.set([]);
      this.hidePicker();
    }
  }
  protected setKey(event: Event): void {
    this.keyDraft = (event.target as HTMLInputElement).value;
    this.discovered.set([]);
  }
  protected setModelId(event: Event): void {
    const model = this.currentModel();
    if (!model) return;
    const value = (event.target as HTMLInputElement).value;
    const known = this.modelOptions().find((m) => m.id === model.id);
    if (
      !model.displayName ||
      model.displayName === model.id ||
      model.displayName === known?.displayName
    )
      model.displayName = value;
    model.id = value;
  }
  protected setModelName(event: Event): void {
    const model = this.currentModel();
    if (model) model.displayName = (event.target as HTMLInputElement).value;
  }
  protected setOutputLimit(event: Event): void {
    const model = this.currentModel();
    if (model) {
      const value = (event.target as HTMLInputElement).value;
      model.maxOutputTokens = value ? Number(value) : null;
    }
  }
  protected setTokenParameter(event: Event): void {
    const model = this.currentModel();
    if (model)
      model.tokenParameter = (event.target as HTMLSelectElement).value as
        'max_tokens' | 'max_completion_tokens';
  }
  protected setModelFlag(field: 'supportsTemperature' | 'supportsSeed', event: Event): void {
    const model = this.currentModel();
    if (model) model[field] = (event.target as HTMLInputElement).checked;
  }
  protected modelOptions(): readonly ModelDefinition[] {
    const options = new Map<string, ModelDefinition>();
    for (const model of [...(this.saved()?.models ?? []), ...this.discovered()])
      options.set(model.id, model);
    return [...options.values()];
  }
  protected filteredModels(): readonly ModelDefinition[] {
    const query = this.search().trim().toLowerCase();
    return this.modelOptions().filter((m) =>
      `${m.id} ${m.displayName}`.toLowerCase().includes(query),
    );
  }
  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
  protected openPicker(): void {
    if (this.modelOptions().length === 0 || this.busy()) return;
    this.search.set('');
    const popover = this.modelPopover()?.nativeElement;
    if (!popover) return;
    popover.showPopover();
    this.pickerOpen.set(true);
    this.modelSearch()?.nativeElement.focus();
  }
  private hidePicker(): void {
    const popover = this.modelPopover()?.nativeElement;
    if (popover?.isConnected && popover.matches(':popover-open')) popover.hidePopover();
    this.pickerOpen.set(false);
  }
  protected onPickerToggle(event: Event): void {
    this.pickerOpen.set((event as Event & { newState: string }).newState === 'open');
  }
  protected onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const model = this.filteredModels()[0];
      if (model) this.pickModel(model);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.modelPopover()
        ?.nativeElement.querySelector<HTMLButtonElement>('[role="option"]')
        ?.focus();
    }
  }
  protected pickModel(model: ModelDefinition): void {
    if (!this.draft) return;
    const index = this.draft.models.findIndex((m) => m.id === model.id);
    if (index >= 0) this.editingIndex = index;
    else this.draft.models[this.editingIndex] = this.editable(model);
    this.hidePicker();
    this.modelAnchor()?.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
  }
  protected editModel(index: number): void {
    this.editingIndex = index;
  }
  protected addModel(): void {
    if (!this.draft) return;
    this.draft.models.push(this.editable({ id: '', displayName: '' }));
    this.editingIndex = this.draft.models.length - 1;
    this.modelAnchor()?.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
  }
  protected removeModel(): void {
    if (!this.draft || this.draft.models.length < 2) return;
    this.draft.models.splice(this.editingIndex, 1);
    this.editingIndex = 0;
  }
  private config(): ProviderConfig {
    if (!this.draft) throw new Error('No provider');
    return parseProviderConfig({
      ...this.draft,
      models: this.draft.models.map((m) => ({
        ...m,
        displayName: m.displayName.trim() || m.id.trim(),
        maxOutputTokens: m.maxOutputTokens ?? undefined,
      })),
    });
  }
  protected urlChanged(): boolean {
    try {
      return (
        this.saved() !== undefined &&
        normalizeLlmBaseUrl(this.draft?.baseUrl ?? '') !== this.saved()?.baseUrl
      );
    } catch {
      return this.saved() !== undefined;
    }
  }
  protected hasCredential(): boolean {
    return (
      Boolean(this.keyDraft.trim()) ||
      (!this.urlChanged() && this.saved() !== undefined && this.saved()?.keySource !== 'none')
    );
  }
  protected canDiscover(): boolean {
    try {
      if (!this.draft) return false;
      parseProviderConnection(this.draft);
      return this.hasCredential();
    } catch {
      return false;
    }
  }
  protected canSave(): boolean {
    try {
      this.config();
      return !this.keyDraft.trim() || this.settings()?.canStore === true;
    } catch {
      return false;
    }
  }
  private comparable(provider: ProviderConfig): string {
    return JSON.stringify({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      models: provider.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        maxOutputTokens: m.maxOutputTokens,
        tokenParameter: m.tokenParameter ?? 'max_tokens',
        supportsTemperature: m.supportsTemperature ?? true,
        supportsSeed: m.supportsSeed ?? true,
      })),
    });
  }
  protected dirty(): boolean {
    const saved = this.saved();
    if (!saved || this.keyDraft.trim()) return true;
    try {
      return this.comparable(this.config()) !== this.comparable(saved);
    } catch {
      return true;
    }
  }
  protected verified(): boolean {
    return (
      !this.dirty() &&
      (this.saved()?.verifiedModels.includes(this.currentModel()?.id ?? '') ?? false)
    );
  }
  private async work(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      await action();
    } catch {
      this.notice.set('llm.failed');
    } finally {
      this.busy.set(false);
    }
  }
  protected async discover(): Promise<void> {
    if (!this.draft || !this.canDiscover()) return;
    const provider = parseProviderConnection(this.draft);
    const apiKey = this.keyDraft.trim();
    let open = false;
    await this.work(async () => {
      const result = await this.state.discoverLlmModels({
        provider,
        ...(apiKey ? { apiKey } : {}),
      });
      if (this.destroyed) return;
      if (!result.ok) {
        this.notice.set(`llm.test.${result.reason}`);
        return;
      }
      this.discovered.set(result.models);
      open = result.models.length > 0;
      this.notice.set(open ? null : 'llm.noModels');
    });
    if (open && !this.destroyed) this.openPicker();
  }
  protected async save(activate: boolean): Promise<void> {
    const changed = this.dirty();
    const apiKey = this.keyDraft.trim();
    const modelId = this.currentModel()?.id.trim();
    this.keyDraft = '';
    await this.work(async () => {
      const provider = this.config();
      if (!activate || changed)
        await this.state.saveLlmProvider({ provider, ...(apiKey ? { apiKey } : {}) });
      if (activate && modelId)
        await this.state.selectLlmModel({ providerConfigId: provider.id, modelId });
      if (!this.destroyed) {
        this.edit(provider, modelId);
        this.notice.set(activate ? 'llm.activated' : 'llm.saved');
      }
    });
  }
  protected async test(): Promise<void> {
    if (this.dirty() || !this.draft) return;
    const providerConfigId = this.draft.id;
    const modelId = this.currentModel()?.id;
    if (!modelId) return;
    await this.work(async () => {
      const result = await this.state.testLlmModel({ providerConfigId, modelId });
      this.notice.set(result.ok ? 'llm.test.ok' : `llm.test.${result.reason ?? 'bad-response'}`);
    });
  }
  protected async clearKey(): Promise<void> {
    const id = this.draft?.id;
    if (!id) return;
    await this.work(async () => {
      await this.state.clearLlmProviderKey(id);
      this.keyDraft = '';
      this.notice.set('llm.keyRemoved');
    });
  }
  protected async remove(): Promise<void> {
    const id = this.draft?.id;
    if (!id) return;
    await this.work(async () => {
      await this.state.removeLlmProvider(id);
      const first = this.settings()?.providers[0];
      if (first) this.edit(first);
      else this.add();
      this.notice.set('llm.removed');
    });
  }
  protected async useLocal(): Promise<void> {
    await this.work(async () => {
      await this.state.selectLlmModel(null);
      this.notice.set('llm.localActive');
    });
  }
}
