//! Action registry for module-declared actions.

use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("Action not found: {0}")]
    ActionNotFound(String),
    #[error("Module not found: {0}")]
    ModuleNotFound(String),
}

pub type RegistryResult<T> = Result<T, RegistryError>;

#[derive(Debug, Clone)]
pub struct ActionMetadata {
    pub module_id: String,
    pub action_id: String,
    pub resource_type: String,
    pub verb: String,
}

/// Registry of module-declared actions
pub struct ActionRegistry {
    actions: HashMap<String, ActionMetadata>,
}

impl ActionRegistry {
    pub fn new() -> Self {
        Self {
            actions: HashMap::new(),
        }
    }

    pub fn register(&mut self, metadata: ActionMetadata) {
        self.actions.insert(metadata.action_id.clone(), metadata);
    }

    pub fn get(&self, action_id: &str) -> RegistryResult<&ActionMetadata> {
        self.actions
            .get(action_id)
            .ok_or_else(|| RegistryError::ActionNotFound(action_id.to_string()))
    }
}

impl Default for ActionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_registry() {
        let mut registry = ActionRegistry::new();

        let metadata = ActionMetadata {
            module_id: "ContentPages".to_string(),
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            verb: "create".to_string(),
        };

        registry.register(metadata.clone());

        let retrieved = registry.get("ContentPages.Page.Create").unwrap();
        assert_eq!(retrieved.module_id, "ContentPages");
        assert_eq!(retrieved.verb, "create");
    }
}
