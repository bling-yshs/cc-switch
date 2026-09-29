//! Codex 双层配置
//!
//! 每个 Codex 供应商保存两层配置（`meta.codexConfigLayers`）：服务商独立配置，
//! 以及最近一次保存最终配置时采用的通用配置快照。`settings_config.config`
//! 保存合并后的最终 TOML，切换、启动同步和代理恢复都直接使用它。
//! 共享通用配置只在“最终配置”保存时进入某个供应商。

use serde::Serialize;
use serde_json::Value;

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::{CodexConfigLayers, Provider};
use crate::services::mcp::McpService;
use crate::store::AppState;

use super::live::{
    self, codex_provider_has_config_layers, merge_codex_config_layers,
    strip_common_config_from_live_settings, validate_codex_layer_toml,
};
use super::ProviderService;

/// 保存最终配置的结果：数据库已保存；若为当前供应商，`applied` 表示是否已同步到文件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexFinalConfigSaveResult {
    pub is_current: bool,
    pub applied: bool,
    pub apply_error: Option<String>,
}

fn settings_config_text(settings: &Value) -> String {
    settings
        .get("config")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn set_settings_config_text(settings: &mut Value, config: String) {
    if let Some(obj) = settings.as_object_mut() {
        obj.insert("config".to_string(), Value::String(config));
    }
}

fn codex_layers_of(provider: &Provider) -> Option<&CodexConfigLayers> {
    provider
        .meta
        .as_ref()
        .and_then(|meta| meta.codex_config_layers.as_ref())
}

fn load_codex_provider(state: &AppState, id: &str) -> Result<Provider, AppError> {
    state
        .db
        .get_provider_by_id(id, AppType::Codex.as_str())?
        .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))
}

impl ProviderService {
    /// 把旧格式 Codex 供应商固定为双层配置：按原有规则算出当前最终配置，
    /// 并用现有继承标记与剥离逻辑初始化两层内容。已转换的供应商保持不变。
    pub(crate) fn convert_legacy_codex_provider(
        db: &Database,
        provider: &Provider,
    ) -> Result<Provider, AppError> {
        let snippet = db.get_config_snippet(AppType::Codex.as_str())?;
        let stored_config = settings_config_text(&provider.settings_config);
        let effective =
            live::build_effective_settings_with_common_config(db, &AppType::Codex, provider)?;
        let final_config = settings_config_text(&effective);

        let common_snippet = snippet.as_deref().filter(|snippet| {
            !snippet.trim().is_empty()
                && live::provider_uses_common_config(&AppType::Codex, provider, Some(snippet))
        });
        let (provider_config, common_config) = match common_snippet {
            Some(snippet_text) => {
                let stripped = live::remove_common_config_from_settings(
                    &AppType::Codex,
                    &provider.settings_config,
                    snippet_text,
                )
                .map(|settings| settings_config_text(&settings))
                .unwrap_or_else(|err| {
                    log::warn!(
                        "Failed to strip common config while converting Codex provider '{}': {err}",
                        provider.id
                    );
                    stored_config.clone()
                });
                (stripped, snippet_text.to_string())
            }
            None => (stored_config.clone(), String::new()),
        };

        let mut converted = provider.clone();
        if provider.settings_config.get("config").is_some() || !final_config.is_empty() {
            set_settings_config_text(&mut converted.settings_config, final_config);
        }
        converted
            .meta
            .get_or_insert_with(Default::default)
            .codex_config_layers = Some(CodexConfigLayers {
            provider_config,
            common_config,
        });
        Ok(converted)
    }

    /// 兼容转换：幂等，只处理缺少分层元数据的 Codex 供应商。
    /// 必须在首次修改共享通用配置之前执行，否则旧供应商的最终配置会随之改变。
    pub fn ensure_codex_config_layers(state: &AppState) -> Result<(), AppError> {
        let providers = state.db.get_all_providers(AppType::Codex.as_str())?;
        for provider in providers.values() {
            if codex_provider_has_config_layers(&AppType::Codex, provider) {
                continue;
            }
            match Self::convert_legacy_codex_provider(state.db.as_ref(), provider) {
                Ok(converted) => {
                    state.db.save_provider(AppType::Codex.as_str(), &converted)?;
                    log::info!("Codex 供应商 '{}' 已转换为双层配置", provider.id);
                }
                Err(err) => {
                    log::warn!("Codex 供应商 '{}' 双层配置转换失败: {err}", provider.id);
                }
            }
        }
        Ok(())
    }

