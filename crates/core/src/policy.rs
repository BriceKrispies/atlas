//! ABAC policy evaluation with deny-overrides-allow semantics.
//!
//! Implements Invariant I4: Deny-Overrides-Allow Authorization
//! - Any DENY rule overrides all ALLOW rules
//! - Default decision is DENY if no ALLOW matches
//! - Policy evaluation is deterministic

use crate::types::{Condition, Policy, PolicyEffect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvaluationContext {
    pub principal_attributes: HashMap<String, serde_json::Value>,
    pub resource_attributes: HashMap<String, serde_json::Value>,
    pub environment_attributes: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone)]
pub struct PolicyDecision {
    pub decision: Decision,
    pub matched_rules: Vec<String>,
    pub reason: String,
}

pub struct PolicyEngine;

impl PolicyEngine {
    pub fn new() -> Self {
        Self
    }

    /// Evaluate policies with deny-overrides-allow semantics
    pub fn evaluate(
        &self,
        policies: &[Policy],
        context: &PolicyEvaluationContext,
    ) -> PolicyDecision {
        let mut allow_rules = Vec::new();
        let mut deny_rules = Vec::new();

        // Evaluate all active policies
        for policy in policies {
            if !matches!(policy.status, crate::types::PolicyStatus::Active) {
                continue;
            }

            for rule in &policy.rules {
                if evaluate_condition(&rule.conditions, context) {
                    match rule.effect {
                        PolicyEffect::Allow => allow_rules.push(rule.rule_id.clone()),
                        PolicyEffect::Deny => deny_rules.push(rule.rule_id.clone()),
                    }
                }
            }
        }

        // Deny-overrides-allow: Any deny causes denial
        if !deny_rules.is_empty() {
            return PolicyDecision {
                decision: Decision::Deny,
                matched_rules: deny_rules,
                reason: "denied by explicit deny rule".to_string(),
            };
        }

        // If at least one allow and no deny, grant access
        if !allow_rules.is_empty() {
            return PolicyDecision {
                decision: Decision::Allow,
                matched_rules: allow_rules,
                reason: "allowed by matching policy".to_string(),
            };
        }

        // Default deny
        PolicyDecision {
            decision: Decision::Deny,
            matched_rules: Vec::new(),
            reason: "no matching policies".to_string(),
        }
    }
}

fn evaluate_condition(condition: &Condition, context: &PolicyEvaluationContext) -> bool {
    match condition {
        Condition::Literal { value } => *value,
        Condition::And { operands } => operands.iter().all(|op| evaluate_condition(op, context)),
        Condition::Or { operands } => operands.iter().any(|op| evaluate_condition(op, context)),
        Condition::Not { operand } => !evaluate_condition(operand, context),
        Condition::Equals { left, right } => {
            evaluate_condition(left, context) == evaluate_condition(right, context)
        }
        Condition::Attribute { path, source } => {
            let attrs = match source {
                crate::types::AttributeSource::Principal => &context.principal_attributes,
                crate::types::AttributeSource::Resource => &context.resource_attributes,
                crate::types::AttributeSource::Environment => &context.environment_attributes,
            };
            attrs.contains_key(path)
        }
    }
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience function for policy evaluation
pub fn evaluate_policy(policies: &[Policy], context: &PolicyEvaluationContext) -> PolicyDecision {
    PolicyEngine::new().evaluate(policies, context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PolicyRule, PolicyStatus};

    #[test]
    fn test_deny_overrides_allow() {
        let policies = vec![Policy {
            policy_id: "test-policy".to_string(),
            tenant_id: "tenant-001".to_string(),
            rules: vec![
                PolicyRule {
                    rule_id: "allow-rule".to_string(),
                    effect: PolicyEffect::Allow,
                    conditions: Condition::Literal { value: true },
                },
                PolicyRule {
                    rule_id: "deny-rule".to_string(),
                    effect: PolicyEffect::Deny,
                    conditions: Condition::Literal { value: true },
                },
            ],
            version: 1,
            status: PolicyStatus::Active,
        }];

        let context = PolicyEvaluationContext {
            principal_attributes: HashMap::new(),
            resource_attributes: HashMap::new(),
            environment_attributes: HashMap::new(),
        };

        let decision = evaluate_policy(&policies, &context);
        assert_eq!(decision.decision, Decision::Deny);
        assert!(decision.matched_rules.contains(&"deny-rule".to_string()));
    }

    #[test]
    fn test_allow_when_no_deny() {
        let policies = vec![Policy {
            policy_id: "test-policy".to_string(),
            tenant_id: "tenant-001".to_string(),
            rules: vec![PolicyRule {
                rule_id: "allow-rule".to_string(),
                effect: PolicyEffect::Allow,
                conditions: Condition::Literal { value: true },
            }],
            version: 1,
            status: PolicyStatus::Active,
        }];

        let context = PolicyEvaluationContext {
            principal_attributes: HashMap::new(),
            resource_attributes: HashMap::new(),
            environment_attributes: HashMap::new(),
        };

        let decision = evaluate_policy(&policies, &context);
        assert_eq!(decision.decision, Decision::Allow);
    }

    #[test]
    fn test_default_deny() {
        let policies = vec![Policy {
            policy_id: "test-policy".to_string(),
            tenant_id: "tenant-001".to_string(),
            rules: vec![PolicyRule {
                rule_id: "never-match".to_string(),
                effect: PolicyEffect::Allow,
                conditions: Condition::Literal { value: false },
            }],
            version: 1,
            status: PolicyStatus::Active,
        }];

        let context = PolicyEvaluationContext {
            principal_attributes: HashMap::new(),
            resource_attributes: HashMap::new(),
            environment_attributes: HashMap::new(),
        };

        let decision = evaluate_policy(&policies, &context);
        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.reason, "no matching policies");
    }
}
