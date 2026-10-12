//! 双层配置（Codex / Claude）
//!
//! 每个 Codex / Claude 供应商保存两层配置（`meta.codexConfigLayers` /
//! `meta.claudeConfigLayers`）：服务商独立配置，以及最近一次保存最终配置时采用的
//! 通用配置快照。供应商存储的是合并后的最终配置（Codex 为 `settings_config.config`
//! 中的 TOML，Claude 为整个 `settings_config`），切换、启动同步和代理恢复都直接使用它。
//! 共享通用配置只在“最终配置”保存时进入某个供应商。

use serde::Serialize;
use serde_json::Value;

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::{ConfigLayers, Provider};
use crate::services::mcp::McpService;
use crate::store::AppState;

use super::live::{
    self, app_supports_config_layers, merge_config_layers, provider_config_layers,
    provider_has_config_layers, set_provider_config_layers, strip_common_config_from_live_settings,
    validate_config_layer,
};
use super::ProviderService;

/// 保存最终配置的结果：数据库已保存；若为当前供应商，`applied` 表示是否已同步到文件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalConfigSaveResult {
    pub is_current: bool,
    pub applied: bool,
    pub apply_error: Option<String>,
}

fn ensure_layered_app(app_type: &AppType) -> Result<(), AppError> {
    if app_supports_config_layers(app_type) {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "{} 不支持双层配置",
            app_type.as_str()
        )))
    }
}

/// 供应商存储中的最终配置文本：Codex 取 `config` 字段，Claude 为整个配置的 JSON。
fn settings_config_text(app_type: &AppType, settings: &Value) -> String {
    match app_type {
        AppType::Claude => serde_json::to_string_pretty(settings).unwrap_or_default(),
        _ => settings
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

/// 把最终配置文本写回供应商存储：Codex 写入 `config` 字段，Claude 替换整个配置。
fn set_settings_config_text(
    app_type: &AppType,
    settings: &mut Value,
    config: String,
) -> Result<(), AppError> {
    match app_type {
        AppType::Claude => {
            let value = if config.trim().is_empty() {
                Value::Object(Default::default())
            } else {
                serde_json::from_str::<Value>(&config)
                    .map_err(|e| AppError::Message(format!("最终配置 JSON 格式无效: {e}")))?
            };
            if !value.is_object() {
                return Err(AppError::Message("最终配置必须是 JSON 对象".to_string()));
            }
            *settings = value;
        }
        _ => {
            if let Some(obj) = settings.as_object_mut() {
                obj.insert("config".to_string(), Value::String(config));
            }
        }
    }
    Ok(())
}

fn load_provider(state: &AppState, app_type: &AppType, id: &str) -> Result<Provider, AppError> {
    state
        .db
        .get_provider_by_id(id, app_type.as_str())?
        .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))
}

fn live_config_path(app_type: &AppType) -> std::path::PathBuf {
    match app_type {
        AppType::Claude => crate::config::get_claude_settings_path(),
        _ => crate::codex_config::get_codex_config_path(),
    }
}

impl ProviderService {
    /// 把旧格式供应商固定为双层配置：按原有规则算出当前最终配置，
    /// 并用现有继承标记与剥离逻辑初始化两层内容。已转换的供应商保持不变。
    pub(crate) fn convert_legacy_layered_provider(
        db: &Database,
        app_type: &AppType,
        provider: &Provider,
    ) -> Result<Provider, AppError> {
        let snippet = db.get_config_snippet(app_type.as_str())?;
        let common_snippet = snippet.as_deref().filter(|snippet| {
            !snippet.trim().is_empty()
                && live::provider_uses_common_config(app_type, provider, Some(snippet))
        });

        // 只叠加通用配置；Claude 写 live 时动态注入的上下文默认值不固化进最终配置。
        let effective = match common_snippet {
            Some(snippet_text) => live::apply_common_config_to_settings(
                app_type,
                &provider.settings_config,
                snippet_text,
            )
            .unwrap_or_else(|err| {
                log::warn!(
                    "Failed to apply common config while converting {} provider '{}': {err}",
                    app_type.as_str(),
                    provider.id
                );
                provider.settings_config.clone()
            }),
            None => provider.settings_config.clone(),
        };
        let stored_config = settings_config_text(app_type, &provider.settings_config);
        let final_config = settings_config_text(app_type, &effective);

        let (provider_config, common_config) = match common_snippet {
            Some(snippet_text) => {
                let stripped = live::remove_common_config_from_settings(
                    app_type,
                    &provider.settings_config,
                    snippet_text,
                )
                .map(|settings| settings_config_text(app_type, &settings))
                .unwrap_or_else(|err| {
                    log::warn!(
                        "Failed to strip common config while converting {} provider '{}': {err}",
                        app_type.as_str(),
                        provider.id
                    );
                    stored_config.clone()
                });
                (stripped, snippet_text.to_string())
            }
            None => (stored_config.clone(), String::new()),
        };

        let mut converted = provider.clone();
        match app_type {
            AppType::Claude => converted.settings_config = effective,
            _ => {
                if provider.settings_config.get("config").is_some() || !final_config.is_empty() {
                    set_settings_config_text(
                        app_type,
                        &mut converted.settings_config,
                        final_config,
                    )?;
                }
            }
        }
        set_provider_config_layers(
            app_type,
            &mut converted,
            ConfigLayers {
                provider_config,
                common_config,
            },
        );
        Ok(converted)
    }