    /// 新增 Codex 供应商：带分层元数据时按“服务商优先”规则与共享通用配置合并出
    /// 最终配置；不带时（导入、深链接等旧入口）按旧规则固定。
    pub(crate) fn prepare_codex_layers_for_add(
        db: &Database,
        provider: &mut Provider,
    ) -> Result<(), AppError> {
        let Some(layers) = codex_layers_of(provider).cloned() else {
            *provider = Self::convert_legacy_codex_provider(db, provider)?;
            return Ok(());
        };

        let common_config = db
            .get_config_snippet(AppType::Codex.as_str())?
            .unwrap_or_default();
        let final_config = merge_codex_config_layers(&common_config, &layers.provider_config)?;
        set_settings_config_text(&mut provider.settings_config, final_config);
        provider
            .meta
            .get_or_insert_with(Default::default)
            .codex_config_layers = Some(CodexConfigLayers {
            provider_config: layers.provider_config,
            common_config,
        });
        Ok(())
    }

    /// 编辑表单保存当前供应商时，真实 config.toml 才是它最新的最终配置（可能被外部修改过），
    /// 按切走回填的同一套规则读取；代理接管或读取失败时返回 None，沿用数据库中的最终配置。
    pub(crate) fn codex_live_final_config_for_update(
        state: &AppState,
        existing: &Provider,
    ) -> Option<String> {
        if !codex_provider_has_config_layers(&AppType::Codex, existing) {
            return None;
        }
        let current_id =
            crate::settings::get_effective_current_provider(&state.db, &AppType::Codex).ok()??;
        if current_id != existing.id {
            return None;
        }
        let has_live_backup =
            futures::executor::block_on(state.db.get_live_backup(AppType::Codex.as_str()))
                .ok()?
                .is_some();
        if has_live_backup
            || state
                .proxy_service
                .detect_takeover_in_live_config_for_app(&AppType::Codex)
        {
            return None;
        }
        let live_settings = live::read_live_settings(AppType::Codex).ok()?;
        let backfilled = strip_common_config_from_live_settings(
            state.db.as_ref(),
            &AppType::Codex,
            existing,
            live_settings,
        );
        backfilled
            .get("config")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// 编辑表单保存（元数据、认证等）时，分层内容与最终配置以数据库为准，
    /// 避免表单里的旧快照覆盖已单独保存的标签页内容。
    pub(crate) fn reconcile_codex_layers_for_update(
        db: &Database,
        existing: Option<&Provider>,
        provider: &mut Provider,
        preserve_saved_config: bool,
        live_final_config: Option<String>,
    ) -> Result<(), AppError> {
        if preserve_saved_config {
            if let Some(existing) = existing {
                if let Some(layers) = codex_layers_of(existing).cloned() {
                    provider
                        .meta
                        .get_or_insert_with(Default::default)
                        .codex_config_layers = Some(layers);
                    let saved_config = live_final_config
                        .map(Value::String)
                        .or_else(|| existing.settings_config.get("config").cloned());
                    match saved_config {
                        Some(config) => {
                            if let Some(obj) = provider.settings_config.as_object_mut() {
                                obj.insert("config".to_string(), config);
                            }
                        }
                        None => {
                            if let Some(obj) = provider.settings_config.as_object_mut() {
                                obj.remove("config");
                            }
                        }
                    }
                    return Ok(());
                }
            }
        }

        if !codex_provider_has_config_layers(&AppType::Codex, provider) {
            *provider = Self::convert_legacy_codex_provider(db, provider)?;
        }
        Ok(())
    }

    /// 只读合并预览，与保存最终配置共用同一套合并逻辑。
    pub fn preview_codex_config(
        common_config: &str,
        provider_config: &str,
    ) -> Result<String, AppError> {
        merge_codex_config_layers(common_config, provider_config)
    }

    /// 保存服务商配置层：只更新 `codexConfigLayers.providerConfig`。
    pub fn save_codex_provider_config(
        state: &AppState,
        id: &str,
        provider_config: &str,
    ) -> Result<(), AppError> {
        validate_codex_layer_toml(provider_config, "服务商配置")?;
        Self::ensure_codex_config_layers(state)?;

        let _guard = futures::executor::block_on(
            state
                .proxy_service
                .lock_switch_for_app(AppType::Codex.as_str()),
        );
        let mut provider = load_codex_provider(state, id)?;
        let meta = provider.meta.get_or_insert_with(Default::default);
        let layers = meta.codex_config_layers.get_or_insert_with(Default::default);
        layers.provider_config = provider_config.to_string();
        state.db.save_provider(AppType::Codex.as_str(), &provider)
    }

    /// 保存最终配置：按已保存的服务商配置与最新共享通用配置重新合并，写入
    /// `settings_config.config` 并记录通用配置快照；当前供应商随即同步到文件。
    pub fn save_codex_final_config(
        state: &AppState,
        id: &str,
    ) -> Result<CodexFinalConfigSaveResult, AppError> {
        Self::ensure_codex_config_layers(state)?;

        let mut provider = load_codex_provider(state, id)?;
        let provider_config = codex_layers_of(&provider)
            .map(|layers| layers.provider_config.clone())
            .unwrap_or_default();
        let common_config = state
            .db
            .get_config_snippet(AppType::Codex.as_str())?
            .unwrap_or_default();
        let final_config = merge_codex_config_layers(&common_config, &provider_config)?;

        set_settings_config_text(&mut provider.settings_config, final_config.clone());
        provider
            .meta
            .get_or_insert_with(Default::default)
            .codex_config_layers = Some(CodexConfigLayers {
            provider_config,
            common_config,
        });

        let is_current = crate::settings::get_effective_current_provider(
            &state.db,
            &AppType::Codex,
        )?
        .as_deref()
            == Some(id);

        match Self::update_with_options(state, AppType::Codex, None, provider.clone(), false) {
            Ok(_) => Ok(CodexFinalConfigSaveResult {
                is_current,
                applied: is_current,
                apply_error: None,
            }),
            Err(err) => {
                // 非托管路径先落库再写文件：数据库已是新结果时属于“已保存，应用失败”。
                let saved = state
                    .db
                    .get_provider_by_id(id, AppType::Codex.as_str())?
                    .is_some_and(|stored| {
                        settings_config_text(&stored.settings_config) == final_config
                            && codex_layers_of(&stored) == codex_layers_of(&provider)
                    });
                if saved && is_current {
                    Ok(CodexFinalConfigSaveResult {
                        is_current,
                        applied: false,
                        apply_error: Some(err.to_string()),
                    })
                } else {
                    Err(err)
                }
            }
        }
    }

    /// 读取真实的 `~/.codex/config.toml`。
    pub fn read_codex_live_config_text() -> Result<String, AppError> {
        let path = crate::codex_config::get_codex_config_path();
        if !path.exists() {
            return Err(AppError::Message(format!(
                "Codex 配置文件不存在: {}",
                path.display()
            )));
        }
        crate::codex_config::read_codex_config_text()
    }

    /// 直接保存当前配置文件（仅当前供应商），并把文件内容回填为该供应商的最终配置；
    /// 两层配置保持不变。
    pub fn save_codex_live_config_text(
        state: &AppState,
        id: &str,
        config_text: &str,
    ) -> Result<(), AppError> {
        crate::codex_config::validate_config_toml(config_text)?;
        Self::ensure_codex_config_layers(state)?;

        {
            let _guard = futures::executor::block_on(
                state
                    .proxy_service
                    .lock_switch_for_app(AppType::Codex.as_str()),
            );

            let current_id =
                crate::settings::get_effective_current_provider(&state.db, &AppType::Codex)?;
            if current_id.as_deref() != Some(id) {
                return Err(AppError::Message(
                    "只有当前启用的服务商可以保存当前配置".to_string(),
                ));
            }

            let has_live_backup = futures::executor::block_on(
                state.db.get_live_backup(AppType::Codex.as_str()),
            )?
            .is_some();
            if has_live_backup
                || state
                    .proxy_service
                    .detect_takeover_in_live_config_for_app(&AppType::Codex)
            {
                return Err(AppError::Message(
                    "代理接管期间不能直接编辑当前配置".to_string(),
                ));
            }

            let mut provider = load_codex_provider(state, id)?;
            crate::codex_config::write_codex_live_config_atomic(Some(config_text))?;

            let live_settings = live::read_live_settings(AppType::Codex)?;
            provider.settings_config = strip_common_config_from_live_settings(
                state.db.as_ref(),
                &AppType::Codex,
                &provider,
                live_settings,
            );
            state
                .db
                .save_provider(AppType::Codex.as_str(), &provider)
                .map_err(|err| {
                    AppError::Message(format!(
                        "配置文件已保存，但更新服务商最终配置失败: {err}"
                    ))
                })?;
        }

        if let Err(err) = McpService::sync_enabled_for_app(state, &AppType::Codex) {
            log::warn!("保存 Codex 当前配置后重投影 MCP 失败（将在下次同步时自愈）: {err}");
        }
        Ok(())
    }
}
