//! Grouping meshes into separate output files by IFC spatial tier.
//!
//! IFC's spatial structure is `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey`.
//! The user picks a tier; every element is assigned to its nearest ancestor of that tier,
//! and each such ancestor becomes one output GLB. Depth-based splitting (rvm2glb's
//! numeric `--level`) is deliberately not used — IFC tree depth is inconsistent (D-007).

use std::collections::HashMap;

use ifc_lite_processing::QuickMetadataSpatialNode;

/// Which spatial tier to split output files at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SplitTier {
    /// One file for the whole model.
    #[default]
    None,
    Site,
    Building,
    Storey,
}

impl SplitTier {
    /// The IFC type name that marks a boundary at this tier, if any.
    fn ifc_type(self) -> Option<&'static str> {
        match self {
            SplitTier::None => None,
            SplitTier::Site => Some("IfcSite"),
            SplitTier::Building => Some("IfcBuilding"),
            SplitTier::Storey => Some("IfcBuildingStorey"),
        }
    }

    /// Parse a CLI/JS token (`none|site|building|storey`).
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "none" | "" => Some(SplitTier::None),
            "site" => Some(SplitTier::Site),
            "building" => Some(SplitTier::Building),
            "storey" | "story" => Some(SplitTier::Storey),
            _ => None,
        }
    }
}

/// The split node an element belongs to: a display `name` and the express id of the
/// spatial node (0 when the model isn't split / no spatial container was found).
#[derive(Debug, Clone)]
pub struct Group {
    pub node_id: u32,
    pub name: String,
}

/// Map every element express id to its group at `tier`, from the spatial tree. Elements
/// not found under any tier node (or when `tier` is `None`, or when there is no tree) fall
/// into the returned default group. Returns `(assignment, default_group)`.
pub fn assign_groups(
    tier: SplitTier,
    tree: Option<&QuickMetadataSpatialNode>,
    root_name: &str,
) -> (HashMap<u32, Group>, Group) {
    let default = Group {
        node_id: 0,
        name: root_name.to_string(),
    };
    let mut out: HashMap<u32, Group> = HashMap::new();
    let (Some(ty), Some(tree)) = (tier.ifc_type(), tree) else {
        return (out, default);
    };
    walk(tree, ty, None, &mut out);
    (out, default)
}

/// DFS carrying the nearest ancestor group of the requested tier type. Every element under
/// a node inherits that node's group.
fn walk(
    node: &QuickMetadataSpatialNode,
    tier_type: &str,
    current: Option<&Group>,
    out: &mut HashMap<u32, Group>,
) {
    // A node of the requested type opens (or replaces) the current group. ifc-lite reports
    // `type_name` in raw IFC upper-case (e.g. "IFCBUILDINGSTOREY"), so compare loosely.
    let own = if node.summary.type_name.eq_ignore_ascii_case(tier_type) {
        Some(Group {
            node_id: node.summary.express_id,
            name: node_label(node),
        })
    } else {
        None
    };
    let active = own.as_ref().or(current);

    if let Some(g) = active {
        for el in &node.elements {
            out.insert(el.express_id, g.clone());
        }
    }
    for child in &node.children {
        walk(child, tier_type, active, out);
    }
}

fn node_label(node: &QuickMetadataSpatialNode) -> String {
    let n = node.summary.name.trim();
    if n.is_empty() {
        format!("{}#{}", node.summary.type_name, node.summary.express_id)
    } else {
        n.to_string()
    }
}

/// Sanitise a group name into a safe file stem.
pub fn file_stem(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    s = s.trim_matches('_').to_string();
    if s.is_empty() { "model".to_string() } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_parse_roundtrip() {
        assert_eq!(SplitTier::parse("storey"), Some(SplitTier::Storey));
        assert_eq!(SplitTier::parse("SITE"), Some(SplitTier::Site));
        assert_eq!(SplitTier::parse("none"), Some(SplitTier::None));
        assert_eq!(SplitTier::parse("nope"), None);
    }

    #[test]
    fn file_stem_sanitises() {
        assert_eq!(file_stem("Level 1: Ground"), "Level_1__Ground");
        assert_eq!(file_stem("   "), "model");
        assert_eq!(file_stem("A/B\\C"), "A_B_C");
    }

    #[test]
    fn none_tier_yields_empty_assignment() {
        let (map, def) = assign_groups(SplitTier::None, None, "model");
        assert!(map.is_empty());
        assert_eq!(def.name, "model");
    }
}