    /// 兼容转换：幂等，只处理缺少分层元数据的供应商。
    /// 必须在首次修改共享通用配置之前执行，否则旧供应商的最终配置会随之改变。
    pub fn ensure_config_layers(state: &AppState, app_type: &AppType) -> Result<(), AppError> {
        ensure_layered_app(app_type)?;
        let providers = state.db.get_all_providers(app_type.as_str())?;
        for provider in providers.values() {
            if provider_has_config_layers(app_type, provider) {
                continue;
            }
            match Self::convert_legacy_layered_provider(state.db.as_ref(), app_type, provider) {
                Ok(converted) => {
                    state.db.save_provider(app_type.as_str(), &converted)?;
                    log::info!(
                        "{} 供应商 '{}' 已转换为双层配置",
                        app_type.as_str(),
                        provider.id
                    );
                }
                Err(err) => {
                    log::warn!(
                        "{} 供应商 '{}' 双层配置转换失败: {err}",
                        app_type.as_str(),
                        provider.id
                    );
                }
            }
        }
        Ok(())
    }

    /// 新增供应商：带分层元数据时按“服务商优先”规则与共享通用配置合并出
    /// 最终配置；不带时（导入、深链接等旧入口）按旧规则固定。
    pub(crate) fn prepare_layers_for_add(
        db: &Database,
        app_type: &AppType,
        provider: &mut Provider,
    ) -> Result<(), AppError> {
        let Some(layers) = provider_config_layers(app_type, provider).cloned() else {
            *provider = Self::convert_legacy_layered_provider(db, app_type, provider)?;
            return Ok(());
        };

        validate_config_layer(app_type, &layers.provider_config, "服务商配置")?;
        let common_config = db
            .get_config_snippet(app_type.as_str())?
            .unwrap_or_default();
        let final_config = merge_config_layers(app_type, &common_config, &layers.provider_config)?;
        set_settings_config_text(app_type, &mut provider.settings_config, final_config)?;
        set_provider_config_layers(
            app_type,
            provider,
            ConfigLayers {
                provider_config: layers.provider_config,
                common_config,
            },
        );
        Ok(())
    }

    /// 编辑表单保存当前供应商时，真实配置文件才是它最新的最终配置（可能被外部修改过），
    /// 按切走回填的同一套规则读取；代理接管或读取失败时返回 None，沿用数据库中的最终配置。
    pub(crate) fn live_final_config_for_update(
        state: &AppState,
        app_type: &AppType,
        existing: &Provider,
    ) -> Option<String> {
        if !provider_has_config_layers(app_type, existing) {
            return None;
        }
        let current_id =
            crate::settings::get_effective_current_provider(&state.db, app_type).ok()??;
        if current_id != existing.id {
            return None;
        }
        let has_live_backup =
            futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))
                .ok()?
                .is_some();
        if has_live_backup
            || state
                .proxy_service
                .detect_takeover_in_live_config_for_app(app_type)
        {
            return None;
        }
        let live_settings = live::read_live_settings(app_type.clone()).ok()?;
        let backfilled =
            strip_common_config_from_live_settings(state.db.as_ref(), app_type, existing, live_settings);
        match app_type {
            AppType::Claude => backfilled
                .is_object()
                .then(|| settings_config_text(app_type, &backfilled)),
            _ => backfilled
                .get("config")
                .and_then(Value::as_str)
                .map(str::to_string),
        }
    }

    /// 编辑表单保存（元数据、认证等）时，分层内容与最终配置以数据库为准，
    /// 避免表单里的旧快照覆盖已单独保存的标签页内容。
    pub(crate) fn reconcile_layers_for_update(
        db: &Database,
        app_type: &AppType,
        existing: Option<&Provider>,
        provider: &mut Provider,
        preserve_saved_config: bool,
        live_final_config: Option<String>,
    ) -> Result<(), AppError> {
        if preserve_saved_config {
            if let Some(existing) = existing {
                if let Some(layers) = provider_config_layers(app_type, existing).cloned() {
                    set_provider_config_layers(app_type, provider, layers);
                    match app_type {
                        AppType::Claude => {
                            provider.settings_config = match live_final_config {
                                Some(config) => serde_json::from_str(&config)
                                    .unwrap_or_else(|_| existing.settings_config.clone()),
                                None => existing.settings_config.clone(),
                            };
                        }
                        _ => {
                            let saved_config = live_final_config
                                .map(Value::String)
                                .or_else(|| existing.settings_config.get("config").cloned());
                            if let Some(obj) = provider.settings_config.as_object_mut() {
                                match saved_config {
                                    Some(config) => {
                                        obj.insert("config".to_string(), config);
                                    }
                                    None => {
                                        obj.remove("config");
                                    }
                                }
                            }
                        }
                    }
                    return Ok(());
                }
            }
        }

        if !provider_has_config_layers(app_type, provider) {
            *provider = Self::convert_legacy_layered_provider(db, app_type, provider)?;
        }
        Ok(())
    }

    /// 只读合并预览，与保存最终配置共用同一套合并逻辑。
    pub fn preview_layered_config(
        app_type: &AppType,
        common_config: &str,
        provider_config: &str,
    ) -> Result<String, AppError> {
        merge_config_layers(app_type, common_config, provider_config)
    }

    /// 保存服务商配置层：只更新分层元数据中的 `providerConfig`。
    pub fn save_layered_provider_config(
        state: &AppState,
        app_type: &AppType,
        id: &str,
        provider_config: &str,
    ) -> Result<(), AppError> {
        validate_config_layer(app_type, provider_config, "服务商配置")?;
        Self::ensure_config_layers(state, app_type)?;

        let _guard = futures::executor::block_on(
            state.proxy_service.lock_switch_for_app(app_type.as_str()),
        );
        let mut provider = load_provider(state, app_type, id)?;
        let mut layers = provider_config_layers(app_type, &provider)
            .cloned()
            .unwrap_or_default();
        layers.provider_config = provider_config.to_string();
        set_provider_config_layers(app_type, &mut provider, layers);
        state.db.save_provider(app_type.as_str(), &provider)
    }

    /// 保存最终配置：按已保存的服务商配置与最新共享通用配置重新合并，写入
    /// 供应商存储并记录通用配置快照；当前供应商随即同步到文件。
    ///
    /// # Arguments
    /// * `state` - 应用状态。
    /// * `app_type` - 应用类型（Codex / Claude）。
    /// * `id` - 服务商标识。
    /// * `expected_live_config` - 预览时读取的磁盘文件。
    /// * `expected_is_current` - 预览时的当前服务商身份。
    /// * `expected_final_config` - 用户已查看的合并结果。
    ///
    /// # Returns
    /// 保存及应用结果；基线变化时返回错误。
    pub fn save_layered_final_config(
        state: &AppState,
        app_type: &AppType,
        id: &str,
        expected_live_config: Option<&str>,
        expected_is_current: bool,
        expected_final_config: &str,
    ) -> Result<FinalConfigSaveResult, AppError> {
        Self::ensure_config_layers(state, app_type)?;

        let mut provider = load_provider(state, app_type, id)?;
        let provider_config = provider_config_layers(app_type, &provider)
            .map(|layers| layers.provider_config.clone())
            .unwrap_or_default();
        let common_config = state
            .db
            .get_config_snippet(app_type.as_str())?
            .unwrap_or_default();
        let final_config = merge_config_layers(app_type, &common_config, &provider_config)?;
        if final_config != expected_final_config {
            return Err(AppError::Message(
                "配置层已变化，请重新查看应用预览。".to_string(),
            ));
        }

        set_settings_config_text(app_type, &mut provider.settings_config, final_config)?;
        let layers = ConfigLayers {
            provider_config,
            common_config,
        };
        set_provider_config_layers(app_type, &mut provider, layers.clone());

        let is_current =
            crate::settings::get_effective_current_provider(&state.db, app_type)?.as_deref()
                == Some(id);

        if is_current != expected_is_current {
            return Err(AppError::Message(
                "当前服务商已变化，请重新查看应用预览。".to_string(),
            ));
        }
        if is_current {
            let live_config = Self::read_layered_live_config_text(app_type)?;
            if expected_live_config != Some(live_config.as_str()) {
                return Err(AppError::Message(
                    "磁盘配置已变化，请重新查看应用预览。".to_string(),
                ));
            }
            let has_live_backup =
                futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))?
                    .is_some();
            if has_live_backup
                || state
                    .proxy_service
                    .detect_takeover_in_live_config_for_app(app_type)
            {
                return Err(AppError::Message(
                    "代理接管期间请先退出接管，再应用配置。".to_string(),
                ));
            }
        }

        let saved_settings = provider.settings_config.clone();
        match Self::update_with_options(state, app_type.clone(), None, provider, false) {
            Ok(_) => Ok(FinalConfigSaveResult {
                is_current,
                applied: is_current,
                apply_error: None,
            }),
            Err(err) => {
                // 非托管路径先落库再写文件：数据库已是新结果时属于“已保存，应用失败”。
                let saved = state
                    .db
                    .get_provider_by_id(id, app_type.as_str())?
                    .is_some_and(|stored| {
                        settings_config_text(app_type, &stored.settings_config)
                            == settings_config_text(app_type, &saved_settings)
                            && provider_config_layers(app_type, &stored) == Some(&layers)
                    });
                if saved && is_current {
                    Ok(FinalConfigSaveResult {
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

    /// 读取真实的配置文件（Codex `config.toml` / Claude `settings.json`）。
    pub fn read_layered_live_config_text(app_type: &AppType) -> Result<String, AppError> {
        ensure_layered_app(app_type)?;
        let path = live_config_path(app_type);
        if !path.exists() {
            return Err(AppError::Message(format!(
                "{} 配置文件不存在: {}",
                app_type.as_str(),
                path.display()
            )));
        }
        std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))
    }

    fn write_layered_live_config_text(
        app_type: &AppType,
        config_text: &str,
    ) -> Result<(), AppError> {
        match app_type {
            AppType::Claude => {
                crate::config::write_text_file(&live_config_path(app_type), config_text)
            }
            _ => crate::codex_config::write_codex_live_config_atomic(Some(config_text)),
        }
    }

    fn validate_layered_live_config_text(
        app_type: &AppType,
        config_text: &str,
    ) -> Result<(), AppError> {
        match app_type {
            AppType::Claude => match serde_json::from_str::<Value>(config_text) {
                Ok(value) if value.is_object() => Ok(()),
                Ok(_) => Err(AppError::Message(
                    "Claude 配置文件必须是 JSON 对象".to_string(),
                )),
                Err(e) => Err(AppError::Message(format!(
                    "Claude 配置文件 JSON 格式无效: {e}"
                ))),
            },
            _ => crate::codex_config::validate_config_toml(config_text),
        }
    }

    /// 直接保存当前配置文件（仅当前供应商），并把文件内容回填为该供应商的最终配置；
    /// 两层配置保持不变。
    ///
    /// # Arguments
    /// * `state` - 应用状态。
    /// * `app_type` - 应用类型（Codex / Claude）。
    /// * `id` - 当前服务商标识。
    /// * `config_text` - 要写入的配置文本。
    /// * `expected_live_config` - 编辑前读取的磁盘内容。
    ///
    /// # Returns
    /// 写入成功返回空值，文件变化或保存失败时返回错误。
    pub fn save_layered_live_config_text(
        state: &AppState,
        app_type: &AppType,
        id: &str,
        config_text: &str,
        expected_live_config: &str,
    ) -> Result<(), AppError> {
        ensure_layered_app(app_type)?;
        Self::validate_layered_live_config_text(app_type, config_text)?;
        Self::ensure_config_layers(state, app_type)?;

        {
            let _guard = futures::executor::block_on(
                state.proxy_service.lock_switch_for_app(app_type.as_str()),
            );

            let current_id = crate::settings::get_effective_current_provider(&state.db, app_type)?;
            if current_id.as_deref() != Some(id) {
                return Err(AppError::Message(
                    "只有当前启用的服务商可以保存当前配置".to_string(),
                ));
            }

            let has_live_backup =
                futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))?
                    .is_some();
            if has_live_backup
                || state
                    .proxy_service
                    .detect_takeover_in_live_config_for_app(app_type)
            {
                return Err(AppError::Message(
                    "代理接管期间不能直接编辑当前配置".to_string(),
                ));
            }

            let mut provider = load_provider(state, app_type, id)?;
            if Self::read_layered_live_config_text(app_type)? != expected_live_config {
                return Err(AppError::Message(
                    "磁盘配置已变化，请重新读取后检查修改。".to_string(),
                ));
            }
            Self::write_layered_live_config_text(app_type, config_text)?;

            let live_settings = live::read_live_settings(app_type.clone())?;
            provider.settings_config = strip_common_config_from_live_settings(
                state.db.as_ref(),
                app_type,
                &provider,
                live_settings,
            );
            state
                .db
                .save_provider(app_type.as_str(), &provider)
                .map_err(|err| {
                    AppError::Message(format!(
                        "配置文件已保存，但更新服务商最终配置失败: {err}"
                    ))
                })?;
        }

        // Codex 的 MCP 投影在 config.toml 中，直接覆盖文件后需要重投影。
        if matches!(app_type, AppType::Codex) {
            if let Err(err) = McpService::sync_enabled_for_app(state, app_type) {
                log::warn!("保存 Codex 当前配置后重投影 MCP 失败（将在下次同步时自愈）: {err}");
            }
        }
        Ok(())
    }
}
